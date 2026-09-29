"""Wait-time predictor.

Learns actual wait (minutes from joining to being called) from queue history.
Features: people ahead, hour of day, weekday, service. Model: gradient-boosted trees
(scikit-learn, constrained so more people ahead never lowers the ETA), which capture patterns like "Monday 10 AM is slow" that a plain
average misses. On training we also measure a naive baseline
(people_ahead x average service time) so we can show how much better the model is.
"""
import threading
from datetime import datetime

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

_lock = threading.Lock()
_state = {"model": None, "service_ids": [], "avg_service": {}, "metrics": None}

MIN_ROWS = 200


def _features(ahead, hour, weekday, service_id, service_ids):
    one_hot = [1.0 if service_id == s else 0.0 for s in service_ids]
    return [float(ahead), float(hour), float(weekday), 1.0 if weekday == 0 else 0.0, *one_hot]


def train(conn) -> dict | None:
    rows = conn.execute(
        """SELECT service_id, ahead_at_join, created_at,
                  (julianday(called_at) - julianday(created_at)) * 1440 AS wait_min
           FROM tokens WHERE called_at IS NOT NULL"""
    ).fetchall()
    svc_rows = conn.execute(
        """SELECT service_id, AVG((julianday(served_at) - julianday(called_at)) * 1440) AS avg_s
           FROM tokens WHERE status = 'served' AND served_at IS NOT NULL GROUP BY service_id"""
    ).fetchall()
    avg_service = {r["service_id"]: r["avg_s"] for r in svc_rows if r["avg_s"]}
    service_ids = sorted({r["service_id"] for r in conn.execute("SELECT id AS service_id FROM services")})

    if len(rows) < MIN_ROWS:
        with _lock:
            _state.update(model=None, service_ids=service_ids, avg_service=avg_service, metrics=None)
        return None

    X, y, naive = [], [], []
    for r in rows:
        created = datetime.strptime(r["created_at"], "%Y-%m-%d %H:%M:%S")
        X.append(_features(r["ahead_at_join"], created.hour + created.minute / 60, created.weekday(), r["service_id"], service_ids))
        y.append(max(0.0, r["wait_min"]))
        naive.append(r["ahead_at_join"] * avg_service.get(r["service_id"], 4.0))
    X, y, naive = np.array(X), np.array(y), np.array(naive)

    X_tr, X_te, y_tr, y_te, _, naive_te = train_test_split(X, y, naive, test_size=0.2, random_state=42)
    # monotonic_cst: more people ahead can never mean a shorter predicted wait
    mono = [1] + [0] * (X.shape[1] - 1)
    model = HistGradientBoostingRegressor(max_iter=300, max_depth=5, learning_rate=0.08,
                                          monotonic_cst=mono, random_state=42)
    model.fit(X_tr, y_tr)
    mae_model = mean_absolute_error(y_te, model.predict(X_te))
    mae_naive = mean_absolute_error(y_te, naive_te)
    model.fit(X, y)  # final model on all data

    metrics = {
        "trained_on": int(len(y)),
        "mae_model_min": round(float(mae_model), 2),
        "mae_naive_min": round(float(mae_naive), 2),
        "improvement_pct": round(float((mae_naive - mae_model) / mae_naive * 100), 1) if mae_naive else 0.0,
        "trained_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    with _lock:
        _state.update(model=model, service_ids=service_ids, avg_service=avg_service, metrics=metrics)
    return metrics


def predict_wait(service_id: int, ahead: int, when: datetime | None = None) -> float:
    """Predicted minutes until this person is called, given `ahead` people waiting in front
    (ahead=0 still waits for whoever is at the counter now)."""
    if ahead < 0:
        return 0.0
    when = when or datetime.now()
    with _lock:
        model, service_ids, avg_service = _state["model"], _state["service_ids"], _state["avg_service"]
    if model is None or service_id not in service_ids:
        return round((ahead + 0.5) * avg_service.get(service_id, 4.0), 1)
    x = np.array([_features(ahead, when.hour + when.minute / 60, when.weekday(), service_id, service_ids)])
    return round(max(0.5, float(model.predict(x)[0])), 1)


def metrics() -> dict | None:
    with _lock:
        return _state["metrics"]


def avg_service_times() -> dict[int, float]:
    with _lock:
        return dict(_state["avg_service"])
