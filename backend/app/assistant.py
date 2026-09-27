"""AI Service Assistant: routes a student's question to the right counter.

Design: the LLM only *chooses the service and phrases the reply*. Facts
(required documents, live wait, counter location) always come from our database,
so the assistant can't invent documents. If the LLM is unavailable we fall back
to keyword scoring over the same data.
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
                score += 3 if kw in text else 0      # phrase match counts more
            elif kw in words:
                score += 2
            elif any(w.startswith(kw) for w in words if len(kw) >= 4):
                score += 1                           # 'certificates' ~ 'certificate'
        if score > best_score:
            best, best_score = s, score
    return best


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


def answer(conn, message: str) -> dict:
    services = list_services(conn)
    catalog = [
        {"id": s["id"], "name": s["name"], "description": s["description"], "documents": s["documents"]}
        for s in services
    ]

    raw = llm.generate(
        prompt=f"Services:\n{json.dumps(catalog)}\n\nStudent question: {message}",
        system=(
            "You help college students find the correct administrative counter. Choose the single best service id "
            "from the list, or null if none fits. Write a friendly 1-2 sentence reply. Mention only documents that "
            "appear in that service's list. Return JSON: {\"service_id\": number|null, \"reply\": \"...\"}"
        ),
        json_mode=True,
    )
    if raw:
        try:
            parsed = json.loads(raw)
            sid = parsed.get("service_id")
            service = next((s for s in services if s["id"] == sid), None)
            reply = str(parsed.get("reply", "")).strip()
            if service and reply:
                return {"reply": reply, "match": _live_info(conn, service), "source": "ai"}
            if sid is None and reply:
                return {"reply": reply, "match": None, "source": "ai"}
        except (ValueError, TypeError, AttributeError):
            pass

    service = _keyword_route(message, services)
    if service:
        info = _live_info(conn, service)
        return {"reply": _fallback_reply(service, info), "match": info, "source": "keyword"}
    names = ", ".join(s["name"] for s in services)
    return {
        "reply": f"I couldn't match that to a counter. Available services are: {names}. Try describing what you need, like 'bonafide certificate' or 'lost ID card'.",
        "match": None,
        "source": "keyword",
    }
