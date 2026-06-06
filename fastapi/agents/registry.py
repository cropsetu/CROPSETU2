"""
Model Registry — CropGuard Agentic AI

Single source of truth for which LLMs the pipeline can use, what each one
can do (vision / json / context), and how the farmer-facing "Fast vs Best"
tier toggle maps to a per-stage fallback chain.

Adding a new model:
  1. Register it in MODEL_CATALOG with provider + capabilities + key env var.
  2. Add a matching pricing row in agents/llm_utils._PRICING.
  3. Reference it from STAGE_TIER_CHAINS (or a *_MODELS env override).

Removing a stale entry:
  - Delete the catalog row. The router silently skips any chain entry that
    points to an unknown or unconfigured model, so removal is safe.
"""
from __future__ import annotations

import os
from typing import Literal

from config import ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY

Provider = Literal["gemini", "groq", "anthropic"]
Stage    = Literal["diagnose", "treatment", "report", "ensemble", "chat", "alert", "pest"]
Tier     = Literal["fast", "best"]


# ── Catalog ──────────────────────────────────────────────────────────────────
# Capabilities:
#   vision    — accepts image inputs
#   json      — emits well-formed JSON reliably (used for treatment + diagnosis)
#   long_ctx  — > 128k context (only relevant for very long reports)
MODEL_CATALOG: dict[str, dict] = {
    "gemini-2.5-flash": {
        "provider":     "gemini",
        "capabilities": {"vision", "json"},
        "api_key":      GEMINI_API_KEY,
        "display":      "Gemini 2.5 Flash",
        "tier_hint":    "fast",
    },
    "gemini-2.5-pro": {
        "provider":     "gemini",
        "capabilities": {"vision", "json", "long_ctx"},
        "api_key":      GEMINI_API_KEY,
        "display":      "Gemini 2.5 Pro",
        "tier_hint":    "best",
    },
    "llama-3.3-70b-versatile": {
        "provider":     "groq",
        "capabilities": {"json"},
        "api_key":      GROQ_API_KEY,
        "display":      "Llama 3.3 70B (Groq)",
        "tier_hint":    "fast",
    },
    "claude-sonnet-4-6": {
        "provider":     "anthropic",
        "capabilities": {"vision", "json", "long_ctx"},
        "api_key":      ANTHROPIC_API_KEY,
        "display":      "Claude Sonnet 4.6",
        "tier_hint":    "best",
    },
    "claude-haiku-4-5-20251001": {
        "provider":     "anthropic",
        # Haiku 4.5 supports vision; the previous "json only" tagging
        # excluded it from diagnose chains. With the new keys' Gemini Pro
        # quota=0 and Sonnet being too slow for our 8K-char system prompt,
        # Haiku is the fast vision fallback we need.
        "capabilities": {"vision", "json"},
        "api_key":      ANTHROPIC_API_KEY,
        "display":      "Claude Haiku 4.5",
        "tier_hint":    "fast",
    },
}


