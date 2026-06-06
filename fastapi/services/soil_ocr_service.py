"""
Soil Health Card OCR service.

Reads a photographed Indian Soil Health Card (SHC) and extracts the 12 standard
soil parameters into structured JSON for the farmer to REVIEW before saving.

Design notes
  - Reuses the shared vision dispatch (agents/llm_dispatch.call_llm_vision) so the
    model is swappable from .env (AI_SOIL_OCR_MODEL). Default Gemini 2.5 Flash.
  - The 12 output keys EXACTLY match the backend /soil/manual contract
    (backend/src/routes/soil.routes.js) and the frontend PARAM_FIELDS so the
    `fields` object drops straight into the manual form for review.
  - The model is told NEVER to invent values: a parameter that isn't clearly
    printed on the card must come back as null with a note. OCR is advisory only;
    the frontend shows the values as editable pre-fills and never auto-submits.
"""
from __future__ import annotations

import logging

from agents.llm_dispatch import call_llm_vision, get_feature_config
from agents.llm_utils import empty_token_info
from utils.json_extractor import extract_json

logger = logging.getLogger(__name__)

# Canonical parameter keys — must match backend/src/routes/soil.routes.js (line ~131)
# and frontend SoilFormScreen PARAM_FIELDS keys.
_CANONICAL_KEYS = (
    "ph", "nitrogen", "phosphorus", "potassium", "ec",
    "organicCarbon", "zinc", "iron", "manganese", "copper", "boron", "sulphur",
)

# Canonical units the form expects, surfaced to the model so it normalizes.
_UNITS = {
    "ph": "(unitless, 0-14)",
    "nitrogen": "kg/ha (available N)",
    "phosphorus": "kg/ha (available P)",
    "potassium": "kg/ha (available K)",
    "ec": "dS/m",
    "organicCarbon": "% (percent)",
    "zinc": "ppm (mg/kg)",
    "iron": "ppm (mg/kg)",
    "manganese": "ppm (mg/kg)",
    "copper": "ppm (mg/kg)",
    "boron": "ppm (mg/kg)",
    "sulphur": "ppm (mg/kg)",
}

_SYSTEM_PROMPT = (
    "You are an OCR + data-extraction engine for Indian Soil Health Cards (SHC) "
    "issued under the government Soil Health Card / RKVY scheme. You read a photo "
    "of such a card (often a table of soil test results in English or a regional "
    "Indian language) and return ONLY the printed numeric values.\n\n"
    "STRICT RULES:\n"
    "1. Return ONLY values that are clearly printed on the card. If a parameter is "
    "missing, blank, illegible, or you are unsure, set it to null. NEVER guess or "
    "invent a value.\n"
    "2. Output the numeric value only (a number), not the rating words "
    "(Low/Medium/High). If only a rating word is printed with no number, set the "
    "value to null and mention it in notes.\n"
    "3. Normalize each value to the canonical unit listed for that key. If the card "
    "uses a different unit, convert it and note the original unit in `units`.\n"
    "4. Map common card labels to keys: 'OC'/'Organic Carbon'→organicCarbon, "
    "'Available Nitrogen'/'N'→nitrogen, 'P'/'Available Phosphorus'→phosphorus, "
    "'K'/'Available Potassium'→potassium, 'S'→sulphur, 'Zn'→zinc, 'Fe'→iron, "
    "'Mn'→manganese, 'Cu'→copper, 'B'→boron, 'EC'→ec, 'pH'→ph.\n"
    "5. Respond with a SINGLE JSON object and nothing else."
)


def _user_prompt() -> str:
    keys_block = "\n".join(f"  - {k}: {_UNITS[k]}" for k in _CANONICAL_KEYS)
    return (
        "Extract the soil test values from this Soil Health Card photo.\n\n"
        "Canonical keys and the unit each value must be in:\n"
        f"{keys_block}\n\n"
        "Return JSON in EXACTLY this shape (use null for anything not clearly "
        "printed):\n"
        "{\n"
        '  "fields": { "ph": 7.1, "nitrogen": 240, "phosphorus": 18, '
        '"potassium": 300, "ec": 0.3, "organicCarbon": 0.45, "zinc": 0.5, '
        '"iron": 3.8, "manganese": 2.5, "copper": 0.3, "boron": 0.4, '
        '"sulphur": 8 },\n'
        '  "units": { "nitrogen": "kg/ha" },\n'
        '  "confidence": "high" | "medium" | "low",\n'
        '  "notes": "short note on anything blank/converted/uncertain, or empty"\n'
        "}"
    )


def _coerce_fields(raw_fields: dict | None) -> dict:
    """Keep only the 12 canonical keys; coerce to float or null. Reject
    non-numeric / out-of-sanity values to null so the form never pre-fills junk."""
    out: dict[str, float | None] = {k: None for k in _CANONICAL_KEYS}
    if not isinstance(raw_fields, dict):
        return out
    for k in _CANONICAL_KEYS:
        v = raw_fields.get(k)
        if v is None:
            continue
        try:
            num = float(v)
        except (TypeError, ValueError):
            continue
        if num != num or num < 0:  # NaN or negative → reject
            continue
        if k == "ph" and not (0 < num <= 14):  # pH sanity
            continue
        out[k] = num
    return out


async def extract_soil_card(image: dict) -> dict:
    """
    image: {"data": <base64>, "mime_type": <str>}

    Returns:
      {
        "fields": { <12 canonical keys> -> number|null },
        "units":  { <key> -> original unit string },
        "confidence": "high"|"medium"|"low",
        "notes": <str>,
        "token_info": { ... },
      }
    """
    images_b64 = [{
        "data": image["data"],
        "mime_type": (image.get("mime_type") or "image/jpeg"),
    }]

    cfg = get_feature_config("SOIL_OCR")
    raw, tok = await call_llm_vision(
        cfg, _SYSTEM_PROMPT, _user_prompt(), images_b64,
        max_tokens=1024, temperature=0.0,
    )

    parsed = extract_json(raw) or {}
    fields = _coerce_fields(parsed.get("fields"))
    found = sum(1 for v in fields.values() if v is not None)

    confidence = parsed.get("confidence")
    if confidence not in ("high", "medium", "low"):
        confidence = "high" if found >= 8 else "medium" if found >= 4 else "low"

    notes = parsed.get("notes")
    if not isinstance(notes, str):
        notes = ""
    if found == 0:
        notes = (notes + " No values could be read — please enter them manually.").strip()

    units = parsed.get("units") if isinstance(parsed.get("units"), dict) else {}

    logger.info("[SoilOCR] extracted %d/12 fields (confidence=%s)", found, confidence)

    return {
        "fields": fields,
        "units": units,
        "confidence": confidence,
        "notes": notes,
        "fieldsFound": found,
        "token_info": tok or empty_token_info(cfg.model),
    }
