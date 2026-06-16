"""
agents/llm_dispatch.py — Flat per-feature LLM dispatch (Gemini-first, multi-provider).

Each AI feature (text chat, crop diagnose, treatment, alert, pest) resolves ONE
model. Gemini is the default for every feature, but WI-11 makes the dispatch
MULTI-PROVIDER: the model id's prefix selects the provider —
    gemini-*            → Google Gemini
    gpt-*               → OpenAI
    claude-*            → Anthropic
    llama-* / mixtral-* → Groq
(see _detect_provider). The provider's own API key is resolved automatically
(GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GROQ_API_KEY); when that
key is unset, get_feature_config raises a clear ConfigError rather than calling
with an empty credential.

The model can be set three ways (highest precedence first):
    1. model_override — the admin App Settings choice (ai.model.*), forwarded
       per-request from the Express backend (body.model / params.model_diagnose /
       params.model_treatment). Honoured live, no restart.
    2. AI_<FEATURE>_MODEL / AI_<FEATURE>_API_KEY env vars.
    3. The baked-in Gemini default (_DEFAULTS).

Fallback chains:
    • call_llm_text — for a Gemini PRIMARY: Gemini → Gemini Flash↔Pro capacity
      fallback → cross-provider Groq (text-chat features, GROQ_API_KEY set). A
      non-Gemini primary (OpenAI/Anthropic/Groq) is called direct, NO fallback.
    • call_llm_vision — no fallback for any provider; Groq is rejected (no vision).
For non-chat features there is no fallback by design (full control, fail loud).
An unknown model-id prefix raises ConfigError so it can't silently fail at call time.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import httpx

from agents.llm_utils import (
    call_anthropic_text,
    call_anthropic_vision,
    call_gemini_text,
    call_gemini_vision,
    call_groq_text,
    call_openai_text,
    call_openai_vision,
)
from config import GEMINI_API_KEY, GROQ_API_KEY, GROQ_FALLBACK_MODEL

logger = logging.getLogger(__name__)


# ── Feature registry ─────────────────────────────────────────────────────────
# These are the only feature names the dispatcher recognizes. The matching
# env vars follow the pattern AI_<FEATURE>_MODEL / _API_KEY / _BASE_URL.
AI_FEATURES = (
    "TEXT_CHAT",        # FarmMind chat / Q&A (legacy single-pass)
    "CHAT_WRITER",      # FarmMind agentic chat — draft + follow-up suggester
    "CHAT_ENHANCER",    # FarmMind agentic chat — fact-check + rewrite to final
    "CHAT_VISION",      # FarmMind chat — general image understanding (NOT crop-disease)
    "SOIL_OCR",         # Soil Health Card photo → structured 12-parameter JSON
    "CROP_DIAGNOSE",    # Crop disease vision diagnose
    "CROP_TREATMENT",   # RAG-grounded treatment plan
    "ALERT",            # Smart farm alerts
    "PEST",             # KisanRakshak pest enhancement
)


# Default Gemini model per feature, used when AI_<F>_MODEL is unset in .env so a
# fresh checkout still works. Admin can override any of these by setting the env
# var. The api key defaults to GEMINI_API_KEY for every feature.
#
# Flash is the default everywhere — fast + cheap and the free-tier limits are
# generous enough for the chat pipeline's multiple calls/message. Switch a
# feature to gemini-2.5-pro via AI_<FEATURE>_MODEL when you want more accuracy.
_DEFAULTS: dict[str, str] = {
    # feature             default Gemini model id
    "TEXT_CHAT":          "gemini-2.5-flash",
    "CHAT_WRITER":        "gemini-2.5-flash",
    "CHAT_ENHANCER":      "gemini-2.5-flash",
    "CHAT_VISION":        "gemini-2.5-flash",
    "SOIL_OCR":           "gemini-2.5-flash",
    "CROP_DIAGNOSE":      "gemini-2.5-flash",
    "CROP_TREATMENT":     "gemini-2.5-flash",
    "ALERT":              "gemini-2.5-flash",
    "PEST":               "gemini-2.5-flash",
}


# ── Data model ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FeatureConfig:
    feature:  str          # e.g. "TEXT_CHAT"
    model:    str          # e.g. "gemini-2.5-flash"
    api_key:  str
    base_url: Optional[str] = None  # vestigial — Gemini uses its native REST endpoint

    @property
    def provider(self) -> str:
        return _detect_provider(self.model, self.base_url)


class ConfigError(RuntimeError):
    """Raised on an unsupported model-id prefix or a missing provider API key."""


# ── Provider detection ───────────────────────────────────────────────────────

def _detect_provider(model: str, base_url: Optional[str] = None) -> str:
    """Route by model-id prefix (WI-11): gemini-* / gpt-* / claude-* /
    llama-*|mixtral-*. An unknown prefix is a configuration error we surface
    immediately rather than at call time."""
    m = (model or "").lower().strip()
    if m.startswith("gemini-"):
        return "gemini"
    if m.startswith("gpt-"):
        return "openai"
    if m.startswith("claude-"):
        return "anthropic"
    if m.startswith("llama-") or m.startswith("mixtral-"):
        return "groq"
    raise ConfigError(
        f"Unsupported model {model!r}. Supported prefixes: "
        f"gemini-* / gpt-* / claude-* / llama-* (or mixtral-*)."
    )


# Per-provider env var holding the default API key when AI_<FEATURE>_API_KEY is unset.
_PROVIDER_KEY_ENV = {
    "gemini":    "GEMINI_API_KEY",
    "openai":    "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "groq":      "GROQ_API_KEY",
}


# ── Config loader ────────────────────────────────────────────────────────────

def get_feature_config(feature: str, model_override: Optional[str] = None) -> FeatureConfig:
    """Read AI_<FEATURE>_MODEL / _API_KEY from os.environ.

    Falls back to the baked-in Gemini default (see _DEFAULTS) for the model and
    to GEMINI_API_KEY for the key when the env var is unset.

    `model_override` (WI-11) is the admin App Settings choice, forwarded per
    request from the Express backend (body.model / params.model_diagnose /
    params.model_treatment). When present and resolvable to a known provider it
    takes precedence over the env/default model, and the provider-aware key
    resolution below follows the overridden model. An unknown override is
    IGNORED (logged) so a stray value degrades to the configured model instead of
    failing the request — the value is already allowlisted upstream by the ENUM
    setting, so this is defence-in-depth.
    """
    if feature not in AI_FEATURES:
        raise ValueError(f"Unknown AI feature {feature!r}. Valid: {AI_FEATURES}")

    default_model = _DEFAULTS[feature]
    model = (os.environ.get(f"AI_{feature}_MODEL") or default_model).strip()
    # str() coerces any non-string body value (number/object) to a harmless string
    # so a malformed override degrades to the configured model instead of raising.
    ov = str(model_override or "").strip()
    if ov:
        try:
            _detect_provider(ov)          # validate it maps to a supported provider
            model = ov
        except ConfigError:
            logger.warning("Ignoring unsupported model_override %r for %s; using %s",
                           ov, feature, model)
    # Provider-aware key (WI-11): a 'claude-*'/'gpt-*'/'llama-*' model defaults to
    # its own provider's key, not GEMINI_API_KEY. AI_<FEATURE>_API_KEY still overrides.
    provider = _detect_provider(model)
    default_key = os.environ.get(_PROVIDER_KEY_ENV[provider], "")
    api_key = (os.environ.get(f"AI_{feature}_API_KEY") or default_key).strip()

    # Fail fast with an actionable message when the selected provider has no key,
    # instead of sending an empty Bearer token and getting an opaque 401 back (and
    # wasting a round-trip). This is the common case when an admin picks a non-Gemini
    # model in App Settings but that provider's key isn't set on the AI service yet.
    if not api_key:
        raise ConfigError(
            f"{feature}: model {model!r} routes to provider '{provider}', but no API key "
            f"is configured. Set {_PROVIDER_KEY_ENV[provider]} (or AI_{feature}_API_KEY) "
            f"on the AI service to use this model."
        )

    return FeatureConfig(feature=feature, model=model, api_key=api_key, base_url=None)


# ── Capacity fallback (within Gemini) ────────────────────────────────────────
# When the primary model is throttled (503 "high demand"), retrying the SAME
# overloaded model rarely helps. A different-size Gemini model has separate
# capacity, so on exhausted-retry failure we try ONE fallback. This is a
# capacity fallback within the same provider (Flash↔Pro), NOT the cross-provider
# "weaker guess" the diagnose path deliberately avoids — Pro is the stronger
# model, so the chat answer quality only improves. Enabled by default for chat +
# text-advisory features; vision diagnosis stays single-model by design. Any
# feature can override the target with AI_<FEATURE>_FALLBACK_MODEL (empty = off).
_AUTO_FALLBACK_FEATURES = {"TEXT_CHAT", "CHAT_WRITER", "CHAT_ENHANCER", "ALERT", "PEST"}


def _fallback_model(feature: str, primary: str) -> Optional[str]:
    explicit = (os.environ.get(f"AI_{feature}_FALLBACK_MODEL") or "").strip()
    if explicit:
        return explicit if explicit.lower() != (primary or "").lower() else None
    if feature not in _AUTO_FALLBACK_FEATURES:
        return None
    p = (primary or "").lower()
    if p == "gemini-2.5-flash":
        return "gemini-2.5-pro"
    if p == "gemini-2.5-pro":
        return "gemini-2.5-flash"
    return None


# ── Cross-provider fallback (Gemini → Groq) ──────────────────────────────────
# LAST resort for the text-chat features: after the Gemini primary AND its
# Flash↔Pro capacity fallback have both failed, try Groq so the farmer still
# gets a reply instead of "Chat unavailable". This is the ONE place CropSetu
# leaves the Gemini-only path — Groq has capacity separate from Google, so it
# survives a Gemini-side outage / quota exhaustion that retrying Gemini cannot.
# Off unless GROQ_API_KEY is set (no key → Gemini-only behaviour, unchanged).
# Text-only — Groq Llama can't do vision, so call_llm_vision never uses it.
# Override per feature: AI_<FEATURE>_GROQ_FALLBACK=false to disable, or
# AI_<FEATURE>_GROQ_MODEL=<groq-model> to pick a different Groq model.
_GROQ_FALLBACK_FEATURES = {"TEXT_CHAT", "CHAT_WRITER", "CHAT_ENHANCER"}


def _groq_fallback(feature: str) -> Optional[tuple[str, str]]:
    """Return (groq_model, groq_api_key) for the cross-provider chat fallback,
    or None when it's disabled or unconfigured."""
    api_key = (os.environ.get(f"AI_{feature}_GROQ_API_KEY") or GROQ_API_KEY).strip()
    if not api_key:
        return None
    default_on = "true" if feature in _GROQ_FALLBACK_FEATURES else "false"
    enabled = (os.environ.get(f"AI_{feature}_GROQ_FALLBACK") or default_on).strip().lower()
    if enabled != "true":
        return None
    model = (os.environ.get(f"AI_{feature}_GROQ_MODEL") or GROQ_FALLBACK_MODEL).strip()
    return (model, api_key) if model else None


