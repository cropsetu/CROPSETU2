"""
eval/golden_runner.py — run the full diagnosis pipeline against a labeled
golden set of leaf images and emit accuracy + calibration metrics.

Why this exists
  replay.py re-runs the diagnose stage on persisted scans, but the
  original image bytes were never stored, so replays test prompt-only
  changes. The golden runner is the vision-regression gate: real
  labeled images on disk, full orchestrator (cascade -> ensemble -> RAG
  -> safety), aggregate metrics, machine-readable report.

Manifest format (data/golden_set/manifest.jsonl)
  One JSON object per line:
    {
      "id":           "tomato-late-blight-001",
      "image_paths":  ["/abs/or/relative/to/golden_set/img1.jpg"],
      "params":       { "crop_name": "Tomato", "crop_growth_stage": "Flowering",
                        "soil_type": "Loam", "irrigation_system": "Drip",
                        "planting_date": "2026-02-01", "state": "Maharashtra",
                        "district": "Pune", "tier": "fast", "language": "en" },
      "ground_truth": { "disease": "Late Blight",
                        "scientific_name": "Phytophthora infestans",
                        "severity": "MODERATE" }
    }

Usage
  python -m eval.golden_runner
  python -m eval.golden_runner --manifest custom.jsonl --concurrency 2
  python -m eval.golden_runner --baseline eval/reports/baseline.json

Output
  • eval/reports/{git_sha}_{utc_timestamp}.json  (always written)
  • stdout summary table
  • If --baseline given, a markdown diff vs that report
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Optional

# Make `agents.*`, `orchestrator`, etc. importable when run as `python -m eval.golden_runner`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orchestrator import run_diagnosis  # noqa: E402
from data.disease_synonyms import same_disease, _norm  # noqa: E402

logger = logging.getLogger("eval.golden_runner")

REPO_ROOT       = Path(__file__).resolve().parent.parent
DEFAULT_MFEST   = REPO_ROOT / "data" / "golden_set" / "manifest.jsonl"
REPORTS_DIR     = REPO_ROOT / "eval" / "reports"


# ── Manifest loading ─────────────────────────────────────────────────────────

def _load_manifest(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"Manifest not found: {path}")
    rows: list[dict] = []
    with path.open() as f:
        for lineno, raw in enumerate(f, 1):
            raw = raw.strip()
            if not raw or raw.startswith("#"):
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Manifest line {lineno} not valid JSON: {exc}")
            for key in ("id", "image_paths", "params", "ground_truth"):
                if key not in row:
                    raise ValueError(f"Manifest line {lineno} missing key '{key}'")
            rows.append(row)
    return rows


def _resolve_images(image_paths: list[str], manifest_dir: Path) -> list[dict]:
    """Resolve relative paths against the manifest's directory and shape the
    list the way `orchestrator.run_diagnosis` expects: [{path, type}]."""
    out: list[dict] = []
    for p in image_paths:
        path = Path(p)
        if not path.is_absolute():
            path = manifest_dir / p
        if not path.exists():
            raise FileNotFoundError(f"Golden image not found: {path}")
        out.append({"path": str(path), "type": "leaf"})
    return out


# ── Per-row scoring ──────────────────────────────────────────────────────────

def _top1_match(predicted_primary: str, truth_disease: str, crop: Optional[str] = None) -> bool:
    """STRICT, production-matching: crop-scoped canonical equality — the SAME
    matcher snap/reconciler use, so eval reflects production (gates regressions)."""
    if not _norm(predicted_primary) or not _norm(truth_disease):
        return False
    return same_disease(predicted_primary, truth_disease, crop=crop)


def _top1_match_lenient(predicted_primary: str, truth_disease: str, crop: Optional[str] = None) -> bool:
    """LENIENT (diagnostic only): strict OR raw substring — surfaces close /
    not-yet-mapped names. NEVER used to gate regressions."""
    if _top1_match(predicted_primary, truth_disease, crop):
        return True
    p, t = _norm(predicted_primary), _norm(truth_disease)
    return bool(p and t and (p == t or p in t or t in p))


def _top3_match(report: dict, truth_disease: str, crop: Optional[str] = None) -> bool:
    """Truth appears in primary OR any of the LLM's top differentials (strict)."""
    candidates: list[str] = []
    primary = (report.get("disease") or {}).get("name_common")
    if primary:
        candidates.append(primary)
    diffs = (report.get("differentials")
             or (report.get("meta") or {}).get("differentials")
             or [])
    for d in diffs[:2]:
        if isinstance(d, dict):
            name = d.get("disease") or d.get("name") or d.get("name_common")
            if name:
                candidates.append(name)
    return any(_top1_match(c, truth_disease, crop) for c in candidates)


def _brier_term(predicted_confidence: float, correct: bool) -> float:
    """Per-row Brier contribution = (conf - target)**2 with target = 1 if correct else 0."""
    target = 1.0 if correct else 0.0
    return (predicted_confidence - target) ** 2


