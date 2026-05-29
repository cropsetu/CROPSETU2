"""
Unit tests for safety/chemicals.py — the chemical registry.

These tests are the load-bearing safety guarantees: a regression in
find_active() or is_banned() means a banned chemical could slip through
the post-LLM validator and end up on a farmer's dispensing sheet.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from safety.chemicals import (
    BANNED_ACTIVES,
    REGISTERED_ACTIVES,
    REGISTRY_VERSION,
    find_active,
    is_banned,
    is_state_organic,
)


# ── find_active ─────────────────────────────────────────────────────────────

def test_find_active_canonical_hit():
    a = find_active("mancozeb")
    assert a is not None
    assert a.name == "mancozeb"
    assert a.pesticide_type == "fungicide"
    assert a.frac_irac_group == "FRAC M03"


def test_find_active_with_formulation_suffix():
    # LLMs commonly emit "Mancozeb 75% WP" or "Propiconazole 25 EC"
    assert find_active("Mancozeb 75% WP").name == "mancozeb"
    assert find_active("Propiconazole 25 EC").name == "propiconazole"


def test_find_active_brand_name_alias():
    # Brand aliases the registry tracks should resolve to the active
    assert find_active("Tilt").name == "propiconazole"
    assert find_active("Coragen").name == "chlorantraniliprole"
    assert find_active("Confidor").name == "imidacloprid"


def test_find_active_unknown_returns_none():
    # Important: unknown must be None (the validator flags as unverified,
    # not blocks — over-blocking is worse than under-blocking).
    assert find_active("MysteryShield 50 EC") is None
    assert find_active("") is None
    assert find_active(None) is None


def test_find_active_substring_brand_match():
    # "Dithane M-45" is a Mancozeb brand
    assert find_active("Dithane M-45").name == "mancozeb"


def test_find_active_case_and_whitespace_insensitive():
    assert find_active("  MANCOZEB  ").name == "mancozeb"
    assert find_active("mAnCoZeB").name == "mancozeb"


def test_find_active_biological_agents():
    assert find_active("Trichoderma viride").name == "trichoderma viride"
    assert find_active("Trichoderma viride").frac_irac_group == "BIO"
    assert find_active("Pseudomonas fluorescens").pesticide_type == "fungicide"


# ── is_banned ───────────────────────────────────────────────────────────────

def test_is_banned_central_banned_chemicals():
    # The textbook bans — must be caught regardless of formulation suffix
    for name in ("Monocrotophos 36 SL", "Endosulfan", "Methyl Parathion 50% EC",
                "Phorate 10G", "Triazophos 40 EC", "Lindane", "Aldrin"):
        banned, reason = is_banned(name)
        assert banned is True, f"{name} must be flagged as banned"
        assert "ban" in reason.lower() or "banned" in reason.lower()


def test_is_banned_unknown_chemical_returns_false():
    banned, reason = is_banned("MysteryShield 50 EC")
    assert banned is False
    assert reason == ""


def test_is_banned_state_level_kerala():
    # Kerala has extra restrictions beyond the central list
    banned_central, _ = is_banned("Imidacloprid")
    assert banned_central is False
    banned_kerala, reason = is_banned("Imidacloprid", state="Kerala")
    assert banned_kerala is True
    assert "kerala" in reason.lower()


def test_is_banned_state_lookup_case_insensitive():
    banned1, _ = is_banned("Imidacloprid", state="kerala")
    banned2, _ = is_banned("Imidacloprid", state="KERALA")
    banned3, _ = is_banned("Imidacloprid", state="  Kerala  ")
    assert banned1 and banned2 and banned3


def test_is_banned_empty_input():
    assert is_banned("") == (False, "")
    assert is_banned(None) == (False, "")


# ── is_state_organic ────────────────────────────────────────────────────────

def test_sikkim_is_organic_state():
    assert is_state_organic("Sikkim") is True
    assert is_state_organic("sikkim") is True
    assert is_state_organic("  SIKKIM  ") is True


def test_other_states_not_organic():
    for s in ("Maharashtra", "Punjab", "Karnataka", "", None):
        assert is_state_organic(s) is False


# ── registry shape sanity ───────────────────────────────────────────────────

def test_registry_version_present():
    assert isinstance(REGISTRY_VERSION, str)
    assert len(REGISTRY_VERSION) > 0


def test_banned_list_has_critical_chemicals():
    # These have been banned for years — if any are missing it's a serious bug
    for critical in ("monocrotophos", "endosulfan", "methyl parathion",
                     "phorate", "lindane"):
        assert critical in BANNED_ACTIVES, f"{critical} missing from BANNED_ACTIVES"


def test_registered_actives_have_required_fields():
    # Every entry must have FRAC group and PHI baseline — validator depends on these
    for name, entry in REGISTERED_ACTIVES.items():
        assert entry.name == name
        assert entry.pesticide_type in (
            "fungicide", "insecticide", "bactericide", "herbicide", "nematicide"
        )
        assert isinstance(entry.phi_days_default, int)
        assert entry.phi_days_default >= 0
        assert isinstance(entry.rei_hours_default, int)
        assert entry.rei_hours_default >= 0
        assert entry.pollinator_safety in ("safe", "caution", "avoid_during_bloom")
