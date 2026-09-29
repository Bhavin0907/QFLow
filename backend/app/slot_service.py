"""Slot booking: generate bookable windows, crowd levels, book / cancel / check-in."""
from datetime import datetime, timedelta

from . import eta_model
from . import timezone as tz
from .db import row_to_dict, write_transaction
from .queue_service import QueueError, get_service, join_queue, now_str, today_str


def _slot_overlaps_lunch(start: datetime, end: datetime, lunch_start: int, lunch_end: int) -> bool:
    lunch_s = start.replace(hour=lunch_start, minute=0, second=0, microsecond=0)
    lunch_e = start.replace(hour=lunch_end, minute=0, second=0, microsecond=0)
    return start < lunch_e and end > lunch_s


def iter_slot_starts(service: dict, day: datetime) -> list[datetime]:
    """All slot start times for a day, excluding lunch break."""
    slot_min = service["slot_minutes"]
    open_h, close_h = service["open_hour"], service["close_hour"]
    lunch_start, lunch_end = service["lunch_start"], service["lunch_end"]
    day = day.replace(hour=0, minute=0, second=0, microsecond=0)
    cursor = day.replace(hour=open_h, minute=0, second=0)
    end = day.replace(hour=close_h, minute=0, second=0)
    slots = []
    while cursor < end:
        slot_end = cursor + timedelta(minutes=slot_min)
        if slot_end > end:
            break
        if not _slot_overlaps_lunch(cursor, slot_end, lunch_start, lunch_end):
            slots.append(cursor)
        cursor += timedelta(minutes=slot_min)
    return slots


def _booking_counts(conn, service_id: int, slot_date: str) -> dict[str, int]:
    rows = conn.execute(
        """SELECT slot_start, COUNT(*) AS n FROM appointments
           WHERE service_id = ? AND slot_date = ? AND status IN ('booked', 'checked_in')
           GROUP BY slot_start""",
        (service_id, slot_date),
    ).fetchall()
    return {r["slot_start"]: r["n"] for r in rows}


def _estimated_ahead(conn, service_id: int, slot_start: datetime) -> int:
    """Rough queue length at slot time: current waiting + earlier bookings not yet checked in."""
    waiting = conn.execute(
        "SELECT COUNT(*) FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'waiting'",
        (service_id, slot_start.strftime("%Y-%m-%d")),
    ).fetchone()[0]
    pending_bookings = conn.execute(
        """SELECT COUNT(*) FROM appointments
           WHERE service_id = ? AND slot_date = ? AND status = 'booked' AND slot_start <= ?""",
        (service_id, slot_start.strftime("%Y-%m-%d"), slot_start.strftime("%Y-%m-%d %H:%M:%S")),
    ).fetchone()[0]
    return waiting + pending_bookings


def crowd_level(eta_min: float) -> str:
    if eta_min < 12:
        return "low"
    if eta_min < 28:
        return "medium"
    return "high"


def _empty_reason(service: dict, date_str: str, stats: dict, available: int) -> str | None:
    if available:
        return None
    day = datetime.strptime(date_str, "%Y-%m-%d").date()
    now = tz.now_naive()
    if tz.is_sunday(day):
        return "closed_sunday"
    if day < now.date():
        return "past_date"
    if day == now.date() and now.hour >= service["close_hour"]:
        return "closed_today"
    if stats["generated"] == 0:
        return "closed_today"
    if stats["full"] and stats["full"] >= stats["generated"]:
        return "all_full"
    if stats["past"] and stats["past"] >= stats["generated"]:
        return "all_past"
    return "unavailable"


