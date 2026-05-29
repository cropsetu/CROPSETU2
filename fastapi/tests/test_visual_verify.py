"""
Unit tests for safety/visual_verify.py — HSV pixel cross-check against
the LLM's color claims.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Skip the whole module gracefully if Pillow is missing — visual_verify
# degrades to {available: False} in that case.
try:
    from PIL import Image, ImageDraw   # noqa: F401
    _PIL_OK = True
except Exception:
    _PIL_OK = False

pytestmark = pytest.mark.skipif(not _PIL_OK, reason="Pillow not installed")

from safety.visual_verify import verify_visual_claims   # noqa: E402


def _save_solid(color_rgb, path):
    img = Image.new("RGB", (400, 400), color=color_rgb)
    img.save(path, "JPEG", quality=85)


def _diag_with_visual_claims(*claims):
    return {
        "primary_diagnosis": {"description": " ".join(claims)},
        "visual_symptoms_detected": list(claims),
    }


def test_visual_verify_returns_unavailable_for_no_images():
    out = verify_visual_claims(_diag_with_visual_claims("yellow halos"), [])
    assert out["available"] is False


def test_visual_verify_with_no_color_claims_zero_penalty(tmp_path):
    p = tmp_path / "img.jpg"
    _save_solid((60, 140, 60), p)
    out = verify_visual_claims(
        {"primary_diagnosis": {"description": "non-specific damage"}, "visual_symptoms_detected": []},
        [{"path": str(p), "type": "leaf"}],
    )
    assert out["available"] is True
    assert out["claimed"] == []
    assert out["score_penalty"] == 0.0


def test_visual_verify_falsifies_yellow_on_pure_green(tmp_path):
    p = tmp_path / "green.jpg"
    _save_solid((50, 160, 50), p)
    out = verify_visual_claims(
        _diag_with_visual_claims("brown lesions with yellow halos"),
        [{"path": str(p), "type": "leaf"}],
    )
    assert out["available"] is True
    assert "yellow" in out["claimed"]
    assert "yellow" in out["falsified"]
    assert out["score_penalty"] > 0.0


def test_visual_verify_verified_when_color_present(tmp_path):
    # An image dominated by yellow pixels should VERIFY a yellow claim.
    p = tmp_path / "yellow.jpg"
    _save_solid((220, 200, 50), p)   # strong yellow in RGB
    out = verify_visual_claims(
        _diag_with_visual_claims("yellow halos"),
        [{"path": str(p), "type": "leaf"}],
    )
    assert "yellow" in out["claimed"]
    assert "yellow" in out["verified"]
    assert out["score_penalty"] == 0.0


def test_visual_verify_penalty_capped_at_010(tmp_path):
    # Many falsified claims must not cumulatively exceed -0.10.
    p = tmp_path / "green.jpg"
    _save_solid((50, 160, 50), p)
    out = verify_visual_claims(
        {
            "primary_diagnosis": {"description":
                "yellow halos with brown necrotic spots and white powdery sporulation and red wilting"},
            "visual_symptoms_detected": ["yellow halos", "brown lesions", "white powdery growth", "red wilting"],
        },
        [{"path": str(p), "type": "leaf"}],
    )
    assert out["score_penalty"] <= 0.10
    assert len(out["falsified"]) >= 3   # all four color claims should be flagged


def test_visual_verify_handles_missing_file(tmp_path):
    out = verify_visual_claims(
        _diag_with_visual_claims("yellow halos"),
        [{"path": str(tmp_path / "does_not_exist.jpg"), "type": "leaf"}],
    )
    assert out.get("available") is False
