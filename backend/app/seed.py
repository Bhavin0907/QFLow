"""Seed the database with services, demo accounts, 30 days of realistic queue
history (for the ETA model and heatmaps), and a live queue for today.

History is produced by simulating a real single-counter queue minute by minute:
morning rush, lunch break, busier Mondays, half-day Saturdays, random service
times, cancellations and no-shows. The waits in the data are therefore consistent
with the queue lengths, which is what lets the ML model learn real patterns.

Run:  python -m app.seed          (from the backend folder)
"""
import json
import math
import os
import random
from datetime import datetime, timedelta

from .db import DB_PATH, get_conn, init_db
from .security import hash_password

SERVICES = [
    {
        "name": "Certificates Office", "code": "C", "counter": "Admin Block, Counter 1",
        "description": "Bonafide, conduct, transfer and course completion certificates.",
        "documents": ["College ID card", "Filled application form", "Fee receipt (Rs. 50)"],
        "keywords": ["certificate", "bonafide", "conduct", "transfer", "tc", "completion", "study certificate", "passport verification"],
        "rate": 8.0, "svc": 5.0,
    },
    {
        "name": "ID Card Desk", "code": "I", "counter": "Admin Block, Counter 3",
        "description": "New ID cards, lost ID replacement and detail corrections.",
        "documents": ["Passport-size photo", "Police complaint or affidavit (for lost cards)", "Fee receipt (Rs. 200)"],
        "keywords": ["id", "identity", "lost", "card", "replacement", "stolen", "damaged", "photo", "lost id"],
        "rate": 4.5, "svc": 6.5,
    },
    {
        "name": "Fee & Accounts", "code": "F", "counter": "Accounts Section, Ground Floor",
        "description": "Fee payment issues, refunds, scholarships and receipts.",
        "documents": ["College ID card", "Fee challan or payment proof", "Bank passbook copy (for refunds)"],
        "keywords": ["fee", "fees", "payment", "refund", "scholarship", "challan", "receipt", "due", "fine", "hostel fee"],
        "rate": 9.0, "svc": 4.0,
    },
    {
        "name": "Exam Cell", "code": "E", "counter": "Exam Cell, First Floor",
        "description": "Hall tickets, revaluation, marksheet corrections and results.",
        "documents": ["College ID card", "Hall ticket or marksheet copy", "Revaluation fee receipt (if applicable)"],
        "keywords": ["exam", "hall", "ticket", "revaluation", "marksheet", "result", "arrear", "grade", "hall ticket", "mark"],
        "rate": 5.5, "svc": 5.5,
    },
    {
        "name": "IT Help Desk", "code": "H", "counter": "Library Building, Room 12",
        "description": "Wi-Fi access, college email, LMS login and password resets.",
        "documents": ["College ID card", "Laptop or phone with the issue"],
        "keywords": ["wifi", "wi-fi", "internet", "email", "password", "lms", "login", "portal", "network", "account"],
        "rate": 6.0, "svc": 4.5,
    },
]

HOUR_PROFILE = {9: 0.9, 10: 1.45, 11: 1.3, 12: 1.0, 13: 0.45, 14: 1.15, 15: 0.9, 16: 0.55}
FIRST_NAMES = ["Aarav", "Priya", "Karthik", "Divya", "Rahul", "Sneha", "Vikram", "Ananya", "Arjun", "Meera",
               "Rohan", "Kavya", "Siddharth", "Nithya", "Harish", "Lakshmi", "Aditya", "Pooja", "Surya", "Deepa"]
