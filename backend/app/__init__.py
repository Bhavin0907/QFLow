"""Loads backend/.env (if present) into the environment before other modules read it."""
import os

_env = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(_env):
    with open(_env) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                if value.strip():
                    os.environ.setdefault(key.strip(), value.strip())
    if "TZ" in os.environ and hasattr(__import__("time"), "tzset"):
        __import__("time").tzset()
