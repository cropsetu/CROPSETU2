"""
LLM Utility Functions — CropGuard Agentic AI (Gemini-only)

Shared helpers for calling Gemini (vision + text). CropSetu consolidated onto
Google Gemini for production; the Anthropic call path was removed. Two non-Gemini
providers survive in narrow, opt-in roles (both keyed by their own env var, both
no-ops when that key is unset):
  - Groq (call_groq_text)      — text-chat last-resort fallback when the Gemini
                                 path is fully down (agents/llm_dispatch).
  - OpenAI (call_openai_vision) — one extra cross-vendor voter in the crop-disease
                                 diagnosis ensemble (agents/router + ensemble_agent).
Each function returns (raw_text, token_info_dict).
"""
from __future__ import annotations

import asyncio
import json
import logging

import httpx

from services.http_clients import get_gemini, get_groq, get_openai

logger = logging.getLogger(__name__)

# ── Pricing (USD per 1K tokens, approximate) ────────────────────────────────
# A model missing from this table makes _calc_cost() silently return 0.0 — which
# breaks the daily spend cap (it would see $0). Keep a row for every Gemini model
# the registry/_DEFAULTS can select. Verify against Google's published rates.
_PRICING = {
    "gemini-2.5-flash":            {"input": 0.00015, "output": 0.0006},
    "gemini-2.5-pro":              {"input": 0.00125, "output": 0.005},
    # Groq — chat fallback only. Keep a row so the daily spend cap stays accurate
    # when chat fails over to Groq (an unpriced model would bill $0). Verify
    # against Groq's published per-token rates.
    "llama-3.3-70b-versatile":     {"input": 0.00059, "output": 0.00079},
    # OpenAI — crop-diagnosis ensemble voter. Same rationale: an unpriced model
    # bills $0 and breaks the daily spend cap. Verify against OpenAI's rates.
    "gpt-4o":                      {"input": 0.0025,  "output": 0.01},
    "gpt-4o-mini":                 {"input": 0.00015, "output": 0.0006},
    # Anthropic (Claude) — multi-provider routing (WI-11). USD per 1K tokens
    # (Anthropic publishes per-MTok: Opus 4.8 $5/$25, Sonnet 4.6 $3/$15,
    # Haiku 4.5 $1/$5 → ÷1000 here). Verify against current rates.
    "claude-opus-4-8":             {"input": 0.005,   "output": 0.025},
    "claude-sonnet-4-6":           {"input": 0.003,   "output": 0.015},
    "claude-haiku-4-5":            {"input": 0.001,   "output": 0.005},
}

