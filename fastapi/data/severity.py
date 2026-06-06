"""
data/severity.py — single canonical severity enum + normalizer.

The diagnosis prompt emits {None, Mild, Moderate, Severe}. Historically the
reconciler, treatment bucketer, report urgency badge, and eval each used their
own spellings ("High", "Critical", "medium"…), so a "High"-vs-"Severe" pair read
as a mismatch. Everything now maps through here.
"""
from __future__ import annotations

SEVERITY_LEVELS: tuple[str, ...] = ("None", "Mild", "Moderate", "Severe")

_ALIASES: dict[str, str] = {
    "none": "None", "healthy": "None", "nil": "None", "no": "None", "absent": "None",
    "mild": "Mild", "low": "Mild", "slight": "Mild", "minor": "Mild", "early": "Mild",
    "moderate": "Moderate", "medium": "Moderate", "mid": "Moderate",
    "severe": "Severe", "high": "Severe", "critical": "Severe",
    "advanced": "Severe", "extensive": "Severe", "very high": "Severe",
}


def normalize_severity(raw: str | None) -> str:
    """Map any severity spelling to a canonical SEVERITY_LEVELS value.
    Unknown/empty → 'Moderate' (conservative default — never under-states)."""
    return _ALIASES.get((raw or "").strip().lower(), "Moderate")


def severity_rank(raw: str | None) -> int:
    """Ordinal rank in SEVERITY_LEVELS (None=0 … Severe=3)."""
    return SEVERITY_LEVELS.index(normalize_severity(raw))
