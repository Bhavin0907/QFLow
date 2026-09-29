"""Analytics: peak-hour heatmap, best time to visit, daily trends, admin insight."""
import json
import time
from datetime import datetime, timedelta

from . import eta_model, llm
from .queue_service import format_token, list_services, today_str, waiting_count

OPEN_HOURS = list(range(9, 17))          # 9 AM - 5 PM
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def heatmap(conn, service_id: int) -> dict:
    """Average wait (minutes) per weekday x hour from all history."""
    rows = conn.execute(
        """SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow,
                  CAST(strftime('%H', created_at) AS INTEGER) AS hr,
                  AVG((julianday(called_at) - julianday(created_at)) * 1440) AS wait,
                  COUNT(*) AS n
           FROM tokens WHERE service_id = ? AND called_at IS NOT NULL
           GROUP BY dow, hr""",
        (service_id,),
    ).fetchall()
    # sqlite %w: 0 = Sunday. Convert to Mon=0 ... Sat=5
    grid = {}
    for r in rows:
        wd = (r["dow"] + 6) % 7
        if wd < len(WEEKDAYS) and r["hr"] in OPEN_HOURS and r["n"] >= 3:
            grid[(wd, r["hr"])] = round(r["wait"], 1)
    cells = [
        {"day": WEEKDAYS[d], "day_index": d, "hour": h, "avg_wait": grid.get((d, h))}
        for d in range(len(WEEKDAYS)) for h in OPEN_HOURS
    ]
    return {"hours": OPEN_HOURS, "days": WEEKDAYS, "cells": cells}


def best_time(conn, service_id: int) -> dict | None:
    hm = heatmap(conn, service_id)
    valid = [c for c in hm["cells"] if c["avg_wait"] is not None]
    if not valid:
        return None
    today = datetime.now().weekday()
    best_overall = min(valid, key=lambda c: c["avg_wait"])
    worst = max(valid, key=lambda c: c["avg_wait"])
    today_cells = [c for c in valid if c["day_index"] == today and c["hour"] >= datetime.now().hour]
    best_today = min(today_cells, key=lambda c: c["avg_wait"]) if today_cells else None
    return {"best_overall": best_overall, "best_today": best_today, "busiest": worst}


