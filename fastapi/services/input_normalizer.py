"""
Input Normalizer — Fuzzy-match and deduplicate farm context fields.

Handles:
  - Typos in crop names ("wheqt" → "Wheat")
  - Duplicate fields (primaryCropName / cropName → crop_name)
  - Soil type and irrigation type normalization
  - Growth stage estimation from crop age
"""
from __future__ import annotations
import logging
from difflib import get_close_matches

logger = logging.getLogger(__name__)


# ── Canonical lookup tables ───────────────────────────────────────────────────

VALID_CROPS = [
    "Wheat", "Rice", "Cotton", "Sugarcane", "Soybean", "Maize",
    "Tomato", "Onion", "Potato", "Chilli", "Gram", "Tur", "Lentil",
    "Jowar", "Bajra", "Groundnut", "Sunflower", "Mustard", "Garlic",
    "Ginger", "Turmeric", "Brinjal", "Cauliflower", "Cabbage", "Spinach",
    "Okra", "Cucumber", "Pumpkin", "Watermelon", "Mango", "Banana",
    "Papaya", "Pomegranate", "Grapes", "Orange", "Lemon", "Guava",
    "Peas", "Beans", "Capsicum", "Carrot", "Radish", "Beetroot",
    # ── Extended coverage — millets, oilseeds, pulses, plantation/spice,
    #    and minor fruits/vegetables the app's crop picker exposes. ──
    "Ragi", "Barley", "Sesame", "Castor", "Jute", "Tea", "Coffee",
    "Coconut", "Arecanut", "Cardamom", "Black Pepper", "Cumin",
    "Coriander", "Fennel", "Fenugreek", "Ajwain", "Sweet Potato",
    "Tapioca", "Bitter Gourd", "Bottle Gourd", "Muskmelon", "Sapota",
    "Litchi", "Pineapple", "Apple", "Moong", "Urad",
]

# Regional / synonym crop names → canonical VALID_CROPS spelling. Consulted
# (exact, lowercased) BEFORE fuzzy matching, so common real-world inputs that
# fuzzy-matching would miss or mis-map resolve deterministically. Extend freely.
_CROP_ALIASES: dict[str, str] = {
    "corn": "Maize", "makka": "Maize", "makai": "Maize",
    "grape": "Grapes",
    "paddy": "Rice", "dhan": "Rice",
    "bhindi": "Okra", "bhendi": "Okra", "ladyfinger": "Okra",
    "lady finger": "Okra", "lady's finger": "Okra",
    "eggplant": "Brinjal", "aubergine": "Brinjal", "baingan": "Brinjal", "vangi": "Brinjal",
    "bell pepper": "Capsicum", "pepper": "Capsicum", "shimla mirch": "Capsicum",
    "arhar": "Tur", "tur dal": "Tur", "pigeon pea": "Tur", "red gram": "Tur", "toor": "Tur",
    "soyabean": "Soybean", "soya bean": "Soybean", "soya": "Soybean",
    "finger millet": "Ragi", "nachni": "Ragi", "mandua": "Ragi",
    "pearl millet": "Bajra",
    "sorghum": "Jowar",
    "peanut": "Groundnut", "moongphali": "Groundnut",
    "cassava": "Tapioca",
    "green gram": "Moong", "moong dal": "Moong", "mung": "Moong",
    "black gram": "Urad", "urad dal": "Urad",
    "bengal gram": "Gram", "chickpea": "Gram", "chana": "Gram",
    "masoor": "Lentil", "masur": "Lentil", "red lentil": "Lentil",
    "bitter gourd": "Bitter Gourd", "bittergourd": "Bitter Gourd", "karela": "Bitter Gourd",
    "bottle gourd": "Bottle Gourd", "bottlegourd": "Bottle Gourd", "lauki": "Bottle Gourd",
    "muskmelon": "Muskmelon", "kharbuja": "Muskmelon",
    "sweet potato": "Sweet Potato", "shakarkand": "Sweet Potato",
    "black pepper": "Black Pepper", "kali mirch": "Black Pepper",
    "sapota": "Sapota", "chikoo": "Sapota", "chiku": "Sapota",
    "litchi": "Litchi", "lychee": "Litchi",
}

VALID_SOILS = [
    "Black", "Red", "Alluvial", "Laterite", "Sandy", "Clay", "Loamy",
]

VALID_IRRIGATION = [
    "Drip", "Sprinkler", "Flood", "Rainfed", "Canal",
]

# Pre-computed sets/dicts for O(1) membership checks (built once at module load)
_CROPS_SET = set(VALID_CROPS)                              # exact match: O(1)
_SOILS_SET = set(VALID_SOILS)
_IRRIGATION_SET = set(VALID_IRRIGATION)
_SOILS_LOWER_MAP = {s.lower(): s for s in VALID_SOILS}     # lowercase → canonical
_IRRIGATION_LOWER_MAP = {i.lower(): i for i in VALID_IRRIGATION}

# ── Growth-stage estimation (generic by age in days) ─────────────────────────
# Crop-specific overrides can be added here.
_STAGE_OVERRIDES: dict[str, list[tuple[int, str]]] = {
    # (age_cutoffs, stage_name) — sorted ascending
    "Sugarcane": [(30, "Germination"), (120, "Tillering"), (270, "Grand Growth"), (360, "Maturity")],
    "Rice":      [(20, "Seedling"),    (60,  "Tillering"), (90,  "Heading"),       (130, "Maturity")],
    "Wheat":     [(20, "Seedling"),    (50,  "Tillering"), (90,  "Flowering"),     (120, "Maturity")],
}
_DEFAULT_STAGES = [(20, "Seedling"), (60, "Vegetative"), (90, "Flowering"), (130, "Fruiting"), (9999, "Maturity")]


