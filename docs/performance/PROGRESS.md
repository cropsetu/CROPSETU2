# Current Optimization Progress

## Current Item

PERF-021 — feature-by-feature sweep (claude.md §71). Working the findings it
produced; §18, §27, §32, §46, §58 and §62–64 are now answered.

## Status

Every item on the original P0/P1 list is closed. The remaining work is the §71
per-feature sweep and the two things that need something this environment does
not have: production `pg_stat_user_indexes` (index drops, §18) and a staging
environment with mocked AI providers (load testing, §62/§63).

## Current Feature

Data growth (§26/§27), offline behaviour (§46) and the test harness itself.

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
PERF-005  backend/src/socket/chat.socket.js, backend/src/socket/socketReauth.js (new)
          backend/src/server.js, shared/services/{api,socket}.js
          backend/tests/backend/security/{socketHandshakeAuth,socketReauth}.test.js (new)
          frontend/src/services/__tests__/socketAuthRetry.test.js (new)
PERF-009  backend/src/services/erasure.service.js  (to_regclass probe, pre-transaction)
PERF-011  backend/src/server.js, backend/src/config/env.js  (CRON_ENABLED)
PERF-012  backend/src/services/authCache.js (new), middleware/auth.js, config/db.js
PERF-015  backend/prisma/schema.prisma, prisma/manual/read_path_indexes.sql (new)
PERF-016  shared/i18n/translations.js, frontend/src/screens/AI/{Scan,Voice}HistoryScreen.js
          fastapi/weather_service.py  (Redis address + re-probe)
docs      docs/performance/TABLES.md (new) — §14, §66, §67, §68, §69
```

## Tests

| Suite | Before | After |
|---|---|---|
| backend (`npm test`, no flags) | 7–8 suites / 37–38 failing → then 143 failing in parallel | **108 suites / 0 failing, 1275 passing** |
| fastapi (`pytest tests`) | 4 failing / 311 passing | **337 passing** |
| frontend + shared (`npx jest`) | 9 suites / 175 passing | **14 suites / 212 passing** |
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
- A banned or logged-out user could previously hold a socket indefinitely; the
  handshake now refuses one and the sweep closes an existing one within a tick.
- Buy-box: **6 offer queries → 1** for a six-variant product, same winner throughout.
- Consent: **320 rows read → 8**, identical verdict per purpose.
- Admin dashboard: 16 aggregates → **0 on a warm read**.
- Auth: **50 authenticated requests → 1 user read** (98% hit rate); a plain
  `prisma.user.update({isActive:false})` still 401s the next request.
- Comments replies: Seq Scan 8.31 ms → bitmap index scan **0.79 ms**.
- Community feed: 13.07 ms with a sort → **0.14 ms**, no sort.
- Celery scan persistence: 1 of 30 tasks succeeded → **30 of 30**, connections flat at 3.
- i18n: seven regional bundles (692 KB) no longer evaluated at cold start.
- Backend suite wall clock: ~30 s, unchanged.

## Recently completed (this session)

| ID | What | Verified by |
|---|---|---|
| PERF-022 | Retention for the two FastAPI-owned scan tables | live DB: absent/present/idempotent |
| PERF-023 | §27 payload split — measured and **rejected**, 15.9 KB/report | offline report build |
| PERF-024 | Write queue minted a new Idempotency-Key per retry | revert → 1 of 6 fails |
| PERF-025 | Uploads cut off mid-Cloudinary at 30 s | revert → 2 of 5 fail |
| PERF-026 | Native voice could not recover from an expired token | revert → 5 of 7 fail |
| PERF-027 | `npm test` ≠ CI; 143 spurious failures | 143 → 0 |
| PERF-028 | `reviews` index prefix-subsumed — proven, not dropped | EXPLAIN, 200k rows |

## Next item

The §71 sweep's surviving findings, then the two blocked items.

**Blocked on something this environment does not have — not on effort:**
- **§18 index drops** need `pg_stat_user_indexes` from production. ~40 of 284
  index declarations look prefix-subsumed or duplicated. One of them
  (`reviews.userId`, PERF-028) is now *proven* subsumed by query plan rather than
  suspected — and still not dropped, because §18 is explicit that a structural
  argument alone is not enough for a production index.
- **§62/§63 load testing under AI load** still needs mocked providers so a run
  does not spend real Gemini money. The read paths ARE now measured — see
  `LOAD-AND-PROFILE.md`: 5,028 rps on the storefront at 100 concurrent, zero
  errors to 2,000 concurrent, DB connections flat at 13. The AI path is the one
  scenario deliberately omitted rather than approximated.

**Known and deliberately deferred:** PERF-020 (the 676 KB i18n backfill is still
eager — splitting it means changing the generator), and the Expo receipt-polling
half of §45.

## A note on the test suite — now resolved (PERF-027)

The previous version of this section recorded three DB-backed suites each
failing once, never reproducing, cause unknown, hypothesis "shared-schema
contention between suites".

The hypothesis was right and the mechanism is now known. Every DB-backed suite
truncates all tables in `afterAll` against one shared database. Nothing enforced
serial execution: the CI workflow passed `--runInBand`, the `test` script did
not. Running `npm test` plainly produced **143 failures**, stably — the same 143
twice, which reads as a real regression rather than a harness problem, and cost
an hour of hunting through a diff before the flag explained it.

`maxWorkers: 1` now lives in the jest config, so `npm test`, `npx jest <file>`
and CI all mean the same thing. The intermittent single-suite failures were the
mild version of the same collision.

**Method note worth keeping:** the tell was that the failure count was
*identical* across runs while the failing *suite* set changed. Deterministic
count plus non-deterministic attribution is a harness signature, not a code
signature.