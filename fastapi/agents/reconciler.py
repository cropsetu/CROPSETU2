"""
agents/reconciler.py — fuse parallel ensemble outputs into one diagnosis.

Pure function, no I/O, no LLM. Sole purpose: given N model results that
each follow the disease_diagnosis_agent JSON shape, produce ONE
diagnosis dict the rest of the pipeline (cross_verify, treatment, report)
can consume unchanged.

The four steps come straight from §6.4 of the master spec, in the order
they must run:

  1. Canonicalize names (data/disease_synonyms.py). Models call the same
     pathogen different things — without canonicalization, "Brown Rust"
     vs "Puccinia triticina" reads as disagreement.
  2. Vote. Agreement → boost confidence; majority → keep dissenter as a
     differential; all-disagree → set needs_lab_confirmation and surface
     all opinions.
  3. Fuse confidence. Weighted average by self-reported confidence; an
     ensemble_accuracy_weights hook is left open for the Phase 8
     feedback loop to wire in per-model historical accuracy.
  4. Safety-biased merge of flags. Severity = most conservative;
     OR-merge `needs_lab_confirmation`, `is_out_of_distribution`,
     `crop_mismatch`.
"""
from __future__ import annotations

import logging
from collections import Counter
from statistics import mean
from typing import Any, Iterable, Optional

from data.disease_synonyms import canonicalize

logger = logging.getLogger(__name__)


# Severity ranking — higher index = more severe. Reconciler always picks the
# most conservative (highest) reported severity so treatment doesn't
# under-react when one model said "Severe" and another said "Mild".
_SEVERITY_ORDER = ["unknown", "mild", "moderate", "severe", "critical"]


def _sev_rank(s: str | None) -> int:
    try:
        return _SEVERITY_ORDER.index((s or "").strip().lower())
    except ValueError:
        return 0  # treat unfamiliar labels as the floor


def _primary_canonical(result: dict) -> str:
    pd = result.get("primary_diagnosis") or {}
    return canonicalize(pd.get("disease") or pd.get("scientific_name") or "")


def _canon_differentials(result: dict) -> list[dict]:
    """Return differentials with each name canonicalized in-place (copy)."""
    out: list[dict] = []
    for d in result.get("differentials") or []:
        if not isinstance(d, dict):
            continue
        nd = dict(d)
        nd["disease"] = canonicalize(d.get("disease") or d.get("name") or "")
        out.append(nd)
    return out


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _merged_causal_factors(results: list[dict]) -> list[str]:
    """De-dup causal factors across all results, preserving first-seen order."""
    seen: set[str] = set()
    ordered: list[str] = []
    for r in results:
        for cf in r.get("causal_factors") or []:
            if isinstance(cf, str):
                key = cf.strip().lower()
                if key and key not in seen:
                    seen.add(key)
                    ordered.append(cf.strip())
    return ordered


def _worst_spread(results: list[dict]) -> str:
    order = ["UNKNOWN", "LOW", "MODERATE", "HIGH", "CRITICAL"]
    best = "UNKNOWN"
    for r in results:
        s = (r.get("spread_risk") or "UNKNOWN").upper()
        if order.index(s) > order.index(best):
            best = s
    return best


def _weather_correlation_consensus(results: list[dict]) -> str:
    """Majority vote on weather_correlation; ties favor PARTIAL (the cautious
    middle). Used to feed cross_verify the agreed view, not one model's."""
    votes = Counter((r.get("weather_correlation") or "PARTIAL").upper() for r in results)
    if not votes:
        return "PARTIAL"
    top, _ = votes.most_common(1)[0]
    return top


