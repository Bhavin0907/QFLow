"""Queue business logic. Pure functions over a sqlite connection, no web framework,
so it can be tested directly and the API layer stays thin."""
import json
from datetime import datetime, timedelta

from . import eta_model
from . import timezone as tz
from .db import row_to_dict, write_transaction


class QueueError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def now_str() -> str:
    return tz.now_str()


def today_str() -> str:
    return tz.today_str()


def format_token(code: str, number: int) -> str:
    return f"{code}-{number:03d}"


def _parse_ts(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")


def _grace_expires_at(ts: str, grace_seconds: int) -> str:
    return (_parse_ts(ts) + timedelta(seconds=grace_seconds)).strftime("%Y-%m-%d %H:%M:%S")


def grace_seconds_left(token: dict) -> int | None:
    if token.get("status") != "called" or token.get("responded_at"):
        return None
    exp = token.get("grace_expires_at")
    if not exp:
        return None
    return max(0, int((_parse_ts(exp) - tz.now_naive()).total_seconds()))


# Waiting order: priority lane first, then first-come-first-served by token number.
WAITING_ORDER = "priority DESC, token_number ASC"
REQUEUE_WINDOW_MINUTES = 15


# ---------- services ----------

def _service_out(row) -> dict:
    s = row_to_dict(row)
    s["documents"] = json.loads(s.get("documents") or "[]")
    s["keywords"] = json.loads(s.get("keywords") or "[]")
    s["is_paused"] = bool(s["is_paused"])
    return s


def get_service(conn, service_id: int) -> dict:
    row = conn.execute("SELECT * FROM services WHERE id = ?", (service_id,)).fetchone()
    if row is None:
        raise QueueError("Service not found", 404)
    return _service_out(row)


def list_services(conn) -> list[dict]:
    rows = conn.execute("SELECT * FROM services ORDER BY id").fetchall()
    return [_service_out(r) for r in rows]


def update_service(conn, service_id: int, *, documents: list[str] | None = None, keywords: list[str] | None = None) -> dict:
    get_service(conn, service_id)
    if documents is not None:
        docs = [d.strip() for d in documents if d.strip()]
        if len(docs) > 10:
            raise QueueError("At most 10 documents allowed", 400)
        conn.execute("UPDATE services SET documents = ? WHERE id = ?", (json.dumps(docs), service_id))
    if keywords is not None:
        kws = [k.strip().lower() for k in keywords if k.strip()]
        if len(kws) > 30:
            raise QueueError("At most 30 keywords allowed", 400)
        conn.execute("UPDATE services SET keywords = ? WHERE id = ?", (json.dumps(kws), service_id))
    return get_service(conn, service_id)


def create_service(conn, name, code, description, counter, documents, keywords) -> dict:
    code = code.strip().upper()
    exists = conn.execute(
        "SELECT 1 FROM services WHERE lower(name) = lower(?) OR code = ?", (name.strip(), code)
    ).fetchone()
    if exists:
        raise QueueError("A service with this name or token code already exists", 409)
    cur = conn.execute(
        "INSERT INTO services (name, code, description, counter, documents, keywords) VALUES (?,?,?,?,?,?)",
        (name.strip(), code, description.strip(), counter.strip(), json.dumps(documents), json.dumps(keywords)),
    )
    return get_service(conn, cur.lastrowid)


def set_pause(conn, service_id: int, paused: bool, message: str = "") -> dict:
    get_service(conn, service_id)
    conn.execute(
        "UPDATE services SET is_paused = ?, pause_message = ? WHERE id = ?",
        (1 if paused else 0, message.strip() if paused else "", service_id),
    )
    return get_service(conn, service_id)


# ---------- tokens ----------

def waiting_count(conn, service_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'waiting'",
        (service_id, today_str()),
    ).fetchone()[0]


def join_queue(
    conn,
    service_id: int,
    user_id: int,
    priority: bool = False,
    *,
    is_booked: bool = False,
    appointment_id: int | None = None,
    predicted_eta_min: float | None = None,
) -> dict:
    service = get_service(conn, service_id)
    with write_transaction(conn):
        active = conn.execute(
            "SELECT id FROM tokens WHERE service_id = ? AND user_id = ? AND status IN ('waiting','called')",
            (service_id, user_id),
        ).fetchone()
        if active:
            raise QueueError("You already have an active token for this service", 409)
        if not is_booked:
            pending = conn.execute(
                """SELECT id FROM appointments
                   WHERE service_id = ? AND user_id = ? AND status = 'booked' AND slot_date >= ?""",
                (service_id, user_id, today_str()),
            ).fetchone()
            if pending:
                raise QueueError("You have a booking for this service. Check in or cancel it first.", 409)

        day = today_str()
        next_number = conn.execute(
            "SELECT COALESCE(MAX(token_number), 0) + 1 FROM tokens WHERE service_id = ? AND token_date = ?",
            (service_id, day),
        ).fetchone()[0]
        ahead = waiting_count(conn, service_id)
        if predicted_eta_min is None:
            predicted_eta_min = eta_model.predict_wait(service_id, ahead)
        cur = conn.execute(
            """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, priority,
                                   ahead_at_join, is_booked, predicted_eta_min, appointment_id, created_at)
               VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?)""",
            (
                service_id, user_id, next_number, day, 1 if priority else 0, ahead,
                1 if is_booked else 0, predicted_eta_min, appointment_id, now_str(),
            ),
        )
        token_id = cur.lastrowid
    token = get_token(conn, token_id)
    token["service_paused"] = service["is_paused"]
    return token


def get_token(conn, token_id: int) -> dict:
    row = conn.execute(
        """SELECT t.*, s.code, s.name AS service_name, s.counter, a.slot_start
           FROM tokens t
           JOIN services s ON s.id = t.service_id
           LEFT JOIN appointments a ON a.id = t.appointment_id
           WHERE t.id = ?""",
        (token_id,),
    ).fetchone()
    if row is None:
        raise QueueError("Token not found", 404)
    t = row_to_dict(row)
    t["label"] = format_token(t["code"], t["token_number"])
    t["is_booked"] = bool(t.get("is_booked"))
    return t


def position_of(conn, token: dict) -> int:
    """1-based position among waiting tokens (1 = next to be called)."""
    if token["status"] != "waiting":
        return 0
    ahead = conn.execute(
        """SELECT COUNT(*) FROM tokens
           WHERE service_id = ? AND token_date = ? AND status = 'waiting'
             AND (priority > ? OR (priority = ? AND token_number < ?))""",
        (token["service_id"], token["token_date"], token["priority"], token["priority"], token["token_number"]),
    ).fetchone()[0]
    return ahead + 1


def cancel_token(conn, token_id: int, user_id: int) -> dict:
    token = get_token(conn, token_id)
    if token["user_id"] != user_id:
        raise QueueError("You can only cancel your own token", 403)
    if token["status"] not in ("waiting", "called"):
        raise QueueError(f"Token is already {token['status']}", 409)
    conn.execute("UPDATE tokens SET status = 'cancelled' WHERE id = ?", (token_id,))
    if token.get("appointment_id"):
        conn.execute(
            "UPDATE appointments SET status = 'completed' WHERE id = ? AND status = 'checked_in'",
            (token["appointment_id"],),
        )
    return get_token(conn, token_id)


def current_called(conn, service_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'called' ORDER BY called_at DESC LIMIT 1",
        (service_id, today_str()),
    ).fetchone()
    return get_token(conn, row["id"]) if row else None


def _get_consecutive_booked(conn, service_id: int, day: str) -> int:
    row = conn.execute(
        "SELECT consecutive_booked FROM queue_state WHERE service_id = ? AND token_date = ?",
        (service_id, day),
    ).fetchone()
    return row["consecutive_booked"] if row else 0


def _set_consecutive_booked(conn, service_id: int, day: str, n: int):
    conn.execute(
        """INSERT INTO queue_state (service_id, token_date, consecutive_booked) VALUES (?, ?, ?)
           ON CONFLICT(service_id, token_date) DO UPDATE SET consecutive_booked = excluded.consecutive_booked""",
        (service_id, day, n),
    )


def _finish_called(conn, service_id: int, ts: str):
    conn.execute(
        """UPDATE tokens SET status = 'served', served_at = ?,
                  actual_wait_min = ROUND((julianday(?) - julianday(created_at)) * 1440, 2)
           WHERE service_id = ? AND status = 'called'""",
        (ts, ts, service_id),
    )


def _mark_skipped(conn, token_id: int, ts: str):
    conn.execute(
        """UPDATE tokens SET status = 'skipped', served_at = ?,
                  actual_wait_min = COALESCE(actual_wait_min,
                      ROUND((julianday(?) - julianday(created_at)) * 1440, 2))
           WHERE id = ?""",
        (ts, ts, token_id),
    )


def _invoke_next(conn, service_id: int, service: dict, day: str, ts: str) -> int | None:
    nxt_id, new_consecutive = _pick_next_waiting(conn, service_id, day)
    if nxt_id is None:
        return None
    grace = int(service.get("grace_seconds") or 20)
    grace_exp = _grace_expires_at(ts, grace)
    conn.execute(
        """UPDATE tokens SET status = 'called', called_at = ?,
                  grace_expires_at = ?, responded_at = NULL,
                  actual_wait_min = ROUND((julianday(?) - julianday(created_at)) * 1440, 2)
           WHERE id = ?""",
        (ts, grace_exp, ts, nxt_id),
    )
    _set_consecutive_booked(conn, service_id, day, new_consecutive)
    return nxt_id


def _pick_next_waiting(conn, service_id: int, day: str) -> tuple[int | None, int]:
    """Fair merge: due booked slots first, but at most 2 consecutive booked before a walk-in."""
    now = now_str()
    rows = conn.execute(
        """SELECT t.id, t.is_booked, t.priority, t.token_number, a.slot_start
           FROM tokens t
           LEFT JOIN appointments a ON a.id = t.appointment_id
           WHERE t.service_id = ? AND t.token_date = ? AND t.status = 'waiting'""",
        (service_id, day),
    ).fetchall()

    walkins = [dict(r) for r in rows if not r["is_booked"]]
    booked_due = [
        dict(r) for r in rows
        if r["is_booked"] and r["slot_start"] and r["slot_start"] <= now
    ]
    walkins.sort(key=lambda r: (-r["priority"], r["token_number"]))
    booked_due.sort(key=lambda r: (r["slot_start"], -r["priority"], r["token_number"]))

    consecutive = _get_consecutive_booked(conn, service_id, day)
    chosen = None
    new_consecutive = consecutive

    if consecutive >= 2 and walkins:
        chosen = walkins[0]["id"]
        new_consecutive = 0
    elif booked_due and consecutive < 2:
        chosen = booked_due[0]["id"]
        new_consecutive = consecutive + 1
    elif walkins:
        chosen = walkins[0]["id"]
        new_consecutive = 0
    elif booked_due:
        chosen = booked_due[0]["id"]
        new_consecutive = consecutive + 1

    return chosen, new_consecutive


def call_next(conn, service_id: int) -> dict:
    """Finish the currently called token (if any) and call the next waiting one."""
    service = get_service(conn, service_id)
    if service["is_paused"]:
        raise QueueError("Queue is paused. Resume it before calling the next token.", 409)
    day = today_str()
    with write_transaction(conn):
        ts = now_str()
        _finish_called(conn, service_id, ts)
        nxt_id = _invoke_next(conn, service_id, service, day, ts)
        if nxt_id is None:
            raise QueueError("No one is waiting in this queue", 404)
    return get_token(conn, nxt_id)


def mark_served(conn, service_id: int) -> dict:
    cur = current_called(conn, service_id)
    if cur is None:
        raise QueueError("No token is currently being served", 404)
    ts = now_str()
    conn.execute(
        """UPDATE tokens SET status = 'served', served_at = ?,
                  actual_wait_min = COALESCE(actual_wait_min,
                      ROUND((julianday(?) - julianday(created_at)) * 1440, 2))
           WHERE id = ?""",
        (ts, ts, cur["id"]),
    )
    return get_token(conn, cur["id"])


def skip_and_advance(conn, service_id: int) -> tuple[dict, dict | None]:
    """Mark the called token as a no-show and call the next waiting person."""
    service = get_service(conn, service_id)
    if service["is_paused"]:
        raise QueueError("Queue is paused. Resume it before skipping.", 409)
    day = today_str()
    with write_transaction(conn):
        cur = conn.execute(
            "SELECT id FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'called' ORDER BY called_at DESC LIMIT 1",
            (service_id, day),
        ).fetchone()
        if cur is None:
            raise QueueError("No token is currently being served", 404)
        ts = now_str()
        _mark_skipped(conn, cur["id"], ts)
        nxt_id = _invoke_next(conn, service_id, service, day, ts)
    skipped = get_token(conn, cur["id"])
    nxt = get_token(conn, nxt_id) if nxt_id else None
    return skipped, nxt


def skip_current(conn, service_id: int) -> dict:
    skipped, _ = skip_and_advance(conn, service_id)
    return skipped


def respond_to_call(conn, token_id: int, user_id: int) -> dict:
    token = get_token(conn, token_id)
    if token["user_id"] != user_id:
        raise QueueError("You can only respond to your own token", 403)
    if token["status"] != "called":
        raise QueueError("Only a called token can be confirmed", 409)
    if token.get("responded_at"):
        return token
    ts = now_str()
    conn.execute("UPDATE tokens SET responded_at = ? WHERE id = ?", (ts, token_id))
    return get_token(conn, token_id)


def rejoin_seconds_left(served_at: str | None) -> int:
    if not served_at:
        return 0
    deadline = _parse_ts(served_at) + timedelta(minutes=REQUEUE_WINDOW_MINUTES)
    return max(0, int((deadline - tz.now_naive()).total_seconds()))


def requeue_after_noshow(conn, token_id: int, user_id: int) -> dict:
    old = get_token(conn, token_id)
    if old["user_id"] != user_id:
        raise QueueError("You can only re-queue your own missed token", 403)
    if old["status"] != "skipped":
        raise QueueError("Only a no-show token can be re-queued", 409)
    if old.get("requeue_used"):
        raise QueueError("You have already used your one re-queue for this missed turn", 409)
    if rejoin_seconds_left(old.get("served_at")) <= 0:
        raise QueueError("Re-join window has expired", 409)
    active = conn.execute(
        "SELECT id FROM tokens WHERE service_id = ? AND user_id = ? AND status IN ('waiting','called')",
        (old["service_id"], user_id),
    ).fetchone()
    if active:
        raise QueueError("You already have an active token for this service", 409)
    token = join_queue(conn, old["service_id"], user_id, is_booked=False)
    conn.execute("UPDATE tokens SET requeue_used = 1 WHERE id = ?", (token_id,))
    return token


def requeue_eligible_for_user(conn, user_id: int) -> list[dict]:
    day = today_str()
    active_services = {
        r[0]
        for r in conn.execute(
            """SELECT service_id FROM tokens
               WHERE user_id = ? AND token_date = ? AND status IN ('waiting', 'called')""",
            (user_id, day),
        ).fetchall()
    }
    rows = conn.execute(
        """SELECT t.id, t.service_id, t.token_number, t.served_at, s.code, s.name AS service_name, s.counter
           FROM tokens t JOIN services s ON s.id = t.service_id
           WHERE t.user_id = ? AND t.token_date = ? AND t.status = 'skipped' AND t.requeue_used = 0
           ORDER BY t.served_at DESC""",
        (user_id, day),
    ).fetchall()
    seen: set[int] = set()
    out = []
    for r in rows:
        sid = r["service_id"]
        if sid in active_services or sid in seen:
            continue
        left = rejoin_seconds_left(r["served_at"])
        if left <= 0:
            continue
        seen.add(sid)
        d = row_to_dict(r)
        d["label"] = format_token(d["code"], d["token_number"])
        d["rejoin_seconds_left"] = left
        out.append(d)
    return out


def process_grace_timeouts(conn) -> list[dict]:
    """Auto no-show tokens whose grace period expired without a response."""
    ts = now_str()
    rows = conn.execute(
        """SELECT t.id, t.service_id FROM tokens t
           WHERE t.status = 'called' AND t.responded_at IS NULL
             AND t.grace_expires_at IS NOT NULL AND t.grace_expires_at <= ?""",
        (ts,),
    ).fetchall()
    events = []
    for row in rows:
        try:
            skipped, nxt = skip_and_advance(conn, row["service_id"])
            events.append({
                "service_id": row["service_id"],
                "event": "no_show",
                "label": skipped["label"],
                "token_id": skipped["id"],
                "next_label": nxt["label"] if nxt else None,
                "next_token_id": nxt["id"] if nxt else None,
            })
        except QueueError:
            pass
    return events


def waiting_list(conn, service_id: int, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        f"""SELECT t.id, t.token_number, t.priority, t.created_at, t.is_booked,
                   u.name AS user_name, s.code, a.slot_start
            FROM tokens t
            JOIN services s ON s.id = t.service_id
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN appointments a ON a.id = t.appointment_id
            WHERE t.service_id = ? AND t.token_date = ? AND t.status = 'waiting'
            ORDER BY {WAITING_ORDER} LIMIT ?""",
        (service_id, today_str(), limit),
    ).fetchall()
    out = []
    for r in rows:
        d = row_to_dict(r)
        d["label"] = format_token(d["code"], d["token_number"])
        d["is_booked"] = bool(d.get("is_booked"))
        d["queue_type"] = "BOOKED" if d["is_booked"] else "WALK-IN"
        if d["slot_start"]:
            slot_dt = datetime.strptime(d["slot_start"], "%Y-%m-%d %H:%M:%S")
            d["slot_time"] = slot_dt.strftime("%I:%M %p").lstrip("0")
        else:
            d["slot_time"] = None
        out.append(d)
    return out


def active_tokens_for_user(conn, user_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id FROM tokens WHERE user_id = ? AND status IN ('waiting','called') ORDER BY created_at",
        (user_id,),
    ).fetchall()
    return [get_token(conn, r["id"]) for r in rows]


def history_for_user(conn, user_id: int, limit: int = 10) -> list[dict]:
    rows = conn.execute(
        "SELECT id FROM tokens WHERE user_id = ? AND status NOT IN ('waiting','called') ORDER BY created_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()
    return [get_token(conn, r["id"]) for r in rows]


def today_stats(conn, service_id: int) -> dict:
    day = today_str()
    counts = {
        r["status"]: r["n"]
        for r in conn.execute(
            "SELECT status, COUNT(*) AS n FROM tokens WHERE service_id = ? AND token_date = ? GROUP BY status",
            (service_id, day),
        ).fetchall()
    }
    avg_wait = conn.execute(
        """SELECT AVG(actual_wait_min) FROM tokens
           WHERE service_id = ? AND token_date = ? AND actual_wait_min IS NOT NULL""",
        (service_id, day),
    ).fetchone()[0]
    avg_service = conn.execute(
        """SELECT AVG((julianday(served_at) - julianday(called_at)) * 1440)
           FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'served' AND served_at IS NOT NULL""",
        (service_id, day),
    ).fetchone()[0]
    return {
        "waiting": counts.get("waiting", 0),
        "served": counts.get("served", 0),
        "skipped": counts.get("skipped", 0),
        "cancelled": counts.get("cancelled", 0),
        "avg_wait_min": round(avg_wait, 1) if avg_wait else None,
        "avg_service_min": round(avg_service, 1) if avg_service else None,
    }
