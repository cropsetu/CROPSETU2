# KrushiSarva — Performance Baseline

> Captured against `feat/skeleton-convention-and-cleanup` @ `0b43b18`, 2026-08-21.
> Every number here was read from the working tree or produced by a command
> recorded below. Nothing is inferred from documentation.
>
> This file supersedes nothing. It is the denominator the rest of
> `docs/performance/` is measured against.

---

## 0. What already happened

This is **not** a cold start. The repository carries two prior artefacts:

| Artefact | What it is |
|---|---|
| `ARCHITECTURE.md` (12,190 lines) | Scaling analysis + 54-item defect register |
| `audit/scalability-audit.html` | Adversarially-verified load audit @ `5bc1536` — 146 findings raised, 119 confirmed, 15 refuted, 23 P0 surviving |

Eight commits since that audit's HEAD have landed a large part of its P0 list.
`FINDINGS.md` records what is **still open**; `COMPLETED.md` records what
landed. This file records the measurable state of the system as it stands.

---

## 1. Service topology

```
Farmer app (Expo 54 / RN 0.81)  ─┐
Seller app (Expo 54 / RN 0.81)  ─┼──► Express 4 + Prisma 5 + Socket.IO ──┬──► PostgreSQL
Admin SPA  (Vite + React + TS)  ─┘         (BullMQ producer, 12 node-cron)│
                                                       │                  ├──► Redis
                                                       └──► FastAPI ──────┤
                                                             │            └──► Cloudinary
                                                             └──► Celery ──► AI providers
```

The admin SPA is **built into the backend image** and served same-origin from
`/admin` (`Dockerfile` stage 1 → `ADMIN_DIST_DIR`). It is not a separate deploy.

Modular monolith + one specialised AI service. Nothing in this baseline argues
for microservices, Kafka, sharding, or a search cluster.

### Codebase size (tracked files only)

| Area | Files | Lines |
|---|---:|---:|
| `backend/` | 336 | 69,194 |
| `frontend/` | 179 | 68,630 |
| `shared/` | 48 | 33,177 |
| `fastapi/` | 101 | 21,137 |
| `seller-app/` | 31 | 9,733 |
| `admin/` | 46 | 6,967 |
| **Total** | **741** | **208,838** |

`backend/prisma/schema.prisma` is 3,192 lines — 90 models, 43 enums,
282 `@@index` declarations.

---

## 2. Connection budget

### PostgreSQL

`backend/src/config/db.js` pins `connection_limit=12` per Express replica
(`DB_CONNECTION_LIMIT` overrides). This is **chosen, not derived** — it was
previously `os.cpus().length * 2 + 1`, which reads the *host's* core count
rather than the container's cgroup quota, so one replica on a shared 32-core
Railway host claimed 65 connections against `max_connections` 100.

Budget as documented in that file:

```
max_connections                       100
  − superuser reserve                  −3
  − FastAPI asyncpg (max_size 10)     −10
  − Celery asyncpg                    −10
  − ops headroom                       −5
  ────────────────────────────────────────
  available to Express                  72   → 6 replicas × 12
```