def daily_series(conn, days: int = 14) -> list[dict]:
    start = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT token_date,
                  SUM(status = 'served') AS served,
                  AVG(CASE WHEN called_at IS NOT NULL
                      THEN (julianday(called_at) - julianday(created_at)) * 1440 END) AS avg_wait
           FROM tokens WHERE token_date >= ? GROUP BY token_date ORDER BY token_date""",
        (start,),
    ).fetchall()
    return [
        {"date": r["token_date"], "served": r["served"] or 0, "avg_wait": round(r["avg_wait"], 1) if r["avg_wait"] else 0}
        for r in rows
    ]


def service_breakdown(conn, day: str) -> list[dict]:
    out = []
    for s in list_services(conn):
        r = conn.execute(
            """SELECT SUM(status = 'served') AS served, SUM(status = 'skipped') AS skipped, COUNT(*) AS total,
                      AVG(CASE WHEN called_at IS NOT NULL
                          THEN (julianday(called_at) - julianday(created_at)) * 1440 END) AS avg_wait
               FROM tokens WHERE service_id = ? AND token_date = ?""",
            (s["id"], day),
        ).fetchone()
        peak = conn.execute(
            """SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hr, COUNT(*) AS n
               FROM tokens WHERE service_id = ? AND token_date = ? GROUP BY hr ORDER BY n DESC LIMIT 1""",
            (s["id"], day),
        ).fetchone()
        out.append({
            "service": s["name"],
            "served": r["served"] or 0,
            "skipped": r["skipped"] or 0,
            "total": r["total"] or 0,
            "avg_wait": round(r["avg_wait"], 1) if r["avg_wait"] else 0,
            "peak_hour": peak["hr"] if peak else None,
        })
    return out


def _avg_service_times(conn) -> dict[int, float]:
    cached = eta_model.avg_service_times()
    if cached:
        return cached
    rows = conn.execute(
        """SELECT service_id, AVG((julianday(served_at) - julianday(called_at)) * 1440) AS avg_s
           FROM tokens WHERE status = 'served' AND served_at IS NOT NULL GROUP BY service_id"""
    ).fetchall()
    return {r["service_id"]: r["avg_s"] for r in rows if r["avg_s"]}


def _eta_accuracy_slice(rows, avg_service: dict[int, float]) -> dict:
    if not rows:
        return {"count": 0, "mae_model_min": None, "mae_naive_min": None, "improvement_pct": None}
    model_err, naive_err = [], []
    for r in rows:
        actual = float(r["actual_wait_min"])
        pred = float(r["predicted_eta_min"])
        naive = float(r["ahead_at_join"]) * avg_service.get(r["service_id"], 4.0)
        model_err.append(abs(actual - pred))
        naive_err.append(abs(actual - naive))
    mae_model = sum(model_err) / len(model_err)
    mae_naive = sum(naive_err) / len(naive_err)
    return {
        "count": len(rows),
        "mae_model_min": round(mae_model, 2),
        "mae_naive_min": round(mae_naive, 2),
        "improvement_pct": round((mae_naive - mae_model) / mae_naive * 100, 1) if mae_naive else 0.0,
    }


def eta_accuracy(conn, day: str | None = None, chart_limit: int = 24) -> dict:
    """Live ETA accuracy from logged predictions vs actual waits (join → called)."""
    day = day or today_str()
    rows = conn.execute(
        """SELECT t.id, t.service_id, t.token_number, t.ahead_at_join, t.predicted_eta_min,
                  t.actual_wait_min, t.is_booked, s.code
           FROM tokens t JOIN services s ON s.id = t.service_id
           WHERE t.token_date = ? AND t.predicted_eta_min IS NOT NULL AND t.actual_wait_min IS NOT NULL
           ORDER BY t.called_at""",
        (day,),
    ).fetchall()
    avg_service = _avg_service_times(conn)
    row_dicts = [dict(r) for r in rows]
    overall = _eta_accuracy_slice(row_dicts, avg_service)
    walk_in = _eta_accuracy_slice([r for r in row_dicts if not r["is_booked"]], avg_service)
    booked = _eta_accuracy_slice([r for r in row_dicts if r["is_booked"]], avg_service)

    chart = []
    for r in row_dicts[-chart_limit:]:
        naive = round(r["ahead_at_join"] * avg_service.get(r["service_id"], 4.0), 1)
        chart.append({
            "label": format_token(r["code"], r["token_number"]),
            "predicted": round(float(r["predicted_eta_min"]), 1),
            "actual": round(float(r["actual_wait_min"]), 1),
            "naive": naive,
            "is_booked": bool(r["is_booked"]),
        })

    return {
        "day": day,
        **overall,
        "by_type": {"walk_in": walk_in, "booked": booked},
        "chart": chart,
    }


def _in_lunch(service: dict, when: datetime) -> bool:
    if when.hour < service.get("lunch_start", 13):
        return False
    return when.hour < service.get("lunch_end", 14)


def _outside_hours(service: dict, when: datetime) -> bool:
    return when.hour < service.get("open_hour", 9) or when.hour >= service.get("close_hour", 17)


def _arrivals_per_min(conn, service_id: int) -> float:
    """Estimate join rate from today's traffic in the current hour."""
    hour = datetime.now().hour
    row = conn.execute(
        """SELECT COUNT(*) AS n FROM tokens
           WHERE service_id = ? AND token_date = ? AND CAST(strftime('%H', created_at) AS INTEGER) = ?""",
        (service_id, today_str(), hour),
    ).fetchone()
    n = row["n"] or 0
    if n >= 2:
        return max(0.04, n / 60.0)
    row = conn.execute(
        """SELECT AVG(cnt) FROM (
               SELECT COUNT(*) AS cnt FROM tokens
               WHERE service_id = ? AND called_at IS NOT NULL
                 AND CAST(strftime('%H', created_at) AS INTEGER) = ?
               GROUP BY token_date
           )""",
        (service_id, hour),
    ).fetchone()
    hist = row[0] if row else None
    return max(0.05, (hist or 6) / 60.0)


