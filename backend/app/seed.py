"""Seed the database with services, demo accounts, 30 days of realistic queue
history (for the ETA model and heatmaps), and a live queue for today.

History is produced by simulating a real single-counter queue minute by minute:
morning rush, lunch break, busier Mondays, half-day Saturdays, random service
times, cancellations and no-shows. The waits in the data are therefore consistent
with the queue lengths, which is what lets the ML model learn real patterns.

Run:  python -m app.seed              (full reset + history + live demo)
      python -m app.seed --live         (reset only today's live queues)
"""
import argparse
import json
import math
import os
import random
from datetime import datetime, timedelta

from . import eta_model
from . import slot_service as slots
from . import timezone as tz
from .db import DB_PATH, get_conn, init_db
from .queue_service import _invoke_next, get_service, now_str, waiting_count
from .security import hash_password

SLOT_DEFAULTS = {
    "open_hour": 9, "close_hour": 17, "lunch_start": 13, "lunch_end": 14,
    "grace_seconds": 20, "slot_release_minutes": 10, "rush_threshold_min": 30,
}

SERVICES = [
    {
        "name": "Fee Counter", "code": "F", "counter": "Admin Block, Ground Floor",
        "description": "Fee payment, refunds, scholarships and receipt issues.",
        "documents": ["College ID card", "Fee challan or payment proof", "Bank passbook copy (for refunds)"],
        "keywords": ["fee", "fees", "payment", "refund", "scholarship", "challan", "receipt", "due", "fine", "hostel fee"],
        "rate": 9.0, "svc": 4.0, "slot_minutes": 15, "max_per_slot": 4, "rush_threshold_min": 12,
    },
    {
        "name": "Exam Cell", "code": "E", "counter": "Exam Cell, First Floor",
        "description": "Hall tickets, revaluation, marksheet corrections and results.",
        "documents": ["College ID card", "Hall ticket or marksheet copy", "Revaluation fee receipt (if applicable)"],
        "keywords": ["exam", "hall", "ticket", "revaluation", "marksheet", "result", "arrear", "grade", "hall ticket", "mark"],
        "rate": 5.5, "svc": 5.5, "slot_minutes": 20, "max_per_slot": 3, "rush_threshold_min": 25,
    },
    {
        "name": "Hostel Office", "code": "H", "counter": "Hostel Block A, Office Room",
        "description": "Room allotment, leave requests, hostel fee and maintenance issues.",
        "documents": ["College ID card", "Hostel ID card", "Leave application (if applicable)"],
        "keywords": ["hostel", "room", "leave", "allotment", "maintenance", "warden", "mess"],
        "rate": 6.0, "svc": 5.0, "slot_minutes": 15, "max_per_slot": 3, "rush_threshold_min": 20,
    },
    {
        "name": "Admin Help Desk", "code": "A", "counter": "Admin Block, Counter 2",
        "description": "General enquiries, certificates, bonafide and document verification.",
        "documents": ["College ID card", "Filled application form", "Supporting documents as listed on the form"],
        "keywords": ["certificate", "bonafide", "admin", "help", "verification", "general", "enquiry"],
        "rate": 8.0, "svc": 5.0, "slot_minutes": 15, "max_per_slot": 3, "rush_threshold_min": 30,
    },
    {
        "name": "ID Card Desk", "code": "I", "counter": "Admin Block, Counter 3",
        "description": "New ID cards, lost ID replacement and detail corrections.",
        "documents": ["Passport-size photo", "Police complaint or affidavit (for lost cards)", "Fee receipt (Rs. 200)"],
        "keywords": ["id", "identity", "lost", "card", "replacement", "stolen", "damaged", "photo", "lost id"],
        "rate": 4.5, "svc": 6.5, "slot_minutes": 20, "max_per_slot": 2, "rush_threshold_min": 30,
    },
]


def _svc_cfg(s: dict) -> dict:
    return {**SLOT_DEFAULTS, **s}

HOUR_PROFILE = {9: 0.9, 10: 1.45, 11: 1.3, 12: 1.0, 13: 0.45, 14: 1.15, 15: 0.9, 16: 0.55}
FIRST_NAMES = ["Aarav", "Priya", "Karthik", "Divya", "Rahul", "Sneha", "Vikram", "Ananya", "Arjun", "Meera",
               "Rohan", "Kavya", "Siddharth", "Nithya", "Harish", "Lakshmi", "Aditya", "Pooja", "Surya", "Deepa"]