def list_slots(conn, service_id: int, date_str: str | None = None) -> dict:
    service = get_service(conn, service_id)
    date_str = date_str or today_str()
    day = datetime.strptime(date_str, "%Y-%m-%d")
    counts = _booking_counts(conn, service_id, date_str)
    now = tz.now_naive()
    max_per = service["max_per_slot"]
    stats = {"generated": 0, "past": 0, "full": 0, "lunch_skipped": 0, "available": 0}
    slots_out = []

    if not tz.is_bookable_date(date_str):
        return {
            "date": date_str,
            "timezone": "Asia/Kolkata",
            "server_now": tz.now_str(),
            "bookable_dates": tz.bookable_dates(3),
            "service": {
                "open_hour": service["open_hour"],
                "close_hour": service["close_hour"],
                "slot_minutes": service["slot_minutes"],
                "lunch_start": service["lunch_start"],
                "lunch_end": service["lunch_end"],
                "max_per_slot": max_per,
            },
            "stats": stats,
            "empty_reason": "past_date" if tz.parse_date(date_str) < now.date() else "closed_sunday",
            "slots": [],
        }

    all_starts = iter_slot_starts(service, day)
    stats["generated"] = len(all_starts)

    for start in all_starts:
        key = start.strftime("%Y-%m-%d %H:%M:%S")
        booked = counts.get(key, 0)
        is_past = day.date() == now.date() and start <= now
        is_full = booked >= max_per
        if is_past:
            stats["past"] += 1
            continue
        if is_full:
            stats["full"] += 1
            continue
        ahead = _estimated_ahead(conn, service_id, start)
        eta = eta_model.predict_wait(service_id, ahead, when=start)
        stats["available"] += 1
        slots_out.append({
            "slot_start": key,
            "slot_end": (start + timedelta(minutes=service["slot_minutes"])).strftime("%Y-%m-%d %H:%M:%S"),
            "booked": booked,
            "capacity": max_per,
            "spots_left": max_per - booked,
            "crowd_level": crowd_level(eta),
            "predicted_wait_min": eta,
        })

    empty_reason = _empty_reason(service, date_str, stats, len(slots_out))
    return {
        "date": date_str,
        "timezone": "Asia/Kolkata",
        "server_now": tz.now_str(),
        "bookable_dates": tz.bookable_dates(3),
        "service": {
            "open_hour": service["open_hour"],
            "close_hour": service["close_hour"],
            "slot_minutes": service["slot_minutes"],
            "lunch_start": service["lunch_start"],
            "lunch_end": service["lunch_end"],
            "max_per_slot": max_per,
        },
        "stats": stats,
        "empty_reason": empty_reason,
        "slots": slots_out,
    }


def _active_booking(conn, service_id: int, user_id: int) -> dict | None:
    row = conn.execute(
        """SELECT * FROM appointments
           WHERE service_id = ? AND user_id = ? AND status = 'booked' AND slot_date >= ?""",
        (service_id, user_id, today_str()),
    ).fetchone()
    return row_to_dict(row) if row else None


def book_slot(conn, service_id: int, user_id: int, slot_start: str) -> dict:
    service = get_service(conn, service_id)
    try:
        start = tz.parse_naive(slot_start)
    except ValueError:
        raise QueueError("Invalid slot time format", 400)
    if start <= tz.now_naive():
        raise QueueError("That slot has already passed. Pick a later time.", 400)
    if not tz.is_bookable_date(start.strftime("%Y-%m-%d")):
        raise QueueError("Bookings are only available for the next 3 working days (Sundays excluded).", 400)

    valid = {s["slot_start"] for s in list_slots(conn, service_id, start.strftime("%Y-%m-%d"))["slots"]}
    if slot_start not in valid:
        raise QueueError("That slot is full or unavailable", 409)

    active = conn.execute(
        "SELECT id FROM tokens WHERE service_id = ? AND user_id = ? AND status IN ('waiting','called')",
        (service_id, user_id),
    ).fetchone()
    if active:
        raise QueueError("You already have an active token for this service", 409)
    if _active_booking(conn, service_id, user_id):
        raise QueueError("You already have a booking for this service. Cancel it first or check in.", 409)

    with write_transaction(conn):
        n = conn.execute(
            """SELECT COUNT(*) FROM appointments
               WHERE service_id = ? AND slot_start = ? AND status IN ('booked', 'checked_in')""",
            (service_id, slot_start),
        ).fetchone()[0]
        if n >= service["max_per_slot"]:
            raise QueueError("That slot just filled up. Pick another.", 409)
        cur = conn.execute(
            """INSERT INTO appointments (service_id, user_id, slot_start, slot_date, status, created_at)
               VALUES (?, ?, ?, ?, 'booked', ?)""",
            (service_id, user_id, slot_start, start.strftime("%Y-%m-%d"), now_str()),
        )
        appt_id = cur.lastrowid
    return get_appointment(conn, appt_id)


