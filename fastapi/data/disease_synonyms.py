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

    # ── Rice ───────────────────────────────────────────────────────────
    "rice blast":           "Magnaporthe oryzae",
    "blast":                "Magnaporthe oryzae",
    "magnaporthe":          "Magnaporthe oryzae",
    "sheath blight":        "Rhizoctonia solani",
    "rhizoctonia":          "Rhizoctonia solani",

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


_PUNCT_RE = re.compile(r"[^\w\s]")


def _norm(name: str) -> str:
    """Light normalisation: lower, strip, collapse whitespace, drop punctuation."""
    s = (name or "").strip().lower()
    s = _PUNCT_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def canonicalize(name: str | None) -> str:
    """
    Return the canonical name for a disease label.

    Lookup order:
      1. exact normalised match
      2. substring match (e.g. "wheat brown rust (Puccinia)" → "brown rust")
      3. fall back to the input string (title-cased) so unmapped names
         still flow through the pipeline; eval reports will show which
         names need adding.
    """
    if not name:
        return ""
    key = _norm(name)
    if key in _SYNONYMS:
        return _SYNONYMS[key]
    # Substring: prefer the LONGEST matching key so "wheat brown rust"
    # picks up "wheat brown rust" before "brown rust".
    matches = [k for k in _SYNONYMS if k in key]
    if matches:
        best = max(matches, key=len)
        return _SYNONYMS[best]
    return name.strip()


def same_disease(a: str | None, b: str | None) -> bool:
    """True iff two labels canonicalize to the same disease."""
    ca = canonicalize(a)
    cb = canonicalize(b)
    if not ca or not cb:
        return False
    return ca.lower() == cb.lower()
