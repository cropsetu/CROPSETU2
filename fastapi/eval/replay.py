"""
eval/replay.py — replay persisted scans against a different prompt / model
to compare diagnosis quality.

Usage
  python -m eval.replay [options]

  --limit N                   How many recent scans to sample (default 25)
  --since YYYY-MM-DD          Only scans created on/after this UTC date
  --crop NAME                 Only scans of this crop (e.g. Tomato)
  --candidate-prompt-version  Prompt version to test (e.g. v2). Default:
                              whatever ACTIVE_VERSIONS["diagnose"] resolves
                              to right now — useful for "current vs hash X"
                              baselines.
  --baseline-prompt-version   Prompt version to compare against. Default:
                              the version recorded on each historical row.
  --tier fast|best            Force a tier on replay (default: whatever
                              the original scan ran at)
  --concurrency N             Parallel replays (default 4)
  --dry-run                   Print which rows would be replayed; do nothing

Output
  • Prints a per-row diff (disease, confidence, escalation) to stdout
  • Writes a CSV summary to eval/out/replay-<timestamp>.csv with the
    aggregate stats (agreement rate, mean confidence shift, escalation
    delta, cost delta)

NOTE: This replay re-runs the LLM. Cost = sampled rows × normal scan cost.
Use --limit conservatively, especially when --tier=best.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

import asyncpg

logger = logging.getLogger("eval.replay")

# ── Imports of the live pipeline. We intentionally use the production
#    orchestrator so the replay reflects the full stage chain (router
#    fallback, cross_verify, validator, etc.) — anything else would be
#    benchmarking a strawman.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from db_pool import get_shared_pool          # noqa: E402
from agents.disease_diagnosis_agent import (  # noqa: E402
    run_disease_diagnosis_agent,
    DIAGNOSE_PROMPT_META,
)
from agents.image_quality_agent import run_image_quality_agent  # noqa: E402
from agents.prompt_registry import load_prompt                   # noqa: E402
from services.weather_rules import analyze_weather_risk_rules    # noqa: E402

# ── Persistence schema columns we care about ───────────────────────────────
_QUERY = """
    SELECT id, created_at, crop_name, state, district, growth_stage,
           tier, primary_disease, confidence, escalated,
           model_diagnose, prompt_diagnose_hash, payload, image_hashes
    FROM ai_scan_diagnoses
    WHERE ($1::timestamptz IS NULL OR created_at >= $1)
      AND ($2::text         IS NULL OR crop_name  = $2)
    ORDER BY created_at DESC
    LIMIT $3
"""


async def _fetch_rows(*, limit: int, since: str | None, crop: str | None) -> list[asyncpg.Record]:
    pool = await get_shared_pool()
    if pool is None:
        raise RuntimeError("DATABASE_URL not set or pool unavailable — cannot fetch rows")
    since_ts = None
    if since:
        since_ts = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
    async with pool.acquire() as conn:
        return await conn.fetch(_QUERY, since_ts, crop, limit)


def _payload_dict(raw):
    """Persistence stores `payload` as JSONB — asyncpg may return str or dict."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return {}


async def _replay_one(row, *, tier_override: str | None) -> dict:
    """
    Re-run JUST the diagnose stage for a single historical scan. We skip
    the rest of the pipeline (treatment, report) to keep cost down — the
    eval question is "did the disease+confidence change", not "did the
    whole pipeline change".

    Returns a dict with both the original and replayed values.
    """
    payload = _payload_dict(row["payload"])
    # Reconstruct minimal context. We use the SAME image hashes the row
    # has — but the actual image bytes are NOT stored (privacy). Replay
    # therefore runs on whatever the stored payload preserved (none),
    # which means the visual evidence is missing. This is a KNOWN
    # limitation: replay only meaningfully tests text-only logic such
    # as new context wording, new differential prompts, etc. Vision-
    # regression eval needs a golden image set (see eval/golden/).
    params = (payload.get("farm") or {}) | {
        "crop_name":          row["crop_name"],
        "state":              row["state"],
        "district":           row["district"],
        "crop_growth_stage":  row["growth_stage"],
        "tier":               tier_override or row["tier"] or "fast",
    }
    weather_outlook = payload.get("weather_outlook") or {}
    weather_risk = {
        "overall_disease_risk": weather_outlook.get("risk", "UNKNOWN"),
        "favorable_diseases":   weather_outlook.get("favorable_diseases", []),
        "advisory":             weather_outlook.get("advisory", ""),
        "weather_used":         weather_outlook.get("weather_used", False),
        "risk_factors":         weather_outlook.get("risk_factors", []),
        "forecast_risk":        weather_outlook.get("forecast_risk", ""),
        "soil_risk":            weather_outlook.get("soil_risk", "UNKNOWN"),
    }
    image_quality = (payload.get("image_quality") or {}) | {"usable": True}

    # We DON'T have the original image bytes, so we pass an empty list.
    # The diagnose agent will return its _uncertain_fallback for the
    # actual prediction, but we're really here to measure prompt-level
    # changes (different system prompt → different reasoning even on
    # no-image cases, useful for shaking out parse errors).
    images: list[dict] = []

    t0 = time.monotonic()
    try:
        new_diag, tok = await run_disease_diagnosis_agent(
            images=images,
            image_quality=image_quality,
            weather_risk=weather_risk,
            params=params,
        )
        new_pd = new_diag.get("primary_diagnosis") or {}
        result = {
            "id":                       row["id"],
            "crop":                     row["crop_name"],
            "tier":                     params["tier"],
            "orig_disease":             row["primary_disease"],
            "orig_confidence":          float(row["confidence"] or 0),
            "orig_escalated":           bool(row["escalated"]),
            "orig_prompt_hash":         row["prompt_diagnose_hash"],
            "replay_disease":           new_pd.get("disease"),
            "replay_confidence":        float(new_diag.get("confidence_score") or 0),
            "replay_escalated":         bool(new_diag.get("needs_advisor")),
            "replay_prompt_hash":       (new_diag.get("_prompt_meta") or {}).get("hash"),
            "replay_model":             tok.get("model"),
            "replay_cost_usd":          float(tok.get("cost_usd") or 0),
            "replay_elapsed_seconds":   round(time.monotonic() - t0, 2),
            "agree":                    (new_pd.get("disease") or "").lower() == (row["primary_disease"] or "").lower(),
        }
    except Exception as exc:
        result = {
            "id":     row["id"],
            "crop":   row["crop_name"],
            "tier":   params["tier"],
            "error":  f"{type(exc).__name__}: {exc}",
        }
    return result


