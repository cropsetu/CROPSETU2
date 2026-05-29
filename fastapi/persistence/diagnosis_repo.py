"""
Diagnosis repository — write-only record of every pipeline run.

Public API: `record_diagnosis(...)` — fire-and-forget. Never raises.

Schema rationale
  • Wide columns for the high-value query keys (crop, state, disease,
    confidence, escalated, tier, model) so we can do "average confidence
    on Tomato in Maharashtra last week" without parsing JSON.
  • Bag-of-everything `payload JSONB` for the full report — keeps us
    flexible while we still iterate on the report shape.
  • Indexes on (created_at), (crop_name, created_at), (escalated) — the
    only queries we anticipate during P1. Add more as needed; never add
    indexes without a query that needs them.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone

from db_pool import get_shared_pool

logger = logging.getLogger(__name__)

PERSISTENCE_ENABLED: bool = (
    os.environ.get("DIAGNOSIS_PERSISTENCE_ENABLED", "true").strip().lower() != "false"
)

_TABLE = "ai_scan_diagnoses"
_CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {_TABLE} (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_id      TEXT,
    user_id         TEXT,
    crop_name       TEXT,
    state           TEXT,
    district        TEXT,
    growth_stage    TEXT,
    farm_size_acres NUMERIC,
    tier            TEXT,
    image_hashes    TEXT[],
    image_quality   NUMERIC,
    weather_used    BOOLEAN,
    weather_risk    TEXT,
    primary_disease TEXT,
    pathogen_type   TEXT,
    confidence      NUMERIC,
    confidence_tier TEXT,
    escalated       BOOLEAN,
    needs_lab       BOOLEAN,
    model_diagnose  TEXT,
    model_treatment TEXT,
    prompt_diagnose_hash  TEXT,
    prompt_treatment_hash TEXT,
    registry_version TEXT,
    safety_blockers INT NOT NULL DEFAULT 0,
    safety_warnings INT NOT NULL DEFAULT 0,
    pipeline_seconds NUMERIC,
    total_tokens    INT,
    cost_usd        NUMERIC,
    payload         JSONB
);
"""

_INDEXES_SQL = (
    f"CREATE INDEX IF NOT EXISTS {_TABLE}_created_at_idx       ON {_TABLE} (created_at DESC);",
    f"CREATE INDEX IF NOT EXISTS {_TABLE}_crop_created_at_idx  ON {_TABLE} (crop_name, created_at DESC);",
    f"CREATE INDEX IF NOT EXISTS {_TABLE}_escalated_idx        ON {_TABLE} (escalated) WHERE escalated = TRUE;",
    f"CREATE INDEX IF NOT EXISTS {_TABLE}_user_created_at_idx  ON {_TABLE} (user_id, created_at DESC);",
)


