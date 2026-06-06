"""
data/disease_lexicon.py — curated English→Indic disease-name lexicon.

WHY: machine-translating a disease NAME can produce a wrong or unrecognizable
term for the local dealer who fills the prescription (the same reason we keep
chemical/brand names in English). So instead of MT, we look the disease term up
in this VETTED lexicon and fall back to the English name when there is no
curated entry — never a machine guess.

⚠️ EXPAND + VERIFY WITH AN AGRONOMIST/LANGUAGE EXPERT before treating coverage
as complete. Keys are canonical English common names (lowercased on lookup).
Languages use Sarvam/ISO codes: hi, mr, te, ta, kn, bn, gu, pa.
This is a STARTER set — unlisted (disease, lang) pairs fall back to English.
"""
from __future__ import annotations

# canonical english (lower) → { lang: localized name }
_LEXICON: dict[str, dict[str, str]] = {
    "healthy":          {"hi": "स्वस्थ", "mr": "निरोगी"},
    "powdery mildew":   {"hi": "चूर्णिल आसिता (भुरी)", "mr": "भुरी रोग"},
    "downy mildew":     {"hi": "मृदुरोमिल आसिता (केवड़ा)", "mr": "केवडा रोग"},
    "rust":             {"hi": "रतुआ", "mr": "तांबेरा"},
    "leaf spot":        {"hi": "पर्ण चित्ती", "mr": "पानावरील ठिपके"},
    "wilt":             {"hi": "उकठा (म्लानि)", "mr": "मर रोग"},
    "blight":           {"hi": "झुलसा", "mr": "करपा"},
    "anthracnose":      {"hi": "एंथ्राक्नोज", "mr": "करपा (अँथ्रॅकनोज)"},
}


def local_disease_name(disease: str | None, lang: str | None) -> str | None:
    """Return the curated localized disease name for `lang`, or None when there
    is no vetted entry (caller should fall back to the English term — never MT)."""
    if not disease or not lang:
        return None
    return _LEXICON.get(disease.strip().lower(), {}).get(lang.strip().lower())
