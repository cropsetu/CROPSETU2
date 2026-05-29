"""
Image Quality Agent — CropGuard Agentic AI

Assesses uploaded crop images for usability in disease diagnosis.
Uses heuristic checks (file size, dimensions, format) rather than LLM
to keep this stage fast and free.

Returns:
  {
    "quality_score": float (0.0–1.0),
    "usable": bool,
    "suggestions": list[str],
    "enhancement_notes": str,
  }
"""
from __future__ import annotations

import base64
import logging
import math
from pathlib import Path

logger = logging.getLogger(__name__)

# Pillow is optional at import time so this module still loads even if the
# venv hasn't reinstalled requirements.txt. When PIL is missing we just
# skip the CV checks and degrade to the file-size heuristic.
try:
    from PIL import Image, ImageFilter, ImageOps, ImageStat  # type: ignore
    _PIL_OK = True
except Exception:
    Image = None  # type: ignore
    _PIL_OK = False

# Minimum thresholds
_MIN_FILE_BYTES = 10_000        # 10 KB — likely too small/blurry
_GOOD_FILE_BYTES = 100_000      # 100 KB — decent quality
_MAX_FILE_BYTES  = 15_000_000   # 15 MB — anything bigger is suspicious / DoS-y
_SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# Magic-byte signatures. The extension on its own is untrusted (an
# attacker could rename anything to .jpg); we ALWAYS confirm against
# the first bytes of the file before handing it to the vision model.
_MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff",            "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n",       "image/png"),
    # WEBP: RIFF....WEBP — the inner 4 bytes are file size, so we match
    # the prefix and the literal "WEBP" tag separately in _sniff_mime.
    (b"RIFF",                    "image/webp"),
    (b"GIF87a",                  "image/gif"),
    (b"GIF89a",                  "image/gif"),
)


# ── CV inspection (Pillow-only — no opencv/numpy needed) ────────────────────
# Returns a dict of structural quality signals the vision model would
# otherwise have to infer. Conservative: a missing/bad signal returns
# neutral (None) so we never falsely reject a usable image.
_BLUR_MIN_EDGE_STDDEV = 8.0     # below this → likely blurry / out of focus
_EXPOSURE_MIN_MEAN   = 35       # 0–255; below = under-exposed
_EXPOSURE_MAX_MEAN   = 220      # above = blown out
_GREEN_RATIO_MIN     = 0.05     # < 5 % green → probably not a plant photo


