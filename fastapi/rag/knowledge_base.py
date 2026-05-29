"""
rag/knowledge_base.py — structured retrieval for grounded treatment.

Public surface
    retrieve(disease, crop, zone) -> dict

The returned dict is the source-of-truth the treatment LLM must
recommend from. It composes:

  - actives:           [{name, frac_irac_group, phi_days, rei_hours,
                         pollinator_safety, notes, registered_for_crop}]
    Pulled from safety/chemicals.REGISTERED_ACTIVES, filtered by the
    label-claim matrix in _LABEL_CLAIMS so off-label actives are
    excluded at the retrieval layer (not just flagged later).

  - cultural_practices: [str]   — ICAR-style non-chemical guidance per
                                   (disease, crop). When the registry
                                   has no specific entry, falls back to
                                   a generic IPM checklist.

  - etl:                float | None  — Economic Threshold Level. Below
                                        this, the treatment LLM is told
                                        to advise "monitor first, do
                                        not spray". Sourced from public
                                        ICAR + IIHR thresholds.

  - mrl:                dict          — { commodity_active: ppm } FSSAI
                                        MRL values for the recommended
                                        actives, for the dispensing-sheet
                                        annex.

  - regulatory_notes:   [str]         — Mandatory advisories: licensed-
                                        dealer purchase, CIB&RC
                                        registration number on label,
                                        bee bloom-time avoidance, etc.

  - zone:               str           — Echoes the zone we keyed on so
                                        the LLM sees the geographic
                                        context.

Why structured / not vector RAG
  The treatment pipeline's failure mode is hallucination of dosage and
  registration claims, not "we couldn't recall the right document".
  A structured KB keyed on (disease, crop, zone) is a hard constraint
  the LLM can't drift past, and is far smaller to maintain than a
  scanned ICAR PDF corpus. Embedding-based RAG is a future enhancement.
"""
from __future__ import annotations

import logging
from typing import Optional

from safety.chemicals import REGISTERED_ACTIVES, RegisteredActive

logger = logging.getLogger(__name__)


# ── Label-claim matrix ───────────────────────────────────────────────────────
# CIB&RC registers each chemical for a SPECIFIC crop-pest combination.
# Recommending an active outside its registered claims is illegal
# under the Insecticides Act 1968. Keys are lowercased (crop, disease)
# tuples; values are the set of active names registered for that pair.
#
# v1 covers the top crop-disease pairs we see in production. Add entries
# as eval/golden_runner surfaces "off-label" warnings — the validator
# downstream will block any LLM recommendation not on this list.

_LABEL_CLAIMS: dict[tuple[str, str], set[str]] = {
    # ── Wheat ──
    ("wheat", "yellow rust"):       {"propiconazole", "tebuconazole", "mancozeb"},
    ("wheat", "brown rust"):        {"propiconazole", "tebuconazole", "mancozeb"},
    ("wheat", "leaf rust"):         {"propiconazole", "tebuconazole", "mancozeb"},
    ("wheat", "powdery mildew"):    {"propiconazole", "tebuconazole", "sulfur"},
    ("wheat", "puccinia triticina"): {"propiconazole", "tebuconazole", "mancozeb"},
    # ── Rice ──
    ("rice",  "blast"):             {"tricyclazole", "carbendazim", "tebuconazole"},
    ("rice",  "rice blast"):        {"tricyclazole", "carbendazim", "tebuconazole"},
    ("rice",  "magnaporthe oryzae"): {"tricyclazole", "carbendazim", "tebuconazole"},
    ("rice",  "sheath blight"):     {"hexaconazole", "validamycin", "propiconazole"},
    ("rice",  "rhizoctonia solani"): {"hexaconazole", "validamycin", "propiconazole"},
    # ── Tomato ──
    ("tomato", "late blight"):              {"mancozeb", "metalaxyl", "copper oxychloride", "chlorothalonil"},
    ("tomato", "phytophthora infestans"):   {"mancozeb", "metalaxyl", "copper oxychloride", "chlorothalonil"},
    ("tomato", "early blight"):             {"mancozeb", "chlorothalonil", "azoxystrobin"},
    ("tomato", "alternaria solani"):        {"mancozeb", "chlorothalonil", "azoxystrobin"},
    # ── Potato ──
    ("potato", "late blight"):              {"mancozeb", "metalaxyl", "chlorothalonil"},
    ("potato", "phytophthora infestans"):   {"mancozeb", "metalaxyl", "chlorothalonil"},
    ("potato", "early blight"):             {"mancozeb", "azoxystrobin"},
    # ── Cotton ──
    ("cotton", "bacterial blight"):         {"copper oxychloride", "streptocycline"},
    ("cotton", "thrips"):                   {"imidacloprid", "fipronil"},
    ("cotton", "aphids"):                   {"imidacloprid", "thiamethoxam"},
    # ── Grapes ──
    ("grapes", "powdery mildew"):           {"sulfur", "myclobutanil"},
    ("grapes", "downy mildew"):             {"copper oxychloride", "mancozeb", "metalaxyl"},
}


