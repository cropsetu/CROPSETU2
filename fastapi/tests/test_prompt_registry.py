"""
Tests for agents/prompt_registry.py — versioned prompt loading + A/B
sticky bucketing.
"""
import os
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Smuggle two extra prompt files into place for the duration of these
# tests. We make a real v2 by duplicating v1 (the hash differs because
# we append a single character — enough to make the registry treat
# them as distinct versions).
_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "agents" / "prompts"
_V2_FILES = [
    _PROMPTS_DIR / "diagnose.v2_test.md",
    _PROMPTS_DIR / "treatment.v2_test.md",
]


@pytest.fixture(autouse=True)
def _install_v2_prompts():
    """Create v2_test variants, then clean up the disk + the registry's
    in-process cache after the test runs."""
    # Force re-import of registry so test isolation is real
    import importlib
    from agents import prompt_registry as pr
    importlib.reload(pr)

    base_diag  = _PROMPTS_DIR / "diagnose.v1.md"
    base_treat = _PROMPTS_DIR / "treatment.v1.md"
    _V2_FILES[0].write_text(base_diag.read_text() + "\n(test-v2-variant)\n")
    _V2_FILES[1].write_text(base_treat.read_text() + "\n(test-v2-variant)\n")

    original_active = dict(pr.ACTIVE_VERSIONS)
    yield pr

    # Cleanup
    for p in _V2_FILES:
        try: p.unlink()
        except FileNotFoundError: pass
    pr.ACTIVE_VERSIONS.clear()
    pr.ACTIVE_VERSIONS.update(original_active)
    pr._cache.clear()


# ── load_prompt — single-version baseline ───────────────────────────────────

def test_load_prompt_single_version(_install_v2_prompts):
    pr = _install_v2_prompts
    p = pr.load_prompt("diagnose")
    assert p.name == "diagnose"
    assert p.version == "v1"
    assert isinstance(p.hash, str) and len(p.hash) == 12
    assert "Dr. KrishiGuard" in p.text


def test_load_prompt_explicit_version(_install_v2_prompts):
    pr = _install_v2_prompts
    p1 = pr.load_prompt("diagnose", version="v1")
    p2 = pr.load_prompt("diagnose", version="v2_test")
    assert p1.hash != p2.hash    # different file content → different hash
    assert "(test-v2-variant)" in p2.text


def test_load_prompt_unknown_name_raises(_install_v2_prompts):
    pr = _install_v2_prompts
    with pytest.raises(KeyError):
        pr.load_prompt("not-a-real-prompt")


def test_load_prompt_unknown_version_raises(_install_v2_prompts):
    pr = _install_v2_prompts
    with pytest.raises(FileNotFoundError):
        pr.load_prompt("diagnose", version="v99")


def test_load_prompt_caches_by_version(_install_v2_prompts):
    pr = _install_v2_prompts
    p1 = pr.load_prompt("diagnose")
    p2 = pr.load_prompt("diagnose")
    assert p1 is p2     # same cached instance


# ── A/B variant resolution ──────────────────────────────────────────────────

def test_ab_sticky_per_user(_install_v2_prompts):
    pr = _install_v2_prompts
    pr.ACTIVE_VERSIONS["diagnose"] = {"v1": 0.5, "v2_test": 0.5}
    pr._cache.clear()
    # Same user_id → same variant on repeated calls
    a = pr._resolve_version("diagnose", "user-42")
    b = pr._resolve_version("diagnose", "user-42")
    c = pr._resolve_version("diagnose", "user-42")
    assert a == b == c


def test_ab_distribution_matches_weights(_install_v2_prompts):
    pr = _install_v2_prompts
    pr.ACTIVE_VERSIONS["diagnose"] = {"v1": 0.10, "v2_test": 0.90}
    pr._cache.clear()
    counts = {"v1": 0, "v2_test": 0}
    for i in range(2000):
        counts[pr._resolve_version("diagnose", f"user-{i}")] += 1
    # 10/90 split — allow ±3 pp tolerance for hash-bucket variance
    pct_v2 = counts["v2_test"] / 2000
    assert 0.87 <= pct_v2 <= 0.93, f"v2_test share {pct_v2:.2%} outside tolerance"


def test_ab_normalises_unbalanced_weights(_install_v2_prompts):
    # Even if operator types weights that don't sum to 1, distribution
    # should still spread across variants proportionally.
    pr = _install_v2_prompts
    pr.ACTIVE_VERSIONS["diagnose"] = {"v1": 30, "v2_test": 70}   # not 0.3/0.7
    pr._cache.clear()
    counts = {"v1": 0, "v2_test": 0}
    for i in range(1500):
        counts[pr._resolve_version("diagnose", f"user-{i}")] += 1
    pct_v2 = counts["v2_test"] / 1500
    assert 0.65 <= pct_v2 <= 0.75


def test_ab_anonymous_bucket_does_not_crash(_install_v2_prompts):
    pr = _install_v2_prompts
    pr.ACTIVE_VERSIONS["diagnose"] = {"v1": 0.5, "v2_test": 0.5}
    pr._cache.clear()
    # Empty/None bucket → falls back to a hash on the prompt name
    v = pr._resolve_version("diagnose", None)
    assert v in ("v1", "v2_test")


def test_ab_load_prompt_with_bucket_id(_install_v2_prompts):
    pr = _install_v2_prompts
    pr.ACTIVE_VERSIONS["diagnose"] = {"v1": 0.5, "v2_test": 0.5}
    pr._cache.clear()
    # Find one user that lands on v1 and one that lands on v2_test
    user_v1 = None
    user_v2 = None
    for i in range(100):
        v = pr._resolve_version("diagnose", f"u-{i}")
        if v == "v1" and user_v1 is None:        user_v1 = f"u-{i}"
        if v == "v2_test" and user_v2 is None:   user_v2 = f"u-{i}"
        if user_v1 and user_v2: break
    assert user_v1 and user_v2
    p1 = pr.load_prompt("diagnose", bucket_id=user_v1)
    p2 = pr.load_prompt("diagnose", bucket_id=user_v2)
    assert p1.version == "v1"
    assert p2.version == "v2_test"


def test_all_active_reports_ab_variants(_install_v2_prompts):
    pr = _install_v2_prompts
    pr.ACTIVE_VERSIONS["diagnose"] = {"v1": 0.3, "v2_test": 0.7}
    pr._cache.clear()
    out = pr.all_active()
    assert "variants" in out["diagnose"]
    variants = out["diagnose"]["variants"]
    assert "v1" in variants and "v2_test" in variants
    assert variants["v1"]["weight"]      == 0.3
    assert variants["v2_test"]["weight"] == 0.7
    # Treatment (still single-version) returns flat meta
    assert "variants" not in out["treatment"]
    assert "hash" in out["treatment"]
