"""
data/disease_synonyms.py — canonical scientific-name map for crop diseases.

Why this is a hard prerequisite for the reconciler
  When the ensemble runs (Gemini Pro + Claude Sonnet + GPT-4o), each model
  can describe the same pathogen with a different label:
    Gemini  → "Brown Rust"
    Claude  → "Wheat Brown Rust"
    GPT-4o  → "Puccinia triticina"
  Without canonicalization the reconciler reads this as three-way
  disagreement and downgrades a correct call to "needs lab". Mapping all
  three to the same scientific name fixes the vote.

How to extend
  - Add an entry whenever a model output uses a name not yet covered.
  - Keys are case-insensitive (looked up via .lower()).
  - The canonical value should be the binomial scientific name where
    available; if the pathogen is poorly described in literature, fall
    back to a stable common name.
  - It is fine for a canonical name to also be a key (identity mapping)
    so model outputs already using the binomial flow through unchanged.

Coverage note
  This is seeded with the diseases the existing safety/chemicals.py
  registry references plus the diseases the weather rule engine knows
  about. Grow it as the golden set surfaces new pairs — eval/golden_runner
  will reveal which scans are losing top-1 to a naming mismatch.
"""
from __future__ import annotations

import re
from functools import lru_cache


# Map: any lowercased synonym -> canonical scientific (or stable common) name.
_SYNONYMS: dict[str, str] = {
    # ── Rusts ────────────────────────────────────────────────────────────
    "brown rust":           "Puccinia triticina",
    "wheat brown rust":     "Puccinia triticina",
    "wheat leaf rust":      "Puccinia triticina",
    "leaf rust":            "Puccinia triticina",
    "puccinia triticina":   "Puccinia triticina",
    "yellow rust":          "Puccinia striiformis",
    "wheat yellow rust":    "Puccinia striiformis",
    "stripe rust":          "Puccinia striiformis",
    "puccinia striiformis": "Puccinia striiformis",
    "black rust":           "Puccinia graminis",
    "stem rust":            "Puccinia graminis",
    "puccinia graminis":    "Puccinia graminis",
    "rust":                 "Rust (unspecified)",

    # ── Blights ─────────────────────────────────────────────────────────
    "late blight":              "Phytophthora infestans",
    "tomato late blight":       "Phytophthora infestans",
    "potato late blight":       "Phytophthora infestans",
    "phytophthora infestans":   "Phytophthora infestans",
    "early blight":             "Alternaria solani",
    "tomato early blight":      "Alternaria solani",
    "potato early blight":      "Alternaria solani",
    "alternaria solani":        "Alternaria solani",
    "alternaria blight":        "Alternaria spp.",
    "bacterial blight":         "Xanthomonas (bacterial blight)",
    "xanthomonas":              "Xanthomonas (bacterial blight)",
    "rice bacterial blight":    "Xanthomonas oryzae",
    "xanthomonas oryzae":       "Xanthomonas oryzae",

    # ── Mildews ─────────────────────────────────────────────────────────
    "powdery mildew":   "Powdery Mildew (Erysiphales)",
    "erysiphe":         "Powdery Mildew (Erysiphales)",
    "erysiphales":      "Powdery Mildew (Erysiphales)",
    "downy mildew":     "Peronosporaceae (downy mildew)",
    "peronospora":      "Peronosporaceae (downy mildew)",

    # ── Wilts / rots ────────────────────────────────────────────────────
    "fusarium wilt":        "Fusarium oxysporum",
    "fusarium":             "Fusarium oxysporum",
    "fusarium oxysporum":   "Fusarium oxysporum",
    "panama disease":       "Fusarium oxysporum f. sp. cubense",
    "verticillium wilt":    "Verticillium dahliae",
    "bacterial wilt":       "Ralstonia solanacearum",
    "ralstonia":            "Ralstonia solanacearum",
    "root rot":             "Root rot (unspecified)",
    "stem rot":             "Stem rot (unspecified)",
    "red rot":              "Colletotrichum falcatum",
    "sugarcane red rot":    "Colletotrichum falcatum",
    # Exact binomial — needed so a bare "Colletotrichum falcatum" canonicalizes
    # to itself instead of the genus key "colletotrichum" → "Colletotrichum spp."
    "colletotrichum falcatum": "Colletotrichum falcatum",

    # ── Spots ──────────────────────────────────────────────────────────
    "cercospora leaf spot": "Cercospora spp.",
    "cercospora":           "Cercospora spp.",
    "leaf spot":            "Leaf spot (unspecified)",
    "septoria leaf spot":   "Septoria lycopersici",
    "anthracnose":          "Colletotrichum spp.",
    "colletotrichum":       "Colletotrichum spp.",

    # ── Mold ───────────────────────────────────────────────────────────
    "gray mold":            "Botrytis cinerea",
    "grey mold":            "Botrytis cinerea",
    "botrytis":             "Botrytis cinerea",
    "botrytis cinerea":     "Botrytis cinerea",

    # ── Maize / corn ───────────────────────────────────────────────────
    "common rust":               "Puccinia sorghi",
    "corn common rust":          "Puccinia sorghi",
    "maize common rust":         "Puccinia sorghi",
    "puccinia sorghi":           "Puccinia sorghi",
    "northern leaf blight":      "Exserohilum turcicum",
    "northern corn leaf blight": "Exserohilum turcicum",
    "turcicum leaf blight":      "Exserohilum turcicum",
    "exserohilum turcicum":      "Exserohilum turcicum",
    "gray leaf spot":            "Cercospora zeae-maydis",
    "grey leaf spot":            "Cercospora zeae-maydis",
    "cercospora zeae-maydis":    "Cercospora zeae-maydis",

    # ── Rice ───────────────────────────────────────────────────────────
    "rice blast":           "Magnaporthe oryzae",
    "blast":                "Magnaporthe oryzae",
    "magnaporthe":          "Magnaporthe oryzae",
    "sheath blight":        "Rhizoctonia solani",
    "rhizoctonia":          "Rhizoctonia solani",

    # ── Newly-covered crops (BOUNDED) — only diseases where a model commonly
    #    emits a binomial; the candidate list's exact common name covers the
    #    rest. Use full/qualified keys to avoid substring hijacking. ──
    "apple scab":                   "Venturia inaequalis",
    "venturia inaequalis":          "Venturia inaequalis",
    "cedar apple rust":             "Gymnosporangium juniperi-virginianae",
    "citrus canker":                "Xanthomonas citri",
    "xanthomonas citri":            "Xanthomonas citri",
    "citrus greening":              "Candidatus Liberibacter",
    "greening":                     "Candidatus Liberibacter",
    "huanglongbing":                "Candidatus Liberibacter",
    "candidatus liberibacter":      "Candidatus Liberibacter",
    "panama wilt":                  "Fusarium oxysporum f. sp. cubense",
    "blister blight":               "Exobasidium vexans",
    "exobasidium vexans":           "Exobasidium vexans",
    "quick wilt":                   "Phytophthora capsici",
    "phytophthora capsici":         "Phytophthora capsici",
    "coconut bud rot":              "Phytophthora palmivora",
    "mungbean yellow mosaic virus": "Mungbean Yellow Mosaic Virus",
    "papaya ring spot virus":       "Papaya ringspot virus",

    # ── Insect / pest categories surfaced as "diseases" by some models ─
    "thrips":               "Thrips (insect pest)",
    "aphids":               "Aphids (insect pest)",
    "thrips / aphids":      "Aphids (insect pest)",
    "whitefly":             "Whitefly (insect pest)",

    # ── Misc / unknown ─────────────────────────────────────────────────
    "healthy":              "Healthy",
    "no disease":           "Healthy",
    "unknown":              "Unknown",
    "uncertain":            "Unknown",
}


