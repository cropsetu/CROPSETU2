"""
LLM Utility Functions — CropGuard Agentic AI

Shared helpers for calling Gemini (vision + text) and Groq (text).
Each function returns (raw_text, token_info_dict).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import httpx

from services.http_clients import get_anthropic, get_gemini, get_groq

logger = logging.getLogger(__name__)

# ── Pricing (USD per 1K tokens, approximate) ────────────────────────────────
# Without Anthropic models in this table, _calc_cost() silently returns 0.0
# for the entire 5-agent Claude pipeline and the API reports $0.00 spend.
# Verify against Anthropic's current published rates and update on model
# changes.
_PRICING = {
    "gemini-2.5-flash":            {"input": 0.00015, "output": 0.0006},
    "gemini-2.5-pro":              {"input": 0.00125, "output": 0.005},
    "llama-3.3-70b-versatile":     {"input": 0.00059, "output": 0.00079},
    # Anthropic Claude — update when pricing changes.
    "claude-sonnet-4-6":           {"input": 0.003,   "output": 0.015},
    "claude-haiku-4-5-20251001":   {"input": 0.001,   "output": 0.005},
}

_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions"


def empty_token_info(model: str = "none") -> dict:
    """Return a zeroed token-info dict (used for cache hits, rule-based steps, etc.)."""
    return {
        "model": model,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cost_usd": 0.0,
    }


def _calc_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    prices = _PRICING.get(model, {"input": 0.0, "output": 0.0})
    return round(
        (input_tokens * prices["input"] + output_tokens * prices["output"]) / 1000, 6
    )


def _make_token_info(model: str, input_tokens: int, output_tokens: int) -> dict:
    total = input_tokens + output_tokens
    return {
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total,
        "cost_usd": _calc_cost(model, input_tokens, output_tokens),
    }


def _gemini_disable_thinking(model: str) -> bool:
    """Whether to send thinkingConfig.thinkingBudget=0 for this Gemini model.

    Gemini 2.5 Flash lets us disable "thinking" tokens (cuts latency + avoids
    JSON truncation). Gemini 2.5 Pro REQUIRES thinking mode and returns
    HTTP 400 "Budget 0 is invalid" if we force it off — so only opt out on
    models we know allow it.
    """
    return "flash" in (model or "").lower()


# ── Gemini Vision ────────────────────────────────────────────────────────────

async def call_gemini_vision(
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],       # [{"data": str, "mime_type": str}]
    gemini_api_key: str,
    *,
    groq_api_key: str = "",
    model: str = "gemini-2.5-flash",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """
    Call Gemini vision with images + text.
    Returns (raw_response_text, token_info).
    """
    # Pass the API key in a header rather than the URL querystring — query
    # params end up in proxy / LB / debug logs.
    url = f"{_GEMINI_BASE}/{model}:generateContent"
    headers = {"x-goog-api-key": gemini_api_key}

    # Build parts: images first, then text
    parts = []
    for img in images_b64:
        parts.append({
            "inline_data": {
                "mime_type": img["mime_type"],
                "data": img["data"],
            }
        })
    parts.append({"text": f"{system_prompt}\n\n{user_prompt}"})

    # Disable Gemini 2.5's internal "thinking" tokens. By default Flash/Pro
    # spend hundreds-to-thousands of tokens on hidden reasoning BEFORE the
    # visible output, eating the maxOutputTokens budget and causing
    # truncation mid-JSON. Our system prompt already structures the
    # reasoning steps, so we don't need the model's internal scratchpad.
    # This roughly halves end-to-end latency too.
    gen_config = {
        "maxOutputTokens": max_tokens,
        "temperature": temperature,
    }
    if _gemini_disable_thinking(model):
        gen_config["thinkingConfig"] = {"thinkingBudget": 0}
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": gen_config,
    }

    client = get_gemini()
    # We only retry ONCE internally on 429 with a tiny backoff. The router
    # already provides cross-provider fallback (Gemini → Claude → Gemini Flash),
    # so spending 60+ seconds on internal Gemini retries before falling over
    # is pure waste — by the time we get to Claude, the pipeline budget is
    # gone. One quick retry handles transient bursts; persistent quota
    # exhaustion punts to the next model in the chain immediately.
    for attempt in range(2):
        resp = await client.post(url, json=payload, headers=headers, timeout=120)
        if resp.status_code == 429:
            if attempt == 0:
                logger.warning("Gemini 429 (attempt 1) — quick 2s retry")
                await asyncio.sleep(2.0)
                continue
            # Second 429 → bail to the router so it can pick the next provider
            _raise_gemini_error(resp, model)
        # Surface the actual error body before httpx eats it. An expired API
        # key returns 400 with reason=API_KEY_INVALID — the bare HTTPStatusError
        # message ("Client error '400 Bad Request'") hides that completely.
        if resp.status_code >= 400:
            _raise_gemini_error(resp, model)
        break
    else:
        raise RuntimeError("Gemini rate-limited after 2 retries")

    data = resp.json()
    text = ""
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        logger.error("Unexpected Gemini response: %s", json.dumps(data)[:500])
        raise ValueError("Empty or malformed Gemini response")

    usage = data.get("usageMetadata", {})
    tok = _make_token_info(
        model,
        usage.get("promptTokenCount", 0),
        usage.get("candidatesTokenCount", 0),
    )
    return text, tok


def _raise_gemini_error(resp, model: str) -> None:
    """Inspect the response body for the structured Gemini error, log it
    loudly, and raise an exception carrying the API-side reason so callers
    (router._is_transient, agents that surface errors) can react properly."""
    body_text = ""
    reason = ""
    api_message = ""
    try:
        body = resp.json()
        err = body.get("error", {}) or {}
        api_message = err.get("message", "")
        for d in err.get("details", []) or []:
            if "ErrorInfo" in d.get("@type", ""):
                reason = d.get("reason", "")
                break
        body_text = api_message or json.dumps(body)[:300]
    except Exception:
        body_text = (resp.text or "")[:300]

    logger.error(
        "[Gemini] %s returned HTTP %d — reason=%s message=%r",
        model, resp.status_code, reason or "?", body_text,
    )
    # Build an exception whose str() contains the reason so router-side
    # heuristics can detect "API_KEY_INVALID", "QUOTA_EXCEEDED", etc.
    msg = f"Gemini {model} HTTP {resp.status_code}: {reason or 'unknown'} — {body_text}"
    err = httpx.HTTPStatusError(msg, request=resp.request, response=resp)
    # Attach machine-readable hints
    err.gemini_reason = reason       # type: ignore[attr-defined]
    err.gemini_message = api_message  # type: ignore[attr-defined]
    raise err


# ── Gemini Text ──────────────────────────────────────────────────────────────

async def call_gemini_text(
    system_prompt: str,
    user_prompt: str,
    gemini_api_key: str,
    *,
    model: str = "gemini-2.5-flash",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Call Gemini text-only (no images). Returns (raw_text, token_info)."""
    url = f"{_GEMINI_BASE}/{model}:generateContent"
    headers = {"x-goog-api-key": gemini_api_key}

    gen_config = {
        "maxOutputTokens": max_tokens,
        "temperature": temperature,
    }
    # See call_gemini_vision / _gemini_disable_thinking — only Flash allows
    # turning thinking off; Pro requires it (else HTTP 400).
    if _gemini_disable_thinking(model):
        gen_config["thinkingConfig"] = {"thinkingBudget": 0}
    payload = {
        "contents": [
            {"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}
        ],
        "generationConfig": gen_config,
    }

    client = get_gemini()
    # See call_gemini_vision for rationale — one quick retry, then punt to
    # the router for cross-provider fallback.
    for attempt in range(2):
        resp = await client.post(url, json=payload, headers=headers, timeout=90)
        if resp.status_code == 429:
            if attempt == 0:
                logger.warning("Gemini text 429 (attempt 1) — quick 2s retry")
                await asyncio.sleep(2.0)
                continue
            _raise_gemini_error(resp, model)
        if resp.status_code >= 400:
            _raise_gemini_error(resp, model)
        break
    else:
        raise RuntimeError("Gemini text rate-limited after 2 retries")

    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]

    usage = data.get("usageMetadata", {})
    tok = _make_token_info(
        model,
        usage.get("promptTokenCount", 0),
        usage.get("candidatesTokenCount", 0),
    )
    return text, tok


