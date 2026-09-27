# Qflow

Campus queues that keep moving. Students join a service queue from their phone, see their live position and an ML-predicted wait, and get alerted when they're 3 away. Staff call tokens, handle no-shows and pause the queue with a broadcast message. Admins see analytics, peak-hour heatmaps and a daily insight.

**Stack:** React + Vite + Tailwind (frontend), FastAPI + WebSockets (backend), SQLite (database), scikit-learn (wait-time model), optional Gemini API (assistant and insights, with offline fallbacks).

---

## Run it locally

You need Python 3.10+ and Node 18+.

**1. Backend** (terminal 1)

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate     Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
python -m app.seed                   # creates qflow.db with 30 days of history
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs (auto-generated, good to show judges): http://localhost:8000/docs

**2. Frontend** (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

**Demo logins**

| Role | Email | Password |
|---|---|---|
| Student | student@campus.edu | student123 |
| Staff | staff@campus.edu | staff123 |
| Admin | admin@campus.edu | admin123 |

The login page also has one-click demo buttons.

**Reset demo data any time:** stop the backend, run `python -m app.seed`, start it again.

## Let judges join from their phones

The QR codes point to whatever address you opened the app on, so open the app using an address phones can reach.

**Option A: same Wi-Fi or your phone's hotspot.** Find your laptop's IP (`ipconfig` on Windows, `ifconfig` on Mac/Linux), then open `http://<your-ip>:5173` on the laptop. QR codes will use that address. If phones can't connect, allow Python and Node through the Windows firewall.

**Option B: public HTTPS link (works on any network, also enables phone notifications).** Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run:

```bash
cloudflared tunnel --url http://localhost:5173
```

Open the `https://....trycloudflare.com` URL it prints on your laptop. QR codes will use it.

Note: browser notifications on phones need HTTPS (Option B). On plain HTTP the "almost up" alert still shows in the page with a chime and vibration.

## Optional: turn on AI

Copy `backend/.env.example` to `backend/.env` and add a free Gemini key from https://aistudio.google.com/apikey. Restart the backend. Without a key, the assistant uses keyword matching and the insight uses a stats template. The UI shows which one answered.

---

## Demo script (about 4 minutes)

1. **The problem, 15 seconds.** "Every one of us has stood an hour in the certificate line, only to find out we're missing a document."
2. **Open the TV display** (`/display/1`) on the projector. Point to the QR code. Ask judges to scan it and type their name. They're in line in two taps.
3. **Staff view on your laptop.** Press **Call next** (or the N key) a few times. Judges watch their position drop live on their phones. When one reaches 3rd, their phone chimes: "You're almost up."
4. **Pause the queue** with "Lunch break, back at 2:00 PM." Every phone and the TV update instantly.
5. **Student view.** Ask the assistant "I lost my ID card." It routes to the ID Card Desk with the documents to bring, the live wait, and a Join button. Open **Best time to visit** to show the heatmap.
6. **Admin view.** Show the daily insight, then the model card: "Our model predicts waits 20-25% more accurately than a simple average, measured on held-out data."
7. **Close.** "Qflow doesn't just digitize the line. It predicts your wait, sends you to the right counter with the right documents, and tells admins how to make the line shorter."

**Backup plan:** record a 2-minute screen video of this flow tonight in case the venue Wi-Fi fails.

---

## Technical decisions (prepare to explain these)

**No duplicate tokens under concurrency.** Joining a queue runs inside a `BEGIN IMMEDIATE` transaction, which takes SQLite's write lock before reading the current max token number, so simultaneous joins are serialized. A `UNIQUE(service_id, token_date, token_number)` constraint is a second guarantee at the database level. Tested with 60 simultaneous joins: 60 unique tokens.

**Real-time updates.** The server broadcasts a small `queue_update` event over WebSocket after every change. Clients refetch the data they need, so the server stays simple and clients never drift out of sync. The client reconnects automatically with exponential backoff.

**Wait-time prediction.** A scikit-learn gradient-boosted tree model (`HistGradientBoostingRegressor`) learns wait time from people ahead, hour, weekday and service. It is constrained so more people ahead can never lower the prediction. It is evaluated on a held-out 20% against a naive baseline (people ahead × average service time) and retrains from the admin dashboard as real data accumulates. It runs locally, so it never depends on the internet.

**Why 30 days of seeded history?** It comes from a minute-by-minute simulation of a real queue (morning rush, lunch break, busier Mondays, cancellations when lines are long, no-shows), so the waits are consistent with queue lengths and the model learns genuine patterns.

**AI with a safety net.** The LLM only chooses which service fits and phrases the reply. Documents, counters and wait times always come from the database, so the assistant cannot invent requirements. If the API fails or times out (6 seconds), keyword matching over the same data answers instead.

**Security.** Passwords hashed with PBKDF2-SHA256 (200k iterations, per-user salt). JWT auth with role checks on every staff and admin endpoint. Students can only cancel their own tokens. All input validated with Pydantic on the server and checked in forms on the client. Parameterized SQL everywhere.

**Validation and edge cases.** One active token per student per service. Staff can't call next while paused. Only waiting tokens can move to the priority lane. Token numbers restart daily.

## API overview

| Method | Path | Who |
|---|---|---|
| POST | /api/auth/register, /login, /guest | public |
| GET | /api/services, /api/services/{id}, /api/services/{id}/heatmap | public |
| POST | /api/services | admin |
| POST | /api/services/{id}/join | student |
| GET | /api/tokens/me | student |
| POST | /api/tokens/{id}/cancel | owner |
| GET | /api/staff/services/{id} | staff |
| POST | /api/staff/services/{id}/call-next, /serve, /skip, /pause, /resume | staff |
| POST | /api/staff/tokens/{id}/priority | staff |
| GET | /api/display/{id} | public |
| POST | /api/assistant | public |
| GET | /api/admin/overview, /api/admin/insight | admin |
| POST | /api/admin/retrain | admin |
| WS | /ws | live events |

## Project structure

```
backend/app/
  main.py           API routes, auth dependencies, WebSocket broadcast
  queue_service.py  queue logic (join, call, skip, pause, stats)
  eta_model.py      wait-time model: training, evaluation, prediction
  assistant.py      service assistant (LLM + keyword fallback)
  analytics.py      heatmap, best time, daily insight
  seed.py           queue simulation for demo data
  db.py, security.py, llm.py
frontend/src/
  pages/            Login, Student, Join (QR landing), Staff, Admin, Display
  components/       Ticket, Heatmap, Assistant, shared UI
  lib/              API client, auth context, live updates and alerts
```
