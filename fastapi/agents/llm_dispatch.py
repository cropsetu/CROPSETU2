"""
agents/llm_dispatch.py — Flat per-feature LLM dispatch.

Each AI feature (text chat, crop diagnose, treatment, alert, pest, voice STT)
reads exactly ONE model + ONE api key from .env. The provider is auto-detected
from the model name prefix; admins never need to specify it.

Admin workflow when a provider breaks:
    1. Open fastapi/.env
    2. Change AI_<FEATURE>_MODEL=<new-model-id>
    3. Paste AI_<FEATURE>_API_KEY=<new-key>
    4. Save → uvicorn --reload picks it up → done

There is NO fallback chain. If the chosen model fails, the user-facing call
fails too. That's the explicit trade-off the admin wants — full control over
which provider serves each request, no hidden behaviour.

Provider auto-detection rules (in priority order):
    1. AI_<F>_BASE_URL set → openai_compatible (admin override; works for any
       custom URL: OpenRouter, private hosting, Ollama, vLLM, etc.)
    2. Model starts with "claude-"               → anthropic native SDK
    3. Model starts with "gemini-"               → gemini native REST
    4. Model starts with "gpt-", "o1-", "o3-"    → openai-compat @ api.openai.com
    5. Model starts with "llama-", "mixtral-"    → openai-compat @ api.groq.com
    6. Model starts with "deepseek-"             → openai-compat @ api.deepseek.com
    7. Model starts with "grok-"                 → openai-compat @ api.x.ai
    8. Otherwise → AI_<F>_BASE_URL required, raises ConfigError if missing
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import httpx

from agents.llm_utils import (
    call_claude_text,
    call_claude_vision,
    call_gemini_text,
    call_gemini_vision,
    call_openai_compatible_text,
    call_openai_compatible_vision,
)
from config import ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY

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
    "VOICE_STT",        # Whisper transcription (read by backend/, not fastapi/)
)


# Default model + api-key-source per feature, used when AI_<F>_MODEL is unset
# in .env so a fresh checkout still works. Admin can override any of these
# by setting the env var.
#
# Crop disease/treatment default to Gemini 2.5 Flash — fast (~3-5s vs Haiku's
# 30-60s) and cheap, now that Gemini billing is active. To fall back to Claude,
# set AI_CROP_DIAGNOSE_MODEL=claude-haiku-4-5-20251001 (+ AI_CROP_DIAGNOSE_API_KEY).
# Text features default to Groq Llama 3.3 70B — fast, free, preferred for chat.
_DEFAULTS: dict[str, tuple[str, str]] = {
    # feature             (default model id,                default api key constant)
    "TEXT_CHAT":          ("llama-3.3-70b-versatile",       GROQ_API_KEY),
    # Agentic chat stages default to Gemini 2.5 Flash — fast AND with far higher
    # free-tier limits than Groq (which 429s under the pipeline's 3 calls/message).
    # Each is independently swappable via AI_CHAT_<STAGE>_MODEL.
    "CHAT_WRITER":        ("gemini-2.5-flash",              GEMINI_API_KEY),
    "CHAT_ENHANCER":      ("gemini-2.5-flash",              GEMINI_API_KEY),
    "CHAT_VISION":        ("gemini-2.5-flash",              GEMINI_API_KEY),
    # Soil Health Card OCR — Gemini 2.5 Flash reads printed/tabular cards well.
    "SOIL_OCR":           ("gemini-2.5-flash",              GEMINI_API_KEY),
    "CROP_DIAGNOSE":      ("gemini-2.5-flash",              GEMINI_API_KEY),
    "CROP_TREATMENT":     ("gemini-2.5-flash",              GEMINI_API_KEY),
    "ALERT":              ("llama-3.3-70b-versatile",       GROQ_API_KEY),
    "PEST":               ("llama-3.3-70b-versatile",       GROQ_API_KEY),
    "VOICE_STT":          ("whisper-large-v3-turbo",        GROQ_API_KEY),
}


# Known model-prefix → openai-compatible base URL. Order doesn't matter; we
# check prefix containment, not list order.
_PREFIX_TO_BASE_URL: dict[str, str] = {
    "gpt-":         "https://api.openai.com/v1",
    "o1-":          "https://api.openai.com/v1",
    "o3-":          "https://api.openai.com/v1",
    "llama-":       "https://api.groq.com/openai/v1",
    "mixtral-":     "https://api.groq.com/openai/v1",
    "whisper-":     "https://api.groq.com/openai/v1",   # for STT (backend uses this)
    "deepseek-":    "https://api.deepseek.com/v1",
    "grok-":        "https://api.x.ai/v1",
}


# ── Data model ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FeatureConfig:
    feature:  str          # e.g. "TEXT_CHAT"
    model:    str          # e.g. "llama-3.3-70b-versatile"
    api_key:  str
    base_url: Optional[str]  # set when admin wants an explicit endpoint

    @property
    def provider(self) -> str:
        return _detect_provider(self.model, self.base_url)


class ConfigError(RuntimeError):
    """Raised when AI_<F>_MODEL points at an unknown provider with no base_url."""


# ── Provider detection ───────────────────────────────────────────────────────

def _detect_provider(model: str, base_url: Optional[str]) -> str:
    """Return one of: 'anthropic', 'gemini', 'openai_compatible'.

    base_url, when set, ALWAYS wins — admin escape hatch for custom URLs,
    private hosting, OpenRouter, etc. Otherwise we sniff the model prefix.
    """
    if base_url:
        return "openai_compatible"
    m = (model or "").lower().strip()
    if m.startswith("claude-"):
        return "anthropic"
    if m.startswith("gemini-"):
        return "gemini"
    for prefix in _PREFIX_TO_BASE_URL:
        if m.startswith(prefix):
            return "openai_compatible"
    raise ConfigError(
        f"Cannot auto-detect provider for model {model!r}. "
        f"Set AI_<FEATURE>_BASE_URL to the provider's /v1 endpoint."
    )


def _resolve_base_url(model: str, base_url: Optional[str]) -> str:
    """Pick the actual base URL for an openai_compatible call. Explicit
    base_url from env wins; otherwise look up the prefix table."""
    if base_url:
        return base_url
    m = (model or "").lower().strip()
    for prefix, url in _PREFIX_TO_BASE_URL.items():
        if m.startswith(prefix):
            return url
    raise ConfigError(
        f"No known base URL for model prefix in {model!r}. "
        f"Set AI_<FEATURE>_BASE_URL explicitly."
    )


# ── Config loader ────────────────────────────────────────────────────────────

def get_feature_config(feature: str) -> FeatureConfig:
    """Read AI_<FEATURE>_MODEL / _API_KEY / _BASE_URL from os.environ.

    Falls back to the baked-in default (see _DEFAULTS) for model + api_key
    when the env var is unset. base_url defaults to None and is only set
    when the admin provides AI_<F>_BASE_URL explicitly.
    """
    if feature not in AI_FEATURES:
        raise ValueError(f"Unknown AI feature {feature!r}. Valid: {AI_FEATURES}")

    default_model, default_key = _DEFAULTS[feature]
    model = (os.environ.get(f"AI_{feature}_MODEL") or default_model).strip()
    api_key = (os.environ.get(f"AI_{feature}_API_KEY") or default_key).strip()
    base_url = (os.environ.get(f"AI_{feature}_BASE_URL") or "").strip() or None

    return FeatureConfig(feature=feature, model=model, api_key=api_key, base_url=base_url)


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
    if provider == "anthropic":
        return await _with_retry(lambda: call_claude_text(
            system_prompt, user_prompt, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "gemini":
        return await _with_retry(lambda: call_gemini_text(
            system_prompt, user_prompt, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "openai_compatible":
        return await _with_retry(lambda: call_openai_compatible_text(
            system_prompt, user_prompt,
            base_url=_resolve_base_url(cfg.model, cfg.base_url),
            api_key=cfg.api_key, model=cfg.model,
            max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    raise ConfigError(f"Unrouted provider {provider!r} for feature {cfg.feature}")


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
        return await _with_retry(lambda: call_claude_vision(
            system_prompt, user_prompt, images_b64, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "gemini":
        return await _with_retry(lambda: call_gemini_vision(
            system_prompt, user_prompt, images_b64, cfg.api_key,
            model=cfg.model, max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    if provider == "openai_compatible":
        return await _with_retry(lambda: call_openai_compatible_vision(
            system_prompt, user_prompt, images_b64,
            base_url=_resolve_base_url(cfg.model, cfg.base_url),
            api_key=cfg.api_key, model=cfg.model,
            max_tokens=max_tokens, temperature=temperature,
        ), label=label)
    raise ConfigError(f"Unrouted provider {provider!r} for feature {cfg.feature} (vision)")