def rush_forecast(conn, service_id: int, horizon_min: int = 60) -> dict:
    """Forecast wait over the next hour; flag if it will exceed the service threshold."""
    from .queue_service import get_service

    service = get_service(conn, service_id)
    threshold = int(service.get("rush_threshold_min") or 30)
    if service.get("is_paused"):
        return {
            "active": False,
            "service_id": service_id,
            "service_name": service["name"],
            "threshold_min": threshold,
            "message": None,
            "waiting_now": waiting_count(conn, service_id),
        }

    waiting = waiting_count(conn, service_id)
    avg_svc = eta_model.avg_service_times().get(service_id, 4.0) or 4.0
    arrival = _arrivals_per_min(conn, service_id)
    now = datetime.now()
    queue = float(waiting)
    breach_at = None
    peak_wait = eta_model.predict_wait(service_id, max(0, int(round(queue))), now)

    if peak_wait >= threshold:
        breach_at = now

    if not _outside_hours(service, now):
        for step in range(5, horizon_min + 1, 5):
            t = now + timedelta(minutes=step)
            if _outside_hours(service, t):
                break
            if not _in_lunch(service, t):
                for _ in range(5):
                    queue = max(0.0, queue - (1.0 / avg_svc)) + arrival
            ahead = max(0, int(round(queue)))
            wait = eta_model.predict_wait(service_id, ahead, t)
            peak_wait = max(peak_wait, wait)
            if wait >= threshold and breach_at is None and not _in_lunch(service, t):
                breach_at = t

    active = breach_at is not None
    message = None
    if active:
        clock = breach_at.strftime("%I:%M %p").lstrip("0")
        if breach_at <= now + timedelta(seconds=30):
            message = f"{service['name']} wait already exceeds {threshold} min (now ~{round(peak_wait)} min)"
        else:
            message = f"{service['name']} wait will exceed {threshold} min by {clock}"

    return {
        "active": active,
        "service_id": service_id,
        "service_name": service["name"],
        "threshold_min": threshold,
        "peak_wait_min": round(peak_wait, 1),
        "breach_at": breach_at.strftime("%Y-%m-%d %H:%M:%S") if breach_at else None,
        "breach_clock": breach_at.strftime("%I:%M %p").lstrip("0") if breach_at else None,
        "message": message,
        "waiting_now": waiting,
    }


def active_rush_alerts(conn) -> list[dict]:
    alerts = []
    for s in list_services(conn):
        fc = rush_forecast(conn, s["id"])
        if fc["active"]:
            alerts.append(fc)
    return alerts


def _latest_day_with_data(conn) -> str | None:
    """Most recent *completed* day (today is still in progress), else today."""
    today = datetime.now().strftime("%Y-%m-%d")
    row = conn.execute("SELECT MAX(token_date) FROM tokens WHERE status = 'served' AND token_date < ?", (today,)).fetchone()
    if row and row[0]:
        return row[0]
    row = conn.execute("SELECT MAX(token_date) FROM tokens WHERE status = 'served'").fetchone()
    return row[0] if row else None


def _baseline_avg_wait(conn, day: str) -> float | None:
    start = (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=14)).strftime("%Y-%m-%d")
    v = conn.execute(
        """SELECT AVG((julianday(called_at) - julianday(created_at)) * 1440) FROM tokens
           WHERE token_date >= ? AND token_date < ? AND called_at IS NOT NULL""",
        (start, day),
    ).fetchone()[0]
    return round(v, 1) if v else None


