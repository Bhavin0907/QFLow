"""Qflow API: FastAPI app with REST endpoints and a WebSocket for live updates.

Run (from the backend folder):  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
import os
import socket
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field, field_validator

from . import analytics, assistant, eta_model, llm
from . import queue_service as q
from .db import connect, get_conn, init_db
from .security import create_access_token, decode_access_token, hash_password, verify_password


# ---------- live updates ----------

class ConnectionManager:
    def __init__(self):
        self.active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)

    async def broadcast(self, message: dict):
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


async def notify(service_id: int, event: str, **extra):
    await manager.broadcast({"type": "queue_update", "service_id": service_id, "event": event, **extra})


# ---------- app setup ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with get_conn() as conn:
        if conn.execute("SELECT COUNT(*) FROM services").fetchone()[0] == 0:
            from .seed import seed
            seed(reset=False)
        eta_model.train(conn)
    yield


app = FastAPI(title="Qflow API", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(q.QueueError)
async def queue_error_handler(_: Request, exc: q.QueueError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), conn=Depends(get_db)) -> dict:
    if creds is None:
        raise HTTPException(401, "Please log in to continue")
    payload = decode_access_token(creds.credentials)
    if not payload:
        raise HTTPException(401, "Your session has expired. Please log in again.")
    row = conn.execute("SELECT id, name, email, role FROM users WHERE id = ?", (int(payload["sub"]),)).fetchone()
    if row is None:
        raise HTTPException(401, "Account not found")
    return dict(row)


def require_role(*roles):
    def checker(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "You don't have permission for this action")
        return user
    return checker


staff_only = require_role("staff", "admin")
admin_only = require_role("admin")


# ---------- schemas (validation) ----------

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v):
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Name must be at least 2 characters")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=100)


class GuestIn(BaseModel):
    name: str = Field(min_length=2, max_length=40)


class ServiceIn(BaseModel):
    name: str = Field(min_length=3, max_length=60)
    code: str = Field(min_length=1, max_length=2, pattern=r"^[A-Za-z]{1,2}$")
    description: str = Field(default="", max_length=200)
    counter: str = Field(default="", max_length=80)
    documents: list[str] = Field(default_factory=list, max_length=10)
    keywords: list[str] = Field(default_factory=list, max_length=30)


class PauseIn(BaseModel):
    message: str = Field(default="", max_length=120)


class AskIn(BaseModel):
    message: str = Field(min_length=2, max_length=300)


# ---------- helpers ----------

def _clock(minutes: float) -> str:
    return (datetime.now() + timedelta(minutes=minutes)).strftime("%I:%M %p").lstrip("0")


def _service_live(conn, service: dict) -> dict:
    waiting = q.waiting_count(conn, service["id"])
    called = q.current_called(conn, service["id"])
    eta = eta_model.predict_wait(service["id"], waiting)
    return {
        **service,
        "waiting": waiting,
        "now_serving": called["label"] if called else None,
        "eta_if_join_min": eta,
        "keywords": None,
    }


def _token_live(conn, token: dict) -> dict:
    service = q.get_service(conn, token["service_id"])
    position = q.position_of(conn, token)
    ahead = max(0, position - 1)
    eta = eta_model.predict_wait(token["service_id"], ahead) if token["status"] == "waiting" else 0
    called = q.current_called(conn, token["service_id"])
    return {
        "id": token["id"],
        "label": token["label"],
        "status": token["status"],
        "priority": bool(token["priority"]),
        "service_id": token["service_id"],
        "service_name": token["service_name"],
        "counter": token["counter"],
        "documents": service["documents"],
        "position": position,
        "ahead": ahead,
        "eta_min": eta,
        "eta_clock": _clock(eta) if token["status"] == "waiting" else None,
        "now_serving": called["label"] if called else None,
        "is_paused": service["is_paused"],
        "pause_message": service["pause_message"],
        "created_at": token["created_at"],
        "called_at": token["called_at"],
    }


# ---------- auth ----------

def _auth_response(user_id: int, name: str, email: str, role: str) -> dict:
    return {"access_token": create_access_token(user_id, role), "user": {"id": user_id, "name": name, "email": email, "role": role}}


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn, conn=Depends(get_db)):
    email = body.email.lower()
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    cur = conn.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'student')",
        (body.name, email, hash_password(body.password)),
    )
    return _auth_response(cur.lastrowid, body.name, email, "student")


@app.post("/api/auth/login")
def login(body: LoginIn, conn=Depends(get_db)):
    row = conn.execute("SELECT * FROM users WHERE email = ?", (body.email.lower(),)).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    return _auth_response(row["id"], row["name"], row["email"], row["role"])


@app.post("/api/auth/guest", status_code=201)
def guest(body: GuestIn, conn=Depends(get_db)):
    """One-tap join for QR-code visitors: creates a lightweight student account."""
    import secrets
    name = body.name.strip()
    email = f"guest-{secrets.token_hex(4)}@guest.qflow"
    cur = conn.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'student')",
        (name, email, hash_password(secrets.token_hex(16))),
    )
    return _auth_response(cur.lastrowid, name, email, "student")


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return user


# ---------- services ----------

@app.get("/api/services")
def services(conn=Depends(get_db)):
    return [_service_live(conn, s) for s in q.list_services(conn)]


@app.get("/api/services/{service_id}")
def service_detail(service_id: int, conn=Depends(get_db)):
    s = q.get_service(conn, service_id)
    return {**_service_live(conn, s), "best_time": analytics.best_time(conn, service_id)}


@app.get("/api/services/{service_id}/heatmap")
def service_heatmap(service_id: int, conn=Depends(get_db)):
    q.get_service(conn, service_id)
    return analytics.heatmap(conn, service_id)


@app.post("/api/services", status_code=201)
async def create_service(body: ServiceIn, _=Depends(admin_only), conn=Depends(get_db)):
    s = q.create_service(
        conn, body.name, body.code, body.description, body.counter,
        [d.strip() for d in body.documents if d.strip()], [k.strip().lower() for k in body.keywords if k.strip()],
    )
    eta_model.train(conn)
    await notify(s["id"], "service_created")
    return s


# ---------- student tokens ----------

@app.post("/api/services/{service_id}/join", status_code=201)
async def join(service_id: int, user=Depends(current_user), conn=Depends(get_db)):
    token = q.join_queue(conn, service_id, user["id"])
    await notify(service_id, "joined")
    return _token_live(conn, token)


@app.get("/api/tokens/me")
def my_tokens(user=Depends(current_user), conn=Depends(get_db)):
    return {
        "active": [_token_live(conn, t) for t in q.active_tokens_for_user(conn, user["id"])],
        "history": [
            {"id": t["id"], "label": t["label"], "status": t["status"], "service_name": t["service_name"], "created_at": t["created_at"]}
            for t in q.history_for_user(conn, user["id"])
        ],
    }


@app.post("/api/tokens/{token_id}/cancel")
async def cancel(token_id: int, user=Depends(current_user), conn=Depends(get_db)):
    token = q.cancel_token(conn, token_id, user["id"])
    await notify(token["service_id"], "cancelled")
    return {"id": token["id"], "status": token["status"]}


# ---------- staff controls ----------

@app.get("/api/staff/services/{service_id}")
def staff_view(service_id: int, _=Depends(staff_only), conn=Depends(get_db)):
    s = q.get_service(conn, service_id)
    called = q.current_called(conn, service_id)
    return {
        "service": {**s, "keywords": None},
        "current": {"id": called["id"], "label": called["label"], "called_at": called["called_at"]} if called else None,
        "waiting": q.waiting_list(conn, service_id),
        "stats": q.today_stats(conn, service_id),
    }


@app.post("/api/staff/services/{service_id}/call-next")
async def call_next(service_id: int, _=Depends(staff_only), conn=Depends(get_db)):
    token = q.call_next(conn, service_id)
    await notify(service_id, "called", label=token["label"], token_id=token["id"], counter=token["counter"])
    return {"id": token["id"], "label": token["label"]}


@app.post("/api/staff/services/{service_id}/serve")
async def serve(service_id: int, _=Depends(staff_only), conn=Depends(get_db)):
    token = q.mark_served(conn, service_id)
    await notify(service_id, "served", label=token["label"])
    return {"id": token["id"], "label": token["label"], "status": token["status"]}


@app.post("/api/staff/services/{service_id}/skip")
async def skip(service_id: int, _=Depends(staff_only), conn=Depends(get_db)):
    token = q.skip_current(conn, service_id)
    await notify(service_id, "skipped", label=token["label"])
    return {"id": token["id"], "label": token["label"], "status": token["status"]}


@app.post("/api/staff/services/{service_id}/pause")
async def pause(service_id: int, body: PauseIn, _=Depends(staff_only), conn=Depends(get_db)):
    s = q.set_pause(conn, service_id, True, body.message or "This counter is temporarily paused.")
    await notify(service_id, "paused", message=s["pause_message"])
    return {"is_paused": True, "pause_message": s["pause_message"]}


@app.post("/api/staff/services/{service_id}/resume")
async def resume(service_id: int, _=Depends(staff_only), conn=Depends(get_db)):
    q.set_pause(conn, service_id, False)
    await notify(service_id, "resumed")
    return {"is_paused": False}


@app.post("/api/staff/tokens/{token_id}/priority")
async def prioritize(token_id: int, _=Depends(staff_only), conn=Depends(get_db)):
    token = q.get_token(conn, token_id)
    if token["status"] != "waiting":
        raise HTTPException(409, "Only waiting tokens can be moved to the priority lane")
    conn.execute("UPDATE tokens SET priority = 1 WHERE id = ?", (token_id,))
    await notify(token["service_id"], "priority")
    return {"id": token_id, "priority": True}


# ---------- public display screen ----------

@app.get("/api/display/{service_id}")
def display(service_id: int, conn=Depends(get_db)):
    s = q.get_service(conn, service_id)
    called = q.current_called(conn, service_id)
    return {
        "service_name": s["name"],
        "counter": s["counter"],
        "code": s["code"],
        "is_paused": s["is_paused"],
        "pause_message": s["pause_message"],
        "now_serving": called["label"] if called else None,
        "up_next": [w["label"] for w in q.waiting_list(conn, service_id, limit=5)],
        "waiting": q.waiting_count(conn, service_id),
        "eta_if_join_min": eta_model.predict_wait(service_id, q.waiting_count(conn, service_id)),
    }


# ---------- AI ----------

@app.post("/api/assistant")
def ask(body: AskIn, conn=Depends(get_db)):
    return assistant.answer(conn, body.message.strip())


@app.get("/api/admin/overview")
def admin_overview(_=Depends(admin_only), conn=Depends(get_db)):
    today = q.today_str()
    breakdown = analytics.service_breakdown(conn, today)
    total_waiting = sum(q.waiting_count(conn, s["id"]) for s in q.list_services(conn))
    served_today = sum(b["served"] for b in breakdown)
    waits = [b["avg_wait"] for b in breakdown if b["avg_wait"]]
    return {
        "kpis": {
            "served_today": served_today,
            "waiting_now": total_waiting,
            "avg_wait_today": round(sum(waits) / len(waits), 1) if waits else None,
            "no_shows_today": sum(b["skipped"] for b in breakdown),
        },
        "daily": analytics.daily_series(conn),
        "services": breakdown,
        "model": eta_model.metrics(),
        "ai_enabled": llm.is_enabled(),
    }


@app.get("/api/admin/insight")
def admin_insight(_=Depends(admin_only), conn=Depends(get_db)):
    return analytics.admin_insight(conn)


@app.post("/api/admin/retrain")
def retrain(_=Depends(admin_only), conn=Depends(get_db)):
    m = eta_model.train(conn)
    if m is None:
        raise HTTPException(400, "Not enough history to train yet (need at least 200 completed tokens)")
    return m


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_enabled": llm.is_enabled(), "model_ready": eta_model.metrics() is not None}


def _detect_lan_ip() -> str | None:
    for host in ("8.8.8.8", "10.255.255.255"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((host, 80))
                ip = s.getsockname()[0]
                if not ip.startswith("127."):
                    return ip
        except OSError:
            continue
    return None


@app.get("/api/network")
def network():
    return {"lan_ip": _detect_lan_ip()}


# ---------- websocket ----------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive pings from the client
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ---------- serve the built frontend (single deployment) ----------

DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = os.path.join(DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(DIST, "index.html"))
