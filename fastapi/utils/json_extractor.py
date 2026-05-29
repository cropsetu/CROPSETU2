"""
JSON Extractor — CropGuard

Extracts valid JSON from LLM responses that may contain markdown fences,
preamble text, or other non-JSON content.
"""
from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)


def extract_json(raw: str) -> dict | None:
    """
    Extract and parse JSON from a raw LLM response string.

    Handles:
    - Pure JSON responses
    - JSON wrapped in ```json ... ``` markdown fences
    - JSON embedded in surrounding text
    - JSON with trailing commas (common LLM error)

    Returns parsed dict or None if extraction fails.
    """
    if not raw or not raw.strip():
        return None

    text = raw.strip()

    # 1. Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Try extracting from markdown code fences.
    # Match from the FIRST ```json (or ```) to the LAST ``` — the
    # non-greedy variant terminates at the first inner ``` if the JSON
    # contains a markdown snippet itself.
    greedy_fence = re.search(r"```(?:json)?\s*\n?(.*)```", text, re.DOTALL)
    if greedy_fence:
        try:
            return json.loads(greedy_fence.group(1).strip())
        except json.JSONDecodeError:
            pass
    # Fall back to non-greedy for the simple case
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 3. Try finding the outermost { ... } block
    first_brace = text.find("{")
    if first_brace >= 0:
        # Find matching closing brace
        depth = 0
        last_brace = -1
        in_string = False
        escape = False

        for i in range(first_brace, len(text)):
            c = text[i]
            if escape:
                escape = False
                continue
            if c == "\\":
                escape = True
                continue
            if c == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    last_brace = i
                    break

        if last_brace > first_brace:
            json_str = text[first_brace : last_brace + 1]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                # Try fixing trailing commas
                fixed = re.sub(r",\s*([}\]])", r"\1", json_str)
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

    # Surface a slice of the actual response so debugging doesn't require
    # re-running the request. First 200 + last 200 chars almost always
    # reveals whether the LLM truncated, added prose, used a different
    # fence, or returned a refusal.
    head = text[:200].replace("\n", "\\n")
    tail = text[-200:].replace("\n", "\\n")
    logger.warning(
        "Failed to extract JSON from LLM response (length=%d) — head=%r tail=%r",
        len(text), head, tail,
    )
    return None
