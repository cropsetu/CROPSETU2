"""
security/input_sanitize.py — user free-text hygiene for LLM prompts (AISVC-3).

clean_user_text() — strip control characters, normalise unicode, and CAP
LENGTH so a single field can't be used to inflate token cost or smuggle
terminal/zero-width control sequences into prompts and logs.

This is defence-in-depth: it does not "prove" safety, but it removes the
easy wins (megabyte inputs, hidden control chars, raw concatenation that lets
"ignore previous instructions" sit at the same level as the system prompt).
"""
from __future__ import annotations

import re
import unicodedata

# Strip C0/C1 control chars EXCEPT tab/newline/carriage-return, plus the
# zero-width / bidi-override characters that can hide injected instructions.
_CONTROL_RE = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f"
    r"​-‏‪-‮⁠﻿]"
)

# Sensible per-field cap. Big enough for a detailed symptom description, small
# enough that a field can't balloon the prompt. Override per call where needed.
DEFAULT_MAX_LEN = 2000


def clean_user_text(value, *, max_len: int = DEFAULT_MAX_LEN) -> str:
    """Normalise + de-control + length-cap a single user free-text value.

    Returns '' for None/empty. Non-str inputs are coerced via str().
    """
    if value is None:
        return ""
    s = value if isinstance(value, str) else str(value)
    # Normalise so visually-identical sequences collapse and combining marks
    # don't survive as separate control points.
    s = unicodedata.normalize("NFC", s)
    s = _CONTROL_RE.sub("", s)
    s = s.strip()
    if max_len and len(s) > max_len:
        s = s[:max_len].rstrip()
    return s
