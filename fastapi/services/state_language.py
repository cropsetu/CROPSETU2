"""
Indian state → primary language mapping.

Ported from frontend/src/i18n/stateMappings.js. The two files must stay in
sync — future cleanup should move this to a JSON file consumed by both
the FastAPI service and the React Native app.
"""
from __future__ import annotations

# State name → ISO 639-1 language code.
# Names are stored exactly as they appear in user profiles (matches the
# frontend onboarding state picker).
STATE_TO_LANG: dict[str, str] = {
    # Hindi belt
    "Uttar Pradesh":        "hi",
    "Bihar":                "hi",
    "Rajasthan":            "hi",
    "Haryana":              "hi",
    "Himachal Pradesh":     "hi",
    "Uttarakhand":          "hi",
    "Delhi":                "hi",
    "Jammu & Kashmir":      "hi",
    "Ladakh":               "hi",
    "Madhya Pradesh":       "hi",
    "Chhattisgarh":         "hi",
    "Jharkhand":            "hi",
    # West
    "Maharashtra":          "mr",
    "Goa":                  "mr",
    "Gujarat":              "gu",
    "Dadra & Nagar Haveli": "gu",
    "Daman & Diu":          "gu",
    # North-west
    "Punjab":               "pa",
    "Chandigarh":           "pa",
    # South
    "Tamil Nadu":           "ta",
    "Karnataka":            "kn",
    "Kerala":               "ml",
    "Andhra Pradesh":       "te",
    "Telangana":            "te",
    "Puducherry":           "ta",
    "Lakshadweep":          "ml",
    # East
    "West Bengal":          "bn",
    "Odisha":               "or",
    "Assam":                "as",
    "Tripura":              "bn",
    # North-east + Islands — no dedicated language, default to English
    "Manipur":              "en",
    "Meghalaya":            "en",
    "Nagaland":             "en",
    "Mizoram":              "en",
    "Arunachal Pradesh":    "en",
    "Sikkim":               "en",
    "Andaman & Nicobar":    "en",
}

# Native display name for each language code — used as a section header
# on the rendered report ("Native summary — मराठी").
LANG_NAMES: dict[str, str] = {
    "en": "English",
    "hi": "हिन्दी",
    "mr": "मराठी",
    "ta": "தமிழ்",
    "te": "తెలుగు",
    "kn": "ಕನ್ನಡ",
    "ml": "മലയാളം",
    "bn": "বাংলা",
    "gu": "ગુજરાતી",
    "pa": "ਪੰਜਾਬੀ",
    "or": "ଓଡ଼ିଆ",
    "as": "অসমীয়া",
}

# Case-insensitive lookup table built once at import time.
_NORMALIZED: dict[str, str] = {k.lower(): v for k, v in STATE_TO_LANG.items()}


def lang_for_state(state: str | None, fallback: str = "en") -> str:
    """Resolve a state name to its primary language code.

    Case-insensitive; tolerates leading/trailing whitespace. Returns the
    `fallback` when state is missing or unknown.
    """
    if not state:
        return fallback
    return _NORMALIZED.get(state.strip().lower(), fallback)


def lang_display_name(lang: str) -> str:
    """Return the native display name for a language code (e.g. 'mr' → 'मराठी')."""
    return LANG_NAMES.get(lang, lang)
