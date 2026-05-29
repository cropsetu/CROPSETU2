"""
Structured Logging — CropGuard

Two output modes, selected by LOG_FORMAT env var:
  • LOG_FORMAT=text  (default in dev): the existing pipe-separated lines
  • LOG_FORMAT=json  (recommended in prod): one JSON object per line so
    Railway / CloudWatch / Loki can index by request_id, user_id, stage,
    latency_ms, cost_usd, model, etc. without grep gymnastics.

Per-request context (request_id, user_id, tier) is carried via
contextvars so any logger.info() inside an async stage automatically
gets the right tags without threading them through every call signature.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid
from contextvars import ContextVar
from typing import Any

# ── Contextvars ──────────────────────────────────────────────────────────────
# Set by the FastAPI middleware on every request; read by JsonFormatter and
# any code that wants to stamp a structured event.
request_id_var: ContextVar[str] = ContextVar("request_id", default="")
user_id_var: ContextVar[str]    = ContextVar("user_id",    default="")
tier_var: ContextVar[str]       = ContextVar("tier",       default="")
stage_var: ContextVar[str]      = ContextVar("stage",      default="")


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


class RequestContext:
    """
    Convenience context-manager so non-FastAPI code (background jobs,
    scripts) can also stamp logs:

        with RequestContext(request_id="abc", user_id="u-42"):
            ...
    """

    def __init__(self, *, request_id: str = "", user_id: str = "", tier: str = ""):
        self._rid = request_id or new_request_id()
        self._uid = user_id
        self._tier = tier
        self._tokens: list = []

    def __enter__(self):
        self._tokens.append(request_id_var.set(self._rid))
        if self._uid:
            self._tokens.append(user_id_var.set(self._uid))
        if self._tier:
            self._tokens.append(tier_var.set(self._tier))
        return self

    def __exit__(self, exc_type, exc, tb):
        for tok in reversed(self._tokens):
            tok.var.reset(tok)


# ── Formatters ───────────────────────────────────────────────────────────────

class JsonFormatter(logging.Formatter):
    """Renders each LogRecord as a single-line JSON object.

    Fields always present: ts, level, logger, msg, request_id (if set),
    user_id (if set), tier (if set), stage (if set). Extra fields passed
    via `logger.info("...", extra={"foo": 1})` are merged in.
    """

    _RESERVED = {
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "module", "msecs",
        "msg", "name", "pathname", "process", "processName", "relativeCreated",
        "stack_info", "thread", "threadName", "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts":     int(record.created * 1000),
            "level":  record.levelname,
            "logger": record.name,
            "msg":    record.getMessage(),
        }
        # Request context (only emit when set — keeps noisy logs slim).
        rid = request_id_var.get()
        if rid:
            payload["request_id"] = rid
        uid = user_id_var.get()
        if uid:
            payload["user_id"] = uid
        tier = tier_var.get()
        if tier:
            payload["tier"] = tier
        stage = stage_var.get()
        if stage:
            payload["stage"] = stage

        # Merge any `extra=...` fields the caller passed.
        for k, v in record.__dict__.items():
            if k in self._RESERVED or k.startswith("_"):
                continue
            if k in payload:
                continue
            try:
                json.dumps(v)  # ensure serialisable
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = repr(v)

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Original pipe-separated format, with request_id appended when set."""

    _FMT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"

    def __init__(self):
        super().__init__(self._FMT, datefmt="%Y-%m-%d %H:%M:%S")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        rid = request_id_var.get()
        if rid:
            line = f"{line}  [rid={rid}]"
        return line


# ── Setup ────────────────────────────────────────────────────────────────────

def setup_logging() -> None:
    """Single entrypoint called from main.lifespan. Idempotent."""
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    fmt = (os.getenv("LOG_FORMAT") or "text").lower()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())

    root = logging.getLogger()
    root.setLevel(level)
    # Clear any existing handlers so the chosen format wins on reload
    root.handlers.clear()
    root.addHandler(handler)

    # Silence noisy libraries
    for noisy in ("httpx", "httpcore", "watchfiles", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