LAST_INITIALS = ["R", "S", "K", "M", "V", "P", "N", "A"]


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _poisson_arrivals(rng, day: datetime, rate_per_hour_fn, open_h, close_h):
    """Minute-level Bernoulli approximation of a non-homogeneous Poisson process."""
    arrivals = []
    t = day.replace(hour=open_h, minute=0, second=0)
    end = day.replace(hour=close_h, minute=0) - timedelta(minutes=15)  # last entry 15 min before close
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
    records, pending = [], []  # pending: called times of earlier arrivals (for 'ahead' count)

    for i, arr in enumerate(arrivals):
        ahead = sum(1 for c in pending if c > arr)
        # people leave if the line looks too long
        cancel_p = 0.03 + min(0.12, ahead * 0.006)
        if rng.random() < cancel_p:
            records.append({"n": i + 1, "created": arr, "called": None, "served": None, "status": "cancelled", "ahead": ahead})
            continue
        called = max(arr, server_free)
        if weekday != 5 and lunch_start <= called < lunch_end:
            called = lunch_end
        rush = 1.15 if called.hour in (10, 11) else 1.0          # complex requests pile up in the rush
        monday = 1.1 if weekday == 0 else 1.0
        mean = svc["svc"] * rush * monday
        sigma = 0.35
        duration = rng.lognormvariate(math.log(mean) - sigma ** 2 / 2, sigma)
        if rng.random() < 0.04:
            status, duration = "skipped", 1.0                    # no-show: staff waits a minute then moves on
        else:
            status = "served"
        served = called + timedelta(minutes=duration)
        server_free = served
        pending.append(called)
        records.append({"n": i + 1, "created": arr, "called": called, "served": served, "status": status, "ahead": ahead})
    return records


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
        # accounts
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
            name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_INITIALS)}."
            cur = conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'student')",
                               (name, f"student{i + 1}@campus.edu", student_pw))
            student_ids.append(cur.lastrowid)

        # services
        service_ids = []
        for s in SERVICES:
            cur = conn.execute(
                "INSERT INTO services (name, code, description, counter, documents, keywords) VALUES (?,?,?,?,?,?)",
                (s["name"], s["code"], s["description"], s["counter"], json.dumps(s["documents"]), json.dumps(s["keywords"])),
            )
            service_ids.append(cur.lastrowid)

        # history
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        rows = []
        for d in range(days, 0, -1):
            day = today - timedelta(days=d)
            for sid, svc in zip(service_ids, SERVICES):
                for r in simulate_day(rng, day, svc):
                    rows.append((
                        sid, rng.choice(student_ids), r["n"], day.strftime("%Y-%m-%d"), r["status"], 0, r["ahead"],
                        _fmt(r["created"]), _fmt(r["called"]) if r["called"] else None,
                        _fmt(r["served"]) if r["served"] else None,
                    ))
        conn.executemany(
            """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, priority, ahead_at_join,
                                   created_at, called_at, served_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )

        # today's live queue: some served earlier, one being served, several waiting
        now = datetime.now()
        day_str = now.strftime("%Y-%m-%d")
        live_waiting = [5, 3, 6, 2, 4]
        for sid, svc, n_wait in zip(service_ids, SERVICES, live_waiting):
            n_served = rng.randint(10, 18)
            number = 0
            t = now - timedelta(minutes=n_served * svc["svc"] + 25)
            for _ in range(n_served):
                number += 1
                created = t
                called = t + timedelta(minutes=rng.uniform(2, 12))
                served = called + timedelta(minutes=rng.uniform(svc["svc"] * 0.6, svc["svc"] * 1.4))
                conn.execute(
                    """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, ahead_at_join,
                                           created_at, called_at, served_at) VALUES (?,?,?,?, 'served', ?, ?,?,?)""",
                    (sid, rng.choice(student_ids), number, day_str, rng.randint(0, 5), _fmt(created), _fmt(called), _fmt(served)),
                )
                t = served - timedelta(minutes=rng.uniform(1, 4))
            number += 1
            conn.execute(
                """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, ahead_at_join,
                                       created_at, called_at) VALUES (?,?,?,?, 'called', ?, ?, ?)""",
                (sid, rng.choice(student_ids), number, day_str, 2,
                 _fmt(now - timedelta(minutes=14)), _fmt(now - timedelta(minutes=2))),
            )
            for k in range(n_wait):
                number += 1
                conn.execute(
                    """INSERT INTO tokens (service_id, user_id, token_number, token_date, status, ahead_at_join, created_at)
                       VALUES (?,?,?,?, 'waiting', ?, ?)""",
                    (sid, rng.choice(student_ids), number, day_str, k,
                     _fmt(now - timedelta(minutes=(n_wait - k) * 3))),
                )
        conn.execute("COMMIT")
        total = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()[0]
    return total


if __name__ == "__main__":
    n = seed()
    print(f"Seeded {n} tokens into {os.path.abspath(DB_PATH)}")
    print("Demo logins: admin@campus.edu / admin123, staff@campus.edu / staff123, student@campus.edu / student123")
