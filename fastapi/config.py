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

# ── Agent model assignments ───────────────────────────────────────────────────
MODEL_IMAGE_QUALITY  = "claude-sonnet-4-6"          # vision capable
MODEL_WEATHER        = "claude-haiku-4-5-20251001"   # fast + cheap
MODEL_DIAGNOSIS      = "claude-sonnet-4-6"           # highest accuracy
MODEL_TREATMENT      = "claude-sonnet-4-6"           # balanced
MODEL_REPORT         = "claude-haiku-4-5-20251001"   # speed > reasoning

# ── Chat / alert model assignments ───────────────────────────────────────────
MODEL_GROQ_CHAT   = os.environ.get("GROQ_CHAT_MODEL",   "llama-3.3-70b-versatile")
MODEL_GEMINI_CHAT = os.environ.get("GEMINI_CHAT_MODEL",  "gemini-2.5-flash")

# ── Quality / confidence thresholds ──────────────────────────────────────────
IMAGE_QUALITY_THRESHOLD   = 0.6
IMAGE_UNUSABLE_THRESHOLD  = 0.4
DIAGNOSIS_CONF_THRESHOLD  = 0.7
DIAGNOSIS_ESCALATE_BELOW  = 0.5
TREATMENT_REL_THRESHOLD   = 0.8

# ── Retry limits ──────────────────────────────────────────────────────────────
MAX_IMAGE_RETRIES     = 3
MAX_DIAGNOSIS_RETRIES = 3

# ── AgriPredict ───────────────────────────────────────────────────────────────
DATA_GOV_API_KEY: str = os.environ.get("DATA_GOV_API_KEY", "")
DATABASE_URL:     str = os.environ.get("DATABASE_URL", "")

# ── Service ───────────────────────────────────────────────────────────────────
API_HOST = os.environ.get("CROPGUARD_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("CROPGUARD_PORT", "8001"))