def estimate_growth_stage(crop: str, age_days: int | float | str | None) -> str:
    """Derive growth stage from crop type and age in days."""
    if age_days is None:
        return "Vegetative"
    try:
        age = int(float(age_days))
    except (ValueError, TypeError):
        return "Vegetative"

    stages = _STAGE_OVERRIDES.get(crop, _DEFAULT_STAGES)
    for cutoff, label in stages:
        if age <= cutoff:
            return label
    return "Maturity"


# ── Fuzzy normalizers ─────────────────────────────────────────────────────────

def normalize_crop_name(raw: str | None) -> str:
    """Map user input to a canonical crop name.

    Order: (1) exact alias lookup (regional/synonym names — O(1)), (2) exact
    set match, (3) fuzzy match. The alias front-door runs first so common
    real-world inputs ('corn', 'bhindi', 'soyabean') resolve deterministically
    instead of relying on — or being mis-mapped by — fuzzy matching.
    """
    if not raw or not str(raw).strip():
        return ""
    s = str(raw).strip()
    alias = _CROP_ALIASES.get(s.lower())   # O(1) — beats fuzzy, never collides
    if alias:
        return alias
    title = s.title()
    if title in _CROPS_SET:        # O(1) set lookup
        return title
    matches = get_close_matches(title, VALID_CROPS, n=1, cutoff=0.6)
    corrected = matches[0] if matches else title
    if corrected != title:
        logger.info(f"[InputNormalizer] Crop fuzzy-matched: '{s}' → '{corrected}'")
    return corrected


def normalize_soil_type(raw: str | None) -> str:
    """Fuzzy-match soil type. O(1) for exact match via pre-built dict."""
    if not raw:
        return "Alluvial"
    raw = str(raw).strip()
    title = raw.title()
    if title in _SOILS_SET:        # O(1) set lookup
        return title
    lower = raw.lower()
    # O(1) dict lookup for lowercase exact match
    if lower in _SOILS_LOWER_MAP:
        return _SOILS_LOWER_MAP[lower]
    # Substring check (small list, acceptable)
    for soil_lower, soil in _SOILS_LOWER_MAP.items():
        if soil_lower in lower or lower in soil_lower:
            return soil
    matches = get_close_matches(lower, list(_SOILS_LOWER_MAP.keys()), n=1, cutoff=0.6)
    if matches:
        corrected = _SOILS_LOWER_MAP[matches[0]]
        logger.info(f"[InputNormalizer] Soil fuzzy-matched: '{raw}' → '{corrected}'")
        return corrected
    return title or "Alluvial"


def normalize_irrigation(raw: str | None) -> str:
    """Fuzzy-match irrigation type. O(1) for exact match via pre-built dict."""
    if not raw:
        return "Rainfed"
    raw = str(raw).strip()
    title = raw.title()
    if title in _IRRIGATION_SET:   # O(1) set lookup
        return title
    lower = raw.lower()
    # O(1) dict lookup for lowercase exact match
    if lower in _IRRIGATION_LOWER_MAP:
        return _IRRIGATION_LOWER_MAP[lower]
    # Substring check (small list, acceptable)
    for irr_lower, irr in _IRRIGATION_LOWER_MAP.items():
        if irr_lower in lower or lower in irr_lower:
            return irr
    matches = get_close_matches(lower, list(_IRRIGATION_LOWER_MAP.keys()), n=1, cutoff=0.6)
    if matches:
        corrected = _IRRIGATION_LOWER_MAP[matches[0]]
        logger.info(f"[InputNormalizer] Irrigation fuzzy-matched: '{raw}' → '{corrected}'")
        return corrected
    return title or "Rainfed"


# ── Main cleaner ──────────────────────────────────────────────────────────────

def clean_farm_context(ctx: dict) -> dict:
    """
    Normalize and deduplicate farm context fields from Express farmContext.

    Handles:
    - Merges primaryCropName / cropName → single 'cropName'
    - Merges primaryCropAge / cropAge → 'cropAge'
    - Fuzzy-matches crop, soil, irrigation
    - Estimates growthStage from age if missing

    Returns the cleaned dict (same keys, Express camelCase preserved).
    Modifies in-place and returns for convenience.
    """
    # ── Merge duplicate primary* fields ──────────────────────────────────────
    if not ctx.get("cropName") and ctx.get("primaryCropName"):
        ctx["cropName"] = ctx["primaryCropName"]
    if not ctx.get("cropAge") and ctx.get("primaryCropAge"):
        ctx["cropAge"] = ctx["primaryCropAge"]

    # ── Fuzzy-normalize key fields ────────────────────────────────────────────
    crop = normalize_crop_name(ctx.get("cropName", ""))
    if crop and crop != ctx.get("cropName"):
        ctx["cropName"] = crop

    soil = normalize_soil_type(ctx.get("soilType", ""))
    if soil:
        ctx["soilType"] = soil

    irrigation = normalize_irrigation(ctx.get("irrigationType", ""))
    if irrigation:
        ctx["irrigationType"] = irrigation

    prev_crop = normalize_crop_name(ctx.get("previousCrop", ""))
    if prev_crop:
        ctx["previousCrop"] = prev_crop

    # ── Growth stage estimation ───────────────────────────────────────────────
    if not ctx.get("growthStage"):
        age = ctx.get("cropAge") or ctx.get("primaryCropAge")
        ctx["growthStage"] = estimate_growth_stage(crop, age)

    logger.info(
        f"[InputNormalizer] Normalized → crop='{ctx.get('cropName')}' "
        f"soil='{ctx.get('soilType')}' irr='{ctx.get('irrigationType')}' "
        f"stage='{ctx.get('growthStage')}' prevCrop='{ctx.get('previousCrop', '')}'"
    )

    return ctx
