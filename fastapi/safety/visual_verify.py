"""
Visual Claim Verifier — CropGuard

The diagnosis LLM frequently lists `visual_symptoms_detected` and
`visual_evidence` entries like "yellow halos", "water-soaked lesions",
"white sporulation". These are the most fabricable parts of the
response — the model has incentive to align with textbook descriptions
of whatever disease it picked, even when the actual pixels don't show
those colors.

This module cross-checks the LLM's color claims against an HSV
histogram of the actual image. If the LLM claims "yellow" but yellow
is essentially absent (< 1 % of non-background pixels), we add a
confidence penalty and surface the discrepancy in the meta block.

Conservative by design: we mark a claim "unverified" rather than
"falsified" when uncertain — the LLM may be right and our sampling
wrong. The cross_verify step uses unverified claims as a soft signal,
not a veto.
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

try:
    from PIL import Image, ImageOps  # type: ignore
    _PIL_OK = True
except Exception:
    _PIL_OK = False


# Color buckets in HSV (PIL uses 0-255 for each channel).
# Conservative ranges — we want false-negative (miss real colors) over
# false-positive (claim absence when present).
_COLORS: dict[str, tuple[tuple[int, int], tuple[int, int], tuple[int, int]]] = {
    # name : ((H_min,H_max), (S_min,S_max), (V_min,V_max))
    "yellow":      ((30, 65),   (60, 255), (90, 255)),
    "orange":      ((10, 30),   (80, 255), (90, 255)),
    "red":         ((0, 10),    (80, 255), (60, 255)),   # also wraps high; we sample both ends
    "brown":       ((10, 30),   (40, 200), (30, 130)),   # low value distinguishes from orange
    "white":       ((0, 255),   (0, 30),   (200, 255)),  # any hue, low sat, high value
    "black":       ((0, 255),   (0, 255),  (0, 35)),     # near zero V
    "purple":      ((180, 210), (60, 255), (60, 255)),
}

# Claim → color mapping. We look at the lowercase text and trigger checks
# when any of these substrings appear.
_CLAIM_KEYWORDS: dict[str, str] = {
    "yellow":          "yellow",
    "halos":           "yellow",   # "yellow halos"
    "chlorosis":       "yellow",   # leaf yellowing
    "chlorotic":       "yellow",
    "orange":          "orange",
    "rust-colored":    "orange",
    "rusty":           "orange",
    "red":             "red",
    "reddening":       "red",
    "reddish":         "red",
    "brown":           "brown",
    "necrotic":        "brown",
    "necrosis":        "brown",
    "tan":             "brown",
    "white":           "white",
    "powdery":         "white",     # powdery mildew
    "sporulation":     "white",     # often presents white
    "mycelium":        "white",
    "black":           "black",
    "dark":            "black",
    "purple":          "purple",
    "purpling":        "purple",
}

# Minimum pixel fraction required for a claim to count as VERIFIED.
_VERIFIED_FRACTION = 0.005   # 0.5 % — a small lesion can be small fraction
_FALSIFIED_FRACTION = 0.001  # < 0.1 % → almost certainly absent


def _classify_pixel(h: int, s: int, v: int) -> str | None:
    """Return the first color bucket the pixel falls in, or None."""
    for name, ((hmin, hmax), (smin, smax), (vmin, vmax)) in _COLORS.items():
        if hmin <= h <= hmax and smin <= s <= smax and vmin <= v <= vmax:
            return name
        # Red wraps around high-H end too
        if name == "red" and (220 <= h <= 255) and smin <= s <= smax and vmin <= v <= vmax:
            return name
    return None


def _histogram(path: Path) -> dict[str, float] | None:
    """Return a dict of {color_name: fraction_of_pixels}. None if PIL missing."""
    if not _PIL_OK:
        return None
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((384, 384))
            hsv = im.convert("HSV")
            pixels = list(hsv.getdata())
    except Exception as exc:
        logger.warning("[VisualVerify] PIL failed on %s: %s", path, exc)
        return None

    step = max(1, len(pixels) // 4000)
    sample = pixels[::step]
    total = max(1, len(sample))
    counts: dict[str, int] = {n: 0 for n in _COLORS}
    for (h, s, v) in sample:
        c = _classify_pixel(h, s, v)
        if c:
            counts[c] += 1
    return {n: counts[n] / total for n in counts}


def _extract_claims(diagnosis: dict) -> set[str]:
    """Pull color-bearing phrases from the diagnosis blob."""
    chunks: list[str] = []
    chunks.append(diagnosis.get("primary_diagnosis", {}).get("description", "") or "")
    chunks.extend(diagnosis.get("visual_symptoms_detected", []) or [])
    ve = diagnosis.get("visual_evidence", {}) or {}
    chunks.append(ve.get("lesion_description", "") or "")
    chunks.append(ve.get("distribution", "") or "")
    text = " ".join(chunks).lower()
    claimed: set[str] = set()
    for kw, color in _CLAIM_KEYWORDS.items():
        if kw in text:
            claimed.add(color)
    return claimed


def verify_visual_claims(diagnosis: dict, images: list[dict]) -> dict:
    """
    Cross-check the diagnosis's color claims against image pixels.

    Returns:
      {
        "available": bool,           # True if at least one image scanned
        "claimed": [colors],
        "verified": [colors],        # present at ≥ 0.5 %
        "unverified": [colors],      # present at 0.1–0.5 % (ambiguous)
        "falsified": [colors],       # < 0.1 % — likely hallucinated
        "fractions": { color: 0.x },
        "score_penalty": float,      # 0..0.10 — applied by cross_verify
      }
    """
    if not _PIL_OK or not images:
        return {"available": False}

    claimed = _extract_claims(diagnosis)
    if not claimed:
        return {"available": True, "claimed": [], "verified": [], "unverified": [],
                "falsified": [], "fractions": {}, "score_penalty": 0.0}

    # Use the first usable image (the leaf close-up). Multi-image aggregation
    # would dilute small-lesion colors; we'd rather over-trust the close-up.
    first_hist: dict[str, float] | None = None
    for img in images:
        path = Path(img.get("path", ""))
        if not path.exists():
            continue
        first_hist = _histogram(path)
        if first_hist is not None:
            break
    if not first_hist:
        return {"available": False}

    verified, unverified, falsified = [], [], []
    for color in claimed:
        frac = first_hist.get(color, 0.0)
        if frac >= _VERIFIED_FRACTION:
            verified.append(color)
        elif frac < _FALSIFIED_FRACTION:
            falsified.append(color)
        else:
            unverified.append(color)

    # Penalty scales with how many claims look fabricated. We cap at -0.10
    # to avoid double-counting with other cross_verify penalties.
    penalty = round(min(0.10, 0.04 * len(falsified)), 3)

    result = {
        "available":     True,
        "claimed":       sorted(claimed),
        "verified":      sorted(verified),
        "unverified":    sorted(unverified),
        "falsified":     sorted(falsified),
        "fractions":     {c: round(first_hist.get(c, 0.0), 4) for c in claimed},
        "score_penalty": penalty,
    }
    if falsified:
        logger.info(
            "[VisualVerify] claimed=%s falsified=%s penalty=%.3f",
            sorted(claimed), sorted(falsified), penalty,
        )
    return result
