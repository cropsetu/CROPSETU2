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
from pathlib import Path

logger = logging.getLogger(__name__)

# Minimum thresholds
_MIN_FILE_BYTES = 10_000        # 10 KB — likely too small/blurry
_GOOD_FILE_BYTES = 100_000      # 100 KB — decent quality
_SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


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

        # Extension check
        if ext not in _SUPPORTED_EXTS:
            suggestions.append(f"Unsupported format ({ext}). Use JPG, PNG, or WebP.")
            scores.append(0.2)
            continue

        # Size-based quality score
        if file_size < _MIN_FILE_BYTES:
            score = 0.3
            suggestions.append("Image is very small — may be too blurry for analysis.")
        elif file_size < _GOOD_FILE_BYTES:
            score = 0.6
        else:
            score = 0.85

        # Bonus for having multiple views
        valid_count += 1
        scores.append(score)

    # Multi-view bonus
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
