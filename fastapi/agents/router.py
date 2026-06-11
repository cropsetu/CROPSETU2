"""
LLM Router — CropGuard Agentic AI

Picks a Gemini model chain for a (stage, tier) and dispatches the call.
Auto-falls back to the next model in the chain (e.g. Gemini Pro → Flash) on
transient errors (429, 5xx, timeouts) or empty/unparseable output.

The router does NOT parse JSON or interpret responses — it just returns the
raw text + accumulated token info. Agents own their own parsing + retry
logic (e.g. disease_diagnosis_agent re-prompts on low confidence).

Usage:
    raw, tok, model_used = await dispatch_vision(
        stage="diagnose",
        tier="best",
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_ctx,
        images_b64=images_b64,
    )

If every model in the chain fails, the last exception is re-raised so the
caller can decide how to recover (typically: return _uncertain_fallback).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

import httpx

from agents.llm_utils import (
    call_gemini_text,
    call_gemini_vision,
    call_openai_vision,
    empty_token_info,
)
from agents.registry import (
    MODEL_CATALOG,
    Stage,
    Tier,
    normalize_tier,
    provider_of,
    resolve_chain,
)
from config import GEMINI_API_KEY, OPENAI_API_KEY

logger = logging.getLogger(__name__)


# ── Error classification ─────────────────────────────────────────────────────

_TRANSIENT_HTTP_STATUSES = {408, 429, 500, 502, 503, 504}


def _is_transient(exc: BaseException) -> bool:
    """
    True if the error is worth trying the next model in the chain.
    Permanent errors (bad API key, schema rejection from us) are NOT
    fallback-worthy — those signal a config bug, not a provider hiccup.
    """
    if isinstance(exc, asyncio.TimeoutError):
        return True
    if isinstance(exc, httpx.TimeoutException):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _TRANSIENT_HTTP_STATUSES
    # Anthropic SDK raises anthropic.APIStatusError, anthropic.APITimeoutError —
    # check status_code if available, otherwise treat connection/timeout-like
    # errors as transient.
    status = getattr(exc, "status_code", None)
    if status is not None:
        return status in _TRANSIENT_HTTP_STATUSES
    if "rate" in str(exc).lower() or "timeout" in str(exc).lower():
        return True
    # Generic RuntimeError raised by our own "rate-limited after 3 retries"
    if isinstance(exc, RuntimeError) and "rate-limited" in str(exc):
        return True
    # Empty-response ValueError raised inside _run_chain — a model returning
    # nothing (Gemini safety-filter trip, Anthropic refusal, etc.) is exactly
    # the case where the next chain member might still succeed.
    if isinstance(exc, ValueError) and "returned empty response" in str(exc):
        return True
    # Provider-level credential / quota failures — these are NOT request
    # errors, so the next provider in the chain (e.g. Claude when Gemini's
    # key expires) should be tried. Gemini's _raise_gemini_error attaches a
    # `gemini_reason` attribute; Anthropic raises AuthenticationError with
    # 401. Match on those signals plus textual fallback.
    reason = getattr(exc, "gemini_reason", "") or ""
    if reason in ("API_KEY_INVALID", "QUOTA_EXCEEDED", "PERMISSION_DENIED",
                  "RESOURCE_EXHAUSTED", "BILLING_DISABLED"):
        return True
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401:
        return True
    msg = str(exc).lower()
    if "api key" in msg and ("invalid" in msg or "expired" in msg):
        return True
    if "authentication_error" in msg or "invalid x-api-key" in msg:
        return True
    return False


# ── Per-provider single-call adapters ────────────────────────────────────────

async def _call_one_vision(
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],
    temperature: float = 0.3,
) -> tuple[str, dict]:
    provider = provider_of(model_id)
    if provider == "gemini":
        return await call_gemini_vision(
            system_prompt, user_prompt, images_b64,
            GEMINI_API_KEY, model=model_id,
            temperature=temperature, max_tokens=4096,
        )
    if provider == "openai":
        # Cross-vendor ensemble voter only (registry restricts OpenAI to the
        # ensemble chain). Same (raw_text, token_info) contract as Gemini.
        return await call_openai_vision(
            system_prompt, user_prompt, images_b64,
            OPENAI_API_KEY, model=model_id,
            temperature=temperature, max_tokens=4096,
        )
    raise ValueError(f"Model {model_id!r} (provider={provider}) has no vision adapter")


async def _call_one_text(
    model_id: str,
    system_prompt: str,
    user_prompt: str,
) -> tuple[str, dict]:
    provider = provider_of(model_id)
    if provider != "gemini":
        raise ValueError(f"Model {model_id!r} has unsupported provider {provider!r} (Gemini-only)")
    return await call_gemini_text(system_prompt, user_prompt, GEMINI_API_KEY, model=model_id)


# ── Public dispatchers ───────────────────────────────────────────────────────

async def dispatch_vision(
    *,
    stage: Stage,
    tier: str | None,
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],
    temperature: float = 0.3,
) -> tuple[str, dict, str]:
    """
    Run the configured vision-model chain for (stage, tier). Returns
    (raw_text, accumulated_token_info, model_used). Raises if all
    chain members fail (last exception is re-raised).
    """
    return await _run_chain(
        stage=stage,
        tier=tier,
        runner=lambda m: _call_one_vision(m, system_prompt, user_prompt, images_b64, temperature),
    )


async def dispatch_one_vision(
    *,
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """
    Call a SINGLE vision model — no chain, no fallback. Used by the
    ensemble agent (agents/ensemble_agent.py) to fan out across multiple
    models in parallel. Per-member failures are caught at the gather
    layer, so we deliberately skip router-style fallback here: one
    failed ensemble member just means N-1 votes for the reconciler.
    Raises whatever the underlying provider raised.
    """
    return await _call_one_vision(model_id, system_prompt, user_prompt, images_b64, temperature)


async def dispatch_text(
    *,
    stage: Stage,
    tier: str | None,
    system_prompt: str,
    user_prompt: str,
) -> tuple[str, dict, str]:
    """
    Run the configured text-model chain for (stage, tier). Returns
    (raw_text, accumulated_token_info, model_used).
    """
    return await _run_chain(
        stage=stage,
        tier=tier,
        runner=lambda m: _call_one_text(m, system_prompt, user_prompt),
    )


# ── Core fallback loop ───────────────────────────────────────────────────────

async def _run_chain(
    *,
    stage: Stage,
    tier: str | None,
    runner: Callable[[str], Awaitable[tuple[str, dict]]],
) -> tuple[str, dict, str]:
    norm_tier: Tier = normalize_tier(tier)
    chain = resolve_chain(stage, norm_tier)

    if not chain:
        raise RuntimeError(
            f"No usable model in chain for stage={stage} tier={norm_tier}. "
            "Check API key env vars and registry entries."
        )

    # Accumulated tokens across the chain — if 3 models 429 and the 4th
    # succeeds, we still want to surface what the failed attempts cost (0
    # tokens typically, but the bookkeeping shape is preserved).
    accumulated = empty_token_info(chain[0])
    last_exc: BaseException | None = None

    for idx, model_id in enumerate(chain):
        try:
            logger.info(
                "[Router] stage=%s tier=%s attempt=%d/%d model=%s",
                stage, norm_tier, idx + 1, len(chain), model_id,
            )
            text, tok = await runner(model_id)

            if not text or not text.strip():
                raise ValueError(f"{model_id} returned empty response")

            # Add up tokens (in case earlier attempts produced any) and
            # report the final model used as the chain's model.
            accumulated["input_tokens"]  += tok.get("input_tokens", 0)
            accumulated["output_tokens"] += tok.get("output_tokens", 0)
            accumulated["total_tokens"]  += tok.get("total_tokens", 0)
            accumulated["cost_usd"]      += tok.get("cost_usd", 0.0)
            accumulated["model"]          = tok.get("model", model_id)

            if idx > 0:
                logger.info(
                    "[Router] stage=%s recovered via fallback (model=%s)", stage, model_id,
                )
            return text, accumulated, model_id

        except Exception as exc:  # noqa: BLE001 — we re-raise on exhaustion
            last_exc = exc
            transient = _is_transient(exc)
            logger.warning(
                "[Router] stage=%s model=%s failed (%s, transient=%s)",
                stage, model_id, type(exc).__name__, transient,
            )
            if not transient:
                # Permanent error — don't waste latency walking the rest of
                # the chain; surface the failure immediately.
                raise
            # else: fall through to next model
            continue

    # Exhausted the chain
    assert last_exc is not None
    logger.error(
        "[Router] stage=%s tier=%s exhausted %d models — re-raising last error",
        stage, norm_tier, len(chain),
    )
    raise last_exc


# ── Introspection helpers (used by /health and by orchestrator logs) ────────

def describe_chains(tier: str | None = None) -> dict:
    """Return a structured view of which chain each stage will use. For logs/diag."""
    norm = normalize_tier(tier)
    return {
        stage: {
            "tier":  norm,
            "chain": resolve_chain(stage, norm),  # type: ignore[arg-type]
        }
        for stage in ("diagnose", "treatment", "report")
    }
