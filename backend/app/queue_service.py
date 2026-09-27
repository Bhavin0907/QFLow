"""Queue business logic. Pure functions over a sqlite connection, no web framework,
so it can be tested directly and the API layer stays thin."""
import json
from datetime import datetime

from .db import row_to_dict, write_transaction


class QueueError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def format_token(code: str, number: int) -> str:
    return f"{code}-{number:03d}"


# Waiting order: priority lane first, then first-come-first-served by token number.
WAITING_ORDER = "priority DESC, token_number ASC"


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


def join_queue(conn, service_id: int, user_id: int, priority: bool = False) -> dict:
    service = get_service(conn, service_id)
    with write_transaction(conn):
        active = conn.execute(
            "SELECT id FROM tokens WHERE service_id = ? AND user_id = ? AND status IN ('waiting','called')",
            (service_id, user_id),
        ).fetchone()
        if active:
            raise QueueError("You already have an active token for this service", 409)

        day = today_str()
        next_number = conn.execute(
            "SELECT COALESCE(MAX(token_number), 0) + 1 FROM tokens WHERE service_id = ? AND token_date = ?",
            (service_id, day),
        ).fetchone()[0]
        ahead = waiting_count(conn, service_id)
        cur = conn.execute(
            """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, priority, ahead_at_join, created_at)
               VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?)""",
            (service_id, user_id, next_number, day, 1 if priority else 0, ahead, now_str()),
        )
        token_id = cur.lastrowid
    token = get_token(conn, token_id)
    token["service_paused"] = service["is_paused"]
    return token


def get_token(conn, token_id: int) -> dict:
    row = conn.execute(
        """SELECT t.*, s.code, s.name AS service_name, s.counter
           FROM tokens t JOIN services s ON s.id = t.service_id WHERE t.id = ?""",
        (token_id,),
    ).fetchone()
    if row is None:
        raise QueueError("Token not found", 404)
    t = row_to_dict(row)
    t["label"] = format_token(t["code"], t["token_number"])
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
    return get_token(conn, token_id)


def current_called(conn, service_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'called' ORDER BY called_at DESC LIMIT 1",
        (service_id, today_str()),
    ).fetchone()
    return get_token(conn, row["id"]) if row else None


def call_next(conn, service_id: int) -> dict:
    """Finish the currently called token (if any) and call the next waiting one."""
    service = get_service(conn, service_id)
    if service["is_paused"]:
        raise QueueError("Queue is paused. Resume it before calling the next token.", 409)
    with write_transaction(conn):
        ts = now_str()
        conn.execute(
            "UPDATE tokens SET status = 'served', served_at = ? WHERE service_id = ? AND status = 'called'",
            (ts, service_id),
        )
        nxt = conn.execute(
            f"""SELECT id FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'waiting'
                ORDER BY {WAITING_ORDER} LIMIT 1""",
            (service_id, today_str()),
        ).fetchone()
        if nxt is None:
            raise QueueError("No one is waiting in this queue", 404)
        conn.execute("UPDATE tokens SET status = 'called', called_at = ? WHERE id = ?", (ts, nxt["id"]))
    return get_token(conn, nxt["id"])


def mark_served(conn, service_id: int) -> dict:
    cur = current_called(conn, service_id)
    if cur is None:
        raise QueueError("No token is currently being served", 404)
    conn.execute("UPDATE tokens SET status = 'served', served_at = ? WHERE id = ?", (now_str(), cur["id"]))
    return get_token(conn, cur["id"])


def skip_current(conn, service_id: int) -> dict:
    """Mark the called token as a no-show."""
    cur = current_called(conn, service_id)
    if cur is None:
        raise QueueError("No token is currently being served", 404)
    conn.execute("UPDATE tokens SET status = 'skipped', served_at = ? WHERE id = ?", (now_str(), cur["id"]))
    return get_token(conn, cur["id"])


def waiting_list(conn, service_id: int, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        f"""SELECT t.id, t.token_number, t.priority, t.created_at, u.name AS user_name, s.code
            FROM tokens t JOIN services s ON s.id = t.service_id LEFT JOIN users u ON u.id = t.user_id
            WHERE t.service_id = ? AND t.token_date = ? AND t.status = 'waiting'
            ORDER BY {WAITING_ORDER} LIMIT ?""",
        (service_id, today_str(), limit),
    ).fetchall()
    out = []
    for r in rows:
        d = row_to_dict(r)
        d["label"] = format_token(d["code"], d["token_number"])
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
        """SELECT AVG((julianday(called_at) - julianday(created_at)) * 1440)
           FROM tokens WHERE service_id = ? AND token_date = ? AND called_at IS NOT NULL""",
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