def fuse(
    results: Iterable[dict],
    *,
    accuracy_weights: Optional[dict[str, float]] = None,
) -> dict:
    """
    Reconcile N diagnosis dicts into one.

    `results` is the ordered output of the parallel ensemble (typically
    [primary_cheap, gemini_pro, claude_sonnet, gpt4o]).

    `accuracy_weights` is an optional `{model_id: weight}` mapping the
    feedback loop will populate later; reconciler treats missing entries
    as 1.0 (equal weighting). Each result is expected to have either a
    top-level `_model` field or `_prompt_meta.model` for lookup.

    Returns a dict with the same shape disease_diagnosis_agent emits, plus:
      - ensemble_agreement: e.g. "3/3", "2/3", "1/3"
      - ensemble_voters:    list of canonical names each voter picked
      - ensemble_models:    list of model ids that contributed
      - ensemble_used:      True (lets the orchestrator stamp `meta`)
    """
    results = [r for r in results if isinstance(r, dict) and r.get("primary_diagnosis")]
    if not results:
        # Degenerate input — nothing to fuse. Return a minimal "uncertain"
        # shell rather than raise, so the orchestrator can still produce a
        # rescan response.
        return _empty_fallback()

    if len(results) == 1:
        # Nothing to vote on; return as-is but stamp the ensemble metadata
        # so cross_verify doesn't accidentally apply the agreement floor.
        single = dict(results[0])
        single["ensemble_agreement"] = "1/1"
        single["ensemble_voters"] = [_primary_canonical(results[0])]
        single["ensemble_models"] = [_model_id(results[0])]
        single["ensemble_used"] = False
        return single

    accuracy_weights = accuracy_weights or {}

    # ── Step 1: canonicalize ──────────────────────────────────────────────
    canon_primaries = [_primary_canonical(r) for r in results]

    # ── Step 2: vote ──────────────────────────────────────────────────────
    votes = Counter(name for name in canon_primaries if name)
    if not votes:
        return _empty_fallback()
    top_name, top_count = votes.most_common(1)[0]
    n = len(results)
    agreement_str = f"{top_count}/{n}"

    # Models that voted for the winner — used for confidence fusion.
    winners = [r for r, name in zip(results, canon_primaries) if name == top_name]
    losers  = [r for r, name in zip(results, canon_primaries) if name != top_name]

    # ── Step 3: fuse confidence ──────────────────────────────────────────
    weights = []
    confs   = []
    for r in winners:
        w = accuracy_weights.get(_model_id(r), 1.0)
        weights.append(w)
        confs.append(_safe_float(r.get("confidence_score"), 0.0))
    base_conf = (
        sum(c * w for c, w in zip(confs, weights)) / sum(weights)
        if sum(weights) > 0 else mean(confs) if confs else 0.0
    )

    # Agreement bonus / disagreement penalty.
    if top_count == n:
        base_conf = min(1.0, base_conf + 0.05)              # unanimous
    elif top_count >= max(2, (n + 1) // 2):
        base_conf = min(1.0, base_conf + 0.02)              # majority
    else:
        # Plurality only, OR all disagree → cap and flag for lab.
        base_conf = min(base_conf, 0.55)

    # ── Step 4: safety-biased merge of flags ─────────────────────────────
    needs_lab = any(r.get("needs_lab_confirmation") for r in results) or top_count < max(2, (n + 1) // 2)
    is_ood    = any(r.get("is_out_of_distribution") for r in results)
    crop_mis  = any(r.get("crop_mismatch") for r in results)
    severity_rank = max(_sev_rank((r.get("primary_diagnosis") or {}).get("severity")) for r in results)
    severity = _SEVERITY_ORDER[severity_rank].title()

    # Pathogen type — winner's wins, but fall back to majority if winner's missing.
    pathogen_type = (winners[0].get("primary_diagnosis") or {}).get("pathogen_type") or "unknown"
    if pathogen_type == "unknown":
        ptype_votes = Counter(
            ((r.get("primary_diagnosis") or {}).get("pathogen_type") or "unknown").lower()
            for r in results
        )
        pathogen_type = ptype_votes.most_common(1)[0][0]

    # Visual evidence — concatenate distinct phrases from the winners so the
    # report shows what the agreeing models actually saw.
    visual_evidence: list[str] = []
    seen_ve: set[str] = set()
    for r in winners:
        for v in (r.get("primary_diagnosis") or {}).get("visual_evidence") or []:
            if isinstance(v, str):
                k = v.strip().lower()
                if k and k not in seen_ve:
                    seen_ve.add(k)
                    visual_evidence.append(v.strip())

    # Differentials — start with the LOSERS' primary picks (they become
    # contenders), then merge in each model's own differentials, then
    # de-dup by canonical name. Always exclude the winner itself.
    diff_pool: dict[str, dict] = {}
    for r in losers:
        pd = r.get("primary_diagnosis") or {}
        name = canonicalize(pd.get("disease") or "")
        if not name or name == top_name:
            continue
        diff_pool[name.lower()] = {
            "disease":     name,
            "probability": _safe_float(r.get("confidence_score"), 0.3),
            "reason":      f"Picked by {_model_id(r) or 'a dissenting model'}",
        }
    for r in results:
        for d in _canon_differentials(r):
            name = d.get("disease") or ""
            if not name or name == top_name:
                continue
            key = name.lower()
            if key in diff_pool:
                # Bump probability if multiple models flagged it.
                diff_pool[key]["probability"] = max(
                    diff_pool[key]["probability"],
                    _safe_float(d.get("probability"), 0.0),
                )
            else:
                diff_pool[key] = {
                    "disease":     name,
                    "probability": _safe_float(d.get("probability"), 0.2),
                    "reason":      d.get("reason") or "Surfaced by ensemble",
                }
    differentials = sorted(diff_pool.values(), key=lambda x: x["probability"], reverse=True)[:5]

    # Scientific name — first winner's value, falling back to the
    # canonicalised primary (which is often already scientific).
    scientific_name = (winners[0].get("primary_diagnosis") or {}).get("scientific_name") or top_name

    fused: dict = {
        "primary_diagnosis": {
            "disease":         top_name,
            "scientific_name": scientific_name,
            "confidence":      base_conf,
            "severity":        severity,
            "visual_evidence": visual_evidence,
            "pathogen_type":   pathogen_type,
        },
        "differentials":          differentials,
        "confidence_score":       base_conf,
        "severity":               severity,
        "pathogen_type":          pathogen_type,
        "is_certain":             top_count == n and base_conf >= 0.7,
        "needs_advisor":          base_conf < 0.5 or needs_lab,
        "needs_lab_confirmation": needs_lab,
        "is_out_of_distribution": is_ood,
        "crop_mismatch":          crop_mis,
        "causal_factors":         _merged_causal_factors(results),
        "spread_risk":            _worst_spread(results),
        "weather_correlation":    _weather_correlation_consensus(results),
        "ensemble_agreement":     agreement_str,
        "ensemble_voters":        canon_primaries,
        "ensemble_models":        [_model_id(r) for r in results],
        "ensemble_used":          True,
    }

    # Preserve _visual_audit and _prompt_meta from the winning model that
    # had them — cross_verify and the report's audit trail rely on these.
    for r in winners + losers:
        if "_visual_audit" in r and "_visual_audit" not in fused:
            fused["_visual_audit"] = r["_visual_audit"]
        if "_prompt_meta" in r and "_prompt_meta" not in fused:
            fused["_prompt_meta"] = r["_prompt_meta"]

    logger.info(
        "[Reconciler] fused %d results → '%s' (agree=%s conf=%.2f lab=%s)",
        n, top_name, agreement_str, base_conf, needs_lab,
    )
    return fused


def _model_id(result: dict) -> str:
    """Pull a model id from a diagnose result if present."""
    if "_model" in result:
        return str(result["_model"])
    meta = result.get("_prompt_meta") or {}
    return str(meta.get("model") or meta.get("model_id") or "")


def _empty_fallback() -> dict:
    return {
        "primary_diagnosis": {
            "disease":     "Unknown",
            "confidence":  0.0,
            "severity":    "Unknown",
        },
        "differentials":          [],
        "confidence_score":       0.0,
        "severity":               "Unknown",
        "pathogen_type":          "unknown",
        "is_certain":             False,
        "needs_advisor":          True,
        "needs_lab_confirmation": True,
        "is_out_of_distribution": False,
        "crop_mismatch":          False,
        "causal_factors":         [],
        "spread_risk":            "UNKNOWN",
        "weather_correlation":    "PARTIAL",
        "ensemble_agreement":     "0/0",
        "ensemble_voters":        [],
        "ensemble_models":        [],
        "ensemble_used":          True,
    }
