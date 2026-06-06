"""
eval/load_eval.py — concurrent load-test + detailed accuracy/efficiency eval.

Unlike eval/golden_runner.py (which keeps only totals), this runner captures
the FULL per-stage breakdown the orchestrator already produces and never
surfaces:

  • per-stage TOKENS + cost   (report.meta.pipeline_token_usage.agents)
  • per-stage WALL TIME        (report.meta.budget.per_stage_seconds)
  • per-case latency, ensemble escalation, confidence, predicted vs truth
  • concurrency / throughput   (simulates N farmers scanning simultaneously)

It also tags every log line with the case id so you can WATCH all N pipelines
progress interleaved on the terminal — what "5 users diagnosing at once" looks
like in the logs.

Usage
  python -m eval.load_eval --manifest data/golden_set/batch01/manifest.jsonl --concurrency 5
"""
from __future__ import annotations

import argparse
import asyncio
import contextvars
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orchestrator import run_diagnosis  # noqa: E402
from eval.golden_runner import (        # noqa: E402
    _load_manifest, _resolve_images, _top1_match, _top3_match, _brier_term, _norm,
)

REPO_ROOT   = Path(__file__).resolve().parent.parent
REPORTS_DIR = REPO_ROOT / "eval" / "reports"

# ── Per-case log tagging ─────────────────────────────────────────────────────
# A contextvar set before each run_diagnosis() call; because asyncio tasks copy
# the current context at creation, every sub-task the orchestrator spawns
# inherits the right case tag. A logging.Filter stamps it onto each record.
_case_var: contextvars.ContextVar[str] = contextvars.ContextVar("case_id", default="-")


class _CaseFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.case = _case_var.get()
        return True


