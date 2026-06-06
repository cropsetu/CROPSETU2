"""
safety/invariants.py — boot-time invariant checks.

Surfaces config/data-integrity problems LOUDLY at startup instead of silently at
runtime — the class of bug behind the "silent off-label kill-switch", "$0 pricing
row", "dead 0/3 cap", and "crop-alias drift" gotchas. Wire into the FastAPI
lifespan (assert_boot_invariants) and surface check_invariants() in /health.

check_invariants() NEVER raises — it returns a list of {severity, code, detail}.
assert_boot_invariants(fail_closed=True) raises on any CRITICAL issue (prod);
otherwise it just logs (dev). WARN-level issues are known/tolerable gaps
(e.g. label-claim actives sourced from an external list).
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

CRITICAL = "critical"
WARN = "warning"


def check_invariants() -> list[dict]:
    """Return a list of integrity issues (never raises)."""
    issues: list[dict] = []

    def add(sev: str, code: str, detail: str) -> None:
        issues.append({"severity": sev, "code": code, "detail": detail})

    # 1. No active is simultaneously banned AND registered.
    try:
        from safety.chemicals import BANNED_ACTIVES, REGISTERED_ACTIVES
        overlap = {k.lower() for k in BANNED_ACTIVES} & {k.lower() for k in REGISTERED_ACTIVES}
        if overlap:
            add(CRITICAL, "banned_registered_overlap",
                f"actives both banned and registered: {sorted(overlap)}")
    except Exception as e:  # noqa: BLE001
        add(CRITICAL, "chemicals_import", f"cannot import chemical registry: {e}")

    # 2. Config threshold sanity.
    try:
        from config import (IMAGE_QUALITY_THRESHOLD, IMAGE_UNUSABLE_THRESHOLD,
                            DIAGNOSIS_ESCALATE_BELOW, DIAGNOSIS_CONF_THRESHOLD,
                            ENSEMBLE_ESCALATE_BELOW)
        if not (0 < IMAGE_UNUSABLE_THRESHOLD < IMAGE_QUALITY_THRESHOLD <= 1):
            add(CRITICAL, "image_thresholds",
                f"need 0 < unusable({IMAGE_UNUSABLE_THRESHOLD}) < quality({IMAGE_QUALITY_THRESHOLD}) <= 1")
        if not (DIAGNOSIS_ESCALATE_BELOW < DIAGNOSIS_CONF_THRESHOLD):
            add(CRITICAL, "conf_thresholds",
                f"escalate({DIAGNOSIS_ESCALATE_BELOW}) must be < conf({DIAGNOSIS_CONF_THRESHOLD})")
        if not (0 < ENSEMBLE_ESCALATE_BELOW <= 1):
            add(CRITICAL, "ensemble_threshold", f"out of range: {ENSEMBLE_ESCALATE_BELOW}")
    except Exception as e:  # noqa: BLE001
        add(CRITICAL, "config_import", f"cannot import config thresholds: {e}")

    # 3. Active prompts load non-empty.
    try:
        from agents.prompt_registry import load_prompt
        for name in ("diagnose", "treatment"):
            p = load_prompt(name)
            if not (p and getattr(p, "text", "")):
                add(CRITICAL, "prompt_empty", f"prompt {name!r} loaded empty")
    except Exception as e:  # noqa: BLE001
        add(CRITICAL, "prompt_load", f"cannot load prompts: {e}")

    # 4. Version constants importable (stamped into report.meta.versions).
    try:
        from safety.chemicals import REGISTRY_VERSION as _R          # noqa: F401
        from data.state_bans import REGISTRY_VERSION as _S           # noqa: F401
        from data.crop_disease_whitelist import WHITELIST_VERSION as _W  # noqa: F401
    except Exception as e:  # noqa: BLE001
        add(CRITICAL, "version_constants", f"missing version constant: {e}")

    # 5. Single crop-alias source — the whitelist must delegate, not hold its own map.
    try:
        import data.crop_disease_whitelist as _wl
        if getattr(_wl, "_CROP_ALIASES", None):
            add(WARN, "alias_drift",
                "crop_disease_whitelist still defines _CROP_ALIASES (should delegate to input_normalizer)")
    except Exception:  # noqa: BLE001
        pass

    # 6. Label-claim integrity (WARN — some actives come from an external list).
    try:
        from rag.knowledge_base import _LABEL_CLAIMS
        from safety.chemicals import find_active
        from services.input_normalizer import normalize_crop_name, VALID_CROPS
        valid = set(VALID_CROPS)
        unresolved: set[str] = set()
        bad_crops: set[str] = set()
        for (crop, _disease), actives in _LABEL_CLAIMS.items():
            if normalize_crop_name(crop) not in valid:
                bad_crops.add(crop)
            for a in actives:
                if find_active(a) is None:
                    unresolved.add(a)
        if bad_crops:
            add(WARN, "labelclaim_crop", f"_LABEL_CLAIMS crops not in VALID_CROPS: {sorted(bad_crops)}")
        if unresolved:
            add(WARN, "labelclaim_unresolved_actives",
                f"_LABEL_CLAIMS actives not in REGISTERED_ACTIVES: {sorted(unresolved)}")
    except Exception as e:  # noqa: BLE001
        add(WARN, "labelclaim_check", f"could not check _LABEL_CLAIMS: {e}")

    return issues


def assert_boot_invariants(fail_closed: bool = False) -> list[dict]:
    """Log all issues; raise on CRITICAL when fail_closed (prod)."""
    issues = check_invariants()
    for i in issues:
        (logger.error if i["severity"] == CRITICAL else logger.warning)(
            "[Invariant:%s] %s — %s", i["severity"], i["code"], i["detail"])
    crit = [i for i in issues if i["severity"] == CRITICAL]
    if crit and fail_closed:
        raise RuntimeError(
            f"Boot invariants FAILED ({len(crit)} critical): "
            + "; ".join(f"{i['code']}: {i['detail']}" for i in crit))
    if not issues:
        logger.info("[Invariant] all boot invariants passed")
    return issues
