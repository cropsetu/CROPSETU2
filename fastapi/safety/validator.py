"""
Treatment Validator — CropGuard

Runs AFTER the treatment LLM call and BEFORE the response is cached or
returned. Treats every LLM-emitted chemical as untrusted input and:

  • drops banned actives (central + state-level)
  • marks unknown actives as unverified (needs human review)
  • clamps PHI / REI to registry baselines when the LLM omits or low-balls
  • forces pollinator_safety="avoid_during_bloom" when crop is flowering
    and active is known bee-toxic
  • runs the policy gate — if chemicals are disallowed by confidence /
    crop_mismatch / pathogen_type, strips chemical_controls entirely and
    replaces with culture+biological measures

Output:
  ValidationResult(
    sanitized_treatment: dict,    # treatment dict with unsafe items removed
    blockers:           list,     # hard-stops applied (banned, off-label)
    warnings:           list,     # softer flags (unverified, dose unknown)
    registry_version:   str,
  )

The orchestrator surfaces blockers + warnings into the report meta and
the dispensing-sheet compliance audit.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from data.state_bans import (
    REGISTRY_VERSION as STATE_BANS_VERSION,
    is_banned_in_state,
)
from rag.knowledge_base import _LABEL_CLAIMS  # crop+disease -> allowed actives
from safety.chemicals import (
    REGISTRY_VERSION,
    find_active,
    is_banned,
    is_state_organic,
)
from safety.policy import allow_chemical_recommendations

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    sanitized_treatment: dict
    blockers: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    registry_version: str = REGISTRY_VERSION

    def to_meta(self) -> dict:
        return {
            "registry_version": self.registry_version,
            "blockers": self.blockers,
            "warnings": self.warnings,
            "blocker_count": len(self.blockers),
            "warning_count": len(self.warnings),
        }


_BEE_TOXIC_ACTIVES = {
    "imidacloprid", "thiamethoxam", "clothianidin", "fipronil",
    "lambda-cyhalothrin", "deltamethrin", "cypermethrin", "bifenthrin",
}


def _growth_stage_is_flowering(stage: str | None) -> bool:
    s = (stage or "").lower()
    return any(kw in s for kw in ("flower", "bloom", "anthesis"))


def validate_treatment(
    treatment: dict,
    *,
    diagnosis: dict,
    params: dict,
) -> ValidationResult:
    """Single entry point — orchestrator calls this once per request."""
    state = (params.get("state") or "").lower().strip()
    crop  = (params.get("crop_name") or "").lower().strip()
    disease_name = ((diagnosis.get("primary_diagnosis") or {}).get("disease") or "").lower().strip()
    flowering = _growth_stage_is_flowering(params.get("crop_growth_stage"))

    # Label-claim allowed set for (crop, disease). When the matrix has
    # NO entry for the pair, allowed_for_label is None → off-label check
    # is silent (we already warned in the RAG grounding prompt that no
    # chemicals are registered, so the LLM should have produced none).
    allowed_for_label: set[str] | None = _LABEL_CLAIMS.get((crop, disease_name))

    blockers: list[dict] = []
    warnings: list[dict] = []

    # ── Step 1. Policy gate — strip chemicals if disallowed ──────────────────
    allowed, reason = allow_chemical_recommendations(diagnosis)
    if not allowed:
        if treatment.get("chemical_controls"):
            blockers.append({
                "code": "policy_gate",
                "scope": "all_chemicals",
                "detail": reason,
            })
            logger.warning(
                "[Validator] Stripping %d chemical_controls — %s",
                len(treatment.get("chemical_controls", [])), reason,
            )
            treatment["chemical_controls"] = []
            treatment["medicine_combinations"] = []
            # Keep rotation_plan field but blank — UI reads it as "no rotation needed"
            treatment["rotation_plan"] = ""
        # Also block "Sikkim is fully organic" case at the state level
    if is_state_organic(state):
        if treatment.get("chemical_controls"):
            blockers.append({
                "code": "organic_state",
                "scope": "all_chemicals",
                "detail": f"{state.title()} is a fully organic state — synthetic pesticides barred",
            })
            treatment["chemical_controls"] = []
            treatment["medicine_combinations"] = []
            treatment["rotation_plan"] = ""

    # ── Step 2. Per-chemical validation (only if any remain) ─────────────────
    sanitized_chems: list[dict] = []
    for idx, chem in enumerate(treatment.get("chemical_controls", []) or []):
        verdict = _validate_chemical(
            chem, state=state, flowering=flowering,
            crop=crop, allowed_for_label=allowed_for_label,
        )
        if verdict["blocker"]:
            blockers.append({
                "code": verdict["code"],
                "scope": chem.get("product", f"chemical[{idx}]"),
                "detail": verdict["detail"],
            })
            continue
        if verdict["warning"]:
            warnings.append({
                "code": verdict["code"],
                "scope": chem.get("product", f"chemical[{idx}]"),
                "detail": verdict["detail"],
            })
        sanitized_chems.append(verdict["sanitized"])

    treatment["chemical_controls"] = sanitized_chems

    # ── Step 3. Re-validate medicine_combinations (a separate LLM block) ─────
    sanitized_combos: list[dict] = []
    for combo in treatment.get("medicine_combinations", []) or []:
        components = combo.get("components", []) or []
        kept: list[dict] = []
        for comp in components:
            v = _validate_chemical(
                {"product": comp.get("product", ""), "frac_irac_group": comp.get("frac_group", "")},
                state=state, flowering=flowering,
                crop=crop, allowed_for_label=allowed_for_label,
            )
            if v["blocker"]:
                blockers.append({
                    "code": v["code"],
                    "scope": f"combo:{combo.get('name','?')}/{comp.get('product','?')}",
                    "detail": v["detail"],
                })
                continue
            kept.append(comp)
        if kept:
            combo = dict(combo)
            combo["components"] = kept
            sanitized_combos.append(combo)
        # If all components were dropped, drop the combo entirely
    treatment["medicine_combinations"] = sanitized_combos

    # ── Step 4. Re-validate "do_not_use" — if the LLM mentions a banned
    #            active here, that's good (it's flagging it). We don't act
    #            on that block, but we surface the registry hits for the
    #            compliance audit.
    # (no-op — kept for clarity)

    # ── Step 5. If chemicals were stripped, ensure cultural+biological remain
    if not treatment.get("chemical_controls") and not treatment.get("cultural_practices"):
        treatment["cultural_practices"] = [
            "Remove and destroy visibly infected plant material",
            "Improve airflow by pruning and proper spacing",
            "Switch to drip irrigation to reduce leaf wetness",
        ]
    if not treatment.get("chemical_controls") and not treatment.get("biological_options"):
        # Keep the field present so the UI renders the section
        treatment["biological_options"] = treatment.get("biological_options", [])

    # ── Step 6. Stamp validator metadata
    treatment.setdefault("_safety", {})
    treatment["_safety"] = {
        "registry_version":   REGISTRY_VERSION,
        "state_bans_version": STATE_BANS_VERSION,
        "blockers": blockers,
        "warnings": warnings,
    }

    logger.info(
        "[Validator] reg=%s chems_kept=%d blockers=%d warnings=%d",
        REGISTRY_VERSION, len(sanitized_chems), len(blockers), len(warnings),
    )

    return ValidationResult(
        sanitized_treatment=treatment,
        blockers=blockers,
        warnings=warnings,
    )


# ── Per-chemical validator ───────────────────────────────────────────────────

def _validate_chemical(
    chem: dict,
    *,
    state: str,
    flowering: bool,
    crop: str = "",
    allowed_for_label: set[str] | None = None,
) -> dict[str, Any]:
    """
    Returns dict {blocker, warning, code, detail, sanitized}.

    blocker=True  → chemical removed from output (banned, off-label, etc.)
    warning=True  → kept, but flagged in safety audit (unknown active, dose missing)
    """
    product = chem.get("product", "") or chem.get("active_ingredient", "")
    active_field = chem.get("active_ingredient") or product

    # 1. Ban check — central registry
    banned, ban_reason = is_banned(product, state=state)
    if not banned:
        banned, ban_reason = is_banned(active_field, state=state)
    if banned:
        return {
            "blocker": True,
            "warning": False,
            "code": "banned_chemical",
            "detail": f"{product!r}: {ban_reason}",
            "sanitized": None,
        }

    # 1b. Ban check — state-specific registry (Phase 7 addition).
    # Crop-scoped bans (e.g. Maharashtra cotton-area emergency lists) are
    # honoured here so e.g. monocrotophos on cotton in Maharashtra is
    # blocked even though it's only "restricted" centrally.
    if state:
        state_banned, state_reason = is_banned_in_state(active_field, state, crop=crop)
        if not state_banned:
            state_banned, state_reason = is_banned_in_state(product, state, crop=crop)
        if state_banned:
            return {
                "blocker": True,
                "warning": False,
                "code": "banned_in_state",
                "detail": f"{product!r}: {state_reason}",
                "sanitized": None,
            }

    # 1c. Label-claim check — CIB&RC registers each active for SPECIFIC
    # crop-pest combinations. Off-label is illegal under the Insecticides
    # Act 1968 even if the chemical itself is registered for other crops.
    # When the (crop, disease) pair has no label-claim entry in our matrix,
    # allowed_for_label is None and this check is skipped (the RAG block
    # already told the LLM to recommend cultural only — anything that
    # slipped through is the unverified_active warning instead).
    if allowed_for_label is not None:
        active_lc = (active_field or product or "").strip().lower()
        # Match via substring so "Mancozeb 75% WP" matches "mancozeb".
        if active_lc and not any(name in active_lc or active_lc in name
                                  for name in allowed_for_label):
            return {
                "blocker": True,
                "warning": False,
                "code": "off_label",
                "detail": (
                    f"{product!r}: not registered for this crop-pest combination "
                    f"under CIB&RC label claims (allowed: {sorted(allowed_for_label)})"
                ),
                "sanitized": None,
            }

    # 2. Registry resolve
    active = find_active(active_field) or find_active(product)

    sanitized = dict(chem)
    code = ""
    detail = ""
    warning = False

    if active is None:
        # Unknown active → keep but flag for human review. We don't drop
        # because the registry is intentionally incomplete; dropping every
        # unknown would over-block.
        warning = True
        code = "unverified_active"
        detail = f"{product!r}: not in CIB&RC registry slice — needs human verification"
        sanitized["_validator_note"] = "unverified active ingredient"
    else:
        # 3. PHI / REI clamp — never lower than registry baseline
        phi_llm = sanitized.get("phi_days")
        if not isinstance(phi_llm, (int, float)) or phi_llm < active.phi_days_default:
            sanitized["phi_days"] = active.phi_days_default
            warning = warning or False  # silent clamp; surfaced below if needed
        rei_llm = sanitized.get("rei_hours")
        if not isinstance(rei_llm, (int, float)) or rei_llm < active.rei_hours_default:
            sanitized["rei_hours"] = active.rei_hours_default

        # 4. FRAC/IRAC fill-in
        if not sanitized.get("frac_irac_group") and active.frac_irac_group:
            sanitized["frac_irac_group"] = active.frac_irac_group

        # 5. Pollinator safety enforcement during flowering
        active_lower = active.name
        if flowering and active_lower in _BEE_TOXIC_ACTIVES:
            sanitized["pollinator_safety"] = "avoid_during_bloom"
            return {
                "blocker": True,
                "warning": False,
                "code": "bee_toxic_during_bloom",
                "detail": (
                    f"{product!r}: bee-toxic active ({active.name}) cannot be sprayed during flowering"
                ),
                "sanitized": None,
            }
        if not sanitized.get("pollinator_safety"):
            sanitized["pollinator_safety"] = active.pollinator_safety

    # 6. Dose sanity — must have dosage
    if not sanitized.get("dosage"):
        warning = True
        code = code or "missing_dosage"
        detail = detail or f"{product!r}: dosage missing — apply per CIB&RC label"

    return {
        "blocker": False,
        "warning": warning,
        "code": code,
        "detail": detail,
        "sanitized": sanitized,
    }