# Feedback table — populated by POST /ai/scan/{report_id}/feedback. Joins
# back to ai_scan_diagnoses.request_id (which the report stamps as the
# canonical id the mobile app sees). Per-model accuracy aggregation
# (Phase 8 reconciler weights) queries this table.
_FEEDBACK_TABLE = "ai_scan_feedback"
_FEEDBACK_CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {_FEEDBACK_TABLE} (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    report_id       TEXT NOT NULL,
    user_id         TEXT,
    was_correct     BOOLEAN NOT NULL,
    actual_disease  TEXT,
    notes           TEXT
);
"""
_FEEDBACK_INDEXES_SQL = (
    f"CREATE INDEX IF NOT EXISTS {_FEEDBACK_TABLE}_report_id_idx  ON {_FEEDBACK_TABLE} (report_id);",
    f"CREATE INDEX IF NOT EXISTS {_FEEDBACK_TABLE}_created_at_idx ON {_FEEDBACK_TABLE} (created_at DESC);",
)


_init_lock = asyncio.Lock()
_initialised = False


async def _ensure_schema() -> bool:
    """Idempotent CREATE TABLE + indexes. Returns True if table is ready."""
    global _initialised
    if _initialised:
        return True
    async with _init_lock:
        if _initialised:
            return True
        pool = await get_shared_pool()
        if pool is None:
            return False
        async with pool.acquire() as conn:
            await conn.execute(_CREATE_SQL)
            for stmt in _INDEXES_SQL:
                await conn.execute(stmt)
            await conn.execute(_FEEDBACK_CREATE_SQL)
            for stmt in _FEEDBACK_INDEXES_SQL:
                await conn.execute(stmt)
        _initialised = True
        logger.info("[Persistence] %s + %s schemas ready", _TABLE, _FEEDBACK_TABLE)
        return True


async def record_feedback(
    *,
    report_id: str,
    was_correct: bool,
    actual_disease: str | None = None,
    notes: str | None = None,
    user_id: str | None = None,
) -> bool:
    """
    Persist a farmer's "was this diagnosis correct?" verdict.

    Returns True if the row was written. Returns False (rather than raising)
    if persistence is disabled or the DB pool is unavailable — the route
    surfaces False as a 503 so the client can retry, but a failure here
    must never lose user-facing functionality.
    """
    if not PERSISTENCE_ENABLED:
        return False
    try:
        ok = await _ensure_schema()
        if not ok:
            return False
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                f"INSERT INTO {_FEEDBACK_TABLE} "
                f"(report_id, user_id, was_correct, actual_disease, notes) "
                f"VALUES ($1, $2, $3, $4, $5)",
                report_id, user_id, bool(was_correct), actual_disease, notes,
            )
        logger.info(
            "[Feedback] saved report_id=%s correct=%s actual=%s",
            report_id[:8], was_correct, actual_disease,
        )
        return True
    except Exception:
        logger.exception("[Feedback] record_feedback failed report_id=%s", report_id[:8])
        return False


# ── Public API ──────────────────────────────────────────────────────────────

def _image_hashes(images: list[dict]) -> list[str]:
    """Cheap perceptual-ish hash: SHA-256 of file bytes truncated to 16 hex.
    Stored so we can detect "same image submitted twice" across users
    without keeping the bytes."""
    hashes: list[str] = []
    for img in images or []:
        try:
            with open(img["path"], "rb") as f:
                data = f.read()
            hashes.append(hashlib.sha256(data).hexdigest()[:16])
        except Exception:
            hashes.append("err")
    return hashes


def _summary_row(*, params: dict, images: list[dict], report: dict) -> dict:
    """Pull the high-value scalar columns out of the report."""
    meta = report.get("meta") or {}
    disease = report.get("disease") or {}
    pipeline_token_usage = meta.get("pipeline_token_usage") or {}
    prompts = meta.get("prompts") or {}
    safety = meta.get("safety") or {}
    weather_outlook = report.get("weather_outlook") or {}

    return {
        "request_id":      meta.get("request_id"),
        "user_id":         params.get("user_id"),
        "crop_name":       params.get("crop_name"),
        "state":           params.get("state"),
        "district":        params.get("district"),
        "growth_stage":    params.get("crop_growth_stage"),
        "farm_size_acres": _maybe_num(params.get("farm_size_acres")),
        "tier":            meta.get("tier"),
        "image_hashes":    _image_hashes(images),
        "image_quality":   _maybe_num(meta.get("image_quality_score")),
        "weather_used":    bool(weather_outlook.get("weather_used", False)),
        "weather_risk":    weather_outlook.get("risk"),
        "primary_disease": disease.get("name_common"),
        "pathogen_type":   meta.get("pathogen_type"),
        "confidence":      _maybe_num(report.get("confidence_score")),
        "confidence_tier": meta.get("confidence_tier"),
        "escalated":       bool(meta.get("escalated", False)),
        "needs_lab":       bool(meta.get("needs_lab_confirmation", False)),
        "model_diagnose":  meta.get("model_diagnose"),
        "model_treatment": meta.get("model_treatment"),
        "prompt_diagnose_hash":  (prompts.get("diagnose")  or {}).get("hash"),
        "prompt_treatment_hash": (prompts.get("treatment") or {}).get("hash"),
        "registry_version":      safety.get("registry_version"),
        "safety_blockers": len(safety.get("blockers", [])),
        "safety_warnings": len(safety.get("warnings", [])),
        "pipeline_seconds": _maybe_num(meta.get("pipeline_seconds")),
        "total_tokens":    int(pipeline_token_usage.get("total_tokens") or 0),
        "cost_usd":        _maybe_num(pipeline_token_usage.get("total_cost_usd")),
    }


def _maybe_num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


async def record_diagnosis(
    *,
    params: dict,
    images: list[dict],
    report: dict,
) -> None:
    """Fire-and-forget. Never raises — DB outage must not break a scan."""
    if not PERSISTENCE_ENABLED:
        return
    try:
        ok = await _ensure_schema()
        if not ok:
            logger.debug("[Persistence] DB pool unavailable — skipping write")
            return
        row = _summary_row(params=params, images=images, report=report)
        # Strip _safety from the payload so the JSONB isn't bloated with
        # the same data the columns already hold.
        payload = json.dumps(report, default=str)

        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                f"""
                INSERT INTO {_TABLE} (
                    request_id, user_id, crop_name, state, district, growth_stage,
                    farm_size_acres, tier, image_hashes, image_quality,
                    weather_used, weather_risk, primary_disease, pathogen_type,
                    confidence, confidence_tier, escalated, needs_lab,
                    model_diagnose, model_treatment,
                    prompt_diagnose_hash, prompt_treatment_hash, registry_version,
                    safety_blockers, safety_warnings,
                    pipeline_seconds, total_tokens, cost_usd, payload
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,
                    $7,$8,$9,$10,
                    $11,$12,$13,$14,
                    $15,$16,$17,$18,
                    $19,$20,
                    $21,$22,$23,
                    $24,$25,
                    $26,$27,$28,$29::jsonb
                )
                """,
                row["request_id"], row["user_id"], row["crop_name"], row["state"],
                row["district"], row["growth_stage"], row["farm_size_acres"],
                row["tier"], row["image_hashes"], row["image_quality"],
                row["weather_used"], row["weather_risk"], row["primary_disease"],
                row["pathogen_type"], row["confidence"], row["confidence_tier"],
                row["escalated"], row["needs_lab"], row["model_diagnose"],
                row["model_treatment"], row["prompt_diagnose_hash"],
                row["prompt_treatment_hash"], row["registry_version"],
                row["safety_blockers"], row["safety_warnings"],
                row["pipeline_seconds"], row["total_tokens"], row["cost_usd"],
                payload,
            )
        logger.debug(
            "[Persistence] saved scan crop=%s disease=%s conf=%s tier=%s",
            row["crop_name"], row["primary_disease"], row["confidence"], row["tier"],
        )
    except Exception:
        logger.exception("[Persistence] record_diagnosis failed — continuing without")
