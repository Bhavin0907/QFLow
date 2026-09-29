"""Campus-local time (Asia/Kolkata). Slot strings in the DB are naive IST wall-clock times."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Kolkata")


def now() -> datetime:
    return datetime.now(TZ)


def now_naive() -> datetime:
    """Naive datetime matching IST wall clock — use for slot comparisons."""
    n = now()
    return n.replace(tzinfo=None)


def today_str() -> str:
    return now().strftime("%Y-%m-%d")


def now_str() -> str:
    return now_naive().strftime("%Y-%m-%d %H:%M:%S")


def parse_naive(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def is_sunday(day: date | datetime) -> bool:
    d = day.date() if isinstance(day, datetime) else day
    return d.weekday() == 6


def bookable_dates(count: int = 3) -> list[str]:
    """Up to `count` dates starting today, skipping Sundays."""
    dates: list[str] = []
    cursor = now().date()
    while len(dates) < count:
        if cursor.weekday() != 6:
            dates.append(cursor.strftime("%Y-%m-%d"))
        cursor += timedelta(days=1)
    return dates


def is_bookable_date(date_str: str) -> bool:
    try:
        d = parse_date(date_str)
    except ValueError:
        return False
    if is_sunday(d):
        return False
    return date_str in bookable_dates(3)