# ── Crop-scoped scientific names ──────────────────────────────────────────────
# Disease COMMON names are crop-specific: "Leaf Rust" is Puccinia triticina on
# wheat, Puccinia hordei on barley, Hemileia vastatrix on coffee. A flat map can
# only encode one, so this crop-scoped table WINS when a crop is supplied.
# Keyed by (canonical-crop, _norm(common_name)) → binomial. Seeded with the pairs
# a flat map provably gets wrong; everything else falls back to the flat map / the
# common name. NEEDS agronomist review before treating as complete.
_CROP_SCI: dict[tuple[str, str], str] = {
    # Leaf Rust — crop-specific pathogens (the headline bug)
    ("Wheat",    "leaf rust"):           "Puccinia triticina",
    ("Wheat",    "brown rust"):          "Puccinia triticina",
    ("Barley",   "leaf rust"):           "Puccinia hordei",
    ("Coffee",   "leaf rust"):           "Hemileia vastatrix",
    # White Rust — Albugo (an oomycete, NOT a true rust)
    ("Mustard",  "white rust"):          "Albugo candida",
    ("Radish",   "white rust"):          "Albugo candida",
    ("Spinach",  "white rust"):          "Albugo occidentalis",
    # Tea / Mango "Red Rust" — an alga (Cephaleuros), not a rust
    ("Tea",      "red rust"):            "Cephaleuros parasiticus",
    ("Tea",      "blister blight"):      "Exobasidium vexans",
    ("Mango",    "red rust"):            "Cephaleuros virescens",
    ("Mango",    "bacterial canker"):    "Xanthomonas citri pv. mangiferaeindicae",
    # Citrus Canker variants
    ("Orange",   "citrus canker"):       "Xanthomonas citri",
    ("Lemon",    "citrus canker"):       "Xanthomonas citri",
    # Bacterial leaf spots — must stay distinct from generic/fungal "Leaf Spot"
    ("Chilli",   "bacterial leaf spot"): "Xanthomonas euvesicatoria",
    ("Capsicum", "bacterial leaf spot"): "Xanthomonas euvesicatoria",
    ("Moong",    "bacterial leaf spot"): "Xanthomonas/Pseudomonas (bacterial leaf spot)",
    ("Sesame",   "bacterial leaf spot"): "Xanthomonas/Pseudomonas (bacterial leaf spot)",
    ("Grapes",   "bacterial leaf spot"): "Xanthomonas (bacterial leaf spot)",
}

