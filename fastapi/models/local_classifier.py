"""
Local Leaf Classifier — ONNX MobileNetV2 (PlantVillage), optional.

Lazy-loads the model on first call so importing this module is cheap even
when no model file is present. The classifier is the "tier-zero" fallback:

  • If the orchestrator detects every LLM in the chain has failed, it
    can call `classify(images)` to still produce a best-effort top-k.
  • If the orchestrator runs the LLM normally, it can pass the local
    top-k into the prompt as a prior, reducing hallucination.

Configuration
  LOCAL_CLASSIFIER_MODEL_PATH    Absolute path to the .onnx file.
                                 Unset → classifier is disabled (no error).
  LOCAL_CLASSIFIER_LABELS_PATH   Optional. Plain-text labels, one per
                                 line, line N = class N. Defaults to a
                                 PlantVillage label list if absent.
  LOCAL_CLASSIFIER_INPUT_SIZE    Defaults to 224 (MobileNetV2 standard).
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

# Import-optional deps — if either is missing, the classifier is just disabled.
try:
    import numpy as np  # type: ignore
    _NUMPY_OK = True
except Exception:
    np = None  # type: ignore
    _NUMPY_OK = False

try:
    import onnxruntime as ort  # type: ignore
    _ORT_OK = True
except Exception:
    ort = None  # type: ignore
    _ORT_OK = False

try:
    from PIL import Image, ImageOps  # type: ignore
    _PIL_OK = True
except Exception:
    _PIL_OK = False


MODEL_PATH = os.environ.get("LOCAL_CLASSIFIER_MODEL_PATH", "").strip()
LABELS_PATH = os.environ.get("LOCAL_CLASSIFIER_LABELS_PATH", "").strip()
INPUT_SIZE = int(os.environ.get("LOCAL_CLASSIFIER_INPUT_SIZE", "224") or 224)
TOP_K = 3


# Default PlantVillage label list (38 classes, alphabetical-by-crop).
# Override by setting LOCAL_CLASSIFIER_LABELS_PATH.
_DEFAULT_LABELS = [
    "Apple - Apple scab", "Apple - Black rot", "Apple - Cedar apple rust", "Apple - healthy",
    "Blueberry - healthy",
    "Cherry - Powdery mildew", "Cherry - healthy",
    "Corn - Cercospora leaf spot / Gray leaf spot", "Corn - Common rust",
    "Corn - Northern Leaf Blight", "Corn - healthy",
    "Grape - Black rot", "Grape - Esca (Black Measles)",
    "Grape - Leaf blight (Isariopsis Leaf Spot)", "Grape - healthy",
    "Orange - Haunglongbing (Citrus greening)",
    "Peach - Bacterial spot", "Peach - healthy",
    "Pepper - Bacterial spot", "Pepper - healthy",
    "Potato - Early blight", "Potato - Late blight", "Potato - healthy",
    "Raspberry - healthy",
    "Soybean - healthy",
    "Squash - Powdery mildew",
    "Strawberry - Leaf scorch", "Strawberry - healthy",
    "Tomato - Bacterial spot", "Tomato - Early blight", "Tomato - Late blight",
    "Tomato - Leaf Mold", "Tomato - Septoria leaf spot",
    "Tomato - Spider mites (Two-spotted spider mite)", "Tomato - Target Spot",
    "Tomato - Tomato Yellow Leaf Curl Virus", "Tomato - Tomato mosaic virus",
    "Tomato - healthy",
]


@dataclass(frozen=True)
class Prediction:
    label: str
    score: float

    def as_dict(self) -> dict:
        return {"label": self.label, "score": round(self.score, 4)}


# ── State ────────────────────────────────────────────────────────────────────
_session = None
_labels: list[str] = []
_lock = Lock()
_init_attempted = False
_init_error: str | None = None


def _load_labels() -> list[str]:
    if LABELS_PATH and Path(LABELS_PATH).exists():
        try:
            return [l.strip() for l in Path(LABELS_PATH).read_text().splitlines() if l.strip()]
        except Exception as exc:
            logger.warning("[LocalCls] labels file unreadable (%s) — using defaults", exc)
    return list(_DEFAULT_LABELS)


def is_available() -> bool:
    """True iff all deps are importable AND the model file is configured."""
    return _NUMPY_OK and _ORT_OK and _PIL_OK and bool(MODEL_PATH) and Path(MODEL_PATH).exists()


def status() -> dict:
    """Reportable state — used by /health and the diagnosis meta block."""
    return {
        "configured": bool(MODEL_PATH),
        "available":  is_available(),
        "loaded":     _session is not None,
        "model_path": MODEL_PATH or None,
        "deps": {
            "numpy":       _NUMPY_OK,
            "onnxruntime": _ORT_OK,
            "pillow":      _PIL_OK,
        },
        "init_error": _init_error,
    }


def _ensure_session() -> bool:
    """Lazy-init. Returns True iff the session is loaded and ready."""
    global _session, _labels, _init_attempted, _init_error
    if _session is not None:
        return True
    if _init_attempted:
        return False  # already failed once; don't retry on every call
    with _lock:
        if _session is not None:
            return True
        _init_attempted = True
        if not is_available():
            _init_error = "deps or model path missing"
            return False
        try:
            _session = ort.InferenceSession(
                MODEL_PATH,
                providers=["CPUExecutionProvider"],
            )
            _labels = _load_labels()
            logger.info(
                "[LocalCls] loaded model=%s labels=%d input_size=%d",
                MODEL_PATH, len(_labels), INPUT_SIZE,
            )
            return True
        except Exception as exc:
            _init_error = f"{type(exc).__name__}: {exc}"
            logger.warning("[LocalCls] init failed: %s", _init_error)
            return False


def _preprocess(path: Path):
    """Pillow → CHW float32 numpy array, normalized per ImageNet stats.
    Returns the (1, 3, H, W) batch ready for ONNX."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB").resize((INPUT_SIZE, INPUT_SIZE))
    arr = np.asarray(im, dtype=np.float32) / 255.0
    # ImageNet normalisation — matches all common MobileNetV2 weights.
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr = (arr - mean) / std
    arr = arr.transpose(2, 0, 1)             # HWC → CHW
    return arr[np.newaxis, ...].astype(np.float32)  # batch dim


def _softmax(x):
    e = np.exp(x - np.max(x))
    return e / e.sum()


def classify(images: list[dict], *, top_k: int = TOP_K) -> list[Prediction] | None:
    """Run inference on the FIRST usable image. Returns None if the
    classifier isn't configured/loaded — caller must treat that as
    "feature disabled", not "error"."""
    if not _ensure_session():
        return None
    for img in images or []:
        path = Path(img.get("path", ""))
        if not path.exists():
            continue
        try:
            x = _preprocess(path)
            input_name = _session.get_inputs()[0].name
            logits = _session.run(None, {input_name: x})[0][0]
            probs = _softmax(logits)
            order = np.argsort(probs)[::-1][:top_k]
            preds = [Prediction(label=_labels[i] if i < len(_labels) else f"class_{i}",
                                score=float(probs[i])) for i in order]
            logger.debug("[LocalCls] top-k for %s: %s", path.name, [(p.label, round(p.score, 3)) for p in preds])
            return preds
        except Exception as exc:
            logger.warning("[LocalCls] inference failed on %s: %s", path, exc)
            continue
    return None
