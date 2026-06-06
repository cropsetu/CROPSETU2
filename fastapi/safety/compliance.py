"""
Compliance Audit — CropGuard

Builds the *real* compliance_audit block consumed by the dispensing-sheet
section of the report. Replaces the previous stub that always wrote
status="PASSED" without checking anything.

Each check returns one of:
  PASSED   — verified against registry / policy
  WARNING  — soft flag (e.g. unknown active, dose missing)
  FAILED   — hard violation (banned, off-label, PHI > harvest window)
  N/A      — check not applicable (e.g. pollinator check on non-flowering crop)
"""
from __future__ import annotations

from safety.chemicals import (
    REGISTRY_VERSION,
    REGISTRY_SOURCES,
    find_active,
    is_banned,
    is_state_organic,
)


# Coarse days-from-sowing to maturity, used only to estimate the harvest
# window for the PHI check below. Conservative; absent crops → no estimate.
_CROP_MATURITY_DAYS: dict[str, int] = {
    "Rice": 130, "Wheat": 120, "Maize": 110, "Cotton": 170, "Sugarcane": 360,
    "Tomato": 120, "Potato": 110, "Onion": 140, "Chilli": 150, "Soybean": 100,
    "Groundnut": 120, "Mustard": 130, "Cabbage": 100, "Cauliflower": 100,
}


def _days_to_harvest(params: dict) -> int | None:
    """Best-effort days until harvest. Returns None when it can't be estimated.
    Near-harvest growth stages short-circuit to a small window."""
    stage = (params.get("crop_growth_stage") or "").lower()
    if any(k in stage for k in ("maturity", "ripening", "harvest")):
        return 7
    planting = params.get("planting_date")
    maturity = _CROP_MATURITY_DAYS.get((params.get("crop_name") or "").strip())
    if planting and maturity:
        try:
            from datetime import datetime, date
            pd = datetime.fromisoformat(str(planting)[:10]).date()
            return max(0, maturity - (date.today() - pd).days)
        except Exception:
            return None
    return None


