"""Local LLM client (Ollama). Every caller has an offline fallback."""
import json
import logging
import os
import re
import time

import httpx

log = logging.getLogger(__name__)

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3.5:9b")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "8"))

def _thinking_pattern() -> re.Pattern[str]:
    think = ("<" + "think" + ">", "</" + "think" + ">")
    redacted = ("<think>", "</think>")
    return re.compile(
        rf"{think[0]}.*?{think[1]}|{redacted[0]}.*?{redacted[1]}",
        re.DOTALL | re.IGNORECASE,
    )


_THINKING = _thinking_pattern()

_reachable: bool | None = None
_reachable_checked_at: float = 0.0


def is_configured() -> bool:
    return LLM_PROVIDER == "ollama"


def is_enabled() -> bool:
    """True when a local LLM provider is configured (may still be unreachable)."""
    return is_configured()


def _strip_thinking(text: str) -> str:
    return _THINKING.sub("", text).strip()


async def check_reachable() -> bool:
    global _reachable, _reachable_checked_at
    if not is_configured():
        _reachable = False
        return False
    if _reachable is not None and time.time() - _reachable_checked_at < 30:
        return _reachable
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            _reachable = resp.status_code == 200
    except Exception:
        _reachable = False
    _reachable_checked_at = time.time()
    return _reachable


async def status() -> dict:
    reachable = await check_reachable() if is_configured() else False
    return {
        "provider": LLM_PROVIDER,
        "model": OLLAMA_MODEL if is_configured() else None,
        "reachable": reachable,
    }


async def generate_json(
    prompt: str,
    system: str = "",
    *,
    keep_alive: str | None = None,
) -> dict | None:
    if not is_configured():
        return None

    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body: dict = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"num_ctx": 4096},
        "messages": messages,
    }
    if keep_alive:
        body["keep_alive"] = keep_alive

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=body)
            resp.raise_for_status()
            content = resp.json().get("message", {}).get("content", "")
            content = _strip_thinking(content)
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                _mark_reachable(True)
                return parsed
            log.info("Ollama returned non-object JSON — using offline fallback")
    except httpx.TimeoutException:
        log.info("Ollama timeout (%ss) — using offline fallback", LLM_TIMEOUT)
    except httpx.HTTPError as exc:
        log.info("Ollama connection error — using offline fallback: %s", exc)
    except json.JSONDecodeError:
        log.info("Ollama invalid JSON — using offline fallback")
    except Exception as exc:
        log.info("Ollama error — using offline fallback: %s", exc)

    _mark_reachable(False)
    return None


def _mark_reachable(ok: bool) -> None:
    global _reachable, _reachable_checked_at
    _reachable = ok
    _reachable_checked_at = time.time()


async def warmup() -> None:
    if not is_configured():
        return
    log.info("Warming up Ollama model %s …", OLLAMA_MODEL)
    result = await generate_json(
        system="Reply with JSON only.",
        prompt='Return {"ok": true}',
        keep_alive="10m",
    )
    if result:
        log.info("Ollama warm-up complete")
    else:
        log.info("Ollama warm-up skipped — offline fallback will be used")