# ── Runner ───────────────────────────────────────────────────────────────────

async def _run_one(row: dict, manifest_dir: Path) -> dict:
    rid = row["id"]
    t0 = time.monotonic()
    try:
        images = _resolve_images(row["image_paths"], manifest_dir)
        report = await run_diagnosis(dict(row["params"]), images)
    except Exception as exc:
        return {
            "id": rid,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_seconds": round(time.monotonic() - t0, 2),
        }
    meta = report.get("meta") or {}
    pd   = report.get("disease") or {}
    truth = row["ground_truth"]
    truth_disease = truth.get("disease", "")
    predicted_primary = pd.get("name_common", "")
    crop = (row.get("params") or {}).get("crop_name")
    confidence = float(meta.get("confidence_score") or pd.get("confidence_pct", 0) / 100.0 or 0)
    top1 = _top1_match(predicted_primary, truth_disease, crop)
    top1_lenient = _top1_match_lenient(predicted_primary, truth_disease, crop)
    top3 = _top3_match(report, truth_disease, crop)
    cost = float(((meta.get("pipeline_token_usage") or {}).get("total_cost_usd")) or 0)
    # Severity accuracy (canonical {None,Mild,Moderate,Severe}) — only scored
    # when the manifest carries a ground-truth severity.
    truth_sev = truth.get("severity")
    if truth_sev:
        from data.severity import normalize_severity as _nsev
        pred_sev = pd.get("severity") or pd.get("severity_label") or ""
        severity_match = _nsev(pred_sev) == _nsev(truth_sev)
    else:
        severity_match = None
    return {
        "id":                 rid,
        "truth_disease":      truth_disease,
        "predicted_disease":  predicted_primary,
        "confidence":         confidence,
        "top1":               top1,
        "top1_lenient":       top1_lenient,
        "top3":               top3,
        "severity_match":     severity_match,
        "escalated":          bool(meta.get("escalated", False)),
        "brier_term":         _brier_term(confidence, top1),
        "cost_usd":           cost,
        "elapsed_seconds":    round(time.monotonic() - t0, 2),
        "tier":               meta.get("tier"),
        "model_diagnose":     meta.get("model_diagnose"),
        "ensemble_used":      bool(meta.get("ensemble_used", False)),
    }


def _aggregate(per_row: list[dict]) -> dict:
    ok = [r for r in per_row if "error" not in r]
    errs = [r for r in per_row if "error" in r]
    if not ok:
        return {"rows": len(per_row), "ok": 0, "errors": len(errs), "metrics": {}}
    top1_rate = mean(int(r["top1"]) for r in ok)
    top1_lenient_rate = mean(int(r.get("top1_lenient", r["top1"])) for r in ok)
    top3_rate = mean(int(r["top3"]) for r in ok)
    escalation_rate = mean(int(r["escalated"]) for r in ok)
    ensemble_rate = mean(int(r["ensemble_used"]) for r in ok)
    brier = mean(r["brier_term"] for r in ok)
    mean_conf = mean(r["confidence"] for r in ok)
    mean_cost = mean(r["cost_usd"] for r in ok)
    mean_latency = mean(r["elapsed_seconds"] for r in ok)
    escalated = [r for r in ok if r["escalated"]]
    top1_escalated = mean(int(r["top1"]) for r in escalated) if escalated else None
    not_escalated = [r for r in ok if not r["escalated"]]
    top1_not_escalated = mean(int(r["top1"]) for r in not_escalated) if not_escalated else None
    sev_rows = [r for r in ok if r.get("severity_match") is not None]
    severity_accuracy = mean(int(r["severity_match"]) for r in sev_rows) if sev_rows else None
    return {
        "rows": len(per_row),
        "ok": len(ok),
        "errors": len(errs),
        "metrics": {
            "top1":               round(top1_rate, 4),
            "top1_lenient":       round(top1_lenient_rate, 4),
            "top3":               round(top3_rate, 4),
            "brier":              round(brier, 4),
            "mean_confidence":    round(mean_conf, 4),
            "escalation_rate":    round(escalation_rate, 4),
            "ensemble_rate":      round(ensemble_rate, 4),
            "mean_cost_usd":      round(mean_cost, 6),
            "mean_latency_s":     round(mean_latency, 2),
            "top1_escalated":     round(top1_escalated, 4) if top1_escalated is not None else None,
            "top1_not_escalated": round(top1_not_escalated, 4) if top1_not_escalated is not None else None,
            "severity_accuracy":  round(severity_accuracy, 4) if severity_accuracy is not None else None,
        },
    }


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def _markdown_diff(baseline: dict, current: dict) -> str:
    """Render a one-page comparison table. Both reports are aggregator outputs."""
    bm = (baseline.get("aggregate") or {}).get("metrics") or {}
    cm = (current.get("aggregate")  or {}).get("metrics") or {}
    keys = ["top1", "top3", "brier", "mean_confidence", "escalation_rate",
            "ensemble_rate", "mean_cost_usd", "mean_latency_s",
            "top1_escalated", "top1_not_escalated"]
    lines = [
        f"# Golden-set diff: {baseline.get('git_sha','?')} → {current.get('git_sha','?')}",
        "",
        f"Rows: {baseline.get('aggregate',{}).get('ok',0)} (baseline) "
        f"vs {current.get('aggregate',{}).get('ok',0)} (current). "
        f"Manifest: `{current.get('manifest','?')}`",
        "",
        "| metric | baseline | current | Δ |",
        "|---|---:|---:|---:|",
    ]
    for k in keys:
        b = bm.get(k); c = cm.get(k)
        if b is None and c is None:
            continue
        if isinstance(b, (int, float)) and isinstance(c, (int, float)):
            delta = c - b
            sign = "+" if delta >= 0 else ""
            lines.append(f"| {k} | {b:.4f} | {c:.4f} | {sign}{delta:.4f} |")
        else:
            lines.append(f"| {k} | {b} | {c} | — |")
    return "\n".join(lines) + "\n"