LAST_INITIALS = ["R", "S", "K", "M", "V", "P", "N", "A"]
ROLL_BATCHES = ["RA2211", "RA2210", "RA2311", "RA2310"]


def _roll_number(rng: random.Random) -> str:
    return f"{rng.choice(ROLL_BATCHES)}{rng.randint(100, 499)}"


def _student_name(rng: random.Random) -> str:
    return f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_INITIALS)}. ({_roll_number(rng)})"


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _poisson_arrivals(rng, day: datetime, rate_per_hour_fn, open_h, close_h):
    """Minute-level Bernoulli approximation of a non-homogeneous Poisson process."""
    arrivals = []
    t = day.replace(hour=open_h, minute=0, second=0)
    end = day.replace(hour=close_h, minute=0) - timedelta(minutes=15)
    while t < end:
        p = rate_per_hour_fn(t) / 60.0
        if rng.random() < p:
            arrivals.append(t + timedelta(seconds=rng.randint(0, 59)))
        t += timedelta(minutes=1)
    return arrivals


def simulate_day(rng, day: datetime, svc: dict):
    weekday = day.weekday()
    if weekday == 6:
        return []
    close_h = 13 if weekday == 5 else 17
    day_factor = 1.3 if weekday == 0 else (0.7 if weekday == 5 else (0.9 if weekday == 4 else 1.0))

    def rate_fn(t):
        return svc["rate"] * HOUR_PROFILE.get(t.hour, 0.5) * day_factor

    arrivals = _poisson_arrivals(rng, day, rate_fn, 9, close_h)
    lunch_start, lunch_end = day.replace(hour=13, minute=0), day.replace(hour=13, minute=30)
    server_free = day.replace(hour=9, minute=0)
    records, pending = [], []

    for i, arr in enumerate(arrivals):
        ahead = sum(1 for c in pending if c > arr)
        cancel_p = 0.03 + min(0.12, ahead * 0.006)
        if rng.random() < cancel_p:
            records.append({
                "n": i + 1, "created": arr, "called": None, "served": None,
                "status": "cancelled", "ahead": ahead, "predicted": None, "actual": None,
            })
            continue
        called = max(arr, server_free)
        if weekday != 5 and lunch_start <= called < lunch_end:
            called = lunch_end
        rush = 1.15 if called.hour in (10, 11) else 1.0
        monday = 1.1 if weekday == 0 else 1.0
        mean = svc["svc"] * rush * monday
        sigma = 0.35
        duration = rng.lognormvariate(math.log(mean) - sigma ** 2 / 2, sigma)
        if rng.random() < 0.04:
            status, duration = "skipped", 1.0
        else:
            status = "served"
        served = called + timedelta(minutes=duration)
        server_free = served
        pending.append(called)
        wait_min = (called - arr).total_seconds() / 60 if called else None
        pred = ahead * svc["svc"]
        records.append({
            "n": i + 1, "created": arr, "called": called, "served": served,
            "status": status, "ahead": ahead, "predicted": round(pred, 1),
            "actual": round(wait_min, 2) if wait_min is not None else None,
        })
    return records


def _next_slot_after(now: datetime, slot_minutes: int, lunch_start: int = 13, lunch_end: int = 14) -> datetime:
    """Round up to the next slot boundary after now, skipping lunch."""
    base = now.replace(second=0, microsecond=0)
    if base.minute % slot_minutes:
        base += timedelta(minutes=slot_minutes - (base.minute % slot_minutes))
    if base <= now:
        base += timedelta(minutes=slot_minutes)
    if lunch_start <= base.hour < lunch_end:
        base = base.replace(hour=lunch_end, minute=0)
    return base


