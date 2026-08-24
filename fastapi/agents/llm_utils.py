"""
LLM Utility Functions — CropGuard Agentic AI (multi-provider, WI-11)

Shared raw-client helpers for every LLM provider KrushiSarva can route to. Gemini is
the default, but model selection (admin App Settings / AI_<F>_MODEL env) can pick
any provider; agents/llm_dispatch resolves the provider from the model-id prefix
and calls the matching helper here:
  - Gemini    (call_gemini_text / call_gemini_vision)      — default, text + vision.
  - OpenAI    (call_openai_text / call_openai_vision)      — text + vision (raw httpx,
                                                             OpenAI-compatible API).
  - Anthropic (call_anthropic_text / call_anthropic_vision)— text + vision (official
                                                             `anthropic` SDK).
  - Groq      (call_groq_text)                             — text only (no vision);
                                                             also the text-chat
                                                             last-resort fallback.
Each provider key is read from its own env var and is a no-op when unset. Each
function returns (raw_text, token_info_dict).
"""
from __future__ import annotations

import asyncio
import json
import logging

import httpx

from services.http_clients import get_gemini, get_groq, get_openai

logger = logging.getLogger(__name__)

# ── Pricing (USD per 1K tokens) ─────────────────────────────────────────────
# This table is the meter behind DAILY_SPEND_CAP_USD, remaining_budget() and the
# ensemble headroom gate, so a wrong row silently disables a spend control.
#
# Two bugs used to live here. (1) The Gemini rows carried the BATCH/FLEX prices,
# not the standard interactive ones, which understated Gemini output 2-4x — the
# single largest line in the product. (2) An id missing from the table was priced
# by a substring guess ("pro" in the id → Pro rates, else Flash), so a new model
# billed at whatever the guess happened to land on. The rule now: every
# selectable model MUST have a row here. llm_dispatch.get_feature_config and
# router._call_one_vision both refuse an unpriced model BEFORE spending anything
# (see is_priced), and _calc_cost falls back to the most expensive known rate so
# the cap can only over-estimate, never under.
#
# Rates verified 2026-08-14 against each provider's published STANDARD
# (non-batch, non-flex) rates; the per-1M figures are in the comments, ÷1000 in
# the table. Gemini output prices include thinking tokens — see
# _gemini_output_tokens, which is why thoughtsTokenCount is now counted.
_PRICING = {
    # Google — $0.30/$2.50 and $1.25/$10.00 per 1M (Pro: prompts ≤200k).
    "gemini-2.5-flash":            {"input": 0.00030, "output": 0.00250},
    "gemini-2.5-pro":              {"input": 0.00125, "output": 0.01000},
    # Groq — chat fallback only. $0.59/$0.79 per 1M.
    "llama-3.3-70b-versatile":     {"input": 0.00059, "output": 0.00079},
    # OpenAI — crop-diagnosis ensemble voter. $2.50/$10.00 and $0.15/$0.60 per 1M.
    "gpt-4o":                      {"input": 0.0025,  "output": 0.01},
    "gpt-4o-mini":                 {"input": 0.00015, "output": 0.0006},
    # Anthropic (Claude) — multi-provider routing (WI-11). Per 1M: Opus 4.8
    # $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5.
    "claude-opus-4-8":             {"input": 0.005,   "output": 0.025},
    "claude-sonnet-4-6":           {"input": 0.003,   "output": 0.015},
    "claude-haiku-4-5":            {"input": 0.001,   "output": 0.005},
}

# The most expensive row in the table, computed at import. An unpriced model is
# billed at this rate: over-estimating trips the cap early (visible, annoying),
# while under-estimating disables the cap entirely (a near-free runaway).
_MAX_PRICE = {
    "input":  max(p["input"] for p in _PRICING.values()),
    "output": max(p["output"] for p in _PRICING.values()),
}