async def _main(args) -> int:
    manifest_path = Path(args.manifest).resolve()
    rows = _load_manifest(manifest_path)
    print(f"Loaded {len(rows)} golden rows from {manifest_path}")
    if not rows:
        print("Manifest is empty — nothing to do.")
        return 0
    manifest_dir = manifest_path.parent

    sem = asyncio.Semaphore(args.concurrency)
    async def _bounded(row):
        async with sem:
            return await _run_one(row, manifest_dir)

    per_row = await asyncio.gather(*(_bounded(r) for r in rows))

    # Per-row print
    for r in per_row:
        if "error" in r:
            print(f"  {r['id']:<32}  ERROR  {r['error']}")
            continue
        top1 = "✓" if r["top1"] else "✗"
        top3 = "✓" if r["top3"] else "✗"
        ens  = "[ens]" if r["ensemble_used"] else "     "
        print(f"  {r['id']:<32} top1 {top1}  top3 {top3} {ens}  "
              f"conf={r['confidence']:.2f}  cost=${r['cost_usd']:.4f}  "
              f"truth='{r['truth_disease']}' pred='{r['predicted_disease']}'")

    aggregate = _aggregate(per_row)
    m = aggregate.get("metrics") or {}
    print()
    print("── Aggregate ──")
    print(f"  Rows OK         : {aggregate['ok']}/{aggregate['rows']}")
    if m:
        print(f"  top-1           : {m['top1']:.2%}")
        print(f"  top-3           : {m['top3']:.2%}")
        print(f"  Brier           : {m['brier']:.4f}")
        print(f"  mean conf       : {m['mean_confidence']:.3f}")
        print(f"  escalation rate : {m['escalation_rate']:.2%}")
        print(f"  ensemble rate   : {m['ensemble_rate']:.2%}")
        print(f"  mean cost/scan  : ${m['mean_cost_usd']:.4f}")
        print(f"  mean latency    : {m['mean_latency_s']:.1f}s")
        if m["top1_escalated"] is not None:
            print(f"  top-1 (escalated only)     : {m['top1_escalated']:.2%}")
        if m["top1_not_escalated"] is not None:
            print(f"  top-1 (not escalated only) : {m['top1_not_escalated']:.2%}")

    # Persist report
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    sha = _git_sha()
    report = {
        "git_sha":   sha,
        "timestamp": ts,
        "manifest":  str(manifest_path),
        "aggregate": aggregate,
        "rows":      per_row,
    }
    out_path = REPORTS_DIR / f"{sha}_{ts}.json"
    with out_path.open("w") as f:
        json.dump(report, f, indent=2, sort_keys=True)
    print(f"\nWrote {out_path}")

    if args.baseline:
        baseline_path = Path(args.baseline).resolve()
        if not baseline_path.exists():
            print(f"Baseline not found: {baseline_path}", file=sys.stderr)
            return 1
        baseline = json.loads(baseline_path.read_text())
        diff_md = _markdown_diff(baseline, report)
        diff_path = REPORTS_DIR / f"{sha}_{ts}.diff.md"
        diff_path.write_text(diff_md)
        print(f"Wrote {diff_path}")
        print()
        print(diff_md)
    return 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run the diagnosis pipeline against a labeled golden set")
    p.add_argument("--manifest", type=str, default=str(DEFAULT_MFEST),
                   help=f"Path to manifest.jsonl (default: {DEFAULT_MFEST})")
    p.add_argument("--concurrency", type=int, default=2,
                   help="Parallel scans. Keep low — each one costs real $ and "
                        "burns provider quota.")
    p.add_argument("--baseline", type=str, default=None,
                   help="Path to a previous golden_runner JSON report; emit a "
                        "markdown diff against it.")
    return p.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        sys.exit(asyncio.run(_main(_parse_args())))
    except KeyboardInterrupt:
        sys.exit(130)
