"""
Pipeline Budget — CropGuard

Wall-clock time tracker used by the orchestrator to bound each stage and
to short-circuit downstream stages when budget is already exhausted.

The previous design relied solely on a 120 s `asyncio.wait_for` around the
whole pipeline. That works for the "hang forever" case but leaves no signal
when one stage eats most of the budget: e.g. Diagnose takes 100 s → Treat
gets a 20 s asyncio cancel mid-LLM, and the user sees a generic timeout.

Budget gives the orchestrator two affordances:
  1. `with_budget(coro, max_seconds, ...)` — wrap a single stage in a
     tight timeout, picking the smaller of (stage soft-cap, remaining
     pipeline budget). If neither is enough, raise BudgetExhausted before
     even calling the coro so we don't burn tokens for a doomed call.
  2. `remaining()` — read the leftover budget. The orchestrator uses this
     to DEGRADE: e.g. if < 10 s remain after diagnosis, skip the treatment
     LLM entirely and return a cultural-only fallback.
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import contextmanager
from typing import Awaitable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class BudgetExhausted(TimeoutError):
    """Raised when the remaining budget is too small to even attempt a stage."""


class PipelineBudget:
    """
    Tracks wall-clock spend across the whole pipeline.

    Usage:
        budget = PipelineBudget(total_seconds=120)
        result = await budget.with_budget(
            run_disease_diagnosis_agent(...),
            max_seconds=60,
            stage="diagnose",
        )
        if budget.remaining() < 10:
            ... degrade ...
    """

    def __init__(self, total_seconds: float):
        self.total = float(total_seconds)
        self._start = time.monotonic()
        # Per-stage elapsed accounting — useful for log/metrics, not for
        # gating. Keyed by stage name.
        self.stage_elapsed: dict[str, float] = {}

    def elapsed(self) -> float:
        return time.monotonic() - self._start

    def remaining(self) -> float:
        return max(0.0, self.total - self.elapsed())

    async def with_budget(
        self,
        coro: Awaitable[T],
        *,
        max_seconds: float,
        stage: str,
        min_required: float = 1.0,
    ) -> T:
        """
        Run `coro` with timeout = min(max_seconds, remaining_budget).

        Raises BudgetExhausted if remaining < min_required BEFORE starting.
        Raises asyncio.TimeoutError if the coroutine itself exceeds the
        computed timeout.
        """
        remaining = self.remaining()
        if remaining < min_required:
            # Close the un-awaited coroutine so we don't leak a never-awaited
            # coroutine warning into logs (and a real coroutine object into
            # the event loop). `coro` is a coroutine (not a Task) because the
            # caller passed `agent_call(...)` directly.
            close = getattr(coro, "close", None)
            if callable(close):
                try: close()
                except Exception: pass
            raise BudgetExhausted(
                f"stage={stage}: only {remaining:.1f}s left of {self.total:.0f}s budget — "
                f"need ≥ {min_required:.1f}s to attempt"
            )
        timeout = min(max_seconds, remaining)
        t0 = time.monotonic()
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        finally:
            dt = time.monotonic() - t0
            self.stage_elapsed[stage] = self.stage_elapsed.get(stage, 0.0) + dt
            logger.debug(
                "[Budget] stage=%s spent=%.2fs cap=%.1fs remaining_after=%.1fs",
                stage, dt, timeout, self.remaining(),
            )

    def snapshot(self) -> dict:
        """Dump for the report's meta block."""
        return {
            "total_seconds":     self.total,
            "elapsed_seconds":   round(self.elapsed(), 2),
            "remaining_seconds": round(self.remaining(), 2),
            "per_stage_seconds": {k: round(v, 2) for k, v in self.stage_elapsed.items()},
        }
