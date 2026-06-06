"""
eval/run_book_dataset.py — run the REAL diagnosis pipeline against the
"Diseases of Horticultural Crops" textbook image dataset and validate accuracy.

Dataset (downloaded by the user): a folder with
  crop_disease_dataset.json   — [{image_file, crop, disease, pathogen, ...}]
  images/<image_file>         — the actual plates
Disease labels may be pipe-separated ("A | B" = the source page covered both,
so the image may show EITHER) and may contain "/" alternates ("Scab/Verucosis").
A prediction counts correct if it matches ANY of those alternates.

What this does (per the request):
  • Processes the dataset in BATCHES of N (default 10), small concurrency.
  • For every image, runs orchestrator.run_diagnosis and writes the FULL AI
    response to  <out>/responses/<id>.json  (one-by-one, exactly what the AI returned).
  • Scores each prediction (synonym-aware, multi-truth) → top-1 + top-3.
  • After each batch, writes a markdown comparison TABLE (<out>/batchNN_comparison.md)
    and appends per-image rows to <out>/results.jsonl. Prints the table to stdout.

Usage
  python -m eval.run_book_dataset --batches 1                 # just batch 1
  python -m eval.run_book_dataset --batches 1-3 --batch-size 10 --concurrency 3
  python -m eval.run_book_dataset --batches all
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orchestrator import run_diagnosis                       # noqa: E402
from data.disease_synonyms import same_disease, _norm        # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = Path("/Users/shubhamyeljale/Desktop/Image Download/crop_dataset")
DEFAULT_OUT = REPO_ROOT / "eval" / "reports" / "book_dataset"

# Compound / non-canonical dataset crop categories → a single crop our pipeline
# understands. Anything not listed flows through normalize_crop_name (covered
# crops get a candidate list; the rest fall back to open vocabulary).
CROP_MAP = {
    "Bhendi (Okra)":        "Okra",
    "Onion & Garlic":       "Onion",
    "Pomegranate & Papaya": "Pomegranate",
    "Guava & Sapota":       "Guava",
    "Coconut & Oil palm":   "Coconut",
    "Citrus":               "Orange",
    "Crucifers":            "Cabbage",
    "Cucurbits":            "Cucumber",
    "Jasmine & Crossandra": "Jasmine",
}
DEFAULT_CTX = {
    "crop_growth_stage": "Vegetative", "soil_type": "Loam",
    "irrigation_system": "Drip", "state": "Maharashtra", "district": "Pune",
    "planting_date": "2026-03-01", "tier": "best", "language": "en",
}


def _truth_alternates(disease_str: str) -> list[str]:
    """'Scab/Verucosis | Canker' → ['Scab','Verucosis','Canker'] (acceptable answers)."""
    parts = re.split(r"[|/]", disease_str or "")
    return [p.strip() for p in parts if p.strip() and "general" not in p.lower()]


_BAD = {"unknown", "uncertain", "service_unavailable", "service unavailable", "undetermined", ""}


def _matches(pred: str, truth_list: list[str], crop: str | None = None) -> bool:
    """STRICT: crop-scoped canonical equality (the production matcher)."""
    if not pred or _norm(pred) in _BAD:
        return False
    return any(same_disease(pred, t, crop=crop) for t in truth_list)


def _matches_lenient(pred: str, truth_list: list[str], crop: str | None = None) -> bool:
    """LENIENT (diagnostic only): strict OR raw substring — surfaces close /
    not-yet-mapped names. NEVER used to gate regressions."""
    if not pred or _norm(pred) in _BAD:
        return False
    if _matches(pred, truth_list, crop):
        return True
    p = _norm(pred)
    for t in truth_list:
        tn = _norm(t)
        if p and tn and (p == tn or p in tn or tn in p):
            return True
    return False


def _load_cases(dataset: Path):
    from services.input_normalizer import normalize_crop_name
    recs = json.loads((dataset / "crop_disease_dataset.json").read_text())
    cases = []
    for r in recs:
        if "Cover" in r.get("crop", ""):           # skip cover/front-matter plates
            continue
        img = dataset / "images" / r["image_file"]
        if not img.exists():
            continue
        raw_crop = r["crop"]
        crop = CROP_MAP.get(raw_crop) or normalize_crop_name(raw_crop) or raw_crop
        cid = re.sub(r"\.(jpg|jpeg|png)$", "", r["image_file"], flags=re.I)
        cases.append({
            "id": cid,
            "image": str(img.resolve()),
            "raw_crop": raw_crop,
            "crop": crop,
            "truths": _truth_alternates(r["disease"]),
            "truth_str": r["disease"],
        })
    return cases


async def _run_one(case: dict, responses_dir: Path) -> dict:
    t0 = time.monotonic()
    params = {"crop_name": case["crop"], **DEFAULT_CTX}
    try:
        report = await run_diagnosis(dict(params), [{"path": case["image"], "type": "leaf"}])
    except Exception as exc:
        return {**_thin(case), "error": f"{type(exc).__name__}: {exc}",
                "elapsed": round(time.monotonic() - t0, 1)}
    # Persist the FULL AI response, one file per image.
    (responses_dir / f"{case['id']}.json").write_text(json.dumps(report, indent=2, default=str))

    meta = report.get("meta") or {}
    pd = report.get("disease") or {}
    pred = pd.get("name_common", "")
    diffs = [d.get("disease") for d in (meta.get("differentials") or []) if isinstance(d, dict)]
    conf = float(meta.get("confidence_score") or report.get("confidence_score") or 0)
    svc = bool(report.get("service_unavailable") or meta.get("service_unavailable"))
    return {
        **_thin(case),
        "predicted": pred,
        "confidence": round(conf, 2),
        "top1": _matches(pred, case["truths"], case["crop"]),
        "top1_lenient": _matches_lenient(pred, case["truths"], case["crop"]),
        "top3": any(_matches(c, case["truths"], case["crop"]) for c in [pred, *diffs]),
        "differentials": diffs[:3],
        "service_unavailable": svc,
        "model_diagnose": meta.get("model_diagnose"),
        "ensemble_used": bool(meta.get("ensemble_used")),
        "elapsed": round(time.monotonic() - t0, 1),
    }


def _thin(c: dict) -> dict:
    return {"id": c["id"], "crop": c["crop"], "raw_crop": c["raw_crop"], "truth": c["truth_str"]}


def _table(rows: list[dict], batch_no: int) -> str:
    ok = [r for r in rows if "error" not in r]
    scored = [r for r in ok if not r.get("service_unavailable")]
    t1 = sum(r["top1"] for r in scored)
    t1l = sum(r.get("top1_lenient", r["top1"]) for r in scored)
    t3 = sum(r["top3"] for r in scored)
    svc = sum(1 for r in ok if r.get("service_unavailable"))
    errs = [r for r in rows if "error" in r]
    n = len(scored)
    lines = [
        f"## Batch {batch_no} — comparison ({len(rows)} images)", "",
        f"**Diagnosed:** {n}  ·  **Service-unavailable:** {svc}  ·  **Errors:** {len(errs)}",
        f"**top-1 strict (production matcher):** {t1}/{n}" + (f" ({t1/n:.0%})" if n else ""),
        f"**top-1 lenient (substring, diagnostic):** {t1l}/{n}" + (f" ({t1l/n:.0%})" if n else ""),
        f"**top-3 (in shortlist):** {t3}/{n}" + (f" ({t3/n:.0%})" if n else ""), "",
        "| # | Crop (dataset) | Truth (textbook) | AI predicted | Conf | ✓ top-1 | ✓ top-3 |",
        "|---|---|---|---|---:|:---:|:---:|",
    ]
    for i, r in enumerate(rows, 1):
        if "error" in r:
            lines.append(f"| {i} | {r['crop']} | {r['truth'][:30]} | ERROR: {r['error'][:40]} | — | — | — |")
            continue
        pred = "⏳ SERVICE UNAVAILABLE" if r.get("service_unavailable") else (r["predicted"] or "—")
        c1 = "✅" if r.get("top1") else "❌"
        c3 = "✅" if r.get("top3") else "❌"
        lines.append(
            f"| {i} | {r['crop']} ({r['raw_crop']}) | {r['truth'][:34]} | {str(pred)[:34]} | "
            f"{r.get('confidence','—')} | {c1} | {c3} |"
        )
    return "\n".join(lines) + "\n"


def _parse_batches(spec: str, total: int, size: int) -> list[int]:
    nb = (total + size - 1) // size
    if spec == "all":
        return list(range(1, nb + 1))
    if "-" in spec:
        a, b = spec.split("-"); return list(range(int(a), min(int(b), nb) + 1))
    return [int(spec)]


async def _main(args) -> int:
    dataset = Path(args.dataset).expanduser().resolve()
    out = Path(args.out).resolve()
    responses_dir = out / "responses"
    responses_dir.mkdir(parents=True, exist_ok=True)

    cases = _load_cases(dataset)
    size = args.batch_size
    batches = _parse_batches(args.batches, len(cases), size)
    print(f"Dataset: {len(cases)} real images → {(len(cases)+size-1)//size} batches of {size}")
    print(f"Running batches: {batches}  (concurrency {args.concurrency})")
    print(f"Output: {out}\n")

    sem = asyncio.Semaphore(args.concurrency)
    results_path = out / "results.jsonl"

    for b in batches:
        chunk = cases[(b - 1) * size: b * size]
        if not chunk:
            break
        print(f"── Batch {b}: {len(chunk)} images ──")

        async def _bounded(c):
            async with sem:
                r = await _run_one(c, responses_dir)
                tag = "ERR" if "error" in r else ("SVC" if r.get("service_unavailable")
                      else ("✓" if r.get("top1") else "✗"))
                print(f"  [{tag}] {r['id']:<44} pred='{r.get('predicted','-')}' "
                      f"truth='{r['truth'][:28]}' conf={r.get('confidence','-')}")
                return r

        rows = await asyncio.gather(*(_bounded(c) for c in chunk))
        with results_path.open("a") as f:
            for r in rows:
                f.write(json.dumps({**r, "batch": b}) + "\n")
        table = _table(rows, b)
        (out / f"batch{b:02d}_comparison.md").write_text(table)
        print("\n" + table)

    print(f"Per-image AI responses saved under {responses_dir}")
    return 0


def _parse_args():
    p = argparse.ArgumentParser(description="Run the diagnosis pipeline over the textbook crop-disease dataset")
    p.add_argument("--dataset", default=str(DEFAULT_DATASET))
    p.add_argument("--out", default=str(DEFAULT_OUT))
    p.add_argument("--batch-size", type=int, default=10)
    p.add_argument("--batches", default="1", help='"1", "1-3", or "all"')
    p.add_argument("--concurrency", type=int, default=3)
    return p.parse_args()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(_main(_parse_args())))
    except KeyboardInterrupt:
        sys.exit(130)
