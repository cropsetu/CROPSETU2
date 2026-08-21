# Current Optimization Progress

## Current Item

PERF-005 — Socket handshake auth is strictly weaker than HTTP auth (RT-02)

## Status

TODO — not started. Nine items are COMPLETE and verified: PERF-001 → 004, 006 → 008,
010, plus the CI in 002.

PERF-005 is deliberately still the head of the queue rather than skipped. It is the
last P0 that is not self-contained: the adversarial pass showed that hardening the
handshake alone produces a client reconnect storm, so it needs a `shared/` change
landed with it. Everything ahead of it in this session was chosen because it could be
finished and verified in one piece.

## Current Feature

Realtime / Socket.IO authentication.

## What was discovered

The session opened by establishing a baseline, then working the P0 list in the
order that makes later work measurable rather than in severity order.

**The suite was the first item, and it paid for itself immediately.** 37–38 tests
failed across 7–8 suites, flakily. Twenty-eight were stale assertions expecting HTTP
422 from a validator that has always answered 400 — measured, not assumed: flipping
the middleware made it *worse* (38 → 50). Under that noise were four real defects,
two of which no test could report because the phone fixture could not generate unique
numbers, so the suites asserting *the marketplace does not oversell a slot* and *does
not lose a rating update* had never executed once.

With the fixture fixed, both immediately failed:

- The booking race produced **1 booking and 9 HTTP 500s**. Isolation was working —
  nothing double-booked — but the losers were told the server had failed, and a 5xx is
  what the mobile client retries. `withSerializableRetry` already existed and guarded
  six AgriStore paths; rent booking had never been wrapped. Now 1 × 201, 9 × 409.
- Five concurrent reviews reproducibly left `ratingCount` at **3, not 5** — a lost
  update on the two columns that order the storefront and feed the buy box.

Then the adversarial recon pass over the remaining audit backlog found a defect **no
audit dimension had opened**: legacy products could be **oversold without limit**.
`applyStockDeltas` — the only function that writes `products.stock` — had zero call
sites, so the pre-backfill checkout branch validated stock against a number no order
ever moved. 20 of 67 products in the dev database take that branch.

The recon pass also refuted several *fix plans* while confirming their findings, which
is the more valuable half: hardening the socket handshake alone would cause a client
reconnect storm (PERF-005), and the obvious queue fix would break every queued job in
production via `worker.js` (PERF-008). Both traps are recorded in `FINDINGS.md`.

## Files changed

```
PERF-001  backend/src/routes/{rent,agristore,farmCropCycle}.routes.js
          backend/src/services/{farm,cropCycle,cacheWarmer}.service.js
          backend/tests/fixtures/factories.js  + 8 test files
PERF-002  .github/workflows/ci.yml (new)
          fastapi/tests/{test_llm_dispatch,test_diagnose_fallback}.py
          backend/tests/backend/security/farmRateLimit.test.js
PERF-003  backend/src/socket/chat.socket.js
          backend/tests/backend/security/socketChatOwnership.test.js (new)
PERF-004  backend/src/utils/stockBatch.js
          backend/src/routes/agristore.routes.js
          backend/tests/backend/api/shopLegacyStock.api.test.js (new)
PERF-006  backend/src/routes/animaltrade.routes.js
          backend/tests/backend/api/animaltrade.api.test.js
PERF-007  fastapi/db_pool.py, fastapi/jobs/tasks.py
          fastapi/tests/test_db_pool_event_loop.py (new)
PERF-008  backend/src/utils/mapLimit.js (new), backend/src/queue/{jobQueue,processors}.js
          backend/src/services/adminBroadcast.service.js, backend/src/config/env.js
          backend/tests/backend/unit/{mapLimit,jobQueue}.test.js
PERF-010  fastapi/jobs/queue.py, fastapi/jobs/tasks.py, fastapi/main.py
          backend/src/routes/admin/ops.routes.js
          fastapi/tests/test_worker_health.py (new)
          backend/tests/backend/unit/opsStatusVerdict.test.js (new)
```

## Tests

| Suite | Before | After |
|---|---|---|
| backend (`npm test -- --runInBand`) | 7–8 suites / 37–38 failing | **97 suites / 0 failing, 1145 passing** |
| fastapi (`pytest tests`) | 4 failing / 311 passing | **330 passing** |
| frontend + shared (`npx jest`) | 9 suites / 175 passing | unchanged, green |
| admin (`tsc --noEmit`, `vite build`) | green | green |

Two new suites were confirmed to **fail with the fix reverted** and pass with it
restored, so they pin their properties rather than merely accompanying them.

## Metrics

Behavioural, measured locally — no production telemetry is available:

- Rent booking under 10-way contention: **9 × 500 → 9 × 409**.
- Review aggregate under 5-way contention: **ratingCount 3 → 5**, 12/12 runs.
- `GET /farms/:id/financial-summary` with any unrecorded cost: **500 → 200**.
- Legacy product stock after an order: **unchanged → decremented**; the last unit can
  no longer be sold twice.
- Chat inbox last-message lookup: **6,000 rows read → 30**; `DISTINCT ON` 3.616 ms →
  `LATERAL` **0.163 ms**, and now O(page) rather than O(message history).
- Chat inbox unread count: 7,474 rows / 2,075 buffers / 12.1 ms → 4,771 / 581 / 5.5 ms,
  and now O(page) rather than O(all unread messages on the platform).
- Celery scan persistence: **1 of 30 tasks succeeded → 30 of 30**, Postgres backends
  flat at 3 (a naive per-task pool rebuild reached 29).
- "Scans queued, no worker" is now the only one of four worker states that reports
  `degraded`; it previously reported `ok`.
- Admin broadcast fan-out: 5,000 concurrent enqueues → bounded to 25; the inline
  fail-open path is capped and sheds best-effort work instead of the API.
- Backend suite wall clock: ~30 s, unchanged.

## Next item

**PERF-005** (socket handshake auth). Read the reconnect-storm trap in `FINDINGS.md`
first — it makes this a `shared/` change, not a backend-only one, and it is the reason
this item was not simply picked up after PERF-006.

Fully independent alternatives, in order of value:
**PERF-007** (Celery asyncpg pool across event loops — reproduced, correctness),
**PERF-010** (queue/Celery/breaker observability — makes everything after it
measurable), **PERF-008** (queue fail-open fan-out — read the `worker.js` trap first).
