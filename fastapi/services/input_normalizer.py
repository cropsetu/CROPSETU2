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

# Pre-computed set for O(1) crop membership checks (built once at module load)
_CROPS_SET = set(VALID_CROPS)                              # exact match: O(1)

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
