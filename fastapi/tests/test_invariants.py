"""Boot-invariant integrity tests (safety/invariants.py)."""
from safety.invariants import check_invariants, assert_boot_invariants, CRITICAL


def test_no_critical_invariant_violations():
    issues = check_invariants()
    crit = [i for i in issues if i["severity"] == CRITICAL]
    assert not crit, f"critical boot-invariant violations: {crit}"


def test_assert_boot_invariants_does_not_raise_in_dev():
    # dev mode (fail_closed=False) must never raise, even with WARN issues.
    assert_boot_invariants(fail_closed=False)


def test_banned_and_registered_are_disjoint():
    from safety.chemicals import BANNED_ACTIVES, REGISTERED_ACTIVES
    overlap = {k.lower() for k in BANNED_ACTIVES} & {k.lower() for k in REGISTERED_ACTIVES}
    assert not overlap, f"actives both banned and registered: {sorted(overlap)}"


def test_version_constants_importable():
    from safety.chemicals import REGISTRY_VERSION
    from data.state_bans import REGISTRY_VERSION as SB
    from data.crop_disease_whitelist import WHITELIST_VERSION
    assert REGISTRY_VERSION and SB and WHITELIST_VERSION
