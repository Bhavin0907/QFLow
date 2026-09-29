"""AI Service Assistant: routes questions to counters or answers about active tokens.

The LLM only chooses services or phrases replies. Facts always come from our database.
If Ollama is unavailable we fall back to keyword scoring and template answers.
"""
import json
import re

from . import eta_model, llm
from .queue_service import list_services, waiting_count

_WORD = re.compile(r"[a-z0-9]+")


def _keyword_route(message: str, services: list[dict]) -> dict | None:
    text = message.lower()
    words = set(_WORD.findall(text))
    best, best_score = None, 0
    for s in services:
        score = 0
        for kw in s["keywords"]:
            kw = kw.lower()
            if " " in kw:
                score += 3 if kw in text else 0
            elif kw in words:
                score += 2
            elif any(w.startswith(kw) for w in words if len(kw) >= 4):
                score += 1
        if score > best_score:
            best, best_score = s, score
    return best


def _pick_context_token(message: str, tokens: list[dict]) -> dict:
    text = message.lower()
    for t in tokens:
        if t.get("service_name", "").lower() in text:
            return t
        if t.get("label", "").lower() in text:
            return t
    return tokens[0]


def _context_keyword_reply(message: str, tokens: list[dict]) -> str | None:
    if not tokens:
        return None
    text = message.lower()
    t = _pick_context_token(message, tokens)

    if any(w in text for w in ("how long", "wait", "eta", "time left", "my turn", "position")):
        if t.get("status") == "called":
            return f"Token {t['label']}: it's your turn! Go to {t['counter']} now."
        if t.get("status") == "waiting":
            pos = t.get("position")
            eta = t.get("eta_min")
            clock = t.get("eta_clock")
            extra = f", around {clock}" if clock else ""
            return (
                f"Token {t['label']} at {t['service_name']}: you are #{pos} in line, "
                f"about {eta} min wait{extra}."
            )
        return f"Token {t['label']} at {t['service_name']} — status: {t.get('status', 'unknown')}."

    if any(w in text for w in ("where", "go", "location", "counter", "find")):
        return f"Go to {t['counter']} for {t['service_name']}."

    if any(w in text for w in ("document", "bring", "need", "carry")):
        docs = t.get("documents") or []
        if docs:
            return f"For {t['service_name']}, bring: {', '.join(docs)}."
        return f"No specific documents listed for {t['service_name']}."

    return None


def _live_info(conn, service: dict) -> dict:
    ahead = waiting_count(conn, service["id"])
    return {
        "service_id": service["id"],
        "service_name": service["name"],
        "counter": service["counter"],
        "documents": service["documents"],
        "waiting": ahead,
        "eta_min": eta_model.predict_wait(service["id"], ahead),
        "is_paused": service["is_paused"],
    }


def _fallback_reply(service: dict, info: dict) -> str:
    docs = ", ".join(service["documents"]) if service["documents"] else "no specific documents"
    return (
        f"This is handled at {service['name']} ({service['counter']}). "
        f"Please bring: {docs}. There are {info['waiting']} people waiting right now."
    )


async def answer(conn, message: str, token_context: list[dict] | None = None) -> dict:
    services = list_services(conn)
    catalog = [
        {"id": s["id"], "name": s["name"], "description": s["description"], "documents": s["documents"]}
        for s in services
    ]
    ctx = token_context or []

    prompt_parts = [f"Student question: {message}"]
    if ctx:
        prompt_parts.append(
            "Student active tokens (use ONLY these facts for wait/location/document questions):\n"
            + json.dumps(ctx)
        )
    prompt_parts.append(f"Services:\n{json.dumps(catalog)}")
    prompt = "\n\n".join(prompt_parts)

    system = (
        "You help college students at an admin queue system. "
        "For wait-time, position, location, or document questions, answer using ONLY token_context numbers and facts. "
        "For finding which counter handles something, pick service_id from the services list. "
        "Write 1-2 short, friendly sentences. "
        'Return JSON: {"service_id": number|null, "reason": "...", "documents": ["..."]}'
    )

    parsed = await llm.generate_json(prompt=prompt, system=system)
    if parsed:
        sid = parsed.get("service_id")
        reason = str(parsed.get("reason", "")).strip()
        if ctx and not sid and reason:
            return {"reply": reason, "match": None, "source": "ai"}
        service = next((s for s in services if s["id"] == sid), None)
        if service and reason:
            info = _live_info(conn, service)
            return {"reply": reason, "match": info, "source": "ai"}
        if sid is None and reason:
            return {"reply": reason, "match": None, "source": "ai"}

    ctx_reply = _context_keyword_reply(message, ctx)
    if ctx_reply:
        return {"reply": ctx_reply, "match": None, "source": "keyword"}

    service = _keyword_route(message, services)
    if service:
        info = _live_info(conn, service)
        return {"reply": _fallback_reply(service, info), "match": info, "source": "keyword"}

    names = ", ".join(s["name"] for s in services)
    return {
        "reply": (
            f"I couldn't match that to a counter. Available services are: {names}. "
            "Try describing what you need, like 'bonafide certificate' or 'lost ID card'."
        ),
        "match": None,
        "source": "keyword",
    }