# ── Transient-failure retry ──────────────────────────────────────────────────
# Free-tier providers (esp. Groq) return 429 under bursty load. A few short
# retries — honouring Retry-After when present — turn a hard "Chat unavailable"
# into a small wait. Caps keep total wait inside the Express→FastAPI 120s budget
# even across the chat pipeline's multiple calls. Only transient statuses retry;
# config errors (400/401/403) fail fast.
_RETRY_STATUSES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 2          # total attempts = 1 + 2
_BACKOFF_BASE_S = 1.5
_BACKOFF_CAP_S = 8.0


def _retry_after_seconds(resp: Optional[httpx.Response]) -> Optional[float]:
    if resp is None:
        return None
    try:
        ra = resp.headers.get("retry-after")
        return float(ra) if ra else None
    except (TypeError, ValueError):
        return None


async def _with_retry(make_call: Callable[[], Awaitable[tuple]], *, label: str) -> tuple:
    """Run an LLM call, retrying transient 429/5xx + timeouts with backoff."""
    attempt = 0
    while True:
        try:
            return await make_call()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status not in _RETRY_STATUSES or attempt >= _MAX_RETRIES:
                raise
            delay = min(_retry_after_seconds(exc.response) or _BACKOFF_BASE_S * (2 ** attempt), _BACKOFF_CAP_S)
            logger.warning("[LLMDispatch] %s HTTP %s — retry %d/%d in %.1fs",
                           label, status, attempt + 1, _MAX_RETRIES, delay)
            await asyncio.sleep(delay)
            attempt += 1
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            if attempt >= _MAX_RETRIES:
                raise
            delay = min(_BACKOFF_BASE_S * (2 ** attempt), _BACKOFF_CAP_S)
            logger.warning("[LLMDispatch] %s %s — retry %d/%d in %.1fs",
                           label, type(exc).__name__, attempt + 1, _MAX_RETRIES, delay)
            await asyncio.sleep(delay)
            attempt += 1