def is_priced(model: str) -> bool:
    """True when `model` has an explicit _PRICING row.

    Call sites that SELECT a model check this before spending anything, so an
    unpriced id fails loudly at selection time instead of quietly mis-billing
    at call time — when the tokens are already gone.
    """
    return (model or "") in _PRICING

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
        # The selection-time guards should make this unreachable. If one is
        # bypassed the tokens are already spent, so record them at the most
        # expensive known rate rather than guessing a family from the id — a
        # guess that lands low is indistinguishable from having no cap at all.
        prices = _MAX_PRICE
        logger.error(
            "[Pricing] model %r has no _PRICING row — billing at the most expensive "
            "known rate ($%.5f in / $%.5f out per 1K). Add an explicit row.",
            model, prices["input"], prices["output"],
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


def _gemini_output_tokens(usage: dict) -> int:
    """Billable output tokens from a Gemini `usageMetadata` block.

    Gemini bills `thoughtsTokenCount` (hidden reasoning) at the OUTPUT rate but
    reports it in a field of its own. Reading only `candidatesTokenCount` meant
    the most expensive part of a Pro call — sometimes the majority of it — was
    recorded as exactly $0. Fold the two together; total_tokens and cost_usd
    then follow automatically.
    """
    return int(usage.get("candidatesTokenCount", 0) or 0) + int(
        usage.get("thoughtsTokenCount", 0) or 0
    )


def _gemini_thinking_config(model: str, max_tokens: int) -> dict | None:
    """generationConfig.thinkingConfig for this Gemini model, or None to omit.

    Gemini 2.5 spends hidden "thinking" tokens BEFORE the visible output, and
    they come out of maxOutputTokens — so an unbudgeted call can burn 1-3K of
    its ceiling on reasoning and truncate mid-JSON. Flash accepts a budget of 0
    (thinking off). Pro REQUIRES thinking and returns HTTP 400 "Budget 0 is
    invalid", which is why the previous version omitted the field entirely for
    Pro — leaving the strongest model in the ensemble the only one with an
    unbounded scratchpad, and the one most likely to truncate.

    Give Pro a small EXPLICIT budget instead, scaled to the output ceiling so a
    512-token streaming reply cannot spend its whole allowance thinking. 128 is
    Pro's documented minimum budget.
    """
    m = (model or "").lower()
    if "flash" in m:
        return {"thinkingBudget": 0}
    if "pro" in m:
        return {"thinkingBudget": max(128, min(512, max_tokens // 4))}
    return None


# Gemini safetySettings. KrushiSarva's legitimate output names pesticides and
# explains how to mix and apply them, which reads as DANGEROUS_CONTENT to the
# default filter — and a filtered response comes back as HTTP 200 with no text,
# i.e. indistinguishable from an outage unless we read promptFeedback. Pin the
# threshold explicitly rather than inheriting a provider default that can move
# under us; the deterministic layer in fastapi/safety/ is what actually gates
# which chemical a farmer is allowed to be told about.
_SAFETY_SETTINGS = [
    {"category": category, "threshold": "BLOCK_ONLY_HIGH"}
    for category in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]


def _raise_gemini_empty(data: dict, label: str) -> None:
    """Raise a typed error that tells a CONTENT BLOCK apart from an outage.

    Gemini returns HTTP 200 with no usable text in three different situations:
    promptFeedback.blockReason (safety filter tripped), finishReason=MAX_TOKENS
    where thinking ate the whole budget, and SAFETY/RECITATION with an empty
    content block. Reading none of them made all three surface as the same
    opaque "empty response", so a filter trip looked like a Gemini outage and
    got retried instead of reported.
    """
    block = (data.get("promptFeedback") or {}).get("blockReason")
    finish = ""
    try:
        finish = data["candidates"][0].get("finishReason", "")
    except (KeyError, IndexError):
        pass
    logger.error(
        "Unexpected Gemini %s response (block=%s finish=%s): %s",
        label, block or "none", finish or "none", json.dumps(data)[:500],
    )
    raise ValueError(
        f"Empty or malformed Gemini response (blockReason={block or 'none'}, "
        f"finishReason={finish or 'none'})"
    )


# ── Multi-turn / structured-output request builders ─────────────────────────
# Gemini and the OpenAI-compatible providers both accept a real turn list; the
# chat surface previously flattened its whole transcript into ONE user-role part
# as "Farmer: …\nFarmMind: …", so a farmer message containing those literal
# labels forged assistant turns the model could not tell from real ones. These
# helpers keep every turn in its own role-tagged entry, where the role is
# structural rather than a string in the text.

_GEMINI_ROLE = {"user": "user", "assistant": "model", "model": "model"}
_OPENAI_ROLE = {"user": "user", "assistant": "assistant", "model": "assistant"}


def _gemini_contents(
    user_prompt: str,
    *,
    system_prompt: str = "",
    history: list[dict] | None = None,
) -> list[dict]:
    """Build Gemini `contents` from an optional [{role, content}] history.

    `system_prompt` is prepended to the FINAL user turn, exactly as the old
    single-part payload did — callers that pass neither history nor
    system_instruction get a byte-identical request. Callers that have moved
    their static prompt to `system_instruction` pass system_prompt="".

    Leading non-user turns are dropped, the same contract call_anthropic_text
    enforces. This is not defensive tidiness: the scan follow-up conversation is
    SEEDED with a lone assistant message (ai.routes.js creates it with
    isScanSession + role 'assistant'), so the very first follow-up hands this
    builder a history whose turn 1 is `model` — and all four adapters should
    agree on one history contract rather than each having its own.
    """
    contents: list[dict] = []
    for turn in history or []:
        role = _GEMINI_ROLE.get(str((turn or {}).get("role", "")).strip().lower())
        text = (turn or {}).get("content") or ""
        if not role or not text:
            continue
        if not contents and role != "user":
            continue
        contents.append({"role": role, "parts": [{"text": text}]})
    final = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt
    contents.append({"role": "user", "parts": [{"text": final}]})
    return contents


def _openai_messages(
    system_text: str,
    user_content,
    history: list[dict] | None = None,
) -> list[dict]:
    """Build an OpenAI-compatible `messages` array (shared by OpenAI and Groq).

    `user_content` is a plain string for text calls and a content-part list for
    vision calls, so both adapters can share the turn-assembly logic.

    Leading non-user turns are dropped for the same reason _gemini_contents drops
    them — the scan follow-up conversation opens with an assistant message, and
    all four adapters hold to one history contract.
    """
    msgs: list[dict] = []
    if system_text:
        msgs.append({"role": "system", "content": system_text})
    started = False
    for turn in history or []:
        role = _OPENAI_ROLE.get(str((turn or {}).get("role", "")).strip().lower())
        text = (turn or {}).get("content") or ""
        if not role or not text:
            continue
        if not started and role != "user":
            continue
        started = True
        msgs.append({"role": role, "content": text})
    msgs.append({"role": "user", "content": user_content})
    return msgs


def _join_system(*blocks: str) -> str:
    """Join the system_instruction and system_prompt slots for providers that
    have exactly one system channel (OpenAI, Groq, Anthropic)."""
    return "\n\n".join(b for b in blocks if b)


def _apply_json_mode(
    gen_config: dict, json_mode: bool, response_schema: dict | None
) -> None:
    """Set Gemini's structured-output fields on a generationConfig, in place.

    A response_schema implies JSON output, so passing one is enough — callers
    don't have to remember to set json_mode as well.
    """
    if response_schema:
        gen_config["responseMimeType"] = "application/json"
        gen_config["responseSchema"] = response_schema
    elif json_mode:
        gen_config["responseMimeType"] = "application/json"


def _openai_response_format(
    json_mode: bool, response_schema: dict | None
) -> dict | None:
    """OpenAI/Groq `response_format` for the same (json_mode, response_schema).

    strict=False deliberately: the schemas in this repo are written for Gemini's
    OpenAPI subset, and OpenAI's strict mode additionally requires
    additionalProperties:false on every object — turning it on would 400 on
    schemas that work fine everywhere else.
    """
    if response_schema:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "response",
                "strict": False,
                "schema": response_schema,
            },
        }
    if json_mode:
        return {"type": "json_object"}
    return None


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
    json_mode: bool = False,
    response_schema: dict | None = None,
) -> tuple[str, dict]:
    """
    Call Gemini vision with images + text.
    Returns (raw_response_text, token_info).

    json_mode / response_schema constrain the model to emit a single valid JSON
    document, which makes the caller's "JSON parse failed → resample at a higher
    temperature" retry unreachable. That retry costs a second FULL vision call
    (~5.6K tokens on diagnose), so this is the cheapest reliability win here.
    """
    # Pass the API key in a header rather than the URL querystring — query
    # params end up in proxy / LB / debug logs.
    url = f"{_GEMINI_BASE}/{model}:generateContent"
    headers = {"x-goog-api-key": gemini_api_key}

    # Part order is a cost decision. The static system prompt (4.2K tokens on
    # diagnose) goes FIRST so it forms a stable prefix Gemini's implicit cache
    # can hit across scans. The old order appended the images first, so every
    # request began with bytes unique to that photo and the prompt behind it was
    # re-billed at full rate on every scan and every ensemble member. The user
    # prompt stays immediately after the images (Google's guidance for
    # image-plus-instruction prompts); only the static block moves. The OpenAI
    # adapter further down already builds its parts this way.
    parts: list[dict] = [{"text": system_prompt}]
    for img in images_b64:
        parts.append({
            "inline_data": {
                "mime_type": img["mime_type"],
                "data": img["data"],
            }
        })
    parts.append({"text": user_prompt})

    gen_config = {
        "maxOutputTokens": max_tokens,
        "temperature": temperature,
    }
    thinking = _gemini_thinking_config(model, max_tokens)
    if thinking:
        gen_config["thinkingConfig"] = thinking
    _apply_json_mode(gen_config, json_mode, response_schema)
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": gen_config,
        "safetySettings": _SAFETY_SETTINGS,
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
        # Was a bare "Empty or malformed Gemini response" — a safety block and a
        # thinking-ate-the-budget truncation looked identical here. See
        # _raise_gemini_empty; the text path has read promptFeedback for a while.
        _raise_gemini_empty(data, "vision")

    usage = data.get("usageMetadata", {})
    tok = _make_token_info(
        model,
        usage.get("promptTokenCount", 0),
        _gemini_output_tokens(usage),
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
    json_mode: bool = False,
    response_schema: dict | None = None,
    system_instruction: str | None = None,
    history: list[dict] | None = None,
) -> tuple[str, dict]:
    """Call Gemini text-only (no images). Returns (raw_text, token_info).

    json_mode=True sets responseMimeType=application/json so Gemini is
    constrained to emit a single syntactically-valid JSON document; pass
    response_schema as well to constrain the SHAPE, not just the syntax (the
    caller still validates semantics).

    system_instruction is sent as Gemini's native `systemInstruction` field
    rather than being glued onto the user turn. That matters twice over: it is
    the stable cache prefix, and it is the only channel the model treats as
    operator authority — text pasted into a user turn is not. `system_prompt`
    keeps its legacy behaviour (prepended to the final user turn) so existing
    callers are unaffected; a caller that has moved to system_instruction passes
    system_prompt="".

    history is [{"role": "user"|"assistant", "content": str}], oldest first, and
    becomes real role-tagged turns instead of a flattened transcript.
    """
    url = f"{_GEMINI_BASE}/{model}:generateContent"
    headers = {"x-goog-api-key": gemini_api_key}

    gen_config = {
        "maxOutputTokens": max_tokens,
        "temperature": temperature,
    }
    _apply_json_mode(gen_config, json_mode, response_schema)
    # See _gemini_thinking_config — Flash takes a budget of 0, Pro takes a small
    # explicit one (a budget of 0 is a hard 400 on Pro).
    thinking = _gemini_thinking_config(model, max_tokens)
    if thinking:
        gen_config["thinkingConfig"] = thinking
    payload = {
        "contents": _gemini_contents(
            user_prompt, system_prompt=system_prompt, history=history
        ),
        "generationConfig": gen_config,
        "safetySettings": _SAFETY_SETTINGS,
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

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
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        _raise_gemini_empty(data, "text")

    usage = data.get("usageMetadata", {})
    tok = _make_token_info(
        model,
        usage.get("promptTokenCount", 0),
        _gemini_output_tokens(usage),
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
    json_mode: bool = False,
    response_schema: dict | None = None,
    system_instruction: str | None = None,
    history: list[dict] | None = None,
) -> tuple[str, dict]:
    """Call Groq's OpenAI-compatible chat API. Returns (raw_text, token_info).

    One quick 2s retry on transient statuses (429 + 5xx) — matching the Gemini
    helpers — then raises HTTPStatusError so the dispatcher's _with_retry applies
    its backoff or surfaces the failure. Keeps the cross-provider fallback well
    inside the request budget rather than burning 60s on internal retries.

    Groq has one system channel, so system_instruction and system_prompt are
    joined into it (Gemini keeps them separate — see call_gemini_text).
    """
    headers = {
        "Authorization": f"Bearer {groq_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": _openai_messages(
            _join_system(system_instruction or "", system_prompt),
            user_prompt,
            history,
        ),
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    response_format = _openai_response_format(json_mode, response_schema)
    if response_format:
        payload["response_format"] = response_format

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


# ── Streaming text (voice low-latency path) ──────────────────────────────────
# Async generators that yield incremental text as the model produces it, then a
# final usage event. Only Gemini + Groq have a streaming path (the two providers
# the voice writer uses); other providers raise upstream so the caller falls back
# to the non-streaming one-shot call. Each yields:
#   {"type": "delta", "text": <incremental text>}        # zero or more
#   {"type": "usage", "token_info": <_make_token_info()>} # exactly one, last
# A failure mid-stream propagates as an exception — the service layer decides
# whether to finalise with the partial text or fall back to a fresh non-stream call.

async def stream_gemini_text(
    system_prompt: str,
    user_prompt: str,
    gemini_api_key: str,
    *,
    model: str = "gemini-2.5-flash",
    max_tokens: int = 512,
    temperature: float = 0.3,
    system_instruction: str | None = None,
    history: list[dict] | None = None,
):
    """Stream Gemini text via :streamGenerateContent?alt=sse. Yields delta/usage events."""
    url = f"{_GEMINI_BASE}/{model}:streamGenerateContent?alt=sse"
    headers = {"x-goog-api-key": gemini_api_key}
    gen_config = {"maxOutputTokens": max_tokens, "temperature": temperature}
    # max_tokens is only ~512 on the voice path, so _gemini_thinking_config
    # scales Pro's budget down rather than letting it eat the whole reply.
    thinking = _gemini_thinking_config(model, max_tokens)
    if thinking:
        gen_config["thinkingConfig"] = thinking
    payload = {
        "contents": _gemini_contents(
            user_prompt, system_prompt=system_prompt, history=history
        ),
        "generationConfig": gen_config,
        "safetySettings": _SAFETY_SETTINGS,
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    client = get_gemini()
    prompt_toks, cand_toks = 0, 0
    async with client.stream("POST", url, json=payload, headers=headers, timeout=90) as resp:
        if resp.status_code >= 400:
            body = (await resp.aread()).decode("utf-8", "replace")
            logger.error("[Gemini stream] %s HTTP %d — %s", model, resp.status_code, body[:300])
            raise httpx.HTTPStatusError(
                f"Gemini stream {resp.status_code}", request=resp.request, response=resp
            )
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if not chunk or chunk == "[DONE]":
                continue
            try:
                data = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            try:
                parts = data["candidates"][0]["content"]["parts"]
                text = "".join(p.get("text", "") for p in parts)
            except (KeyError, IndexError):
                text = ""
            usage = data.get("usageMetadata")
            if usage:
                prompt_toks = usage.get("promptTokenCount", prompt_toks)
                # candidates + thoughts — see _gemini_output_tokens. Gemini's
                # stream reports usage cumulatively, so keep the latest non-zero
                # reading rather than letting an early empty block reset it.
                cand_toks = _gemini_output_tokens(usage) or cand_toks
            if text:
                yield {"type": "delta", "text": text}
    yield {"type": "usage", "token_info": _make_token_info(model, prompt_toks, cand_toks)}


async def stream_groq_text(
    system_prompt: str,
    user_prompt: str,
    groq_api_key: str,
    *,
    model: str = "llama-3.3-70b-versatile",
    max_tokens: int = 512,
    temperature: float = 0.3,
    system_instruction: str | None = None,
    history: list[dict] | None = None,
):
    """Stream Groq's OpenAI-compatible chat API (stream=True). Yields delta/usage events."""
    headers = {"Authorization": f"Bearer {groq_api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": _openai_messages(
            _join_system(system_instruction or "", system_prompt),
            user_prompt,
            history,
        ),
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    client = get_groq()
    prompt_toks, comp_toks = 0, 0
    async with client.stream("POST", _GROQ_BASE, headers=headers, json=payload, timeout=90) as resp:
        if resp.status_code >= 400:
            body = (await resp.aread()).decode("utf-8", "replace")
            logger.error("[Groq stream] %s HTTP %d — %s", model, resp.status_code, body[:300])
            raise httpx.HTTPStatusError(
                f"Groq stream {resp.status_code}", request=resp.request, response=resp
            )
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if chunk == "[DONE]":
                break
            try:
                data = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            choices = data.get("choices") or []
            if choices:
                text = (choices[0].get("delta") or {}).get("content") or ""
                if text:
                    yield {"type": "delta", "text": text}
            usage = data.get("usage")
            if usage:
                prompt_toks = usage.get("prompt_tokens", prompt_toks)
                comp_toks = usage.get("completion_tokens", comp_toks)
    yield {"type": "usage", "token_info": _make_token_info(model, prompt_toks, comp_toks)}


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
    json_mode: bool = False,
    response_schema: dict | None = None,
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
        "messages": _openai_messages(system_prompt, user_content),
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    response_format = _openai_response_format(json_mode, response_schema)
    if response_format:
        payload["response_format"] = response_format

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
    json_mode: bool = False,
    response_schema: dict | None = None,
    system_instruction: str | None = None,
    history: list[dict] | None = None,
) -> tuple[str, dict]:
    """Call OpenAI's chat API (OpenAI-compatible). Returns (raw_text, token_info).

    One system channel, so system_instruction and system_prompt are joined —
    see call_gemini_text for why Gemini keeps them apart.
    """
    headers = {
        "Authorization": f"Bearer {openai_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": _openai_messages(
            _join_system(system_instruction or "", system_prompt),
            user_prompt,
            history,
        ),
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    response_format = _openai_response_format(json_mode, response_schema)
    if response_format:
        payload["response_format"] = response_format
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
    json_mode: bool = False,          # accepted for parity; Claude has no
    response_schema: dict | None = None,  # response_format equivalent here
    system_instruction: str | None = None,
    history: list[dict] | None = None,
) -> tuple[str, dict]:
    """Call Anthropic Claude (text) via the official SDK. Returns (raw_text, token_info).

    json_mode / response_schema are accepted so every text adapter shares one
    signature, but Claude's Messages API has no response_format field on this
    path — they are logged and ignored rather than silently pretended to work.
    """
    from anthropic import AsyncAnthropic

    if json_mode or response_schema:
        logger.debug(
            "[Anthropic] %s: json_mode/response_schema not supported on this path — "
            "the prompt must describe the JSON shape.", model,
        )

    # Claude's `system` is a top-level param, not a message, and the FIRST
    # message must be a user turn — drop any leading assistant turns a caller's
    # history happens to start with rather than 400 on them.
    messages: list[dict] = []
    for turn in history or []:
        role = _OPENAI_ROLE.get(str((turn or {}).get("role", "")).strip().lower())
        text = (turn or {}).get("content") or ""
        if not role or not text:
            continue
        if not messages and role != "user":
            continue
        messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": user_prompt})

    client = AsyncAnthropic(api_key=anthropic_api_key)
    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=_join_system(system_instruction or "", system_prompt),
        messages=messages,
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
    json_mode: bool = False,          # accepted for parity; see call_anthropic_text
    response_schema: dict | None = None,
) -> tuple[str, dict]:
    """Call Anthropic Claude (vision) via the official SDK. Returns (raw_text, token_info)."""
    from anthropic import AsyncAnthropic

    if json_mode or response_schema:
        logger.debug(
            "[Anthropic] %s: json_mode/response_schema not supported on this path — "
            "the prompt must describe the JSON shape.", model,
        )

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