def _hour_label(h):
    if h is None:
        return "-"
    suffix = "AM" if h < 12 else "PM"
    return f"{(h - 1) % 12 + 1} {suffix}"


def _template_insight(day, breakdown, baseline, overall_wait) -> list[str]:
    lines = []
    served = sum(b["served"] for b in breakdown)
    lines.append(f"{served} students were served across {len(breakdown)} counters on {day}.")
    if baseline and overall_wait:
        change = (overall_wait - baseline) / baseline * 100
        direction = "higher" if change > 0 else "lower"
        lines.append(f"Average wait was {overall_wait} min, {abs(change):.0f}% {direction} than the 2-week average of {baseline} min.")
    busiest = max(breakdown, key=lambda b: b["avg_wait"], default=None)
    if busiest and busiest["avg_wait"]:
        lines.append(
            f"{busiest['service']} had the longest waits ({busiest['avg_wait']} min on average), peaking around "
            f"{_hour_label(busiest['peak_hour'])}. Consider opening a second counter in that hour."
        )
    noshow = max(breakdown, key=lambda b: (b["skipped"] / b["total"]) if b["total"] else 0, default=None)
    if noshow and noshow["total"] and noshow["skipped"] / noshow["total"] > 0.04:
        lines.append(
            f"{noshow['service']} had a {noshow['skipped'] / noshow['total'] * 100:.0f}% no-show rate. "
            f"Earlier 'you're almost up' alerts could reduce this."
        )
    return lines


_insight_cache: dict | None = None
_insight_cache_at: float = 0.0
INSIGHT_CACHE_SECONDS = 600


def _compute_insight_stats(conn, day: str) -> dict:
    breakdown = service_breakdown(conn, day)
    overall = conn.execute(
        """SELECT AVG((julianday(called_at) - julianday(created_at)) * 1440) FROM tokens
           WHERE token_date = ? AND called_at IS NOT NULL""",
        (day,),
    ).fetchone()[0]
    overall = round(overall, 1) if overall else None
    baseline = _baseline_avg_wait(conn, day)
    served = sum(b["served"] for b in breakdown)
    skipped = sum(b["skipped"] for b in breakdown)
    return {
        "day": day,
        "students_served": served,
        "no_shows": skipped,
        "overall_avg_wait_min": overall,
        "two_week_avg_wait_min": baseline,
        "per_service": breakdown,
    }


async def admin_insight(conn, *, refresh: bool = False) -> dict:
    global _insight_cache, _insight_cache_at

    if (
        not refresh
        and _insight_cache is not None
        and time.time() - _insight_cache_at < INSIGHT_CACHE_SECONDS
    ):
        return _insight_cache

    day = _latest_day_with_data(conn)
    if not day:
        result = {
            "day": None,
            "lines": ["No queue activity yet. Insights appear once students start joining queues."],
            "source": "template",
        }
        _insight_cache = result
        _insight_cache_at = time.time()
        return result

    stats = _compute_insight_stats(conn, day)
    fallback = _template_insight(
        day, stats["per_service"], stats["two_week_avg_wait_min"], stats["overall_avg_wait_min"],
    )

    parsed = await llm.generate_json(
        prompt=f"Queue statistics (use ONLY these numbers):\n{json.dumps(stats)}",
        system=(
            "You are an operations analyst for a college admin office. "
            "Write 3-4 short sentences for the admin: what happened, what stands out vs normal, "
            "and one concrete staffing recommendation. Use ONLY numbers from the JSON — do not invent any. "
            'Return JSON: {"lines": ["...", "..."]}'
        ),
    )
    if parsed:
        lines = parsed.get("lines")
        if isinstance(lines, list) and lines:
            result = {"day": day, "lines": [str(l) for l in lines[:5]], "source": "ai"}
            _insight_cache = result
            _insight_cache_at = time.time()
            return result

    result = {"day": day, "lines": fallback, "source": "template"}
    _insight_cache = result
    _insight_cache_at = time.time()
    return result