def _seed_partial_bookings(conn, rng, service_ids, student_ids, demo_student_id):
    """Book 1–2 spots in some future slots — never fill every slot on a day."""
    now = tz.now_naive()
    for book_date in tz.bookable_dates(3):
        day_dt = datetime.strptime(book_date, "%Y-%m-%d")
        for sid, svc in zip(service_ids, SERVICES):
            cfg = _svc_cfg(svc)
            starts = slots.iter_slot_starts(cfg, day_dt)
            valid = [
                s for s in starts
                if not (book_date == tz.today_str() and s <= now)
            ]
            if len(valid) < 2:
                continue
            pick_n = rng.randint(2, min(5, len(valid) // 2 + 1))
            for slot_start in rng.sample(valid, pick_n):
                cap = cfg["max_per_slot"]
                n_book = rng.randint(1, max(1, cap - 1))
                for j in range(n_book):
                    uid = demo_student_id if sid == service_ids[0] and book_date == tz.bookable_dates(3)[1] and j == 0 else rng.choice(student_ids)
                    conn.execute(
                        """INSERT INTO appointments (service_id, user_id, slot_start, slot_date, status, created_at)
                           VALUES (?, ?, ?, ?, 'booked', ?)""",
                        (sid, uid, _fmt(slot_start), book_date, _fmt(now - timedelta(hours=rng.randint(1, 6)))),
                    )


def clear_today_live(conn) -> None:
    """Remove today's active queue state without touching historical training data."""
    day = tz.today_str()
    conn.execute("DELETE FROM tokens WHERE token_date = ? AND status IN ('waiting', 'called')", (day,))
    conn.execute(
        """UPDATE appointments SET status = 'cancelled'
           WHERE slot_date = ? AND status IN ('booked', 'checked_in')""",
        (day,),
    )
    conn.execute("DELETE FROM queue_state WHERE token_date = ?", (day,))


def _next_token_number(conn, service_id: int, day: str) -> int:
    return conn.execute(
        "SELECT COALESCE(MAX(token_number), 0) FROM tokens WHERE service_id = ? AND token_date = ?",
        (service_id, day),
    ).fetchone()[0]


def _insert_completed_token(
    conn, service_id: int, user_id: int, number: int, day: str, status: str,
    created: datetime, called: datetime, finished: datetime, ahead: int, svc_rate: float,
):
    wait = round((called - created).total_seconds() / 60, 2)
    conn.execute(
        """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, priority, ahead_at_join,
                               is_booked, predicted_eta_min, actual_wait_min, created_at, called_at, served_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?)""",
        (
            service_id, user_id, number, day, status, ahead,
            round(ahead * svc_rate, 1), wait,
            _fmt(created), _fmt(called), _fmt(finished),
        ),
    )


def _seed_join_waiting(
    conn, service_id: int, user_id: int, *, is_booked: bool = False, appointment_id: int | None = None,
) -> int:
    """Insert a waiting token using the same fields as join_queue (no nested transaction)."""
    day = tz.today_str()
    number = _next_token_number(conn, service_id, day) + 1
    ahead = waiting_count(conn, service_id)
    predicted = eta_model.predict_wait(service_id, ahead)
    cur = conn.execute(
        """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, priority,
                               ahead_at_join, is_booked, predicted_eta_min, appointment_id, created_at)
           VALUES (?, ?, ?, ?, 'waiting', 0, ?, ?, ?, ?, ?)""",
        (
            service_id, user_id, number, day, ahead,
            1 if is_booked else 0, predicted, appointment_id, now_str(),
        ),
    )
    return cur.lastrowid


def _add_checked_in_booking(conn, service_id: int, user_id: int, slot_start: datetime, day: str, rng: random.Random):
    """Booked student who checked in — same token shape as a real check-in."""
    slot_str = _fmt(slot_start)
    cur = conn.execute(
        """INSERT INTO appointments (service_id, user_id, slot_start, slot_date, status, created_at)
           VALUES (?, ?, ?, ?, 'booked', ?)""",
        (service_id, user_id, slot_str, day, _fmt(tz.now_naive() - timedelta(hours=rng.randint(2, 5)))),
    )
    appt_id = cur.lastrowid
    token_id = _seed_join_waiting(conn, service_id, user_id, is_booked=True, appointment_id=appt_id)
    conn.execute(
        "UPDATE appointments SET status = 'checked_in', token_id = ? WHERE id = ?",
        (token_id, appt_id),
    )
    conn.execute(
        "UPDATE tokens SET created_at = ? WHERE id = ?",
        (_fmt(tz.now_naive() - timedelta(minutes=rng.randint(20, 55))), token_id),
    )
    return token_id


def _pick_past_slots(cfg: dict, now: datetime, rng: random.Random, count: int) -> list[datetime]:
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    past = [s for s in slots.iter_slot_starts(cfg, day_start) if s <= now]
    if not past:
        past = [day_start.replace(hour=cfg["open_hour"], minute=0)]
    return rng.sample(past, min(count, len(past)))


def _pick_future_bookings(cfg: dict, now: datetime, rng: random.Random, count: int) -> list[tuple[str, datetime]]:
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_future = [s for s in slots.iter_slot_starts(cfg, day_start) if s > now]
    if len(today_future) >= count:
        return [(tz.today_str(), s) for s in rng.sample(today_future, count)]
    out = [(tz.today_str(), s) for s in today_future]
    need = count - len(out)
    if need > 0:
        for book_date in tz.bookable_dates(3)[1:]:
            day_dt = datetime.strptime(book_date, "%Y-%m-%d")
            starts = slots.iter_slot_starts(cfg, day_dt)
            pick = starts[: need + 2]
            if pick:
                out.extend((book_date, s) for s in rng.sample(pick, min(need, len(pick))))
                need = count - len(out)
            if need <= 0:
                break
    return out[:count]


def seed_live_demo(conn, rng: random.Random | None = None) -> dict:
    """Populate today's live queues for every service (IST). Safe to call after clear_today_live."""
    rng = rng or random.Random(42)
    now = tz.now_naive()
    day_str = tz.today_str()
    students = conn.execute("SELECT id FROM users WHERE role = 'student' ORDER BY id").fetchall()
    if len(students) < 40:
        raise RuntimeError("Need at least 40 student accounts — run full seed first")
    student_ids = [r["id"] for r in students]
    rng.shuffle(student_ids)
    cursor = 0
    summary = {"date": day_str, "timezone": "Asia/Kolkata", "server_now": tz.now_str(), "services": []}

    service_rows = conn.execute("SELECT id, name, code FROM services ORDER BY id").fetchall()
    for row, svc in zip(service_rows, SERVICES):
        sid = row["id"]
        cfg = _svc_cfg(svc)
        used: set[int] = set()

        def pick_user() -> int:
            nonlocal cursor
            for _ in range(len(student_ids)):
                uid = student_ids[cursor % len(student_ids)]
                cursor += 1
                if uid not in used:
                    used.add(uid)
                    return uid
            uid = rng.choice(student_ids)
            used.add(uid)
            return uid

        number = _next_token_number(conn, sid, day_str)

        for _ in range(rng.randint(2, 4)):
            number += 1
            uid = pick_user()
            open_t = now.replace(hour=cfg["open_hour"], minute=0, second=0, microsecond=0)
            created = open_t + timedelta(minutes=rng.randint(0, 150))
            called = created + timedelta(minutes=rng.uniform(3, 18))
            finished = called + timedelta(minutes=rng.uniform(cfg["slot_minutes"] * 0.5, cfg["slot_minutes"] * 1.2))
            _insert_completed_token(
                conn, sid, uid, number, day_str, "served", created, called, finished,
                rng.randint(0, 4), svc["svc"],
            )

        number += 1
        uid = pick_user()
        open_t = now.replace(hour=cfg["open_hour"], minute=0, second=0, microsecond=0)
        created = open_t + timedelta(minutes=rng.randint(60, 180))
        called = created + timedelta(minutes=rng.uniform(5, 20))
        skipped_at = called + timedelta(minutes=1)
        _insert_completed_token(
            conn, sid, uid, number, day_str, "skipped", created, called, skipped_at,
            rng.randint(1, 5), svc["svc"],
        )

        n_waiting = rng.randint(4, 8)
        n_booked_waiting = rng.randint(2, min(4, n_waiting - 1))
        past_slots = _pick_past_slots(cfg, now, rng, n_booked_waiting)
        for slot_start in past_slots:
            _add_checked_in_booking(conn, sid, pick_user(), slot_start, day_str, rng)

        for _ in range(n_waiting - n_booked_waiting):
            uid = pick_user()
            token_id = _seed_join_waiting(conn, sid, uid)
            conn.execute(
                "UPDATE tokens SET created_at = ? WHERE id = ?",
                (_fmt(now - timedelta(minutes=rng.randint(8, 40))), token_id),
            )

        service = get_service(conn, sid)
        ts = now_str()
        nxt_id = _invoke_next(conn, sid, service, day_str, ts)
        if nxt_id:
            conn.execute("UPDATE tokens SET responded_at = ? WHERE id = ?", (ts, nxt_id))

        for book_date, slot_start in _pick_future_bookings(cfg, now, rng, rng.randint(2, 3)):
            uid = pick_user()
            conn.execute(
                """INSERT INTO appointments (service_id, user_id, slot_start, slot_date, status, created_at)
                   VALUES (?, ?, ?, ?, 'booked', ?)""",
                (sid, uid, _fmt(slot_start), book_date, _fmt(now - timedelta(hours=rng.randint(1, 4)))),
            )

        summary["services"].append({
            "name": row["name"],
            "waiting": waiting_count(conn, sid),
            "now_serving": nxt_id is not None,
        })

    return summary


def seed(reset: bool = True, days: int = 30, seed_value: int = 42):
    if reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        for ext in ("-wal", "-shm"):
            if os.path.exists(DB_PATH + ext):
                os.remove(DB_PATH + ext)
    init_db()
    rng = random.Random(seed_value)

    with get_conn() as conn:
        conn.execute("BEGIN")
        demo_accounts = [
            ("Campus Admin", "admin@campus.edu", "admin123", "admin"),
            ("Ramesh (Staff)", "staff@campus.edu", "staff123", "staff"),
            ("Demo Student", "student@campus.edu", "student123", "student"),
        ]
        for name, email, pw, role in demo_accounts:
            conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)",
                         (name, email, hash_password(pw), role))
        student_pw = hash_password("student123")
        student_ids = []
        for i in range(60):
            name = _student_name(rng)
            cur = conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'student')",
                               (name, f"student{i + 1}@campus.edu", student_pw))
            student_ids.append(cur.lastrowid)

        service_ids = []
        for s in SERVICES:
            cfg = _svc_cfg(s)
            cur = conn.execute(
                """INSERT INTO services (name, code, description, counter, documents, keywords,
                                        slot_minutes, open_hour, close_hour, lunch_start, lunch_end,
                                        max_per_slot, grace_seconds, slot_release_minutes, rush_threshold_min)
                   VALUES (?,?,?,?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (s["name"], s["code"], s["description"], s["counter"], json.dumps(s["documents"]),
                 json.dumps(s["keywords"]), cfg["slot_minutes"], cfg["open_hour"], cfg["close_hour"],
                 cfg["lunch_start"], cfg["lunch_end"], cfg["max_per_slot"], cfg["grace_seconds"],
                 cfg["slot_release_minutes"], cfg["rush_threshold_min"]),
            )
            service_ids.append(cur.lastrowid)

        today = tz.now_naive().replace(hour=0, minute=0, second=0, microsecond=0)
        rows = []
        for d in range(days, 0, -1):
            day = today - timedelta(days=d)
            for sid, svc in zip(service_ids, SERVICES):
                for r in simulate_day(rng, day, svc):
                    rows.append((
                        sid, rng.choice(student_ids), r["n"], day.strftime("%Y-%m-%d"), r["status"], 0, r["ahead"],
                        0, r["predicted"], r["actual"], None,
                        _fmt(r["created"]), _fmt(r["called"]) if r["called"] else None,
                        _fmt(r["served"]) if r["served"] else None,
                    ))
        conn.executemany(
            """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, priority, ahead_at_join,
                                   is_booked, predicted_eta_min, actual_wait_min, appointment_id,
                                   created_at, called_at, served_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )

        demo_student_id = conn.execute("SELECT id FROM users WHERE email = 'student@campus.edu'").fetchone()[0]
        seed_live_demo(conn, rng)
        _seed_partial_bookings(conn, rng, service_ids, student_ids, demo_student_id)

        conn.execute("COMMIT")
        total = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()[0]
    return total


def reset_live_only(seed_value: int = 42) -> dict:
    init_db()
    rng = random.Random(seed_value)
    with get_conn() as conn:
        conn.execute("BEGIN")
        clear_today_live(conn)
        summary = seed_live_demo(conn, rng)
        conn.execute("COMMIT")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QFlow database seed")
    parser.add_argument("--live", action="store_true", help="Reset only today's live demo queues")
    args = parser.parse_args()
    if args.live:
        summary = reset_live_only()
        print(f"Live demo reset in {os.path.abspath(DB_PATH)} (IST {summary['server_now']})")
        for s in summary["services"]:
            print(f"  {s['name']}: {s['waiting']} waiting, serving={'yes' if s['now_serving'] else 'no'}")
    else:
        n = seed()
        print(f"Seeded {n} tokens into {os.path.abspath(DB_PATH)}")
    print("Demo logins: admin@campus.edu / admin123, staff@campus.edu / staff123, student@campus.edu / student123")