# ── Groq Text ────────────────────────────────────────────────────────────────

async def call_groq_text(
    system_prompt: str,
    user_prompt: str,
    groq_api_key: str,
    *,
    model: str = "llama-3.3-70b-versatile",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Call Groq text API. Returns (raw_text, token_info)."""
    headers = {
        "Authorization": f"Bearer {groq_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    client = get_groq()
    for attempt in range(3):
        resp = await client.post(_GROQ_BASE, headers=headers, json=payload, timeout=90)
        if resp.status_code == 429:
            wait = 10 * (attempt + 1)
            logger.warning("Groq 429 — backing off %ds", wait)
            await asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        break
    else:
        raise RuntimeError("Groq rate-limited after 3 retries")

    data = resp.json()
    text = data["choices"][0]["message"]["content"]

    usage = data.get("usage", {})
    tok = _make_token_info(
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
    )
    return text, tok


# ── Generic OpenAI-compatible (any /v1/chat/completions endpoint) ────────────
# Same payload + response shape as OpenAI/Groq/DeepSeek/xAI/Together/OpenRouter
# /Mistral/Perplexity/Cerebras/Fireworks/local LM Studio/vLLM/Ollama. The
# admin picks ONE provider per feature in .env; we don't fall back to others.

_OPENAI_COMPAT_CLIENTS: dict[str, "httpx.AsyncClient"] = {}


def _get_openai_compat_client(base_url: str) -> httpx.AsyncClient:
    """One pooled client per distinct base_url. Reuses TLS handshakes across
    requests to the same provider — meaningful given each LLM call is its
    own HTTPS handshake otherwise."""
    if base_url not in _OPENAI_COMPAT_CLIENTS:
        _OPENAI_COMPAT_CLIENTS[base_url] = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20,
                                keepalive_expiry=30.0),
        )
    return _OPENAI_COMPAT_CLIENTS[base_url]


async def call_openai_compatible_text(
    system_prompt: str,
    user_prompt: str,
    *,
    base_url: str,
    api_key: str,
    model: str,
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Call any OpenAI-compatible /v1/chat/completions endpoint.
    Returns (raw_text, token_info). Raises on non-2xx (no internal retries —
    the admin gets the error and decides whether to swap models)."""
    if not api_key:
        raise ValueError(f"API key not configured for {base_url}")

    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    client = _get_openai_compat_client(base_url)
    resp = await client.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    text = data["choices"][0]["message"]["content"]

    usage = data.get("usage", {})
    tok = _make_token_info(
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
    )
    return text, tok


async def call_openai_compatible_vision(
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],   # [{"data": str, "mime_type": str}]
    *,
    base_url: str,
    api_key: str,
    model: str,
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Vision variant — encodes images as data-URLs in the user message.
    Compatible with OpenAI Vision, OpenRouter vision-capable models, etc.
    Models without vision capability will reject the request — that's the
    admin's responsibility to avoid."""
    if not api_key:
        raise ValueError(f"API key not configured for {base_url}")

    # Build OpenAI-style "content as list" for the user message: images first, then text.
    user_content: list[dict] = []
    for img in images_b64:
        data_url = f"data:{img['mime_type']};base64,{img['data']}"
        user_content.append({"type": "image_url", "image_url": {"url": data_url}})
    user_content.append({"type": "text", "text": user_prompt})

    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    client = _get_openai_compat_client(base_url)
    resp = await client.post(url, headers=headers, json=payload, timeout=180)
    resp.raise_for_status()
    data = resp.json()
    text = data["choices"][0]["message"]["content"]

    usage = data.get("usage", {})
    tok = _make_token_info(
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
    )
    return text, tok


async def close_openai_compat_clients() -> None:
    """Close pooled clients on shutdown. Wired into the FastAPI lifespan."""
    for client in _OPENAI_COMPAT_CLIENTS.values():
        try:
            await client.aclose()
        except Exception:
            pass
    _OPENAI_COMPAT_CLIENTS.clear()


# ── Anthropic Claude — Vision ────────────────────────────────────────────────

async def call_claude_vision(
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],       # [{"data": str, "mime_type": str}]
    anthropic_api_key: str = "",   # kept for signature symmetry; SDK reads env/config
    *,
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """
    Claude vision via the official AsyncAnthropic SDK client.
    Returns (raw_text, token_info). The SDK handles its own retries + pooling.
    """
    client = get_anthropic()
    content_blocks: list[dict] = []
    for img in images_b64:
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img["mime_type"],
                "data": img["data"],
            },
        })
    content_blocks.append({"type": "text", "text": user_prompt})

    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_prompt,
        messages=[{"role": "user", "content": content_blocks}],
    )

    text = "".join(
        block.text for block in msg.content if getattr(block, "type", "") == "text"
    )
    usage = getattr(msg, "usage", None)
    tok = _make_token_info(
        model,
        getattr(usage, "input_tokens", 0) if usage else 0,
        getattr(usage, "output_tokens", 0) if usage else 0,
    )
    return text, tok


# ── Anthropic Claude — Text ──────────────────────────────────────────────────

async def call_claude_text(
    system_prompt: str,
    user_prompt: str,
    anthropic_api_key: str = "",
    *,
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Claude text-only call. Returns (raw_text, token_info)."""
    client = get_anthropic()
    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(
        block.text for block in msg.content if getattr(block, "type", "") == "text"
    )
    usage = getattr(msg, "usage", None)
    tok = _make_token_info(
        model,
        getattr(usage, "input_tokens", 0) if usage else 0,
        getattr(usage, "output_tokens", 0) if usage else 0,
    )
    return text, tok
