"""
Policy Gates — CropGuard

Pure functions that decide *whether* a stage should produce certain outputs,
based on diagnosis state. Kept separate from the validator so the policy
itself is easy to read, test, and tune.

The bar: if the AI is not confident the disease is correctly identified,
it must not push a chemical recommendation to the farmer. Wrong pesticide
on the wrong disease is the worst farmer-harm outcome we ship.
"""
from __future__ import annotations

from config import DIAGNOSIS_ESCALATE_BELOW

# Minimum confidence to allow chemical recommendations. Cross-verified
# confidence below this falls back to cultural/biological only.
CHEMICAL_RECOMMENDATION_MIN_CONFIDENCE: float = DIAGNOSIS_ESCALATE_BELOW  # 0.50


def allow_chemical_recommendations(diagnosis: dict) -> tuple[bool, str]:
    """
    Return (allow, reason). If allow=False, treatment_agent should NOT
    return chemical_controls — only cultural/biological/preventive measures.
    """
    conf = float(diagnosis.get("confidence_score") or 0)
    if conf < CHEMICAL_RECOMMENDATION_MIN_CONFIDENCE:
        return False, (
            f"Diagnosis confidence {conf:.0%} is below the safety threshold "
            f"({CHEMICAL_RECOMMENDATION_MIN_CONFIDENCE:.0%}) for chemical recommendations"
        )
    if diagnosis.get("is_out_of_distribution"):
        return False, "Image is out-of-distribution (does not appear to be a known crop disease)"
    if diagnosis.get("crop_mismatch"):
        return False, "Image appears to show a different crop than reported — diagnosis cannot be trusted"
    pathogen = (
        (diagnosis.get("primary_diagnosis") or {}).get("pathogen_type")
        or diagnosis.get("pathogen_type")
        or ""
    ).lower()
    if pathogen in ("viral",):
        return False, "Viral diseases have no curative chemical — vector control + rogueing only"
    if pathogen in ("abiotic", "nutrient"):
        return False, "Abiotic / nutrient issue — no pesticide indicated; correct underlying cause"
    return True, ""