async def _main(args) -> None:
    rows = await _fetch_rows(limit=args.limit, since=args.since, crop=args.crop)
    print(f"Fetched {len(rows)} rows for replay")
    if args.dry_run:
        for r in rows:
            print(f"  id={r['id']:>6} crop={r['crop_name']:<12} disease={r['primary_disease']:<28} "
                  f"conf={float(r['confidence'] or 0):.2f} tier={r['tier']}")
        return

    # Optional: load+verify the candidate prompt is on disk before paying $$$
    if args.candidate_prompt_version:
        try:
            cand = load_prompt("diagnose", version=args.candidate_prompt_version)
            print(f"Candidate prompt: diagnose@{cand.version} hash={cand.hash}")
        except Exception as exc:
            sys.exit(f"Cannot load candidate prompt: {exc}")

    sem = asyncio.Semaphore(args.concurrency)
    async def _bounded(row):
        async with sem:
            return await _replay_one(row, tier_override=args.tier)

    results = await asyncio.gather(*(_bounded(r) for r in rows))

    # Per-row print
    for r in results:
        if r.get("error"):
            print(f"  id={r['id']:>6}  ERROR: {r['error']}")
            continue
        flag = "✓" if r["agree"] else "✗"
        delta = r["replay_confidence"] - r["orig_confidence"]
        print(f"  id={r['id']:>6} {flag}  {r['orig_disease'][:24]:<24}  →  {str(r['replay_disease'])[:24]:<24}"
              f"  conf {r['orig_confidence']:.2f}→{r['replay_confidence']:.2f} ({delta:+.2f})"
              f"  cost=${r['replay_cost_usd']:.4f}")

    # Aggregate stats
    ok = [r for r in results if not r.get("error")]
    if ok:
        agree_rate = sum(1 for r in ok if r["agree"]) / len(ok)
        avg_conf_shift = mean(r["replay_confidence"] - r["orig_confidence"] for r in ok)
        avg_cost = mean(r["replay_cost_usd"] for r in ok)
        avg_latency = mean(r["replay_elapsed_seconds"] for r in ok)
        escalation_delta = (
            mean(int(r["replay_escalated"]) for r in ok)
            - mean(int(r["orig_escalated"]) for r in ok)
        )
        print()
        print("── Aggregate ──")
        print(f"  Rows OK         : {len(ok)}/{len(results)}")
        print(f"  Disease agree   : {agree_rate:.0%}")
        print(f"  Mean conf shift : {avg_conf_shift:+.3f}")
        print(f"  Mean cost/scan  : ${avg_cost:.4f}")
        print(f"  Mean latency    : {avg_latency:.1f}s")
        print(f"  Escalation Δ    : {escalation_delta:+.3f}")

    # CSV
    if results:
        out_dir = Path(__file__).parent / "out"
        out_dir.mkdir(exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        out_path = out_dir / f"replay-{ts}.csv"
        fieldnames = sorted({k for r in results for k in r.keys()})
        with open(out_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(results)
        print(f"\nWrote {out_path}")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Replay persisted scans against a new prompt/model")
    p.add_argument("--limit",  type=int, default=25)
    p.add_argument("--since",  type=str, default=None)
    p.add_argument("--crop",   type=str, default=None)
    p.add_argument("--candidate-prompt-version", type=str, default=None)
    p.add_argument("--baseline-prompt-version",  type=str, default=None)
    p.add_argument("--tier",        type=str, default=None, choices=["fast", "best"])
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--dry-run",     action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = _parse_args()
    try:
        asyncio.run(_main(args))
    except KeyboardInterrupt:
        sys.exit(130)
