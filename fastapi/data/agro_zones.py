"""
data/agro_zones.py — India's 15 agro-climatic zones, district/state mapping.

Why this exists
  Indian ICAR package-of-practices recommendations vary by agro-climatic
  zone (the same disease in cotton has different timing/dosage advice in
  the Trans-Gangetic Plains vs the Southern Plateau). The RAG knowledge
  base keys treatment guidance on (disease, crop, zone) — this module is
  the resolver from a farmer's state/district to that zone.

Coverage
  v1 seeds the mapping at the STATE level — every district in the state
  inherits the state's zone. A handful of high-volume districts get
  explicit overrides where they cross zone boundaries (e.g. western
  Maharashtra vs Vidarbha). Extend `_DISTRICT_OVERRIDES` as accuracy
  matters more.

Reference
  Planning Commission (1989), reaffirmed by NITI Aayog (2018). Names
  match what most ICAR/IIHR documents use.
"""
from __future__ import annotations


# ── The 15 zones (canonical names — used as the RAG key) ─────────────────────
ZONES = (
    "Western Himalayan",
    "Eastern Himalayan",
    "Lower Gangetic Plains",
    "Middle Gangetic Plains",
    "Upper Gangetic Plains",
    "Trans Gangetic Plains",
    "Eastern Plateau and Hills",
    "Central Plateau and Hills",
    "Western Plateau and Hills",
    "Southern Plateau and Hills",
    "East Coast Plains and Hills",
    "West Coast Plains and Hills",
    "Gujarat Plains and Hills",
    "Western Dry Region",
    "Island Region",
)


# Default mapping at the state level. States that span multiple zones get
# a "primary" mapping here; override the divergent districts in
# _DISTRICT_OVERRIDES below.
_STATE_TO_ZONE: dict[str, str] = {
    "jammu and kashmir":         "Western Himalayan",
    "ladakh":                    "Western Himalayan",
    "himachal pradesh":          "Western Himalayan",
    "uttarakhand":                "Western Himalayan",
    "arunachal pradesh":         "Eastern Himalayan",
    "sikkim":                    "Eastern Himalayan",
    "assam":                     "Eastern Himalayan",
    "meghalaya":                 "Eastern Himalayan",
    "manipur":                   "Eastern Himalayan",
    "mizoram":                   "Eastern Himalayan",
    "nagaland":                  "Eastern Himalayan",
    "tripura":                   "Eastern Himalayan",
    "west bengal":               "Lower Gangetic Plains",
    "bihar":                     "Middle Gangetic Plains",
    "jharkhand":                 "Eastern Plateau and Hills",
    "uttar pradesh":             "Upper Gangetic Plains",
    "punjab":                    "Trans Gangetic Plains",
    "haryana":                   "Trans Gangetic Plains",
    "delhi":                     "Trans Gangetic Plains",
    "chandigarh":                "Trans Gangetic Plains",
    "odisha":                    "Eastern Plateau and Hills",
    "chhattisgarh":              "Eastern Plateau and Hills",
    "madhya pradesh":            "Central Plateau and Hills",
    "rajasthan":                 "Western Dry Region",
    "maharashtra":               "Western Plateau and Hills",
    "karnataka":                 "Southern Plateau and Hills",
    "telangana":                 "Southern Plateau and Hills",
    "andhra pradesh":            "East Coast Plains and Hills",
    "tamil nadu":                "East Coast Plains and Hills",
    "puducherry":                "East Coast Plains and Hills",
    "kerala":                    "West Coast Plains and Hills",
    "goa":                       "West Coast Plains and Hills",
    "gujarat":                   "Gujarat Plains and Hills",
    "dadra and nagar haveli":    "Gujarat Plains and Hills",
    "daman and diu":             "Gujarat Plains and Hills",
    "andaman and nicobar islands": "Island Region",
    "lakshadweep":               "Island Region",
}


# District-level overrides for cases where the state's primary zone is
# misleading. Keyed by lowercased district name; values are the actual
# zone. Add entries as accuracy demands.
_DISTRICT_OVERRIDES: dict[str, str] = {
    # Maharashtra — Vidarbha sits in Central Plateau, Konkan in West Coast.
    "amravati":   "Central Plateau and Hills",
    "akola":      "Central Plateau and Hills",
    "buldhana":   "Central Plateau and Hills",
    "wardha":     "Central Plateau and Hills",
    "nagpur":     "Central Plateau and Hills",
    "yavatmal":   "Central Plateau and Hills",
    "chandrapur": "Central Plateau and Hills",
    "gadchiroli": "Central Plateau and Hills",
    "ratnagiri":  "West Coast Plains and Hills",
    "sindhudurg": "West Coast Plains and Hills",
    "raigad":     "West Coast Plains and Hills",
    # Madhya Pradesh — Malwa is Central Plateau but the eastern part bleeds
    # into Eastern Plateau.
    "balaghat":   "Eastern Plateau and Hills",
    # Andhra Pradesh — Rayalaseema is Southern Plateau, not coastal.
    "anantapur":  "Southern Plateau and Hills",
    "kurnool":    "Southern Plateau and Hills",
    "kadapa":     "Southern Plateau and Hills",
    "chittoor":   "Southern Plateau and Hills",
}


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def zone_for(state: str | None, district: str | None = None) -> str:
    """
    Resolve a farmer's location to an agro-climatic zone.

    Order:
      1. District-level override (rare but important — Vidarbha, Konkan,
         Rayalaseema).
      2. State-level default.
      3. Fall back to "Central Plateau and Hills" — a generic interior zone
         that has reasonably wide treatment coverage. Better than empty
         string for the RAG key lookup.
    """
    d = _norm(district)
    if d and d in _DISTRICT_OVERRIDES:
        return _DISTRICT_OVERRIDES[d]
    s = _norm(state)
    if s in _STATE_TO_ZONE:
        return _STATE_TO_ZONE[s]
    return "Central Plateau and Hills"
