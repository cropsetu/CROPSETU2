"""Crop-scoped disease matcher + binomial leak guard (data/disease_synonyms.py,
reconciler crop threading, _normalise leak guard)."""
from data.disease_synonyms import canonicalize, same_disease


# ── Generic substring hijack is killed (the safety-critical bug) ──────────────

def test_white_rust_not_collapsed_to_rust():
    # "White Rust" is Albugo (oomycete), NOT a true rust — must not hijack "rust".
    assert canonicalize("White Rust") != "Rust (unspecified)"
    assert canonicalize("White Rust") == "White Rust"


def test_bacterial_leaf_spot_distinct_from_leaf_spot():
    # Erasing this match silently breaks the bacterial-vs-fungal safety layer.
    assert same_disease("Bacterial Leaf Spot", "Leaf Spot") is False


def test_exact_generic_key_still_maps():
    # STRICT_GENERIC blocks generic-as-substring, NOT exact matches.
    assert canonicalize("Rust") == "Rust (unspecified)"


def test_legit_substring_match_preserved():
    assert canonicalize("wheat brown rust (Puccinia)") == "Puccinia triticina"


# ── Crop-scoped binomials ────────────────────────────────────────────────────

def test_leaf_rust_is_crop_specific():
    assert canonicalize("Leaf Rust", crop="Wheat") == "Puccinia triticina"
    assert canonicalize("Leaf Rust", crop="Barley") == "Puccinia hordei"
    assert canonicalize("Leaf Rust", crop="Coffee") == "Hemileia vastatrix"
    assert canonicalize("Leaf Rust", crop="Coffee") != canonicalize("Leaf Rust", crop="Wheat")


def test_white_rust_crop_scoped_to_albugo():
    assert canonicalize("White Rust", crop="Mustard") == "Albugo candida"


def test_same_disease_crop_scoped():
    # Coffee "Leaf Rust" and its binomial agree only under the coffee scope.
    assert same_disease("Leaf Rust", "Hemileia vastatrix", crop="Coffee") is True


# ── Reconciler vote grouping uses the crop scope ──────────────────────────────

def test_fuse_groups_crop_specific_synonyms():
    from agents.reconciler import fuse
    r1 = {"primary_diagnosis": {"disease": "Leaf Rust", "confidence": 0.8},
          "confidence_score": 0.8, "_model": "m1"}
    r2 = {"primary_diagnosis": {"disease": "Hemileia vastatrix", "confidence": 0.8},
          "confidence_score": 0.8, "_model": "m2"}
    out = fuse([r1, r2], crop="Coffee")
    assert out.get("ensemble_agreement") == "2/2"


# ── Binomial leak guard in _normalise ────────────────────────────────────────

def test_on_ballot_binomial_snaps_to_common_name():
    from agents.disease_diagnosis_agent import _normalise
    r = {"primary_diagnosis": {"disease": "Puccinia triticina", "confidence": 0.8,
                               "pathogen_type": "fungal"},
         "confidence_score": 0.8, "differentials": []}
    out = _normalise(r, "Wheat")
    assert out["primary_diagnosis"]["disease"] == "Brown Rust"
    assert out["primary_diagnosis"]["scientific_name"] == "Puccinia triticina"


def test_off_ballot_binomial_marked_unconfirmed():
    from agents.disease_diagnosis_agent import _normalise
    r = {"primary_diagnosis": {"disease": "Xylaria fakespecies", "confidence": 0.6,
                               "pathogen_type": "fungal"},
         "confidence_score": 0.6, "differentials": []}
    out = _normalise(r, "Wheat")
    assert "(name unconfirmed)" in out["primary_diagnosis"]["disease"]
    assert out["primary_diagnosis"]["scientific_name"] == "Xylaria fakespecies"
