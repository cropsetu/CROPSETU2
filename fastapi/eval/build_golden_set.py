"""
eval/build_golden_set.py — build a labeled golden set from a local PlantVillage
image tree, for measuring diagnosis accuracy across many (crop, disease) classes.

PlantVillage layout expected (the standard "color" tree, one folder per class):
    <src>/Corn_(maize)___Common_rust_/<image>.jpg
    <src>/Tomato___Early_blight/<image>.jpg
    <src>/Grape___healthy/<image>.jpg
    ...
Download once from e.g. github.com/spMohanty/PlantVillage-Dataset (raw/color).

What it does
  • Samples up to N images per class into a manifest.jsonl in the exact shape
    eval/golden_runner + eval/load_eval expect (id / image_paths / params /
    ground_truth). Images are REFERENCED by absolute path (not copied) so the
    batch dir stays tiny and is safe to gitignore.
  • Maps each "Crop___Disease" folder → canonical crop (reusing the whitelist's
    _canon_crop) + canonical common disease name; scientific_name via canonicalize.
  • Applies the same per-crop default agronomic context used by the manual batches.

Usage
  python -m eval.build_golden_set --src /path/to/PlantVillage/color \
      --n-per-class 10 --out batch_pv
  # then:
  AI_DIAGNOSE_VERSION=v2 python -m eval.load_eval \
      --manifest data/golden_set/batch_pv/manifest.jsonl --concurrency 3

Honest scope
  PlantVillage covers ~14 crops (Apple, Corn, Grape, Potato, Tomato, Pepper, …).
  The many minor Indian crops the whitelist now covers have NO public labeled
  image set — their candidate-scoping/treatment improvements are validated by
  unit checks, not a measured top-1 here.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.crop_disease_whitelist import _canon_crop, snap_to_candidate  # noqa: E402
from data.disease_synonyms import canonicalize  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
GOLDEN_DIR = REPO_ROOT / "data" / "golden_set"

_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# Per-crop default context (mirrors the manual batches). Generic fallback for
# crops without an explicit entry — context mainly enriches weather correlation.
_CONTEXT: dict[str, dict] = {
    "Maize":  {"crop_growth_stage": "Tasseling",     "soil_type": "Loam",       "irrigation_system": "Furrow",    "state": "Karnataka",     "district": "Belagavi", "planting_date": "2026-03-20"},
    "Potato": {"crop_growth_stage": "Tuber Bulking", "soil_type": "Sandy Loam", "irrigation_system": "Sprinkler", "state": "Uttar Pradesh", "district": "Agra",     "planting_date": "2026-03-10"},
    "Tomato": {"crop_growth_stage": "Flowering",     "soil_type": "Red",        "irrigation_system": "Drip",      "state": "Maharashtra",   "district": "Nashik",   "planting_date": "2026-03-15"},
    "Grapes": {"crop_growth_stage": "Fruiting",      "soil_type": "Black",      "irrigation_system": "Drip",      "state": "Maharashtra",   "district": "Nashik",   "planting_date": "2025-12-20"},
    "Apple":  {"crop_growth_stage": "Fruiting",      "soil_type": "Loam",       "irrigation_system": "Drip",      "state": "Himachal Pradesh", "district": "Shimla", "planting_date": "2026-03-01"},
}
_DEFAULT_CONTEXT = {"crop_growth_stage": "Vegetative", "soil_type": "Loam",
                    "irrigation_system": "Drip", "state": "Maharashtra",
                    "district": "Pune", "planting_date": "2026-03-01"}


def _parse_class(dirname: str) -> tuple[str, str] | None:
    """'Corn_(maize)___Common_rust_' → ('Maize', 'Common Rust'); None if unparseable."""
    if "___" not in dirname:
        return None
    crop_raw, dis_raw = dirname.split("___", 1)
    crop_raw = crop_raw.replace("_(maize)", "").replace("_(including_sour)", "")
    crop_raw = crop_raw.replace(",_bell", "").replace("_", " ").strip()
    crop = _canon_crop(crop_raw) or crop_raw.title()
    if dis_raw.strip().lower() == "healthy":
        return crop, "Healthy"
    d = dis_raw.replace("_", " ").strip()
    d = d.split("/")[-1].strip()                 # compound label → last segment
    d = re.sub(r"\s*\([^)]*\)", "", d).strip()   # drop parentheticals
    if "gray leaf spot" in d.lower():
        d = "Gray Leaf Spot"
    return crop, d.title()


def _severity(disease: str) -> str:
    return "None" if disease.lower() == "healthy" else "MODERATE"


def _build(src: Path, n_per_class: int, out_name: str, seed: int) -> int:
    if not src.is_dir():
        print(f"Source tree not found: {src}", file=sys.stderr)
        return 1
    rng = random.Random(seed)
    out_dir = GOLDEN_DIR / out_name
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[str] = []
    classes = sorted(p for p in src.iterdir() if p.is_dir() and "___" in p.name)
    print(f"Found {len(classes)} PlantVillage classes under {src}")
    covered = 0
    for cls in classes:
        parsed = _parse_class(cls.name)
        if not parsed:
            continue
        crop, disease = parsed
        imgs = [p for p in cls.iterdir() if p.suffix.lower() in _IMG_EXTS]
        if not imgs:
            continue
        rng.shuffle(imgs)
        picks = imgs[:n_per_class]
        in_list = disease.lower() == "healthy" or snap_to_candidate(crop, disease) is not None
        flag = "" if in_list else "  [!] not in candidate list (open-vocab / gap)"
        print(f"  {crop:<10} / {disease:<26} {len(picks)} imgs{flag}")
        params = {"crop_name": crop, **_CONTEXT.get(crop, _DEFAULT_CONTEXT),
                  "tier": "best", "language": "en"}
        sci = canonicalize(disease) if disease.lower() != "healthy" else ""
        sci = "" if (not sci or sci.lower() == disease.lower()) else sci
        for i, img in enumerate(picks):
            cid = re.sub(r"[^a-z0-9]+", "-", f"{crop}-{disease}-{i+1}".lower()).strip("-")
            rows.append(json.dumps({
                "id": cid,
                "image_paths": [str(img.resolve())],
                "params": params,
                "ground_truth": {"disease": disease, "scientific_name": sci,
                                 "severity": _severity(disease)},
            }, ensure_ascii=False))
        covered += 1

    manifest = out_dir / "manifest.jsonl"
    manifest.write_text("\n".join(rows) + "\n")
    print(f"\nWrote {manifest}  ({len(rows)} cases across {covered} classes)")
    return 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build a golden-set manifest from a PlantVillage tree")
    p.add_argument("--src", required=True, help="Path to PlantVillage 'color' tree (one folder per class)")
    p.add_argument("--n-per-class", type=int, default=10)
    p.add_argument("--out", default="batch_pv", help="Output dir name under data/golden_set/")
    p.add_argument("--seed", type=int, default=7, help="Sampling seed (reproducible)")
    return p.parse_args()


if __name__ == "__main__":
    a = _parse_args()
    sys.exit(_build(Path(a.src).expanduser().resolve(), a.n_per_class, a.out, a.seed))
