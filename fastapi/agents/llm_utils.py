"""
LLM Utility Functions — CropGuard Agentic AI

Shared helpers for calling Gemini (vision + text) and Groq (text).
Each function returns (raw_text, token_info_dict).
"""
from __future__ import annotations

import json
import logging
import time

import httpx

logger = logging.getLogger(__name__)

# ── Pricing (USD per 1K tokens, approximate) ────────────────────────────────
# Without Anthropic models in this table, _calc_cost() silently returns 0.0
# for the entire 5-agent Claude pipeline and the API reports $0.00 spend.
# Verify against Anthropic's current published rates and update on model
# changes.
_PRICING = {
    "gemini-2.5-flash":            {"input": 0.00015, "output": 0.0006},
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

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        },
    }

    async with httpx.AsyncClient(timeout=120) as client:
        for attempt in range(3):
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 429:
                wait = 10 * (attempt + 1)
                logger.warning("Gemini 429 — backing off %ds", wait)
                await _async_sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            raise RuntimeError("Gemini rate-limited after 3 retries")

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

    payload = {
        "contents": [
            {"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}
        ],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        },
    }

    async with httpx.AsyncClient(timeout=90) as client:
        for attempt in range(3):
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 429:
                wait = 10 * (attempt + 1)
                logger.warning("Gemini text 429 — backing off %ds", wait)
                await _async_sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            raise RuntimeError("Gemini text rate-limited after 3 retries")

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

    async with httpx.AsyncClient(timeout=90) as client:
        for attempt in range(3):
            resp = await client.post(_GROQ_BASE, headers=headers, json=payload)
            if resp.status_code == 429:
                wait = 10 * (attempt + 1)
                logger.warning("Groq 429 — backing off %ds", wait)
                await _async_sleep(wait)
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


# ── Async sleep helper ───────────────────────────────────────────────────────

async def _async_sleep(seconds: float):
    import asyncio
    await asyncio.sleep(seconds)