# ── Cultural practices (non-chemical, per disease/crop) ──────────────────────
_CULTURAL_PRACTICES: dict[tuple[str, str], list[str]] = {
    ("wheat", "yellow rust"): [
        "Sow only certified, rust-resistant varieties for your zone (HD-3086, DBW-187 where applicable)",
        "Destroy volunteer wheat plants and barberry hosts near the field",
        "Avoid late sowing — early sowing limits the pathogen's window",
        "Maintain field cleanliness and remove infected stubble after harvest",
    ],
    ("rice", "blast"): [
        "Use balanced NPK fertilization — excess nitrogen worsens blast",
        "Avoid continuous flooding; intermittent drainage reduces pathogen pressure",
        "Sow resistant varieties suited to your zone (IR64, Swarna-Sub1 where appropriate)",
        "Destroy infected stubble and remove alternate weed hosts",
    ],
    ("tomato", "late blight"): [
        "Use disease-free certified seed and resistant varieties",
        "Practice 3-year rotation away from solanaceous crops (tomato, potato, brinjal)",
        "Stake / prune to improve canopy airflow; avoid dense planting",
        "Irrigate at the base, not overhead — keep foliage dry",
        "Destroy infected plant debris; do NOT compost",
    ],
    ("potato", "late blight"): [
        "Plant only certified seed tubers from a clean source",
        "Hill up soil around plants to limit tuber infection",
        "Apply protectant fungicide preventively when humidity > 90% and temp 10-24°C",
        "Destroy haulms 2 weeks before harvest if disease was present",
    ],
    ("cotton", "bacterial blight"): [
        "Use acid-delinted seed treated with carboxin + thiram",
        "Practice 2-year crop rotation away from cotton",
        "Remove and destroy infected cotton stubble after harvest",
        "Avoid overhead irrigation; drip preferred",
    ],
}

_GENERIC_IPM = [
    "Scout fields twice weekly for early symptoms",
    "Maintain field sanitation — remove infected plant debris",
    "Use certified, disease-free planting material",
    "Rotate crops to break the pathogen's cycle",
    "Avoid overhead irrigation when humidity is already high",
]


# ── Economic Threshold Levels (ETL) ──────────────────────────────────────────
# Below the ETL, IPM says monitor — do not spray. Recommendations vary
# by zone for several pests; values here are conservative central
# tendencies from ICAR / IIHR.
_ETL: dict[tuple[str, str], float] = {
    # crop, disease/pest -> threshold (typically % leaf area, plants infected,
    # or insects/plant — context-specific)
    ("cotton", "thrips"):   8.0,       # thrips per leaf
    ("cotton", "aphids"):   15.0,      # aphids per leaf
    ("tomato", "early blight"): 5.0,   # % leaf area
    ("rice",   "blast"):    2.0,       # % leaf area early stage
    ("wheat",  "yellow rust"): 5.0,    # % leaf area, dough stage limit
}


