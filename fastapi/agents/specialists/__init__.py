"""
agents/specialists/ — crop-specific specialist model registry (MoE).

Concept
  When a fine-tuned vision model is available for a specific crop
  (e.g. a model trained on a large tomato-leaf-disease dataset), it
  should vote alongside the frontier ensemble. This module is the
  registry that maps `crop_name` -> `model_id`.

How to register a specialist
  1. Add the model id to agents/registry.MODEL_CATALOG with the right
     provider + capabilities + API key.
  2. Drop a module here named `<crop>.py` (kebab-case lowercase) that
     defines `MODEL_ID = "..."`.

     Example: agents/specialists/tomato.py
         MODEL_ID = "gemini-2.5-pro-tomato-tuned-v1"

  3. ensemble_agent.select(crop) will then append the specialist's id
     to the ensemble fan-out automatically.

Phase 8 will populate this directory once real fine-tuned models exist.
Today it's an empty registry — get_specialist() returns None for every
crop, so the ensemble behaviour is exactly the frontier triplet.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
import re
from typing import Optional

logger = logging.getLogger(__name__)


_SPECIALISTS_CACHE: dict[str, str] | None = None


def _norm_crop(crop: str | None) -> str:
    """Lowercase, strip non-alpha — 'Tomato', 'tomato_var3', 'TOMATO' all collide."""
    return re.sub(r"[^a-z]", "", (crop or "").lower())


def _load_registry() -> dict[str, str]:
    """Walk this package for `<crop>.py` modules exposing MODEL_ID."""
    global _SPECIALISTS_CACHE
    if _SPECIALISTS_CACHE is not None:
        return _SPECIALISTS_CACHE
    import agents.specialists as pkg
    registry: dict[str, str] = {}
    for mod_info in pkgutil.iter_modules(pkg.__path__):
        if mod_info.name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"agents.specialists.{mod_info.name}")
        except Exception as exc:
            logger.warning("[Specialists] cannot import %s: %s", mod_info.name, exc)
            continue
        model_id = getattr(mod, "MODEL_ID", None)
        if not isinstance(model_id, str) or not model_id:
            continue
        registry[_norm_crop(mod_info.name)] = model_id
        logger.info("[Specialists] registered %s -> %s", mod_info.name, model_id)
    _SPECIALISTS_CACHE = registry
    return registry


def get_specialist(crop: str | None) -> Optional[str]:
    """Return the registered specialist model id for this crop, or None."""
    if not crop:
        return None
    return _load_registry().get(_norm_crop(crop))