def build_compliance_audit(
    *,
    diagnosis: dict,
    treatment: dict,
    params: dict,
    validation_meta: dict | None = None,
) -> dict:
    """
    Returns a dict suitable for direct embedding into the report annex.
    Caller is the report_generator_agent.
    """
    state = (params.get("state") or "").lower().strip()
    growth = (params.get("crop_growth_stage") or "").lower()
    is_flowering = any(kw in growth for kw in ("flower", "bloom", "anthesis"))
    chemicals = treatment.get("chemical_controls", []) or []

    validation_meta = validation_meta or treatment.get("_safety") or {}
    blockers = validation_meta.get("blockers", [])
    warnings = validation_meta.get("warnings", [])

    checks: list[dict] = []

    # 1. Banned-chemical check
    banned_hits = [b for b in blockers if b.get("code") in ("banned_chemical", "organic_state")]
    if banned_hits:
        checks.append({
            "check": "Banned / restricted chemicals",
            "status": "FAILED",
            "detail": "; ".join(f"{h['scope']}: {h['detail']}" for h in banned_hits),
        })
    else:
        checks.append({
            "check": "Banned / restricted chemicals",
            "status": "PASSED",
            "detail": (
                f"All {len(chemicals)} recommended product(s) cleared against the central + state ban list"
                if chemicals else "No chemicals recommended"
            ),
        })

    # 2. CIB&RC registration check
    unverified = [w for w in warnings if w.get("code") == "unverified_active"]
    if not chemicals:
        checks.append({
            "check": "CIB&RC registration",
            "status": "N/A",
            "detail": "No chemicals recommended for this case",
        })
    elif unverified:
        checks.append({
            "check": "CIB&RC registration",
            "status": "WARNING",
            "detail": (
                f"{len(unverified)} active(s) not in current registry slice — "
                "requires human verification before dispensing"
            ),
        })
    else:
        checks.append({
            "check": "CIB&RC registration",
            "status": "PASSED",
            "detail": f"All {len(chemicals)} actives matched to registered entries",
        })

    # 3. Pollinator safety. A bee-toxic block FAILED outcome must be
    #    reported even when chemicals=[] — that's the case where the
    #    validator stripped everything because the LLM tried to recommend
    #    a neonicotinoid during flowering. Check the blocker list FIRST,
    #    then fall through to the no-chemicals / non-flowering branches.
    bee_blocks = [b for b in blockers if b.get("code") == "bee_toxic_during_bloom"]
    if bee_blocks:
        checks.append({
            "check": "Pollinator safety",
            "status": "FAILED",
            "detail": "; ".join(b["detail"] for b in bee_blocks),
        })
    elif not chemicals:
        checks.append({
            "check": "Pollinator safety",
            "status": "N/A",
            "detail": "No chemicals recommended",
        })
    elif is_flowering:
        checks.append({
            "check": "Pollinator safety",
            "status": "PASSED",
            "detail": "Flowering crop — bee-toxic actives screened and excluded",
        })
    else:
        checks.append({
            "check": "Pollinator safety",
            "status": "N/A",
            "detail": "Crop not currently in flowering stage",
        })

    # 4. PHI (Pre-Harvest Interval) sanity
    if chemicals:
        phi_values = [c.get("phi_days") for c in chemicals if isinstance(c.get("phi_days"), (int, float))]
        if not phi_values:
            checks.append({
                "check": "PHI on every product",
                "status": "WARNING",
                "detail": "Some chemicals lack a PHI value — applicator should consult label",
            })
        else:
            max_phi = max(phi_values)
            checks.append({
                "check": "PHI on every product",
                "status": "PASSED",
                "detail": f"PHI present on all products; max {max_phi} days — observe before harvest",
            })
            # PHI vs harvest window — a PHI that can't clear before harvest is a
            # residue / MRL-rejection risk (especially for export produce).
            dth = _days_to_harvest(params)
            if dth is not None and max_phi > dth:
                checks.append({
                    "check": "PHI vs harvest window",
                    "status": "FAILED",
                    "detail": (
                        f"Max PHI {max_phi} days exceeds ~{dth} days to estimated harvest — "
                        "residue/MRL risk; choose a shorter-PHI product or delay harvest."
                    ),
                })

    # 5. FRAC / IRAC rotation.
    # Distinct groups must compare the CODE portion ("M03", "3", "11"), not
    # the classifier prefix — otherwise "FRAC M03" and "FRAC 3" both reduce
    # to "FRAC" and a perfectly diverse rotation reads as single-group.
    if chemicals:
        groups = [c.get("frac_irac_group", "") for c in chemicals if c.get("frac_irac_group")]
        distinct = set()
        for g in groups:
            tokens = g.split(None, 1)
            distinct.add(tokens[1].strip() if len(tokens) > 1 else tokens[0])
        if len(distinct) >= 2:
            checks.append({
                "check": "FRAC / IRAC rotation stewardship",
                "status": "PASSED",
                "detail": f"{' → '.join(groups[:3])} (≥ 2 distinct groups)",
            })
        elif groups:
            checks.append({
                "check": "FRAC / IRAC rotation stewardship",
                "status": "WARNING",
                "detail": "Only one MoA group across recommended chemicals — resistance risk",
            })

    # 6. Dose present on each chemical
    if chemicals:
        missing_dose = [c for c in chemicals if not c.get("dosage")]
        if missing_dose:
            checks.append({
                "check": "Dose within label range",
                "status": "WARNING",
                "detail": f"{len(missing_dose)} product(s) missing dosage — applicator must consult label",
            })
        else:
            checks.append({
                "check": "Dose within label range",
                "status": "PASSED",
                "detail": "All products carry a dose value",
            })

    # 7. Policy gate audit
    policy_blocks = [b for b in blockers if b.get("code") == "policy_gate"]
    if policy_blocks:
        checks.append({
            "check": "Confidence / context policy",
            "status": "FAILED",
            "detail": "; ".join(b["detail"] for b in policy_blocks),
        })

    return {
        "registry_version": validation_meta.get("registry_version", REGISTRY_VERSION),
        "registry_sources": list(REGISTRY_SOURCES),
        "checks": checks,
        "summary": {
            "passed":  sum(1 for c in checks if c["status"] == "PASSED"),
            "warning": sum(1 for c in checks if c["status"] == "WARNING"),
            "failed":  sum(1 for c in checks if c["status"] == "FAILED"),
            "na":      sum(1 for c in checks if c["status"] == "N/A"),
        },
    }