_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions"
_OPENAI_BASE = "https://api.openai.com/v1/chat/completions"


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
    prices = _PRICING.get(model)
    if prices is None:
        # An unpriced model would silently bill $0 and disable the daily USD cap
        # (a near-free runaway). Fall back to the closest Gemini family price and
        # log loudly so the row gets added.
        m = (model or "").lower()
        if "pro" in m:
            prices = _PRICING["gemini-2.5-pro"]
        else:
            prices = _PRICING["gemini-2.5-flash"]
        logger.warning(
            "[Pricing] model %r missing from _PRICING — using %s pricing as fallback. "
            "Add an explicit row.", model, "pro" if "pro" in m else "flash",
        )
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
    # Retry ONCE on transient statuses — 429 (rate limit) AND 5xx including 503
    # "high demand" (capacity). A single quick backoff absorbs a transient burst;
    # if it persists we raise so the router fails over to the next model in the
    # chain immediately rather than burning the pipeline budget here.
    _retryable = {429, 500, 502, 503, 504}
    for attempt in range(2):
        resp = await client.post(url, json=payload, headers=headers, timeout=120)
        if resp.status_code in _retryable:
            if attempt == 0:
                logger.warning("Gemini %s (attempt 1, model=%s) — quick 2s retry",
                               resp.status_code, model)
                await asyncio.sleep(2.0)
                continue
            # Still failing → raise so the router advances to the next provider.
            _raise_gemini_error(resp, model)
        # Surface the actual error body before httpx eats it. An expired API
        # key returns 400 with reason=API_KEY_INVALID — the bare HTTPStatusError
        # message ("Client error '400 Bad Request'") hides that completely.
        if resp.status_code >= 400:
            _raise_gemini_error(resp, model)
        break
    else:
        raise RuntimeError(f"Gemini {model} unavailable after 2 retries")

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
    # Quick in-call retry on the FULL transient set (429 + 5xx), matching
    # call_gemini_vision. Previously only 429 retried here, so a 503 "high
    # demand" failed on the first hit even though the next attempt often
    # succeeds. One quick 2s retry, then surface the error to the dispatcher.
    for attempt in range(2):
        resp = await client.post(url, json=payload, headers=headers, timeout=90)
        if resp.status_code in (429, 500, 502, 503, 504):
            if attempt == 0:
                logger.warning("Gemini text %s (attempt 1) — quick 2s retry", resp.status_code)
                await asyncio.sleep(2.0)
                continue
            _raise_gemini_error(resp, model)
        if resp.status_code >= 400:
            _raise_gemini_error(resp, model)
        break
    else:
        raise RuntimeError("Gemini text transient-failed after 2 retries")

    data = resp.json()
    # Gemini can return HTTP 200 with NO usable text: a safety block
    # (promptFeedback.blockReason, no candidates), finishReason=MAX_TOKENS where
    # the candidate has content but no parts (thinking ate the budget), or
    # SAFETY/RECITATION with empty content. Accessing the path blindly raised a
    # KeyError that _with_retry does NOT retry (not an HTTPStatusError) and that
    # surfaced to the user as a cryptic "Chat unavailable — ... 'candidates'".
    # Mirror call_gemini_vision: parse defensively and raise a typed error.
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        block = (data.get("promptFeedback") or {}).get("blockReason")
        finish = ""
        try:
            finish = data["candidates"][0].get("finishReason", "")
        except (KeyError, IndexError):
            pass
        logger.error(
            "Unexpected Gemini text response (block=%s finish=%s): %s",
            block, finish, json.dumps(data)[:500],
        )
        raise ValueError(
            f"Empty or malformed Gemini response (blockReason={block or 'none'}, "
            f"finishReason={finish or 'none'})"
        )

    usage = data.get("usageMetadata", {})
    tok = _make_token_info(
        model,
        usage.get("promptTokenCount", 0),
        usage.get("candidatesTokenCount", 0),
    )
    return text, tok


# ── Groq Text (cross-provider chat fallback) ─────────────────────────────────
# Restored as a LAST-RESORT fallback for the text-chat features. When the Gemini
# primary AND its Flash↔Pro capacity fallback both fail, the dispatcher
# (agents/llm_dispatch.call_llm_text) tries Groq so the farmer still gets a reply
# instead of "Chat unavailable" — Groq's free Llama tier has capacity separate
# from Google's, so it survives a Gemini-side outage or quota exhaustion.
# Text-only: Groq Llama can't do vision, so the vision/diagnose paths never reach
# here. OpenAI-compatible /chat/completions shape.

