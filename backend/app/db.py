"""SQLite database layer.

Kept as plain sqlite3 (no ORM) so every query is visible and easy to explain.
WAL mode + a busy timeout let many requests read while one writes.
"""
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("QFLOW_DB", os.path.join(os.path.dirname(__file__), "..", "qflow.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('student', 'staff', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS services (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    code          TEXT NOT NULL UNIQUE,          -- token prefix, e.g. 'C' -> C-042
    description   TEXT NOT NULL DEFAULT '',
    counter       TEXT NOT NULL DEFAULT '',      -- physical location
    documents     TEXT NOT NULL DEFAULT '[]',    -- JSON list of required documents
    keywords      TEXT NOT NULL DEFAULT '[]',    -- JSON list used by the assistant fallback
    is_paused     INTEGER NOT NULL DEFAULT 0,
    pause_message TEXT NOT NULL DEFAULT '',
    slot_minutes  INTEGER NOT NULL DEFAULT 15,
    open_hour     INTEGER NOT NULL DEFAULT 9,
    close_hour    INTEGER NOT NULL DEFAULT 17,
    lunch_start   INTEGER NOT NULL DEFAULT 13,
    lunch_end     INTEGER NOT NULL DEFAULT 14,
    max_per_slot  INTEGER NOT NULL DEFAULT 3,
    grace_seconds INTEGER NOT NULL DEFAULT 20,
    slot_release_minutes INTEGER NOT NULL DEFAULT 10,
    rush_threshold_min   INTEGER NOT NULL DEFAULT 30,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id  INTEGER NOT NULL REFERENCES services(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    slot_start  TEXT NOT NULL,                       -- YYYY-MM-DD HH:MM:SS
    slot_date   TEXT NOT NULL,                       -- YYYY-MM-DD
    status      TEXT NOT NULL CHECK (status IN ('booked', 'checked_in', 'cancelled', 'completed')),
    token_id    INTEGER,
    released_at TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id         INTEGER NOT NULL REFERENCES services(id),
    user_id            INTEGER REFERENCES users(id),
    token_number       INTEGER NOT NULL,
    token_date         TEXT NOT NULL,                -- YYYY-MM-DD, numbering restarts daily
    status             TEXT NOT NULL CHECK (status IN ('waiting', 'called', 'served', 'skipped', 'cancelled')),
    priority           INTEGER NOT NULL DEFAULT 0,   -- 1 = priority lane (accessibility / urgent)
    ahead_at_join      INTEGER NOT NULL DEFAULT 0,   -- people ahead when joined (ML feature)
    is_booked          INTEGER NOT NULL DEFAULT 0,   -- 1 = checked in from a slot booking
    predicted_eta_min  REAL,
    actual_wait_min    REAL,                         -- set when called (called_at - created_at)
    appointment_id     INTEGER,
    grace_expires_at   TEXT,
    responded_at       TEXT,
    requeue_used       INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    called_at          TEXT,
    served_at          TEXT,
    UNIQUE (service_id, token_date, token_number) -- DB-level guarantee: no duplicate tokens
);

CREATE TABLE IF NOT EXISTS queue_state (
    service_id          INTEGER NOT NULL,
    token_date          TEXT NOT NULL,
    consecutive_booked  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (service_id, token_date)
);

CREATE INDEX IF NOT EXISTS idx_tokens_service_status ON tokens (service_id, status);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens (user_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_service_slot ON appointments (service_id, slot_date, slot_start, status);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments (user_id, status);
"""


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def migrate(conn: sqlite3.Connection):
    """Additive migrations for databases created before Phase 1."""
    svc_cols = _table_columns(conn, "services")
    for col, ddl in (
        ("slot_minutes", "ALTER TABLE services ADD COLUMN slot_minutes INTEGER NOT NULL DEFAULT 15"),
        ("open_hour", "ALTER TABLE services ADD COLUMN open_hour INTEGER NOT NULL DEFAULT 9"),
        ("close_hour", "ALTER TABLE services ADD COLUMN close_hour INTEGER NOT NULL DEFAULT 17"),
        ("lunch_start", "ALTER TABLE services ADD COLUMN lunch_start INTEGER NOT NULL DEFAULT 13"),
        ("lunch_end", "ALTER TABLE services ADD COLUMN lunch_end INTEGER NOT NULL DEFAULT 14"),
        ("max_per_slot", "ALTER TABLE services ADD COLUMN max_per_slot INTEGER NOT NULL DEFAULT 3"),
        ("grace_seconds", "ALTER TABLE services ADD COLUMN grace_seconds INTEGER NOT NULL DEFAULT 20"),
        ("slot_release_minutes", "ALTER TABLE services ADD COLUMN slot_release_minutes INTEGER NOT NULL DEFAULT 10"),
        ("rush_threshold_min", "ALTER TABLE services ADD COLUMN rush_threshold_min INTEGER NOT NULL DEFAULT 30"),
    ):
        if col not in svc_cols:
            conn.execute(ddl)

    tok_cols = _table_columns(conn, "tokens")
    for col, ddl in (
        ("is_booked", "ALTER TABLE tokens ADD COLUMN is_booked INTEGER NOT NULL DEFAULT 0"),
        ("predicted_eta_min", "ALTER TABLE tokens ADD COLUMN predicted_eta_min REAL"),
        ("actual_wait_min", "ALTER TABLE tokens ADD COLUMN actual_wait_min REAL"),
        ("appointment_id", "ALTER TABLE tokens ADD COLUMN appointment_id INTEGER"),
        ("grace_expires_at", "ALTER TABLE tokens ADD COLUMN grace_expires_at TEXT"),
        ("responded_at", "ALTER TABLE tokens ADD COLUMN responded_at TEXT"),
        ("requeue_used", "ALTER TABLE tokens ADD COLUMN requeue_used INTEGER NOT NULL DEFAULT 0"),
    ):
        if col not in tok_cols:
            conn.execute(ddl)

    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='appointments'").fetchone():
        appt_cols = _table_columns(conn, "appointments")
        if "released_at" not in appt_cols:
            conn.execute("ALTER TABLE appointments ADD COLUMN released_at TEXT")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS appointments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id  INTEGER NOT NULL REFERENCES services(id),
            user_id     INTEGER NOT NULL REFERENCES users(id),
            slot_start  TEXT NOT NULL,
            slot_date   TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('booked', 'checked_in', 'cancelled', 'completed')),
            token_id    INTEGER REFERENCES tokens(id),
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queue_state (
            service_id          INTEGER NOT NULL,
            token_date          TEXT NOT NULL,
            consecutive_booked  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (service_id, token_date)
        );
        CREATE INDEX IF NOT EXISTS idx_appointments_service_slot ON appointments (service_id, slot_date, slot_start, status);
        CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments (user_id, status);
        """
    )


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def write_transaction(conn: sqlite3.Connection):
    """BEGIN IMMEDIATE takes the write lock up front, so two simultaneous
    'join queue' requests are serialized and can never read the same max token."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def init_db():
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        migrate(conn)


def row_to_dict(row):
    return dict(row) if row is not None else None