# ── Default tier → stage → fallback chain ────────────────────────────────────
# Each chain is (primary, *fallbacks). The router walks left-to-right on
# 429 / 5xx / timeout / parse-fail. Env vars override any chain (see below).
STAGE_TIER_CHAINS: dict[Stage, dict[Tier, list[str]]] = {
    "diagnose": {
        # NOTE: the production diagnose stage uses FLAT single-model dispatch
        # (AI_CROP_DIAGNOSE_MODEL) with NO cross-model fallback by design — a
        # provider outage returns a clear "service unavailable" rather than a
        # weaker model's guess (silent fallback makes quality impossible to
        # maintain). This chain is retained ONLY as a seed for ensemble member
        # selection (ensemble_agent.select) when the ensemble chain is empty.
        "fast": ["gemini-2.5-flash", "claude-haiku-4-5-20251001"],
        "best": ["gemini-2.5-flash", "claude-haiku-4-5-20251001"],
    },
    "treatment": {
        # Gemini Flash first — same reasoning as the diagnose chain: Flash
        # produces the full structured treatment JSON in 5-10s vs Haiku's
        # 30-60s for the same prompt. Haiku stays as the cross-provider
        # fallback. Once Groq is reauthorised, put llama back at position 0.
        "fast": ["gemini-2.5-flash", "claude-haiku-4-5-20251001"],
        "best": ["gemini-2.5-flash", "claude-haiku-4-5-20251001"],
    },
    # Report is template-only today; chain kept empty so callers can detect
    # "no LLM step" cleanly. Switch to a model id here if you ever want
    # LLM-polished farmer summaries on the Best tier.
    "report": {
        "fast": [],
        "best": [],
    },
    # Ensemble stage: fired by ensemble_agent.run_parallel() when the
    # cascade gate (orchestrator) decides the cheap pass is uncertain.
    # Unlike other stages, the chain is NOT a fallback chain — every
    # entry runs concurrently and votes (see agents/ensemble_agent.py).
    # Tier is ignored for ensemble (always "best").
    #
    # Why Gemini Pro + Claude Sonnet (2 voters, not the spec's 3):
    #   Adding GPT-4o requires an OpenAI provider in services/http_clients.py
    #   + a call_openai_vision() in llm_utils.py + a "openai" branch in
    #   router._call_one_vision. Until that lands, this 2-voter chain (plus
    #   the primary cheap-pass result the orchestrator splices in) gives
    #   the reconciler 3 votes, which is the spec's minimum.
    #
    # TODO: extend MODEL_CATALOG with gpt-4o once the OpenAI provider is wired.
    "ensemble": {
        "fast": ["gemini-2.5-pro", "claude-sonnet-4-6"],
        "best": ["gemini-2.5-pro", "claude-sonnet-4-6"],
    },
    # ── FarmMind chat (text-only Q&A with farm context) ────────────────────
    # Used by services/chat_service.py. Groq Llama is preferred (free tier
    # 30 RPM, fast) with Gemini Flash as fallback and Claude Haiku as the
    # last resort. Best tier swaps to Sonnet for nuanced advisory answers.
    "chat": {
        "fast": ["llama-3.3-70b-versatile", "gemini-2.5-flash", "claude-haiku-4-5-20251001"],
        "best": ["claude-sonnet-4-6", "gemini-2.5-pro", "llama-3.3-70b-versatile"],
    },
    # ── Smart farm alerts (structured JSON list of 4-6 alerts) ─────────────
    # Used by services/alert_service.py. Same providers as chat but tuned
    # for JSON output (lower temperature, smaller max_tokens).
    "alert": {
        "fast": ["llama-3.3-70b-versatile", "gemini-2.5-flash", "claude-haiku-4-5-20251001"],
        "best": ["gemini-2.5-pro", "claude-sonnet-4-6", "llama-3.3-70b-versatile"],
    },
}

# Stage → capability that any chain entry MUST satisfy, else it is skipped.
STAGE_REQUIRED_CAPABILITIES: dict[Stage, set[str]] = {
    "diagnose":  {"vision"},
    "treatment": set(),
    "report":    set(),
    "ensemble":  {"vision"},
    "chat":      set(),    # text-only Q&A
    "alert":     set(),    # JSON list of alerts
    "pest":      set(),    # JSON pest enhancement
}


def _env_override(stage: Stage, tier: Tier) -> list[str] | None:
    """
    Allow ops to override a chain without a code change.

    Example:
      DIAGNOSE_FAST_CHAIN="gemini-2.5-flash,gemini-2.5-pro"
      TREATMENT_BEST_CHAIN="claude-sonnet-4-6,gemini-2.5-pro"
    """
    name = f"{stage.upper()}_{tier.upper()}_CHAIN"
    raw = os.environ.get(name)
    if not raw:
        return None
    return [m.strip() for m in raw.split(",") if m.strip()]


def normalize_tier(value: str | None) -> Tier:
    """
    Map any farmer-facing input to a valid tier.
    "fast", "best", "quality", "premium" all accepted; anything else → "fast".
    """
    v = (value or "").strip().lower()
    if v in ("best", "quality", "premium", "high"):
        return "best"
    return "fast"


def resolve_chain(stage: Stage, tier: Tier) -> list[str]:
    """
    Return the ordered list of model ids the router should try for this
    (stage, tier), filtered to only models that (a) exist in the catalog,
    (b) have an API key set, and (c) satisfy the stage's required capabilities.
    Honours *_CHAIN env overrides.
    """
    chain = _env_override(stage, tier) or STAGE_TIER_CHAINS.get(stage, {}).get(tier, [])
    required = STAGE_REQUIRED_CAPABILITIES.get(stage, set())

    resolved: list[str] = []
    for model_id in chain:
        entry = MODEL_CATALOG.get(model_id)
        if not entry:
            continue
        if not entry.get("api_key"):
            # Key not configured — skip silently so the chain still works
            # in environments missing one provider.
            continue
        if required and not required.issubset(entry["capabilities"]):
            continue
        resolved.append(model_id)
    return resolved


def provider_of(model_id: str) -> Provider | None:
    entry = MODEL_CATALOG.get(model_id)
    return entry["provider"] if entry else None


def display_name(model_id: str) -> str:
    entry = MODEL_CATALOG.get(model_id)
    return entry["display"] if entry else model_id
