"""
PII Redaction — CropGuard

Installs a logging.Filter that scrubs known-PII fragments from BOTH the
free-text `msg` and any structured `extra` fields before the record
reaches the formatter. The goal is to make logs safe to ship to an
external aggregator (Loki/Datadog/Railway) without leaking:

  • GPS coordinates (lat, lon)
  • Long farmer descriptions (symptom_description, names)
  • Phone numbers (Indian + generic)
  • Email addresses

The filter is intentionally conservative: it masks rather than drops, so
operators can still see "a GPS was here" without seeing the value.
"""
from __future__ import annotations

import logging
import os
import re

# Toggle via env in case ops need raw logs for debugging.
PII_REDACTION_ENABLED = (
    os.environ.get("PII_REDACTION_ENABLED", "true").strip().lower() != "false"
)

# ── Patterns ────────────────────────────────────────────────────────────────
# Each regex is anchored to typical formatting so we don't over-mask.

# "lat=19.07, lon=72.87" or "GPS: 19.07°N, 72.87°E"
_RE_LATLON = re.compile(
    r"((?:lat(?:itude)?|gps)\s*[:=]\s*)(-?\d{1,3}\.\d{2,8})"
    r"(\s*[,°]?\s*(?:N|S)?\s*(?:,|;|\s)\s*"
    r"(?:lo?n(?:gitude)?\s*[:=]\s*)?)(-?\d{1,3}\.\d{2,8})",
    re.IGNORECASE,
)
# Generic "decimal,decimal" coordinate fallback (after the labelled one)
_RE_BARE_LATLON = re.compile(
    r"(?<![\d.])(-?[1-8]?\d\.\d{4,8})\s*,\s*(-?1?\d{1,2}\.\d{4,8})(?![\d.])"
)

# Indian phone numbers (10 digits with optional +91 / 91 / 0 prefix)
_RE_PHONE_IN = re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)")
# Generic E.164-ish phone
_RE_PHONE = re.compile(r"(?<!\d)\+\d{1,3}[-\s]?\d{4,12}(?!\d)")

# Emails
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

# ── Indian financial / identity identifiers (PII-16) ─────────────────────────
# Aadhaar — 12 digits, usually grouped 4-4-4. Require the grouped/long form and a
# non-digit boundary so we don't mask ordinary 12-digit sequences like job ids.
_RE_AADHAAR = re.compile(r"(?<!\d)(?:\d{4}[-\s]\d{4}[-\s]\d{4})(?!\d)")
# PAN — 5 letters, 4 digits, 1 letter (e.g. AAAPA5055K).
_RE_PAN = re.compile(r"(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])")
# GSTIN — 2-digit state + 10-char PAN + entity/checksum (15 chars total).
_RE_GST = re.compile(r"(?<![A-Z0-9])\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9](?![A-Z0-9])")
# IFSC — 4 letters + '0' + 6 alphanumerics (e.g. HDFC0000123).
_RE_IFSC = re.compile(r"(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])")

# Long free-text fields the orchestrator logs ("symptom_description": "...")
# — mask everything past 8 chars to keep the field name visible.
_RE_SYMPTOM = re.compile(
    r"((?:symptom_description|farmer_description|narrative)\s*[:=]\s*)([\"'])([^\"']{8,})([\"'])",
    re.IGNORECASE,
)

# Keys whose VALUES we should always mask when emitted via `extra=`.
_SENSITIVE_KEYS = {
    "symptom_description", "farmer_description", "narrative",
    "lat", "lon", "latitude", "longitude", "field_latitude", "field_longitude",
    "phone", "email", "user_phone", "user_email",
    "aadhaar", "aadhar", "pan", "pan_number", "gst", "gstin", "gst_number",
    "ifsc", "bank_ifsc", "account_number", "bank_account",
}


def _scrub_text(s: str) -> str:
    if not isinstance(s, str) or not s:
        return s
    s = _RE_LATLON.sub(r"\1<lat>\3<lon>", s)
    s = _RE_BARE_LATLON.sub("<lat>,<lon>", s)
    s = _RE_PHONE_IN.sub("<phone>", s)
    s = _RE_PHONE.sub("<phone>", s)
    s = _RE_EMAIL.sub("<email>", s)
    # Indian identifiers — GST before PAN since a GSTIN embeds a PAN substring.
    s = _RE_GST.sub("<gstin>", s)
    s = _RE_IFSC.sub("<ifsc>", s)
    s = _RE_PAN.sub("<pan>", s)
    s = _RE_AADHAAR.sub("<aadhaar>", s)
    s = _RE_SYMPTOM.sub(r"\1\2<redacted>\4", s)
    return s


def _scrub_value(v):
    if isinstance(v, str):
        return _scrub_text(v)
    return v


class PIIFilter(logging.Filter):
    """Mutates LogRecord in place. Filter must return True to keep the record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not PII_REDACTION_ENABLED:
            return True
        # 1. Free-text message — handle both pre- and post-% formatting
        if isinstance(record.msg, str):
            record.msg = _scrub_text(record.msg)
        # If args are present and stringy, scrub them too (they get %-joined).
        if record.args:
            if isinstance(record.args, tuple):
                record.args = tuple(_scrub_value(a) for a in record.args)
            elif isinstance(record.args, dict):
                record.args = {k: _scrub_value(v) for k, v in record.args.items()}
        # 2. Structured extras stored on the record (the JsonFormatter dumps
        #    them). Mask any value whose key matches the sensitive set.
        for k in list(record.__dict__.keys()):
            if k in _SENSITIVE_KEYS:
                record.__dict__[k] = "<redacted>"
        return True


def install() -> None:
    """Idempotently attach the PIIFilter to every root-logger HANDLER.

    Filters attached to a *logger* only run on records emitted at that
    logger — they do NOT see records propagated up from child loggers
    (per the stdlib docs). Attaching the filter to each handler ensures
    every record being formatted/written passes through redaction,
    regardless of which logger originated it.
    """
    root = logging.getLogger()
    for h in root.handlers:
        if not any(isinstance(f, PIIFilter) for f in h.filters):
            h.addFilter(PIIFilter())