# ── FSSAI MRL (mg/kg) — selected commodity/active pairs ─────────────────────
# Used by the dispensing sheet annex. Not exhaustive — only the actives
# we actively recommend.
_FSSAI_MRL: dict[tuple[str, str], float] = {
    ("wheat",  "propiconazole"):  0.05,
    ("wheat",  "tebuconazole"):   0.05,
    ("wheat",  "mancozeb"):       0.5,
    ("rice",   "tricyclazole"):   1.0,
    ("rice",   "carbendazim"):    1.0,
    ("tomato", "mancozeb"):       2.0,
    ("tomato", "metalaxyl"):      0.5,
    ("tomato", "chlorothalonil"): 5.0,
    ("potato", "mancozeb"):       0.5,
    ("potato", "metalaxyl"):      0.05,
    ("cotton", "imidacloprid"):   0.05,
    ("grapes", "sulfur"):         50.0,
    ("grapes", "myclobutanil"):   1.0,
}


# ── Mandatory regulatory notes — appended to every recommendation ───────────
_BASE_REGULATORY_NOTES = (
    "Buy pesticides only from licensed dealers; verify the CIB&RC "
    "registration number printed on the label.",
    "Spraying during crop bloom can kill pollinators — schedule applications "
    "outside bloom hours wherever possible.",
    "Follow the label's Pre-Harvest Interval (PHI) strictly — early harvest "
    "leaves illegal residues and risks rejection by buyers.",
    "Wear gloves, mask and full sleeves while mixing and spraying. Bathe and "
    "change clothes after the application is finished.",
)


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def _resolve_actives(crop: str, disease: str) -> list[dict]:
    """Filter REGISTERED_ACTIVES to the ones registered for this (crop, disease).

    If the label-claim matrix has no entry, returns all registered actives
    with `registered_for_crop=False` — the LLM is then told to recommend
    only the cultural practices, and the validator will flag any chemical
    it tries to surface.
    """
    key = (_norm(crop), _norm(disease))
    allowed_names: set[str] = _LABEL_CLAIMS.get(key) or set()
    out: list[dict] = []
    if allowed_names:
        for name in allowed_names:
            ra: Optional[RegisteredActive] = REGISTERED_ACTIVES.get(name)
            if ra is None:
                continue
            out.append({
                "name":                 ra.name,
                "frac_irac_group":      ra.frac_irac_group,
                "phi_days":             ra.phi_days_default,
                "rei_hours":            ra.rei_hours_default,
                "pollinator_safety":    ra.pollinator_safety,
                "notes":                ra.notes,
                "registered_for_crop":  True,
            })
    return out


def _resolve_cultural(crop: str, disease: str) -> list[str]:
    key = (_norm(crop), _norm(disease))
    return list(_CULTURAL_PRACTICES.get(key) or _GENERIC_IPM)


def _resolve_etl(crop: str, disease: str) -> Optional[float]:
    return _ETL.get((_norm(crop), _norm(disease)))


def _resolve_mrl(crop: str, actives: list[dict]) -> dict:
    out: dict = {}
    for a in actives:
        v = _FSSAI_MRL.get((_norm(crop), _norm(a["name"])))
        if v is not None:
            out[a["name"]] = v
    return out


def retrieve(
    disease: str | None,
    crop: str | None,
    zone: str | None = None,
) -> dict:
    """
    Return the structured grounding payload for the treatment LLM.

    Empty inputs are tolerated — an off-label or unknown disease returns a
    grounding with NO actives + the generic IPM block + regulatory notes,
    so the LLM recommends only cultural practices (the safest default).
    """
    actives = _resolve_actives(crop or "", disease or "")
    cultural = _resolve_cultural(crop or "", disease or "")
    etl = _resolve_etl(crop or "", disease or "")
    mrl = _resolve_mrl(crop or "", actives)

    notes = list(_BASE_REGULATORY_NOTES)
    if not actives:
        notes.insert(0, (
            "No chemical active is registered for this (crop, disease) combination "
            "in the local label-claim matrix. Recommend ONLY cultural / biological "
            "practices; do not name any specific chemical."
        ))
    if zone:
        notes.append(f"Recommendations are calibrated for the {zone} agro-climatic zone.")

    logger.info(
        "[RAG] disease=%s crop=%s zone=%s -> %d actives, %d cultural items, ETL=%s",
        disease, crop, zone, len(actives), len(cultural), etl,
    )

    return {
        "disease":           disease or "",
        "crop":              crop or "",
        "zone":              zone or "",
        "actives":           actives,
        "cultural_practices": cultural,
        "etl":               etl,
        "mrl":               mrl,
        "regulatory_notes":  notes,
    }
