"""
Unit tests for safety/validator.py and safety/policy.py.

These cover the post-LLM safety guardrails: removing banned chemicals,
clamping PHI/REI, enforcing the confidence/OOD/crop-mismatch policy
gate, and the organic-state + bee-toxic-during-bloom rules.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from safety.policy import (
    CHEMICAL_RECOMMENDATION_MIN_CONFIDENCE,
    allow_chemical_recommendations,
)
from safety.validator import validate_treatment


def _diag(disease="Early Blight", conf=0.80, pathogen="fungal", **extra):
    """Helper — minimal diagnosis dict."""
    d = {
        "primary_diagnosis": {
            "disease":       disease,
            "scientific_name": "Alternaria solani",
            "confidence":    conf,
            "severity":      "Moderate",
            "pathogen_type": pathogen,
        },
        "confidence_score": conf,
        "pathogen_type":    pathogen,
    }
    d.update(extra)
    return d


# ── policy.allow_chemical_recommendations ───────────────────────────────────

def test_policy_allows_above_threshold():
    ok, _ = allow_chemical_recommendations(_diag(conf=0.85))
    assert ok is True


def test_policy_blocks_below_threshold():
    ok, reason = allow_chemical_recommendations(_diag(conf=0.30))
    assert ok is False
    assert str(int(CHEMICAL_RECOMMENDATION_MIN_CONFIDENCE * 100)) in reason


def test_policy_blocks_out_of_distribution():
    ok, reason = allow_chemical_recommendations(_diag(is_out_of_distribution=True))
    assert ok is False
    assert "out-of-distribution" in reason.lower() or "ood" in reason.lower()


def test_policy_blocks_crop_mismatch():
    ok, reason = allow_chemical_recommendations(_diag(crop_mismatch=True))
    assert ok is False
    assert "crop" in reason.lower()


def test_policy_blocks_viral_diseases():
    ok, reason = allow_chemical_recommendations(_diag(pathogen="viral"))
    assert ok is False
    assert "viral" in reason.lower()


def test_policy_blocks_abiotic():
    ok, _ = allow_chemical_recommendations(_diag(pathogen="abiotic"))
    assert ok is False
    ok2, _ = allow_chemical_recommendations(_diag(pathogen="nutrient"))
    assert ok2 is False


# ── validator: banned chemicals get stripped ────────────────────────────────

def test_validator_strips_banned():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L", "phi_days": 3},
            {"product": "Monocrotophos 36 SL", "active_ingredient": "Monocrotophos",
             "dosage": "1.5 ml/L", "phi_days": 14},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(treatment, diagnosis=_diag(), params={})
    kept = [c["product"] for c in result.sanitized_treatment["chemical_controls"]]
    assert "Mancozeb 75% WP" in kept
    assert not any("Monocrotophos" in p for p in kept)
    # Blocker recorded
    assert any(b["code"] == "banned_chemical" for b in result.blockers)


def test_validator_flags_unknown_active_as_warning():
    treatment = {
        "chemical_controls": [
            {"product": "MysteryShield 50 EC", "active_ingredient": "unknown-x",
             "dosage": "1 g/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(treatment, diagnosis=_diag(), params={})
    # Unknown is kept but flagged as warning (not blocked)
    kept = [c["product"] for c in result.sanitized_treatment["chemical_controls"]]
    assert "MysteryShield 50 EC" in kept
    assert any(w["code"] == "unverified_active" for w in result.warnings)


def test_validator_clamps_phi_to_registry_baseline():
    # LLM emits phi_days=0 for Mancozeb; registry says 3 — must be clamped UP
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L", "phi_days": 0},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(treatment, diagnosis=_diag(), params={})
    kept = result.sanitized_treatment["chemical_controls"][0]
    assert kept["phi_days"] == 3   # registry baseline


def test_validator_clamps_rei_when_low():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L", "phi_days": 5, "rei_hours": 4},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(treatment, diagnosis=_diag(), params={})
    kept = result.sanitized_treatment["chemical_controls"][0]
    assert kept["rei_hours"] == 24


def test_validator_strips_all_chemicals_when_policy_gate_fails():
    # confidence below threshold → chemicals must NOT be returned
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(treatment, diagnosis=_diag(conf=0.30), params={})
    assert result.sanitized_treatment["chemical_controls"] == []
    assert any(b["code"] == "policy_gate" for b in result.blockers)


def test_validator_organic_state_strips_synthetic_pesticides():
    # Sikkim is fully organic — even safe chemicals must be removed
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(
        treatment, diagnosis=_diag(), params={"state": "Sikkim"},
    )
    assert result.sanitized_treatment["chemical_controls"] == []
    assert any(b["code"] == "organic_state" for b in result.blockers)


def test_validator_blocks_bee_toxic_during_bloom():
    # Imidacloprid in flowering crop must be blocked
    treatment = {
        "chemical_controls": [
            {"product": "Confidor 17.8 SL", "active_ingredient": "Imidacloprid",
             "dosage": "0.5 ml/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(
        treatment, diagnosis=_diag(),
        params={"crop_growth_stage": "flowering"},
    )
    assert result.sanitized_treatment["chemical_controls"] == []
    assert any(b["code"] == "bee_toxic_during_bloom" for b in result.blockers)


def test_validator_allows_bee_toxic_outside_bloom():
    # Same chemical at vegetative stage is fine
    treatment = {
        "chemical_controls": [
            {"product": "Confidor 17.8 SL", "active_ingredient": "Imidacloprid",
             "dosage": "0.5 ml/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(
        treatment, diagnosis=_diag(),
        params={"crop_growth_stage": "vegetative"},
    )
    assert len(result.sanitized_treatment["chemical_controls"]) == 1


def test_validator_state_level_ban_kerala():
    # Kerala bans Imidacloprid — must be stripped even at non-flowering stage
    treatment = {
        "chemical_controls": [
            {"product": "Confidor 17.8 SL", "active_ingredient": "Imidacloprid",
             "dosage": "0.5 ml/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(
        treatment, diagnosis=_diag(),
        params={"crop_growth_stage": "vegetative", "state": "Kerala"},
    )
    assert result.sanitized_treatment["chemical_controls"] == []
    assert any(b["code"] == "banned_chemical" for b in result.blockers)


def test_validator_fills_frac_group_from_registry():
    # LLM omits frac_irac_group → validator fills it from the registry
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(treatment, diagnosis=_diag(), params={})
    kept = result.sanitized_treatment["chemical_controls"][0]
    assert kept["frac_irac_group"] == "FRAC M03"


def test_validator_stamps_safety_meta():
    treatment = {"chemical_controls": [], "medicine_combinations": []}
    result = validate_treatment(treatment, diagnosis=_diag(), params={})
    assert "_safety" in result.sanitized_treatment
    assert result.sanitized_treatment["_safety"]["registry_version"]


def test_validator_keeps_chemicals_when_policy_allows():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "active_ingredient": "Mancozeb",
             "dosage": "2.5 g/L"},
            {"product": "Propiconazole 25 EC", "active_ingredient": "Propiconazole",
             "dosage": "1 ml/L"},
        ],
        "medicine_combinations": [],
    }
    result = validate_treatment(
        treatment, diagnosis=_diag(conf=0.85), params={"crop_growth_stage": "vegetative"},
    )
    assert len(result.sanitized_treatment["chemical_controls"]) == 2
    # No blockers in this happy path
    assert all(b["code"] != "banned_chemical" for b in result.blockers)