async def call_groq_text(
    system_prompt: str,
    user_prompt: str,
    groq_api_key: str,
    *,
    model: str = "llama-3.3-70b-versatile",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Call Groq's OpenAI-compatible chat API. Returns (raw_text, token_info).

    One quick 2s retry on transient statuses (429 + 5xx) — matching the Gemini
    helpers — then raises HTTPStatusError so the dispatcher's _with_retry applies
    its backoff or surfaces the failure. Keeps the cross-provider fallback well
    inside the request budget rather than burning 60s on internal retries.
    """
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
    for attempt in range(2):
        resp = await client.post(_GROQ_BASE, headers=headers, json=payload, timeout=90)
        if resp.status_code in (429, 500, 502, 503, 504):
            if attempt == 0:
                logger.warning("Groq text %s (attempt 1, model=%s) — quick 2s retry",
                               resp.status_code, model)
                await asyncio.sleep(2.0)
                continue
            # Surface the body so a transient run of failures is debuggable, then
            # raise HTTPStatusError so the dispatcher decides on further retry.
            logger.error("[Groq] %s HTTP %d — %s", model, resp.status_code,
                         (resp.text or "")[:300])
            resp.raise_for_status()
        if resp.status_code >= 400:
            # 401/403 → bad/expired key; 400 → bad request. Log the reason before
            # httpx eats it ("Client error '401 Unauthorized'" hides the detail).
            logger.error("[Groq] %s HTTP %d — %s", model, resp.status_code,
                         (resp.text or "")[:300])
            resp.raise_for_status()
        break
    else:
        raise RuntimeError(f"Groq {model} transient-failed after 2 retries")

    data = resp.json()
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        logger.error("Unexpected Groq response: %s", json.dumps(data)[:500])
        raise ValueError("Empty or malformed Groq response")

    usage = data.get("usage", {})
    tok = _make_token_info(
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
    )
    return text, tok


# ── OpenAI Vision (crop-diagnosis ensemble voter) ────────────────────────────
# GPT-4o joins the crop-disease ensemble as ONE extra cross-vendor vision voter
# (alongside Gemini Pro + Flash); the reconciler fuses its diagnosis with the
# others. Same OpenAI-compatible /chat/completions shape as Groq, but the user
# turn carries the image as a base64 data URI. Returns the raw JSON text — the
# ensemble agent's _parse_json/_normalise handle it provider-agnostically.

async def call_openai_vision(
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],       # [{"data": str, "mime_type": str}]
    openai_api_key: str,
    *,
    model: str = "gpt-4o",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Call OpenAI vision with images + text. Returns (raw_text, token_info).

    One quick 2s retry on transient statuses (429 + 5xx) — matching the Gemini /
    Groq helpers — then raises HTTPStatusError. As an ensemble member its caller
    (agents/router.dispatch_one_vision) tolerates a hard failure: one missing
    voter just means the reconciler fuses N-1.
    """
    headers = {
        "Authorization": f"Bearer {openai_api_key}",
        "Content-Type": "application/json",
    }
    # OpenAI vision: the user turn is a content array of text + image_url parts,
    # each image inlined as a data URI. Text first, then the image(s).
    user_content: list[dict] = [{"type": "text", "text": user_prompt}]
    for img in images_b64:
        data_uri = f"data:{img['mime_type']};base64,{img['data']}"
        user_content.append({"type": "image_url", "image_url": {"url": data_uri}})

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    client = get_openai()
    for attempt in range(2):
        resp = await client.post(_OPENAI_BASE, headers=headers, json=payload, timeout=120)
        if resp.status_code in (429, 500, 502, 503, 504):
            if attempt == 0:
                logger.warning("OpenAI vision %s (attempt 1, model=%s) — quick 2s retry",
                               resp.status_code, model)
                await asyncio.sleep(2.0)
                continue
            logger.error("[OpenAI] %s HTTP %d — %s", model, resp.status_code,
                         (resp.text or "")[:300])
            resp.raise_for_status()
        if resp.status_code >= 400:
            # 401 → bad/expired key; 400 → bad request (e.g. model lacks vision).
            # Log the body before httpx hides it behind a generic message.
            logger.error("[OpenAI] %s HTTP %d — %s", model, resp.status_code,
                         (resp.text or "")[:300])
            resp.raise_for_status()
        break
    else:
        raise RuntimeError(f"OpenAI {model} transient-failed after 2 retries")

    data = resp.json()
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        logger.error("Unexpected OpenAI response: %s", json.dumps(data)[:500])
        raise ValueError("Empty or malformed OpenAI response")

    usage = data.get("usage", {})
    tok = _make_token_info(
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
    )
    return text, tok


# ── OpenAI text (multi-provider routing, WI-11) ──────────────────────────────
# Same OpenAI-compatible /chat/completions shape as Groq, but against OpenAI's
# endpoint + key. Lets AI_<FEATURE>_MODEL (or the admin model setting) select a
# 'gpt-*' model for text features like chat.

async def call_openai_text(
    system_prompt: str,
    user_prompt: str,
    openai_api_key: str,
    *,
    model: str = "gpt-4o",
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """Call OpenAI's chat API (OpenAI-compatible). Returns (raw_text, token_info)."""
    headers = {
        "Authorization": f"Bearer {openai_api_key}",
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
    client = get_openai()
    for attempt in range(2):
        resp = await client.post(_OPENAI_BASE, headers=headers, json=payload, timeout=90)
        if resp.status_code in (429, 500, 502, 503, 504):
            if attempt == 0:
                logger.warning("OpenAI text %s (attempt 1, model=%s) — quick 2s retry",
                               resp.status_code, model)
                await asyncio.sleep(2.0)
                continue
            logger.error("[OpenAI] %s HTTP %d — %s", model, resp.status_code,
                         (resp.text or "")[:300])
            resp.raise_for_status()
        if resp.status_code >= 400:
            logger.error("[OpenAI] %s HTTP %d — %s", model, resp.status_code,
                         (resp.text or "")[:300])
            resp.raise_for_status()
        break
    else:
        raise RuntimeError(f"OpenAI {model} transient-failed after 2 retries")

    data = resp.json()
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        logger.error("Unexpected OpenAI response: %s", json.dumps(data)[:500])
        raise ValueError("Empty or malformed OpenAI response")
    usage = data.get("usage", {})
    return text, _make_token_info(model, usage.get("prompt_tokens", 0),
                                  usage.get("completion_tokens", 0))


# ── Anthropic (Claude) — text + vision via the official SDK (WI-11) ───────────
# Anthropic's Messages API is NOT OpenAI-compatible: the system prompt is a
# top-level `system=` param (not a message), the reply is a list of content
# blocks, and usage is input_tokens/output_tokens. `temperature` is intentionally
# NOT forwarded — Opus 4.8 / 4.7 reject it (HTTP 400). AsyncAnthropic fits the
# existing async dispatch; the `anthropic` package's deps (httpx, jiter, distro,
# anyio, sniffio, pydantic) are already pinned in requirements.txt.

def _anthropic_text_from(resp) -> str:
    return "".join(
        getattr(b, "text", "") for b in resp.content
        if getattr(b, "type", None) == "text"
    )


async def call_anthropic_text(
    system_prompt: str,
    user_prompt: str,
    anthropic_api_key: str,
    *,
    model: str = "claude-opus-4-8",
    max_tokens: int = 4096,
    temperature: float = 0.3,  # accepted for signature parity; NOT sent to Claude
) -> tuple[str, dict]:
    """Call Anthropic Claude (text) via the official SDK. Returns (raw_text, token_info)."""
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=anthropic_api_key)
    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = _anthropic_text_from(resp)
    if not text:
        logger.error("Empty Anthropic response: %s", str(resp)[:500])
        raise ValueError("Empty or malformed Anthropic response")
    return text, _make_token_info(model, resp.usage.input_tokens, resp.usage.output_tokens)


async def call_anthropic_vision(
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],       # [{"data": str, "mime_type": str}]
    anthropic_api_key: str,
    *,
    model: str = "claude-opus-4-8",
    max_tokens: int = 4096,
    temperature: float = 0.3,  # accepted for signature parity; NOT sent to Claude
) -> tuple[str, dict]:
    """Call Anthropic Claude (vision) via the official SDK. Returns (raw_text, token_info)."""
    from anthropic import AsyncAnthropic

    content: list[dict] = [{"type": "text", "text": user_prompt}]
    for img in images_b64:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img["mime_type"],
                "data": img["data"],
            },
        })

    client = AsyncAnthropic(api_key=anthropic_api_key)
    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": content}],
    )
    text = _anthropic_text_from(resp)
    if not text:
        logger.error("Empty Anthropic vision response: %s", str(resp)[:500])
        raise ValueError("Empty or malformed Anthropic response")
    return text, _make_token_info(model, resp.usage.input_tokens, resp.usage.output_tokens)