def _cv_inspect(path: Path) -> dict:
    """Run blur/exposure/green-ratio checks. Returns a dict of metrics
    plus a single composite `cv_score` in [0, 1] (None if PIL unavailable)."""
    if not _PIL_OK:
        return {"cv_available": False}

    try:
        with Image.open(path) as im:
            # 1. EXIF orientation auto-rotate so portrait photos aren't
            #    analysed sideways. transpose() returns a NEW image — original
            #    is not modified on disk; that's intentional (the LLM gets
            #    the bytes as uploaded; only OUR metrics use the rotated view).
            im = ImageOps.exif_transpose(im)
            width, height = im.size
            # Downscale for speed — 512px is plenty for these heuristics.
            im.thumbnail((512, 512))
            rgb = im.convert("RGB")

            # 2. Edge-energy as a blur proxy. Real Laplacian variance needs
            #    numpy; ImageFilter.FIND_EDGES + ImageStat.stddev is the
            #    pure-PIL approximation that correlates well in practice.
            edges = rgb.convert("L").filter(ImageFilter.FIND_EDGES)
            edge_stddev = float(ImageStat.Stat(edges).stddev[0])

            # 3. Mean luminance for exposure.
            mean_lum = float(ImageStat.Stat(rgb.convert("L")).mean[0])

            # 4. HSV "green" ratio — sample every Nth pixel for speed.
            hsv = rgb.convert("HSV")
            pixels = list(hsv.getdata())
            step = max(1, len(pixels) // 4000)   # ~4000 samples max
            sample = pixels[::step]
            # Plant green in HSV (0-255 each):
            #   H ∈ [60, 130]   ≈ 85°–180° hue range
            #   S ≥ 30          (not washed-out)
            #   V ≥ 30          (not pure black)
            green_hits = sum(
                1 for (h, s, v) in sample
                if 60 <= h <= 130 and s >= 30 and v >= 30
            )
            green_ratio = green_hits / max(len(sample), 1)

            # 5. Composite score — clamped 0..1.
            blur_score = min(1.0, edge_stddev / 30.0)
            exposure_score = 1.0 if _EXPOSURE_MIN_MEAN <= mean_lum <= _EXPOSURE_MAX_MEAN else 0.4
            green_score = min(1.0, green_ratio / 0.20)   # 20%+ green saturates
            cv_score = round((blur_score * 0.5 + exposure_score * 0.2 + green_score * 0.3), 2)

            return {
                "cv_available":   True,
                "width":          width,
                "height":         height,
                "edge_stddev":    round(edge_stddev, 2),
                "blurry":         edge_stddev < _BLUR_MIN_EDGE_STDDEV,
                "mean_luminance": round(mean_lum, 1),
                "exposure_ok":    _EXPOSURE_MIN_MEAN <= mean_lum <= _EXPOSURE_MAX_MEAN,
                "green_ratio":    round(green_ratio, 3),
                "looks_like_plant": green_ratio >= _GREEN_RATIO_MIN,
                "cv_score":       cv_score,
            }
    except Exception as exc:
        logger.warning("[CV] Pillow inspection failed for %s: %s", path.name, exc)
        return {"cv_available": False, "error": str(exc)}


def _sniff_mime(path) -> str | None:
    """Read the first 16 bytes and return a MIME type if recognised."""
    try:
        with open(path, "rb") as f:
            head = f.read(16)
    except OSError:
        return None
    if not head:
        return None
    for sig, mime in _MAGIC_SIGNATURES:
        if head.startswith(sig):
            if mime == "image/webp":
                # Confirm the WEBP marker — RIFF alone is a generic container
                if len(head) >= 12 and head[8:12] == b"WEBP":
                    return mime
                continue
            return mime
    return None


async def run_image_quality_agent(images: list[dict]) -> dict:
    """
    Assess image quality from file metadata.

    images: list of {"path": str, "type": str}
    Returns dict with quality_score, usable, suggestions, enhancement_notes.
    """
    if not images:
        return {
            "quality_score": 0.0,
            "usable": False,
            "suggestions": [
                "No images were uploaded.",
                "Please take a clear photo of the affected crop area.",
                "Use natural daylight for best results.",
            ],
            "enhancement_notes": "",
        }

    scores = []
    suggestions = []
    valid_count = 0

    for img in images:
        path = Path(img.get("path", ""))
        if not path.exists():
            logger.warning("Image file not found: %s", path)
            suggestions.append(f"Image file not found: {path.name}")
            scores.append(0.0)
            continue

        ext = path.suffix.lower()
        file_size = path.stat().st_size

        # Extension check (cheap pre-filter)
        if ext not in _SUPPORTED_EXTS:
            suggestions.append(f"Unsupported format ({ext}). Use JPG, PNG, or WebP.")
            scores.append(0.2)
            continue

        # Max-size guard — reject obvious DoS payloads before we read them.
        if file_size > _MAX_FILE_BYTES:
            logger.warning("Image too large (%d bytes): %s", file_size, path.name)
            suggestions.append(f"Image too large ({file_size // 1_000_000} MB) — keep under 15 MB.")
            scores.append(0.0)
            continue

        # Magic-byte sniff — the extension can be spoofed. If the file's
        # actual bytes don't match a known image format, refuse it: handing
        # arbitrary binary to Gemini wastes tokens and can leak data through
        # the vision model's text decoder.
        sniffed_mime = _sniff_mime(path)
        if sniffed_mime is None:
            logger.warning("Image rejected — magic bytes do not match any known image format: %s", path.name)
            suggestions.append(f"{path.name}: not a valid image file (corrupt or wrong format).")
            scores.append(0.0)
            continue

        # Cross-check: extension claims one thing, magic says another → block.
        ext_mime = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp",
        }.get(ext)
        if ext_mime and sniffed_mime != ext_mime:
            logger.warning(
                "Image MIME mismatch — ext=%s claims %s but magic is %s (%s)",
                ext, ext_mime, sniffed_mime, path.name,
            )
            suggestions.append(
                f"{path.name}: extension says {ext} but file content is {sniffed_mime} — re-export the image."
            )
            scores.append(0.0)
            continue

        # Size-based heuristic score (cheap baseline)
        if file_size < _MIN_FILE_BYTES:
            base_score = 0.3
            suggestions.append("Image is very small — may be too blurry for analysis.")
        elif file_size < _GOOD_FILE_BYTES:
            base_score = 0.6
        else:
            base_score = 0.85

        # CV inspection — blur / exposure / green ratio. Pillow only; no
        # numpy or opencv needed. If PIL is missing or fails, we keep the
        # baseline score (degraded mode logged once).
        cv = _cv_inspect(path)
        if cv.get("cv_available"):
            if cv.get("blurry"):
                suggestions.append(
                    f"{path.name}: image looks blurry (edge energy {cv['edge_stddev']:.1f}). "
                    "Hold the phone steady and retake."
                )
            if not cv.get("exposure_ok"):
                lum = cv["mean_luminance"]
                if lum < _EXPOSURE_MIN_MEAN:
                    suggestions.append(f"{path.name}: image too dark — retake in natural daylight.")
                else:
                    suggestions.append(f"{path.name}: image overexposed — avoid direct sun on the leaf.")
            if not cv.get("looks_like_plant"):
                suggestions.append(
                    f"{path.name}: very little green detected — make sure the leaf fills the frame."
                )
            # Blend: 60% CV (the structural signal) + 40% size baseline.
            score = round(0.6 * cv["cv_score"] + 0.4 * base_score, 2)
        else:
            score = base_score

        # Stash per-image CV details on the image dict — orchestrator can
        # log them, and they get surfaced into the report for debugging.
        img["_cv"] = cv

        # Bonus for having multiple views
        valid_count += 1
        scores.append(score)

    # Multi-view bonus — only earned when at least one image is genuinely
    # good (raw score ≥ 0.5). Three tiny blurry photos shouldn't average
    # above the usability threshold by sheer count.
    if scores and max(scores) >= 0.5:
        if valid_count >= 2:
            scores = [min(1.0, s + 0.1) for s in scores]
        if valid_count >= 3:
            scores = [min(1.0, s + 0.05) for s in scores]

    avg_score = sum(scores) / len(scores) if scores else 0.0
    usable = avg_score >= 0.4

    if not suggestions and usable:
        suggestions = ["Images look good for analysis."]
    elif not usable:
        suggestions.extend([
            "Retake photos in natural daylight.",
            "Take one close-up of the affected area from ~20 cm.",
            "Take one whole-plant photo from ~1 m distance.",
        ])

    enhancement_notes = ""
    if 0.4 <= avg_score < 0.6:
        enhancement_notes = "Image quality is marginal — results may have reduced confidence."

    result = {
        "quality_score": round(avg_score, 2),
        "usable": usable,
        "suggestions": suggestions,
        "enhancement_notes": enhancement_notes,
    }
    logger.info(
        "[ImageQuality] score=%.2f usable=%s images=%d valid=%d",
        avg_score, usable, len(images), valid_count,
    )
    return result
