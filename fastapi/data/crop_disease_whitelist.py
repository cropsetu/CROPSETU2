"""
data/crop_disease_whitelist.py — per-crop candidate-disease whitelist.

Why this exists
  The diagnose model used to work in an OPEN label space: given only the
  crop name (not its diseases), it would emit out-of-crop labels (wheat →
  "Wheat Streak Mosaic"), invent disease on healthy leaves, or return a
  pathogen binomial where a common name was expected ("Alternaria solani"
  instead of "Early Blight"). top-3 was high (the right disease was usually
  in the shortlist) but top-1 was poor (mis-ranked / mis-named).

  Narrowing the candidate set per crop converts that open space into a
  closed ballot: "for Corn, choose from {Common Rust, Northern Leaf Blight,
  Gray Leaf Spot, ..., Healthy}". Two consumers use it:
    1. agents/disease_diagnosis_agent._build_context — injects the list into
       the prompt so the model picks from it.
    2. agents/disease_diagnosis_agent._normalise — snap_to_candidate() maps a
       prediction back to its canonical common name (kills the pathogen-vs-
       common-name mismatch deterministically, even if the model slips).

Design (per approved plan)
  - Covers the major app-supported crops (services.input_normalizer.VALID_CROPS).
    Crops with NO entry return None from candidates_for() → callers fall back
    to OPEN VOCABULARY (no narrowing, no false rejection). Uncovered crops
    never break.
  - SOFT enforcement: snap_to_candidate() only returns a name on a canonical
    MATCH (never nearest-neighbour). A non-match returns None so the caller
    keeps the model's label and applies a soft penalty instead of hard-forcing
    out-of-distribution — this protects against an incomplete whitelist.
  - Disease names are canonical COMMON names (Title Case). "Healthy" is on
    every covered crop's ballot.

Reuse (no reinvention)
  - canonicalize / same_disease  ← data.disease_synonyms (synonym → canonical)
  - normalize_crop_name          ← services.input_normalizer ("corn"→"Maize")
  - _DEFAULT_LABELS              ← models.local_classifier (38 PlantVillage labels)
  - _LABEL_CLAIMS                ← rag.knowledge_base (registered crop,disease pairs)

How to extend
  Add the crop (canonical VALID_CROPS spelling) to _CURATED with its common
  disease names. The merge step folds in any extra diseases the PlantVillage
  labels / label-claims registry know about, de-duplicated by canonical name.
"""
from __future__ import annotations

import re

from data.disease_synonyms import canonicalize, same_disease, _norm
from services.input_normalizer import normalize_crop_name

# Optional reuse sources. Imported defensively so a refactor in either module
# never breaks the whitelist (it just falls back to the curated lists).
try:
    from models.local_classifier import _DEFAULT_LABELS as _PV_LABELS  # type: ignore
except Exception:  # pragma: no cover - defensive
    _PV_LABELS = []
try:
    from rag.knowledge_base import _LABEL_CLAIMS as _KB_CLAIMS  # type: ignore
except Exception:  # pragma: no cover - defensive
    _KB_CLAIMS = {}


HEALTHY = "Healthy"

# Bump when the catalog / candidate lists change — stamped into
# report.meta.versions for reproducibility (see orchestrator).
WHITELIST_VERSION = "1"


# ── Per-crop disease lists ────────────────────────────────────────────────────
# The curated dataset lives in data/crop_disease_catalog.py (data-vs-logic
# split — ~70 crops). It is the seed for _build_whitelist(); "Healthy" is
# appended automatically per crop, so the catalog never lists it.
from data.crop_disease_catalog import CATALOG as _CURATED


def _canon_crop(crop_raw: str | None) -> str:
    """Map any crop input to the canonical whitelist key. SINGLE source of truth:
    delegates entirely to services.input_normalizer.normalize_crop_name (which
    owns the alias map), so the two crop-alias maps can no longer drift."""
    if not crop_raw:
        return ""
    return normalize_crop_name(str(crop_raw).strip())