Per-replica 12 is shared three ways: ~3 HTTP path (Little's law at 300 req/s),
5 in-process BullMQ worker (`QUEUE_CONCURRENCY`), ~2 long-holding cron jobs.

**Ceiling:** ~6 Express replicas before a pooler is required. PgBouncer in
transaction mode is now *unblocked* — the boot-time `prisma db push` that held
a session advisory lock was removed in `fe95648`.

`fastapi/db_pool.py`: one module-level asyncpg pool, `min_size=2, max_size=10`,
`command_timeout=15`.

### Redis

| Process | Clients | Where |
|---|---:|---|
| Express | 3 | `config/redis.js` (main), `server.js:93` (Socket.IO pub/sub pair), `queue/connection.js:21` (BullMQ) |
| FastAPI + Celery | 6 | `weather_service.py:32`, `security/auth.py:75`, `security/spend.py:63`, `agents/treatment_agent.py:58`, `jobs/queue.py:102`, `services/idempotency.py:65` |

All six FastAPI clients are the **synchronous** `redis` library, constructed
lazily at first use. `weather_service.py:32` hardcodes `host="localhost"` —
recorded as a finding, not a baseline fact.

Redis carries: cache, rate limiting, idempotency, leader locks, the JWT jti
denylist, the Socket.IO adapter, scan hold context, voice cancellation, BullMQ
broker, Celery broker + result backend, and the AI spend counter. Correctness-
critical state and disposable cache share one instance.

---

## 3. Background work

### node-cron — 12 schedules, all on every web replica

Registered in `backend/src/server.js:223`–`:437`. Ten are wrapped in
`withLeaderLock` (`backend/src/utils/leaderLock.js`); two are not and therefore
multiply by replica count. **No schedule declares a timezone**, so all fire at
container-local time.

| Cron | Leader-locked | Job |
|---|---|---|
| `*/25 * * * *` | no | (see `server.js:223`) |
| `30 0 * * *` | yes | `mandi-daily-sync` |
| `0 1 1 * *` | yes | `prediction-cache-purge` |
| `*/5 * * * *` | no | (see `server.js:312`) |
| `*/5 * * * *` | yes | `seller-stats-refresh` |
| `7 * * * *` | yes | `seller-metrics-refresh` |
| `*/2 * * * *` | yes | `shop-reservation-sweep` |
| `*/5 * * * *` | — | (see `server.js:375`) |
| `*/10 * * * *` | yes | `shop-payment-reconcile` |
| `10 3 * * *` | yes | `shop-batch-expiry-sweep` |
| `30 2 * * *` | yes | `retention-sweep` |
| `15 * * * *` | yes | `animal-listing-expiry` |

There is no `CRON_ENABLED` flag — cron cannot currently be moved off the
latency-serving tier.

### BullMQ

One queue: `notifications`, one job: `user-notification`
(`backend/src/queue/processors.js`). `attempts: 3`, exponential backoff from
2 s. `enqueue()` **fails open by running the job inline** when Redis is
unavailable, with no concurrency bound.

### Celery

`fastapi/jobs/queue.py:38`. `task_acks_late=True`,
`worker_prefetch_multiplier=1`, `task_time_limit=300`,
`task_soft_time_limit=270`, `result_expires=24h`. Broker and result backend both
`redis://…/1`.

**There is no Celery worker liveness signal anywhere.** FastAPI can report
healthy while zero workers are deployed and every crop scan queues forever.

---

## 4. Test suite

`cd backend && npm test -- --runInBand`

| Run | Suites | Tests |
|---|---|---|
| run 1 | 7 failed / 93 | 37 failed, 1073 passed, 69 todo |
| run 2 | 8 failed / 93 | 38 failed, 1072 passed, 69 todo |

**The baseline is flaky by ±1 suite.** Wall clock ~30 s.

`npm test` without `--runInBand` is **not a usable regression signal**: parallel
jest workers truncate one shared Postgres schema and deadlock
(`40P01` in `tests/fixtures/setup.js`), producing 19 failed suites / 127 failed
tests. Always use `--runInBand`.

### Failing suites (serial)

```
tests/backend/api/agristore.api.test.js
tests/backend/api/auth.api.test.js
tests/backend/api/farm.api.test.js
tests/backend/api/user.api.test.js
tests/backend/db/prisma.test.js
tests/backend/load/booking-concurrency.test.js
tests/backend/security/injection.test.js
tests/backend/unit/cacheWarmer.test.js
```

The dominant root cause is a single contract disagreement: ~24 of the 38 assert
HTTP **422** on a validation rejection while `backend/src/middleware/validate.js`
sends **400**. Classified in `FINDINGS.md` as PERF-001 — this is the first item,
because until it is resolved no subsequent change has a clean regression signal.

Full failing-test list: `docs/performance/baseline-failing-tests.txt`.

### CI

**There is no `.github/` directory.** No workflow runs backend tests, FastAPI
tests, Prisma validation, lint, admin typecheck, or mobile logic tests on any
push. `claude.md` §60 requires CI to be trustworthy; right now it does not exist.

---

## 5. Schema deployment

`Dockerfile` CMD is `node src/server.js` — schema is **not** pushed on boot
(removed in `fe95648`).

`prisma/migrations/` holds 13 directories but is badly incomplete: 65
`CREATE TABLE` for 90 models, 23 `CREATE TYPE` for 43 enums. It cannot build a
fresh database, so `prisma migrate deploy` is not available. Schema changes
follow `prisma/manual/*.sql`, applied deliberately.

Two tables — `ai_scan_diagnoses` and `ai_scan_feedback` — are created by FastAPI
via asyncpg and are **absent from `schema.prisma`**. They are invisible to both
the retention sweep and DPDP erasure.

---

## 6. Request-path cost (read from code, not measured)

Every authenticated request pays, before any handler runs: HS256 verify →
Redis `GET` on the jti denylist → `SELECT tokenVersion, isActive FROM users`.
There is **no cache** on that user read (`backend/src/middleware/auth.js:59`).

| Endpoint | DB | Redis | Payload | Pagination | Cached |
|---|---:|---:|---|---|---|
| `GET /agristore/cart` | 13 | 4–6 | ~5 KB/line | none | no |
| `GET /users/me` | 11–12 | 4 | ~2–3 KB | n/a | no |
| `GET /agristore/products/:id` | 9 + 3V | 4 + 2V | ~12–20 KB | reviews `take:10` | no |
| `GET /agristore/products/:id/offers` | 1 + 3V | 1 | all offers | none | no |
| `POST /agristore/orders/confirm` | 25–35 | 6+ | ~2–4 KB | n/a | no |
| `GET /animals` (nearby) | 4–5 | 7–8 | ~14 KB/20 | SQL `OFFSET` | 30 s, bypassed when authed |
| `GET /agristore/products` (home) | 0 warm / 5 cold | 6 | ~18 KB/20 | `OFFSET` | 60 s |
| `GET /ai/scan/job/:jobId` | 1/poll | 4/poll | ~150 B | n/a | no |
| `GET /admin/metrics` | 16 aggregates + `take:1000` | 4 | ~2 KB | n/a | no |
| `GET /consent` | 1, unbounded rows | 1 | grows with account age | n/a | no |

`V` = variants per product. Compression enabled globally at `app.js:170`.

These are the audit's counts, re-stated here as the baseline to beat. They are
re-verified per item before that item is worked on — see `FINDINGS.md`.

---

## 7. Targets

From `claude.md` §1 and §64:

```
Registered users      100,000+          Cached read p95      < 300 ms
Daily active           20,000+          DB-backed API p95    < 500 ms
Peak concurrent      3,000–5,000        Long AI / media      async
Peak API traffic    100–300 RPS         API availability     > 99.9%
                                        Crash-free users     > 99.5%
```

---

## 8. What this baseline does not know

No production telemetry was available. Specifically absent:

- `pg_stat_statements` / `pg_stat_user_indexes` — so **no index drop is a
  decision**, only a candidate.
- `EXPLAIN ANALYZE` against real data volumes.
- Any executed load test. `backend/tests/backend/load/k6-script.js` exists but
  no run is recorded.
- Node heap / event-loop-lag profiles, RN render profiles.

Every throughput figure above is derived from code paths and the stated targets,
not measured. Anything that turns into a claim about production must be
re-measured before it is believed.