# Coarse single-token / "(unspecified)" keys that must NEVER substring-match a
# longer input — they erase the distinctions the safety layer keys on
# (White Rust→rust, Bacterial Leaf Spot→leaf spot). EXACT matches to these keys
# are still allowed. Only `rust`, `leaf spot`, `anthracnose` are in _SYNONYMS
# today; the rest future-proof the rule.
STRICT_GENERIC = True
_GENERIC = {
    "rust", "leaf spot", "canker", "blight", "wilt",
    "anthracnose", "mildew", "rot", "mosaic",
}


_PUNCT_RE = re.compile(r"[^\w\s]")


def _norm(name: str) -> str:
    """Light normalisation: lower, strip, collapse whitespace, drop punctuation."""
    s = (name or "").strip().lower()
    s = _PUNCT_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _canon_crop_local(crop: str | None) -> str:
    """Canonical crop spelling for _CROP_SCI lookups. Lazy import avoids a
    circular dependency (crop_disease_whitelist imports this module)."""
    if not crop:
        return ""
    try:
        from services.input_normalizer import normalize_crop_name
        return normalize_crop_name(str(crop))
    except Exception:
        return str(crop).strip().title()


@lru_cache(maxsize=4096)
def canonicalize(name: str | None, crop: str | None = None) -> str:
    """
    Return the canonical name for a disease label.

    Memoized (lru_cache): the reconciler canonicalizes the same disease name
    repeatedly across ensemble members + their differentials, and the maps are
    immutable at runtime, so caching by (name, crop) removes the redundant work.

    Precedence:
      1. crop-scoped scientific table (_CROP_SCI) when `crop` is supplied
         ("Leaf Rust" + Coffee → Hemileia vastatrix, not wheat's Puccinia)
      2. exact normalised match in the flat _SYNONYMS map
      3. substring match (e.g. "wheat brown rust (Puccinia)" → "brown rust"),
         but with STRICT_GENERIC, generic keys ("rust", "leaf spot", …) are
         NOT allowed to substring-hijack a longer input (White Rust→rust)
      4. fall back to the input string so unmapped names flow through; eval
         reports will show which names need adding.
    """
    if not name:
        return ""
    key = _norm(name)
    if crop:
        ccrop = _canon_crop_local(crop)
        if (ccrop, key) in _CROP_SCI:
            return _CROP_SCI[(ccrop, key)]
    if key in _SYNONYMS:
        return _SYNONYMS[key]
    # Substring: prefer the LONGEST matching key so "wheat brown rust" picks up
    # "wheat brown rust" before "brown rust".
    matches = [k for k in _SYNONYMS if k in key]
    if STRICT_GENERIC:
        # A generic key may only match EXACTLY (handled above), never as a
        # substring of a longer, more specific name.
        matches = [k for k in matches if k not in _GENERIC]
    if matches:
        best = max(matches, key=len)
        return _SYNONYMS[best]
    return name.strip()


def same_disease(a: str | None, b: str | None, crop: str | None = None) -> bool:
    """True iff two labels canonicalize to the same disease (crop-scoped when
    `crop` is supplied)."""
    ca = canonicalize(a, crop)
    cb = canonicalize(b, crop)
    if not ca or not cb:
        return False
    return ca.lower() == cb.lower()