def _setup_logging(logfile: Path) -> None:
    fmt = logging.Formatter("%(asctime)s | %(case)-26s | %(message)s", datefmt="%H:%M:%S")
    flt = _CaseFilter()
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt); sh.addFilter(flt)
    fh = logging.FileHandler(logfile, mode="w")
    fh.setFormatter(fmt); fh.addFilter(flt)
    root.addHandler(sh); root.addHandler(fh)
    # Silence noisy HTTP / SDK loggers so the orchestrator stage logs stand out.
    for noisy in ("httpx", "httpcore", "anthropic", "openai", "google",
                  "google_genai", "urllib3", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


# ── Metric extraction ────────────────────────────────────────────────────────

def _extract(row: dict, report: dict, wall_start: float, t0: float, t1: float) -> dict:
    meta = report.get("meta") or {}
    pd   = report.get("disease") or {}
    truth = row["ground_truth"]
    truth_disease = truth.get("disease", "")
    predicted = pd.get("name_common", "")
    confidence = float(meta.get("confidence_score") or report.get("confidence_score") or 0)

    tok = (meta.get("pipeline_token_usage") or {})
    agents = tok.get("agents") or {}
    def _ag(name, key):
        return (agents.get(name) or {}).get(key, 0)
    per_stage_tokens = {
        name: {
            "model": (agents.get(name) or {}).get("model", ""),
            "input": _ag(name, "input_tokens"),
            "output": _ag(name, "output_tokens"),
            "total": _ag(name, "total_tokens"),
            "cost":  round(float(_ag(name, "cost_usd") or 0), 6),
        }
        for name in ("disease_diagnosis", "ensemble", "treatment", "weather_analysis", "report_generator")
    }
    per_stage_seconds = ((meta.get("budget") or {}).get("per_stage_seconds") or {})

    diffs = meta.get("differentials") or []
    top1 = _top1_match(predicted, truth_disease)
    top3 = _top3_match({"disease": pd, "differentials": diffs}, truth_disease)

    # report completeness signals
    tre = report.get("treatment") or {}
    return {
        "id": row["id"],
        "crop": row["params"].get("crop_name"),
        "truth_disease": truth_disease,
        "truth_severity": truth.get("severity", ""),
        "predicted_disease": predicted,
        "predicted_severity": pd.get("severity", ""),
        "pathogen_type": pd.get("pathogen_type", ""),
        "confidence": round(confidence, 4),
        "confidence_tier": pd.get("confidence_tier", ""),
        "top1": top1,
        "top3": top3,
        "differentials": [d.get("disease") for d in diffs if isinstance(d, dict)][:3],
        "escalated": bool(meta.get("escalated", False)),
        "needs_advisor": bool((report.get("advisor_needed")) or meta.get("needs_advisor")),
        "ensemble_used": bool(meta.get("ensemble_used", False)),
        "ensemble_agreement": meta.get("ensemble_agreement"),
        "ensemble_models": meta.get("ensemble_models") or [],
        "image_quality_score": meta.get("image_quality_score"),
        "model_diagnose": meta.get("model_diagnose"),
        "model_treatment": meta.get("model_treatment"),
        "brier_term": _brier_term(confidence, top1),
        # timing
        "pipeline_seconds": meta.get("pipeline_seconds"),
        "wall_latency": round(t1 - t0, 2),
        "rel_start": round(t0 - wall_start, 2),
        "rel_end": round(t1 - wall_start, 2),
        "per_stage_seconds": per_stage_seconds,
        # tokens / cost
        "per_stage_tokens": per_stage_tokens,
        "total_input_tokens": tok.get("total_input_tokens", 0),
        "total_output_tokens": tok.get("total_output_tokens", 0),
        "total_tokens": tok.get("total_tokens", 0),
        "cost_usd": round(float(tok.get("total_cost_usd") or 0), 6),
        # report quality
        "report_next_steps": len(report.get("next_steps") or []),
        "report_chemicals": len(tre.get("chemical") or []),
        "report_has_summary": bool(report.get("farmer_summary")),
        "report_id": meta.get("report_id") or report.get("report_id"),
    }


# ── Runner ───────────────────────────────────────────────────────────────────

_active = 0
_max_active = 0


async def _run_one(row: dict, manifest_dir: Path, wall_start: float, sem: asyncio.Semaphore) -> dict:
    global _active, _max_active
    async with sem:
        _case_var.set(row["id"])
        _active += 1
        _max_active = max(_max_active, _active)
        log = logging.getLogger("eval.load")
        log.info("▶ START  (active concurrent = %d)", _active)
        t0 = time.monotonic()
        try:
            images = _resolve_images(row["image_paths"], manifest_dir)
            report = await run_diagnosis(dict(row["params"]), images)
            t1 = time.monotonic()
            res = _extract(row, report, wall_start, t0, t1)
            log.info("✔ DONE   pred='%s' truth='%s' top1=%s conf=%.2f  %.1fs  $%.4f  %s",
                     res["predicted_disease"], res["truth_disease"], res["top1"],
                     res["confidence"], res["wall_latency"], res["cost_usd"],
                     "[ensemble]" if res["ensemble_used"] else "")
            return res
        except Exception as exc:
            t1 = time.monotonic()
            log.exception("✘ ERROR  %s", exc)
            return {"id": row["id"], "crop": row["params"].get("crop_name"),
                    "truth_disease": row["ground_truth"].get("disease", ""),
                    "error": f"{type(exc).__name__}: {exc}",
                    "wall_latency": round(t1 - t0, 2),
                    "rel_start": round(t0 - wall_start, 2), "rel_end": round(t1 - wall_start, 2)}
        finally:
            _active -= 1


# ── Aggregation + reporting ──────────────────────────────────────────────────

def _fmt_secs(x) -> str:
    return f"{x:.1f}s" if isinstance(x, (int, float)) else "—"


def _aggregate_and_print(per_row: list[dict], wall_clock: float, concurrency: int) -> dict:
    ok = [r for r in per_row if "error" not in r]
    errs = [r for r in per_row if "error" in r]

    print("\n" + "=" * 96)
    print("PER-CASE RESULTS (accuracy)")
    print("=" * 96)
    print(f"{'case':<26} {'top1':<5} {'top3':<5} {'conf':>5} {'pred':<22} {'truth':<20} {'ens':<4}")
    print("-" * 96)
    for r in per_row:
        if "error" in r:
            print(f"{r['id']:<26} ERROR  {r['error']}")
            continue
        print(f"{r['id']:<26} {('✓' if r['top1'] else '✗'):<5} {('✓' if r['top3'] else '✗'):<5} "
              f"{r['confidence']:>5.2f} {str(r['predicted_disease'])[:22]:<22} "
              f"{str(r['truth_disease'])[:20]:<20} {('Y' if r['ensemble_used'] else '-'):<4}")

    # ── Per-stage TOKENS ──
    print("\n" + "=" * 96)
    print("PER-STAGE TOKEN & COST BREAKDOWN  (sum across all cases)")
    print("=" * 96)
    print(f"{'stage':<20} {'model':<26} {'in':>10} {'out':>10} {'total':>10} {'cost $':>10}")
    print("-" * 96)
    stages = ("disease_diagnosis", "ensemble", "treatment", "weather_analysis", "report_generator")
    grand = {"in": 0, "out": 0, "total": 0, "cost": 0.0}
    for st in stages:
        tin = sum(r["per_stage_tokens"][st]["input"] for r in ok)
        tout = sum(r["per_stage_tokens"][st]["output"] for r in ok)
        tot = sum(r["per_stage_tokens"][st]["total"] for r in ok)
        cost = sum(r["per_stage_tokens"][st]["cost"] for r in ok)
        models = {r["per_stage_tokens"][st]["model"] for r in ok if r["per_stage_tokens"][st]["model"]}
        model_s = ",".join(sorted(models))[:26] or "—"
        grand["in"] += tin; grand["out"] += tout; grand["total"] += tot; grand["cost"] += cost
        print(f"{st:<20} {model_s:<26} {tin:>10,} {tout:>10,} {tot:>10,} {cost:>10.4f}")
    print("-" * 96)
    print(f"{'TOTAL':<20} {'':<26} {grand['in']:>10,} {grand['out']:>10,} {grand['total']:>10,} {grand['cost']:>10.4f}")

    # ── Per-stage TIME ──
    print("\n" + "=" * 96)
    print("PER-STAGE WALL-TIME  (mean across cases that ran the stage)")
    print("=" * 96)
    print(f"{'stage':<20} {'mean':>8} {'max':>8} {'#cases':>8}")
    print("-" * 96)
    for st in ("diagnose", "ensemble", "treatment"):
        vals = [r["per_stage_seconds"].get(st) for r in ok if r["per_stage_seconds"].get(st)]
        if vals:
            print(f"{st:<20} {mean(vals):>8.1f} {max(vals):>8.1f} {len(vals):>8}")
        else:
            print(f"{st:<20} {'—':>8} {'—':>8} {0:>8}")

    # ── Efficiency / throughput ──
    lat = [r["wall_latency"] for r in ok]
    sum_seq = sum(lat)
    print("\n" + "=" * 96)
    print("EFFICIENCY  /  THROUGHPUT")
    print("=" * 96)
    if lat:
        lat_sorted = sorted(lat)
        p95 = lat_sorted[min(len(lat_sorted) - 1, int(round(0.95 * (len(lat_sorted) - 1))))]
        print(f"  cases (ok/total)      : {len(ok)}/{len(per_row)}")
        print(f"  requested concurrency : {concurrency}   |   max observed concurrent : {_max_active}")
        print(f"  wall-clock (parallel) : {wall_clock:.1f}s")
        print(f"  sum of latencies (seq): {sum_seq:.1f}s")
        print(f"  parallel speedup      : {sum_seq / wall_clock:.2f}x" if wall_clock else "  speedup: —")
        print(f"  throughput            : {len(ok) / wall_clock * 60:.1f} scans/min" if wall_clock else "")
        print(f"  latency mean / median : {mean(lat):.1f}s / {median(lat):.1f}s")
        print(f"  latency min / p95 /max: {min(lat):.1f}s / {p95:.1f}s / {max(lat):.1f}s")
        print(f"  total tokens          : {grand['total']:,}")
        print(f"  total cost            : ${grand['cost']:.4f}   (${grand['cost']/max(len(ok),1):.4f}/scan)")

    # ── Accuracy aggregate ──
    print("\n" + "=" * 96)
    print("ACCURACY  /  CALIBRATION")
    print("=" * 96)
    metrics = {}
    if ok:
        top1 = mean(int(r["top1"]) for r in ok)
        top3 = mean(int(r["top3"]) for r in ok)
        brier = mean(r["brier_term"] for r in ok)
        mconf = mean(r["confidence"] for r in ok)
        esc = mean(int(r["escalated"]) for r in ok)
        ens = mean(int(r["ensemble_used"]) for r in ok)
        sev_ok = [r for r in ok if r["truth_severity"] and r["predicted_severity"]]
        sev_acc = mean(int(_norm(r["predicted_severity"]) == _norm(r["truth_severity"])) for r in sev_ok) if sev_ok else None
        metrics = {
            "top1": round(top1, 4), "top3": round(top3, 4), "brier": round(brier, 4),
            "mean_confidence": round(mconf, 4), "escalation_rate": round(esc, 4),
            "ensemble_rate": round(ens, 4),
            "severity_accuracy": round(sev_acc, 4) if sev_acc is not None else None,
        }
        print(f"  top-1 accuracy        : {top1:.0%}   ({sum(int(r['top1']) for r in ok)}/{len(ok)})")
        print(f"  top-3 accuracy        : {top3:.0%}")
        print(f"  Brier score (↓ better): {brier:.4f}")
        print(f"  mean confidence       : {mconf:.0%}")
        print(f"  escalation rate       : {esc:.0%}")
        print(f"  ensemble-fired rate   : {ens:.0%}")
        if sev_acc is not None:
            print(f"  severity accuracy     : {sev_acc:.0%}")

    # ── Report quality ──
    if ok:
        print("\n" + "=" * 96)
        print("REPORT QUALITY")
        print("=" * 96)
        print(f"  avg next-step actions : {mean(r['report_next_steps'] for r in ok):.1f}")
        print(f"  avg chemical controls : {mean(r['report_chemicals'] for r in ok):.1f}")
        print(f"  % with farmer summary : {mean(int(r['report_has_summary']) for r in ok):.0%}")

    if errs:
        print(f"\n  ⚠ {len(errs)} case(s) errored: " + ", ".join(r["id"] for r in errs))

    return {
        "wall_clock_seconds": round(wall_clock, 2),
        "sum_latency_seconds": round(sum_seq, 2),
        "speedup": round(sum_seq / wall_clock, 2) if wall_clock else None,
        "throughput_scans_per_min": round(len(ok) / wall_clock * 60, 2) if wall_clock else None,
        "max_observed_concurrency": _max_active,
        "requested_concurrency": concurrency,
        "total_tokens": grand["total"],
        "total_cost_usd": round(grand["cost"], 6),
        "ok": len(ok), "errors": len(errs),
        "metrics": metrics,
    }


async def _main(args) -> int:
    manifest_path = Path(args.manifest).resolve()
    rows = _load_manifest(manifest_path)
    manifest_dir = manifest_path.parent
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    _setup_logging(REPORTS_DIR / f"loadtest-{ts}.log")

    log = logging.getLogger("eval.load")
    _case_var.set("MAIN")

    # Eval-only: pin the diagnose prompt version deterministically (e.g. v1 vs v2)
    # without touching production ACTIVE_VERSIONS weights. Set AI_DIAGNOSE_VERSION=v2.
    _ver = os.environ.get("AI_DIAGNOSE_VERSION", "").strip()
    if _ver:
        from agents import prompt_registry
        prompt_registry.ACTIVE_VERSIONS["diagnose"] = _ver
        log.info("[eval] Pinned diagnose prompt to '%s'", _ver)

    log.info("Loaded %d cases | concurrency=%d (simulating %d simultaneous farmers)",
             len(rows), args.concurrency, args.concurrency)

    sem = asyncio.Semaphore(args.concurrency)
    wall_start = time.monotonic()
    per_row = await asyncio.gather(*(_run_one(r, manifest_dir, wall_start, sem) for r in rows))
    wall_clock = time.monotonic() - wall_start

    agg = _aggregate_and_print(per_row, wall_clock, args.concurrency)

    out = {"timestamp": ts, "manifest": str(manifest_path),
           "summary": agg, "rows": per_row}
    out_path = REPORTS_DIR / f"loadtest-{ts}.json"
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True, default=str))
    print(f"\nWrote {out_path}")
    print(f"Wrote {REPORTS_DIR / f'loadtest-{ts}.log'}")
    return 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Concurrent load-test + detailed eval of the diagnosis pipeline")
    p.add_argument("--manifest", required=True)
    p.add_argument("--concurrency", type=int, default=5)
    return p.parse_args()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(_main(_parse_args())))
    except KeyboardInterrupt:
        sys.exit(130)