def _is_generic_canonical(c: str) -> bool:
    """True for coarse canonical 'bucket' names ('Leaf spot (unspecified)',
    'Cercospora spp.', 'Rust (unspecified)') that are too broad to safely dedup
    two distinct diseases against."""
    cl = (c or "").lower()
    return "unspecified" in cl or cl.endswith("spp.")


def _add(diseases: list[str], name: str, crop: str | None = None) -> None:
    """Append `name` for enrichment sources unless a SPECIFIC duplicate exists.

    Dedup on exact normalized match OR same canonical disease — but NOT when the
    shared canonical is a generic bucket (else distinct diseases that merely share
    a generic token, e.g. grape 'Leaf Blight' vs 'Bacterial Leaf Spot', wrongly
    collapse). Curated entries are seeded verbatim and are never deduped against
    each other — this runs only for PlantVillage/KB enrichment.
    """
    name = (name or "").strip()
    if not name or name.lower() == "healthy":
        return
    for existing in diseases:
        if _norm(name) == _norm(existing):
            return
        if same_disease(name, existing, crop=crop) and not _is_generic_canonical(canonicalize(name, crop)):
            return
    diseases.append(name)


def _build_whitelist() -> dict[str, list[str]]:
    """Curated lists, enriched (canonical-deduped) from PlantVillage + KB sources."""
    out: dict[str, list[str]] = {crop: list(ds) for crop, ds in _CURATED.items()}

    # Enrich from PlantVillage labels ("Corn - Common rust"). Compound labels
    # like "Cercospora leaf spot / Gray leaf spot" → take the last segment.
    for label in _PV_LABELS:
        if " - " not in label:
            continue
        crop_part, disease_part = label.split(" - ", 1)
        crop = _canon_crop(crop_part)
        disease = disease_part.split("/")[-1].strip()
        # Drop parenthetical qualifiers ("Esca (Black Measles)" → "Esca",
        # "Leaf blight (Isariopsis Leaf Spot)" → "Leaf blight") so PlantVillage
        # labels dedup cleanly against the curated common names.
        disease = re.sub(r"\s*\([^)]*\)", "", disease).strip()
        if disease.lower() == "healthy":
            out.setdefault(crop, [])
            continue
        if crop:
            out.setdefault(crop, [])
            _add(out[crop], disease.title() if disease.islower() else disease, crop=crop)

    # Enrich from the registered (crop, disease) label-claims registry. Skip
    # scientific-binomial keys that canonical-match a common name already on
    # the ballot (e.g. "puccinia triticina" == curated "Brown Rust").
    for (crop_raw, disease_raw) in _KB_CLAIMS:
        crop = _canon_crop(crop_raw)
        if crop in out:  # only enrich crops we already curate
            _add(out[crop], disease_raw.title(), crop=crop)

    # "Healthy" on every covered crop's ballot.
    for crop in out:
        if HEALTHY not in out[crop]:
            out[crop].append(HEALTHY)
    return out


CROP_DISEASES: dict[str, list[str]] = _build_whitelist()


# ── Public API ────────────────────────────────────────────────────────────────

def candidates_for(crop_raw: str | None) -> list[str] | None:
    """
    Return the candidate disease list (common names incl. "Healthy") for a crop,
    or None if the crop is not covered → caller should use OPEN VOCABULARY.
    """
    crop = _canon_crop(crop_raw)
    if crop in CROP_DISEASES:
        return list(CROP_DISEASES[crop])
    return None


def snap_to_candidate(crop_raw: str | None, predicted_name: str | None) -> str | None:
    """
    Map a predicted disease to the crop's canonical common name IFF it
    canonically matches a candidate (match-only, never nearest-neighbour).
    Returns None when the crop is uncovered OR no candidate matches — the
    caller then keeps the model's label (soft enforcement).
    """
    cands = candidates_for(crop_raw)
    if not cands or not predicted_name:
        return None
    for c in cands:
        if _norm(predicted_name) == _norm(c) or same_disease(predicted_name, c, crop=crop_raw):
            return c
    return None


def is_covered(crop_raw: str | None) -> bool:
    """True if the crop has a curated candidate list."""
    return _canon_crop(crop_raw) in CROP_DISEASES
