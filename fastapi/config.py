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

# ── Anthropic (Claude) ────────────────────────────────────────────────────────
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")

# ── Groq (primary chat LLM — fast + cheap) ────────────────────────────────────
GROQ_API_KEY: str = os.environ.get("GROQ_API_KEY", "")

# ── Google Gemini (chat fallback + vision) ────────────────────────────────────
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")

# ── Sarvam (Indic translation for report enrichment) ─────────────────────────
SARVAM_API_KEY: str = os.environ.get("SARVAM_API_KEY", "")

# ── Agent model assignments ───────────────────────────────────────────────────
# NOTE: The active routing for the disease-detection pipeline now lives in
# agents/registry.py (STAGE_TIER_CHAINS) — driven by the farmer-facing
# "Fast vs Best" toggle. The constants below are kept ONLY for non-pipeline
# call sites (e.g. ad-hoc scripts) and should not be referenced from the
# scan/diagnose/treatment path.
MODEL_IMAGE_QUALITY  = "claude-sonnet-4-6"          # vision capable
MODEL_WEATHER        = "claude-haiku-4-5-20251001"   # fast + cheap
MODEL_DIAGNOSIS      = "claude-sonnet-4-6"           # highest accuracy
MODEL_TREATMENT      = "claude-sonnet-4-6"           # balanced
MODEL_REPORT         = "claude-haiku-4-5-20251001"   # speed > reasoning

# ── Pipeline tier ─────────────────────────────────────────────────────────────
# Default tier when the client does not send `params.tier`. Operators can flip
# the production default to "best" without a code change.
# Valid values: "fast" | "best".
PIPELINE_DEFAULT_TIER: str = os.environ.get("PIPELINE_DEFAULT_TIER", "fast").strip().lower()
# Hard cap: if a request asks for "best" but ops want to block premium spend,
# set ALLOW_BEST_TIER=false to coerce every request to "fast" server-side.
ALLOW_BEST_TIER: bool = os.environ.get("ALLOW_BEST_TIER", "true").strip().lower() != "false"

# ── Chat / alert model assignments ───────────────────────────────────────────
MODEL_GROQ_CHAT   = os.environ.get("GROQ_CHAT_MODEL",   "llama-3.3-70b-versatile")
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
# Soft kill-switch — set ENABLE_ENSEMBLE=false to keep every scan single-model
# (useful during a quota incident or when measuring cheap-only baseline).
ENABLE_ENSEMBLE: bool     = os.environ.get("ENABLE_ENSEMBLE", "true").strip().lower() != "false"
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