def get_appointment(conn, appointment_id: int) -> dict:
    row = conn.execute(
        """SELECT a.*, s.name AS service_name, s.code, s.counter
           FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.id = ?""",
        (appointment_id,),
    ).fetchone()
    if row is None:
        raise QueueError("Booking not found", 404)
    return row_to_dict(row)


def cancel_booking(conn, appointment_id: int, user_id: int) -> dict:
    appt = get_appointment(conn, appointment_id)
    if appt["user_id"] != user_id:
        raise QueueError("You can only cancel your own booking", 403)
    if appt["status"] != "booked":
        raise QueueError(f"Cannot cancel a booking that is already {appt['status']}", 409)
    conn.execute("UPDATE appointments SET status = 'cancelled' WHERE id = ?", (appointment_id,))
    return get_appointment(conn, appointment_id)


def check_in(conn, appointment_id: int, user_id: int) -> dict:
    appt = get_appointment(conn, appointment_id)
    if appt["user_id"] != user_id:
        raise QueueError("You can only check in to your own booking", 403)
    if appt["status"] != "booked":
        raise QueueError(f"Cannot check in — booking is {appt['status']}", 409)
    if appt["slot_date"] != today_str():
        raise QueueError("Check-in is only available on the day of your slot", 400)

    ahead = conn.execute(
        "SELECT COUNT(*) FROM tokens WHERE service_id = ? AND token_date = ? AND status = 'waiting'",
        (appt["service_id"], today_str()),
    ).fetchone()[0]
    predicted = eta_model.predict_wait(appt["service_id"], ahead)

    token = join_queue(
        conn,
        appt["service_id"],
        user_id,
        is_booked=True,
        appointment_id=appointment_id,
        predicted_eta_min=predicted,
    )
    conn.execute(
        "UPDATE appointments SET status = 'checked_in', token_id = ? WHERE id = ?",
        (token["id"], appointment_id),
    )
    token["slot_start"] = appt["slot_start"]
    return token


def release_unclaimed_slots(conn) -> list[dict]:
    """Release bookings not checked in within slot_release_minutes after slot time."""
    now = tz.now_naive()
    rows = conn.execute(
        """SELECT a.id, a.service_id, a.user_id, a.slot_start, a.slot_date,
                  s.name AS service_name, s.slot_release_minutes
           FROM appointments a JOIN services s ON s.id = a.service_id
           WHERE a.status = 'booked' AND a.slot_date = ?""",
        (today_str(),),
    ).fetchall()
    released = []
    for r in rows:
        release_min = int(r["slot_release_minutes"] or 10)
        deadline = tz.parse_naive(r["slot_start"]) + timedelta(minutes=release_min)
        if now < deadline:
            continue
        ts = now_str()
        conn.execute(
            "UPDATE appointments SET status = 'cancelled', released_at = ? WHERE id = ? AND status = 'booked'",
            (ts, r["id"]),
        )
        if conn.execute("SELECT changes()").fetchone()[0]:
            released.append({
                "appointment_id": r["id"],
                "service_id": r["service_id"],
                "service_name": r["service_name"],
                "slot_start": r["slot_start"],
            })
    return released


def appointments_for_user(conn, user_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT a.*, s.name AS service_name, s.code, s.counter
           FROM appointments a JOIN services s ON s.id = a.service_id
           WHERE a.user_id = ? AND a.status = 'booked' AND a.slot_date >= ?
           ORDER BY a.slot_start""",
        (user_id, today_str()),
    ).fetchall()
    return [row_to_dict(r) for r in rows]
