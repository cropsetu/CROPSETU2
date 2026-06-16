"""
Configuration — CropGuard Agentic AI (FastAPI service)
Reads from .env in this directory or the project root.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Try loading .env from this folder first, then fall back to project root
_here = Path(__file__).parent
load_dotenv(_here / ".env", override=False)
load_dotenv(_here.parent / ".env", override=False)

# ── Google Gemini (sole LLM provider) ─────────────────────────────────────────
# CropSetu runs Gemini-only in production. Groq + Anthropic were removed during
# the production consolidation — Gemini serves every LLM feature (chat, alerts,
# diagnosis, treatment, soil OCR, pest). Voice STT/TTS is handled by Sarvam in
# the Express backend.
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")

# ── Groq (cross-provider chat fallback — optional) ────────────────────────────
# CropSetu is Gemini-first, but the text-chat features fall back to Groq's free
# Llama tier when the Gemini path (primary + Flash↔Pro capacity fallback) is
# fully down — so the farmer still gets a reply instead of "Chat unavailable".
# Groq has capacity separate from Google, so it survives a Gemini-side outage or
# quota exhaustion. Leave GROQ_API_KEY blank to disable the fallback entirely
# (chat then fails hard on a Gemini outage, as the Gemini-only design intended).
# Wiring lives in agents/llm_dispatch.call_llm_text; text-only (Groq Llama can't
# do vision, so the vision/diagnose paths never reach it).
GROQ_API_KEY: str = os.environ.get("GROQ_API_KEY", "")
GROQ_FALLBACK_MODEL: str = os.environ.get("GROQ_FALLBACK_MODEL", "llama-3.3-70b-versatile")

# ── OpenAI (crop-diagnosis ensemble voter — optional) ─────────────────────────
# OpenAI is NOT a primary provider. It joins the crop-disease diagnosis ENSEMBLE
# as one extra vision voter alongside Gemini Pro + Flash, so the reconciler fuses
# a cross-vendor opinion on uncertain scans. It only participates when
# OPENAI_API_KEY is set (resolve_chain skips catalog entries with no key) AND the
# ensemble fires at all (ENABLE_ENSEMBLE=true + a low-confidence/ambiguous scan).
# With no key the pipeline stays Gemini-only, unchanged.
OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
OPENAI_DIAGNOSE_MODEL: str = os.environ.get("OPENAI_DIAGNOSE_MODEL", "gpt-4o")

# ── Anthropic (Claude) — multi-provider model routing (WI-11) ────────────────
# Optional; blank disables Claude as a selectable provider. Used when
# AI_<FEATURE>_MODEL is a 'claude-*' id (or the admin AppSetting ai.model.*
# selects one and Express forwards it per request).
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")

# ── Sarvam (Indic translation + voice STT/TTS) ───────────────────────────────
SARVAM_API_KEY: str = os.environ.get("SARVAM_API_KEY", "")

# ── Agent model assignments ───────────────────────────────────────────────────
# NOTE: The active routing for the disease-detection pipeline now lives in
# agents/registry.py (STAGE_TIER_CHAINS) — driven by the farmer-facing
# "Fast vs Best" toggle. The constants below are kept ONLY for non-pipeline
# call sites (e.g. ad-hoc scripts) and should not be referenced from the
# scan/diagnose/treatment path.
MODEL_IMAGE_QUALITY  = "gemini-2.5-pro"      # vision capable, highest accuracy
MODEL_WEATHER        = "gemini-2.5-flash"    # fast + cheap
MODEL_DIAGNOSIS      = "gemini-2.5-pro"      # highest accuracy
MODEL_TREATMENT      = "gemini-2.5-flash"    # balanced
MODEL_REPORT         = "gemini-2.5-flash"    # speed > reasoning

# ── Pipeline tier ─────────────────────────────────────────────────────────────
# Default tier when the client does not send `params.tier`. Operators can flip
# the production default to "best" without a code change.
# Valid values: "fast" | "best".
PIPELINE_DEFAULT_TIER: str = os.environ.get("PIPELINE_DEFAULT_TIER", "fast").strip().lower()
# Hard cap: if a request asks for "best" but ops want to block premium spend,
# set ALLOW_BEST_TIER=false to coerce every request to "fast" server-side.
ALLOW_BEST_TIER: bool = os.environ.get("ALLOW_BEST_TIER", "true").strip().lower() != "false"

# ── Chat / alert model assignment ────────────────────────────────────────────
MODEL_GEMINI_CHAT = os.environ.get("GEMINI_CHAT_MODEL",  "gemini-2.5-flash")

# ── Quality / confidence thresholds ──────────────────────────────────────────
IMAGE_QUALITY_THRESHOLD   = 0.6
IMAGE_UNUSABLE_THRESHOLD  = 0.4
# When true, the quality gate hard-rejects below IMAGE_UNUSABLE_THRESHOLD, treats
# IMAGE_UNUSABLE..IMAGE_QUALITY as "marginal" (proceed + flag), and drops the
# circular enhancement_notes pass-through. Off by default — flip on after
# validating the rescan-rate on the golden set.
STRICT_IMAGE_GATE = os.environ.get("STRICT_IMAGE_GATE", "false").lower() == "true"
DIAGNOSIS_CONF_THRESHOLD  = 0.7
DIAGNOSIS_ESCALATE_BELOW  = 0.5     # "advise farmer to consult expert" threshold
TREATMENT_REL_THRESHOLD   = 0.8

# Cascade-into-ensemble: when the cheap diagnose call returns confidence
# below this value (OR the primary-vs-top-differential delta is too tight),
# the orchestrator fans out to the parallel ensemble (Gemini Pro + Claude
# Sonnet) and reconciles. Set higher → more scans escalate (more accuracy,
# more cost + latency); set lower → ensemble only for the truly hard cases.
# Tune against the eval/golden_runner.py top-1 metric.
ENSEMBLE_ESCALATE_BELOW   = float(os.environ.get("ENSEMBLE_ESCALATE_BELOW", "0.80"))
# Soft kill-switch. Default OFF (matches .env.example — the previous code default
# of "true" silently enabled the 2-4x-cost ensemble fan-out on any deploy that
# omitted the var). Ensemble fans out to Pro+Flash concurrently on uncertain
# scans → 2-4x the 503/throttle exposure too, not worth it on a capacity-
# constrained key. Set ENABLE_ENSEMBLE=true to opt back in.
ENABLE_ENSEMBLE: bool     = os.environ.get("ENABLE_ENSEMBLE", "false").strip().lower() != "false"
# AISVC-5: skip the (2-4x cost) ensemble fan-out when the user's remaining daily
# budget is below this USD reserve, so a near-cap user can't trigger a runaway
# multi-model overrun in a single request. The cheap-pass result still stands.
ENSEMBLE_MIN_BUDGET_USD: float = float(os.environ.get("ENSEMBLE_MIN_BUDGET_USD", "0.05"))
# Ambiguity gate: when |primary_conf - top_differential_prob| < this AND the
# differential's own probability > 0.25, treat the result as ambiguous and
# escalate regardless of absolute confidence. Matches the spec's §6.2.
ENSEMBLE_AMBIGUOUS_DELTA  = float(os.environ.get("ENSEMBLE_AMBIGUOUS_DELTA", "0.10"))

# ── Retry limits ──────────────────────────────────────────────────────────────
MAX_IMAGE_RETRIES     = 3
MAX_DIAGNOSIS_RETRIES = 3

# ── AgriPredict ───────────────────────────────────────────────────────────────
DATA_GOV_API_KEY: str = os.environ.get("DATA_GOV_API_KEY", "")
DATABASE_URL:     str = os.environ.get("DATABASE_URL", "")

# ── Rate limiting ─────────────────────────────────────────────────────────────
# SlowAPI defaults to per-process in-memory counters, so in a multi-instance
# deployment each instance keeps its own bucket and the effective limit is N× too
# loose. Point the limiter at Redis so the sliding window is SHARED across the
# fleet — the limit is then actually enforced in production at scale. Defaults to
# REDIS_URL when set (prod), else empty → in-memory (dev/test, unchanged).
RATE_LIMIT_STORAGE_URI: str = (
    os.environ.get("RATE_LIMIT_STORAGE_URI")
    or os.environ.get("REDIS_URL", "")
).strip()

# ── Service ───────────────────────────────────────────────────────────────────
API_HOST = os.environ.get("CROPGUARD_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("CROPGUARD_PORT", "8001"))
