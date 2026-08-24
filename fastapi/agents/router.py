"""
LLM Router — CropGuard Agentic AI

WHAT ACTUALLY RUNS IN PRODUCTION: `dispatch_one_vision`, called by
agents/ensemble_agent.py for each parallel voter, plus `describe_chains` for
/health and the orchestrator's startup log. That is the whole live surface.

Everything else here is the older stage/tier chain-walking design. KrushiSarva now
selects models per FEATURE through agents/llm_dispatch.get_feature_config
(AI_<FEATURE>_MODEL / admin App Settings), and the diagnose stage deliberately
has NO cross-model fallback — a provider outage returns a clear
service_unavailable instead of a weaker model's guess. `resolve_chain` survives
only as the ensemble's member list.

Two model-selection systems with one of them live is exactly how the
4096-vs-8192 max_tokens divergence went unnoticed for so long (see
_VISION_MAX_TOKENS below): the dead layer had its own ceiling that nobody
reviewed alongside the live one. `dispatch_vision` — the chain-walking vision
entry point, which had no caller at all — has been removed. `_run_chain` and
`_is_transient` are kept: `_is_transient`'s error classification is good and
worth sharing, and `_run_chain` is still exercised by tests/test_router.py.

The router does NOT parse JSON or interpret responses — it just returns the
raw text + accumulated token info. Agents own their own parsing + retry
logic (e.g. disease_diagnosis_agent re-prompts on low confidence).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

import httpx

from agents.llm_utils import (
    call_gemini_vision,
    call_openai_vision,
    empty_token_info,
    is_priced,
)
from agents.registry import (
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

# Every ensemble member runs the SAME diagnose prompt that
# disease_diagnosis_agent.py sends at max_tokens=8192 with the comment "4096
# truncates mid-response". This adapter hardcoded 4096, so the voters silently
# truncated mid-JSON, _parse_json returned None, and ensemble_agent dropped the
# member — with its input tokens already billed. The reconciler then fused 2
# instead of 3-4, fell to plurality, capped confidence at 0.55 and asked the
# farmer to consult his KVK. Same prompt, same ceiling: this is the pre-ship
# rule that bug broke.
_VISION_MAX_TOKENS = 8192


async def _call_one_vision(
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],
    temperature: float = 0.3,
    max_tokens: int = _VISION_MAX_TOKENS,
) -> tuple[str, dict]:
    # The ensemble picks its members from the registry, not from
    # llm_dispatch.get_feature_config, so it bypasses that function's pricing
    # guard. Check here too: an unpriced voter would spend real money against a
    # daily cap that cannot see it. Dropping one member is a cost the reconciler
    # already handles (it fuses N-1); an unmetered spend path is not.
    if not is_priced(model_id):
        raise ValueError(
            f"Model {model_id!r} has no pricing row in agents.llm_utils._PRICING — "
            f"refusing to dispatch an unmeterable call. Add a row to enable it."
        )
    provider = provider_of(model_id)
    if provider == "gemini":
        return await call_gemini_vision(
            system_prompt, user_prompt, images_b64,
            GEMINI_API_KEY, model=model_id,
            temperature=temperature, max_tokens=max_tokens,
        )
    if provider == "openai":
        # Cross-vendor ensemble voter only (registry restricts OpenAI to the
        # ensemble chain). Same (raw_text, token_info) contract as Gemini.
        return await call_openai_vision(
            system_prompt, user_prompt, images_b64,
            OPENAI_API_KEY, model=model_id,
            temperature=temperature, max_tokens=max_tokens,
        )
    raise ValueError(f"Model {model_id!r} (provider={provider}) has no vision adapter")


# ── Public dispatcher (the one live entry point) ─────────────────────────────

async def dispatch_one_vision(
    *,
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],
    temperature: float = 0.3,
    max_tokens: int = _VISION_MAX_TOKENS,
) -> tuple[str, dict]:
    """
    Call a SINGLE vision model — no chain, no fallback. Used by the
    ensemble agent (agents/ensemble_agent.py) to fan out across multiple
    models in parallel. Per-member failures are caught at the gather
    layer, so we deliberately skip router-style fallback here: one
    failed ensemble member just means N-1 votes for the reconciler.
    Raises whatever the underlying provider raised.

    max_tokens defaults to the diagnose prompt's real ceiling (see
    _VISION_MAX_TOKENS) so the ensemble matches the primary pass without every
    caller having to remember to pass it.
    """
    return await _call_one_vision(
        model_id, system_prompt, user_prompt, images_b64, temperature, max_tokens
    )


# ── Core fallback loop (no production caller; see the module docstring) ───────

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

# Which stages actually consult a chain at runtime, and who consults it. Ops was
# being shown diagnose/treatment/report — all three of which resolve their model
# through llm_dispatch.get_feature_config, not through a chain — while the ONE
# chain that really executes, "ensemble", was missing from the output entirely.
# That is backwards for a diagnostic endpoint: it advertised fallback behaviour
# that cannot happen and hid the fan-out that can.
_CHAIN_CONSUMERS = {
    "diagnose":  "",  # flat AI_CROP_DIAGNOSE_MODEL dispatch, no fallback by design
    "treatment": "",  # flat AI_CROP_TREATMENT_MODEL dispatch
    "report":    "",  # template-only, no LLM step
    "ensemble":  "agents.ensemble_agent.select",
}


def describe_chains(tier: str | None = None) -> dict:
    """Return a structured view of the model chain for each stage. For logs/diag.

    Keys `tier` and `chain` are unchanged for existing consumers
    (orchestrator startup log, /health/details). `live` and `used_by` are new:
    `live` is False for a stage whose chain no code path walks, so an operator
    reading /health can tell an advisory listing from a real one.
    """
    norm = normalize_tier(tier)
    return {
        stage: {
            "tier":    norm,
            "chain":   resolve_chain(stage, norm),  # type: ignore[arg-type]
            "live":    bool(consumer),
            "used_by": consumer or "none (model selected per-feature via llm_dispatch)",
        }
        for stage, consumer in _CHAIN_CONSUMERS.items()
    }
