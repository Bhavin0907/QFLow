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
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS tokens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id     INTEGER NOT NULL REFERENCES services(id),
    user_id        INTEGER REFERENCES users(id),
    token_number   INTEGER NOT NULL,
    token_date     TEXT NOT NULL,                -- YYYY-MM-DD, numbering restarts daily
    status         TEXT NOT NULL CHECK (status IN ('waiting', 'called', 'served', 'skipped', 'cancelled')),
    priority       INTEGER NOT NULL DEFAULT 0,   -- 1 = priority lane (accessibility / urgent)
    ahead_at_join  INTEGER NOT NULL DEFAULT 0,   -- people ahead when joined (ML feature)
    created_at     TEXT NOT NULL,
    called_at      TEXT,
    served_at      TEXT,
    UNIQUE (service_id, token_date, token_number) -- DB-level guarantee: no duplicate tokens
);

CREATE INDEX IF NOT EXISTS idx_tokens_service_status ON tokens (service_id, status);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens (user_id, status);
"""


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


def row_to_dict(row):
    return dict(row) if row is not None else None
