"""Analytics: peak-hour heatmap, best time to visit, daily trends, admin insight."""
import json
from datetime import datetime, timedelta

from . import llm
from .queue_service import list_services

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


def admin_insight(conn) -> dict:
    day = _latest_day_with_data(conn)
    if not day:
        return {"day": None, "lines": ["No queue activity yet. Insights appear once students start joining queues."], "source": "template"}
    breakdown = service_breakdown(conn, day)
    overall = conn.execute(
        """SELECT AVG((julianday(called_at) - julianday(created_at)) * 1440) FROM tokens
           WHERE token_date = ? AND called_at IS NOT NULL""",
        (day,),
    ).fetchone()[0]
    overall = round(overall, 1) if overall else None
    baseline = _baseline_avg_wait(conn, day)
    fallback = _template_insight(day, breakdown, baseline, overall)

    stats = {"day": day, "overall_avg_wait_min": overall, "two_week_avg_wait_min": baseline, "per_service": breakdown}
    text = llm.generate(
        prompt=f"Queue statistics for a college administration office:\n{json.dumps(stats)}",
        system=(
            "You are an operations analyst for a college. Write 3 or 4 short, specific sentences for the admin: "
            "what happened, what stands out compared to normal, and one concrete staffing recommendation. "
            "Use only numbers present in the data. Return JSON: {\"lines\": [\"...\", \"...\"]}"
        ),
        json_mode=True,
    )
    if text:
        try:
            lines = json.loads(text)["lines"]
            if isinstance(lines, list) and lines:
                return {"day": day, "lines": [str(l) for l in lines[:5]], "source": "ai"}
        except (ValueError, KeyError, TypeError):
            pass
    return {"day": day, "lines": fallback, "source": "template"}