# ── Dispatch ─────────────────────────────────────────────────────────────────

async def call_llm_text(
    cfg: FeatureConfig,
    system_prompt: str,
    user_prompt: str,
    *,
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """One-shot text LLM call. No fallback. Returns (text, token_info).

    Raises whatever the provider raised on failure — the caller (route
    handler or service) decides how to surface that to the user.
    """
    provider = _detect_provider(cfg.model, cfg.base_url)
    logger.info(
        "[LLMDispatch] feature=%s provider=%s model=%s",
        cfg.feature, provider, cfg.model,
    )

    label = f"{cfg.feature}/{provider}"

    # Non-Gemini providers (WI-11): direct call, no Gemini-family fallback chain.
    if provider == "anthropic":
        return await _with_retry(lambda: call_anthropic_text(
            system_prompt, user_prompt, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "openai":
        return await _with_retry(lambda: call_openai_text(
            system_prompt, user_prompt, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "groq":
        return await _with_retry(lambda: call_groq_text(
            system_prompt, user_prompt, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)

    # Gemini (primary) → Gemini-family capacity fallback → cross-provider Groq.
    try:
        return await _with_retry(lambda: call_gemini_text(
            system_prompt, user_prompt, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    except Exception as primary_exc:  # noqa: BLE001
        # 1) Gemini capacity fallback (Flash↔Pro) — same provider, separate quota.
        fb = _fallback_model(cfg.feature, cfg.model)
        if fb:
            logger.warning(
                "[LLMDispatch] %s primary model %s failed (%s) — capacity fallback to %s",
                cfg.feature, cfg.model, type(primary_exc).__name__, fb,
            )
            try:
                return await _with_retry(lambda: call_gemini_text(
                    system_prompt, user_prompt, cfg.api_key,
                    model=fb, max_tokens=max_tokens, temperature=temperature,
                ), label=f"{label}/fallback:{fb}")
            except Exception:  # noqa: BLE001
                pass  # Gemini path exhausted — fall through to cross-provider Groq.

        # 2) Cross-provider Groq fallback (text-chat features, GROQ_API_KEY set).
        groq = _groq_fallback(cfg.feature)
        if groq:
            groq_model, groq_key = groq
            logger.warning(
                "[LLMDispatch] %s Gemini path failed (%s) — cross-provider fallback to Groq %s",
                cfg.feature, type(primary_exc).__name__, groq_model,
            )
            try:
                return await _with_retry(lambda: call_groq_text(
                    system_prompt, user_prompt, groq_key,
                    model=groq_model, max_tokens=max_tokens, temperature=temperature,
                ), label=f"{cfg.feature}/groq:{groq_model}")
            except Exception:  # noqa: BLE001
                pass  # Groq also failed — surface the original Gemini failure below.

        raise primary_exc  # surface the original failure, not a fallback's


async def call_llm_vision(
    cfg: FeatureConfig,
    system_prompt: str,
    user_prompt: str,
    images_b64: list[dict],
    *,
    max_tokens: int = 4096,
    temperature: float = 0.3,
) -> tuple[str, dict]:
    """One-shot vision LLM call. No fallback. Returns (text, token_info)."""
    provider = _detect_provider(cfg.model, cfg.base_url)
    logger.info(
        "[LLMDispatch] feature=%s provider=%s model=%s (vision)",
        cfg.feature, provider, cfg.model,
    )

    label = f"{cfg.feature}/{provider}/vision"
    if provider == "anthropic":
        return await _with_retry(lambda: call_anthropic_vision(
            system_prompt, user_prompt, images_b64, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "openai":
        return await _with_retry(lambda: call_openai_vision(
            system_prompt, user_prompt, images_b64, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "groq":
        raise ConfigError(
            f"{cfg.feature}: Groq model {cfg.model!r} has no vision support — "
            f"use a gemini-* / gpt-* / claude-* model for vision features."
        )
    return await _with_retry(lambda: call_gemini_vision(
        system_prompt, user_prompt, images_b64, cfg.api_key,
        model=cfg.model, max_tokens=max_tokens, temperature=temperature,
    ), label=label)
