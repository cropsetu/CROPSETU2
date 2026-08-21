# Completed Optimizations

Newest first. An item appears here only after it has been implemented **and
verified** — code written is not completion (`claude.md` §4.3).

---

## PERF-005 — A socket never had to prove who it was

```
ID:        PERF-005
Feature:   Socket.IO authentication (RT-02)
Priority:  P0 — security
Status:    COMPLETE — verified
```

The handshake verified the JWT signature and nothing else. HTTP additionally
checks the Redis jti denylist, `isActive` and `tokenVersion`. So a banned farmer, a
logged-out one, or one whose `tokenVersion` had moved could still open a socket —
and sockets carry AI and voice turns that spend provider money, not only chat.

### Why hardening it alone would have made things worse

`getValidAccessToken` returns the **current** token untouched whenever it is more than
30 s from expiry — the right answer to *"do I have something usable?"* and the wrong one
to *"the server just refused this"*. A server can refuse a perfectly unexpired token:
denylisted jti, or a `tokenVersion` moved by a role/KYC/scope change. The socket client
called it on rejection, got the same refused token back, read it as "session alive" and
reconnected — every 1–5 s, `reconnectionAttempts: Infinity`, for the token's remaining
fifteen minutes. Each attempt would now cost a Redis read **and** a database query.

So `forceRefreshAccessToken` was added alongside it, and the reasons collapse to **two**
categories rather than three. The client cannot distinguish "revoked" from "stale" from
"banned"; what it *can* determine is whether the session can still mint a token, and
that single answer is correct for all of them. A denylisted jti is therefore reported as
`Token stale`, not `Invalid token` — logging out one device revokes that access token
while the refresh lineage survives.

The second category matters more: when the **database** lookup fails the handshake
answers `Authentication unavailable` and the client keeps reconnecting without touching
the session. Answering that like an auth failure would turn one Postgres stall into a
fleet-wide logout — the incident the HTTP path answers 503 rather than 401 to prevent.
The connection still fails closed; only the **session** is left alone.

### The second half — established sockets

A socket is not a request: once open it stays open, so the above lands on the victim's
*next* handshake. `socket/socketReauth.js` re-checks live sockets on a timer.

A **sweep**, not pub/sub, and the reason is countable: 9 sites write `tokenVersion` and
only 2 go through `bumpTokenVersion`; the admin ban writes `isActive` without touching
it at all. A publish hook in the helper would have missed ban, force-logout and DPDP
erasure. Cost is one `findMany` over the *distinct* users on this process plus one
pipelined denylist check **per tick** — ten sockets across three users is one query
naming three ids, and a test says so.

It fails **open**, in deliberate opposition to the handshake: refusing a new connection
is recoverable in seconds, tearing down every live one is not. It does not enforce the
token's `exp` — clients refresh over HTTP without re-handshaking, so that would force
the fleet to reconnect every fifteen minutes for no security gain.

`reauthStats()` and `inlineStats()` are wired into `/admin/ops/status` rather than left
exported and uncalled — which is exactly how `breakerStates()` spent its life until
PERF-010.

**Tests.** 36 — 14 handshake, 15 sweep, 7 client. The four client cases fail against the
previous `getValidAccessToken` behaviour.

**Note.** One full-suite run during this work failed `inputValidation` once and did not
reproduce in five subsequent full runs. That suite is DB-backed and part of the
historically flaky set; recorded rather than assumed away.

**Rollback.** `git revert adb5406 816dcdb`.

---

## PERF-008 — A Redis outage became an API outage

```
ID:        PERF-008
Feature:   Queue fail-open / admin broadcast
Priority:  P0 — a dependency outage cascading into a total outage
Status:    COMPLETE — verified
```

`enqueue()` fails open by running the job inline when Redis is gone — right for
*one* job, catastrophic for a fan-out. `broadcastNotification` called it once per
recipient inside `Promise.allSettled` over the whole list, and the recipient cap is
**5,000 by shipped default** (`settings.service.js`: `default: 5000, max: 5000`), not a
worst case. With Redis down that put 5,000 jobs × 3 DB operations on the request path
at once, against a Prisma pool of 12. Everything else queued behind them until
`pool_timeout` and errored.

**Two bounds, because either alone is insufficient.**

The *fan-out* is bounded regardless of Redis — 5,000 simultaneous enqueues is 5,000
simultaneous Redis writes even on the happy path. `mapLimit` is a worker pool over a
shared cursor rather than fixed batches, so one slow recipient cannot stall the rest,
and it returns `allSettled`'s shape in input order so callers count unchanged.

The *inline path* is bounded too, since the broadcast is not the only thing that could
ever fan out. Below the ceiling, behaviour is identical. At it, **best-effort** jobs are
shed with a line each; anything not explicitly marked best-effort still runs inline,
because correctness outranks latency and a dropped critical side-effect is a silent data
problem.

### The trap

Criticality lives in a **sibling** map, not on the `PROCESSORS` values. The obvious
shape — `{ run, critical }` per value — would have broken **every queued job in
production**: `worker.js` does not go through `getProcessor`, it reads
`PROCESSORS[queue]?.[job.name]` and calls the value directly. An object is not callable,
nothing covers `worker.js`, and CI would have stayed green to deploy. Jobs absent from
the map are treated as **critical**, so one added later without thought cannot become
silently droppable.

`sent` in `BroadcastLog` has always meant *accepted for delivery*, not delivered — the
Expo push happens later in a worker. A shed job was not accepted, so it counts as
failed; counting it as sent would persist a number for deliveries nobody attempted.

The suite's `ENV` mock was two keys, so a bare read for the new knob would have resolved
`undefined` and quietly disabled the bound in the very tests meant to prove it. Both the
mock and the read now guard against that.

**Tests.** 11 new — `mapLimit.test.js` (6) and the extended `jobQueue.test.js` (5). The
two shed cases fail with the bound removed.

**Rollback.** `git revert 6d1ff69`.

---

## PERF-010 — A missing scan worker, and an open circuit, were both invisible

```
ID:        PERF-010
Feature:   Observability (claude.md §35, §55, §56)
Priority:  P0 — makes everything after it measurable
Status:    COMPLETE — verified
```

Two degradations the system could not observe about itself.

**No worker deployed.** `fastapi/railway.json` switches web and worker roles off one
`$ROLE` variable, so running one without the other is a single mistake — and then every
scan is accepted, queued and never run while `/health` stays green. Nothing could tell.

The signal is deliberately a **pair**: queue depth, and how long since *any* worker last
finished a task. Depth alone is a busy afternoon; staleness alone is a quiet one. Both
at once means work is arriving and nothing is consuming it — the shape of a missing
worker, and of a wedged one. The threshold sits above `task_time_limit` so one long scan
running alone cannot trip it, and an idle fleet with an empty queue reads as idle. A
signal that cries wolf from the day it ships is ignored by the week after.

Deliberately **not** `celery_app.control.ping()` — that broadcasts over the broker and
blocks for its whole timeout, inside async handlers that already carry five blocking
Redis round-trips per scan poll (PERF-013). Two Redis reads instead, needing no
cooperation from a worker that may not exist. The worker half is one `SETEX` in the
task's existing `finally`, so success, soft timeout and hard failure all count — a
worker failing every task is still alive and still draining, which is a failure-*rate*
problem and a different signal.

Verified end to end against a real Redis and a real `TestClient`:

| scenario | `/health` |
|---|---|
| worker alive, queue empty | `ok` |
| worker alive, queue busy | `ok` |
| **scans queued, no worker** | **`degraded`** |
| no worker, nothing queued | `ok` |

**Breaker state.** `breakerStates()` has existed and been exported since the circuit
breakers shipped, and **nothing had ever called it** — an OPEN circuit on Gemini,
Sarvam, Razorpay or FastAPI was computed, kept, and displayed nowhere.
`/admin/ops/status` now carries it and names *why* it is amber rather than only that it
is: `ai_service_unreachable`, `queue_unavailable`, `scans_queued_no_worker`,
`breaker_open:<name>`. `HALF_OPEN` stays healthy — that is a recovery probe, not a
fault. That route already fetched FastAPI's `/health/details`, so the worker verdict
reaches the admin panel with no new plumbing, and it stops treating a 200 from the AI
service as proof the AI service works.

**Tests.** 21 — `fastapi/tests/test_worker_health.py` (10) and
`backend/tests/backend/unit/opsStatusVerdict.test.js` (11). The verdict was extracted as
an exported pure function so it can be pinned without standing up an authenticated admin
request.

**Rollback.** `git revert 4735e03`.

---

## PERF-007 — The scan worker lost every diagnosis after its first

```
ID:        PERF-007
Feature:   Crop scan persistence (Celery worker → asyncpg)
Priority:  P0 — silent data loss on the flagship feature
Status:    COMPLETE — verified
```

`db_pool.py` caches one asyncpg pool per process. `jobs/tasks.py` ran each Celery
task under its own `asyncio.run(...)`, justified by a comment claiming Celery workers
are *"process-per-task (prefork pool)"*.

**Prefork is process-per-WORKER.** A child handles tasks back to back for its whole
life, and `worker_max_tasks_per_child` is set nowhere in this repo. `asyncio.run`
closes its loop on return, so from the second task onward the pool held connections
belonging to a loop that no longer existed. Reproduced against live Postgres using
the repo's own `db_pool`:

```
task 1: OK
task 2: InterfaceError: cannot perform operation: another operation is in progress
task 3: InterfaceError: cannot perform operation: another operation is in progress
```

`diagnosis_repo.record_diagnosis` catches that and logs *"continuing without"*. So
nothing user-facing broke and nothing alerted — the farmer got their diagnosis, and
the row was simply never written. **Every crop scan after the first one a worker
process handled went unrecorded.** That also reframes PERF-009: `ai_scan_diagnoses`
has been missing most of its rows, not merely unreachable by erasure.

### Why loop-awareness alone was the wrong fix

Measured, not assumed. Rebuilding the pool per task leaves the previous pool's server
side connected:

| | Postgres backends after 20 tasks |
|---|---|
| rebuild-per-task | **29** |
| one loop per process | **3** |

29 would exhaust the 10-connection Celery budget faster than the bug it replaced. The
worker now keeps **one event loop per process**, which is what a "shared pool" always
implied. 30 tasks: 30 succeeded, connections flat at 3 (previously 1 of 30).

Loop-awareness stays as defence in depth — `eval/replay.py` drives the same pool
through its own `asyncio.run`. A pool whose loop is gone is **dropped, not closed**:
awaiting `close()` raises the very error being avoided, and it has no live sockets to
release. `close_shared_pool` closes only on the pool's own loop, so uvicorn shutdown
still releases connections and a foreign-loop teardown no longer raises.

**Tests.** `fastapi/tests/test_db_pool_event_loop.py` — 5 tests, no database
(`asyncpg.create_pool` stubbed; what is under test is which pool reaches which loop).
Two fail against the original implementation.

**Rollback.** `git revert 75ab1ed`.

---

## PERF-006 — The chat inbox read every message of every chat it listed

```
ID:        PERF-006
Feature:   AnimalTrade chat inbox — GET /animals/chats/my
Priority:  P0 — unbounded in table size
Status:    COMPLETE — verified
```

Two Prisma includes, neither compiling to SQL bounded by the page.

**`messages: { take: 1 }` emits no `LIMIT`.** Prisma slices to one per chat in
JavaScript. Measured on a 30-chat inbox with 200 messages each: **6,000 rows read to
render 30.** The multiplier is the conversation history, so the inbox got slower for
exactly the people who use it most.

**The unread `_count` cost does not depend on the user at all.** It compiles to a
LEFT JOIN against a subquery with no correlation to the listed chats — every unread
message on the *platform* is scanned and grouped, then the other people's rows are
discarded by the join.

### Measured (15,000-row table, other users' traffic present)

| | rows read | buffers | exec |
|---|---:|---:|---:|
| unread count — before | 7,474 | 2,075 | 12.1 ms |
| unread count — after | 4,771 | 581 | 5.5 ms |
| last message — `DISTINCT ON` | sorts 6,000 | 627 | 3.616 ms |
| last message — **`LATERAL`** | **30** | 365 | **0.163 ms** |

`LATERAL`, not `DISTINCT ON`: both return one row per chat, but `DISTINCT ON` must
sort every matching message and **no index can serve it** — it still sorted 6,000 rows
with `enable_seqscan = off`. `LATERAL` is N independent top-1 lookups on the existing
`@@index([chatId, createdAt DESC, id DESC])`. The shape matters more than the 22×: it
costs 30 index lookups whatever the history is, so a two-year-old conversation opens
as fast as a new one. `id DESC` breaks ties so two messages in the same millisecond
cannot alternate between requests.

The seller's per-listing chat list had the same include on a page listing up to 100
chats and shares the helper; its response keeps the full message row.

**Tests.** Three, in `animaltrade.api.test.js`: the newest message is the one reported,
unread counts exclude your own messages and do not leak from a neighbouring chat, and
an empty chat reports zero.

**Rollback.** `git revert ccd2c53`.

---

## PERF-001 — Restore the regression signal, and fix what it was hiding

```
ID:        PERF-001
Feature:   Backend test suite (cross-cutting)
Priority:  P0 — gates every subsequent item (claude.md §60)
Status:    COMPLETE — verified
```

### Problem

`cd backend && npm test -- --runInBand` failed **7–8 suites / 37–38 tests**, and
the count moved between runs. `claude.md` §60 requires a known failing baseline
to be classified rather than hidden, and no change after this one could be
called regression-free while the signal was that noisy.

### What the failures actually were

Classified all 38. They were not 38 problems:

| Group | Count | Verdict |
|---|---:|---|
| Assertions expecting HTTP 422 from `validate()`, which ships 400 | 27 | **Stale tests** |
| Test fixture: `randomPhone()` collides | 2 suites blocked | **Fixture defect, hiding 2 real ones** |
| `0 + Decimal` string concatenation in a test | 1 | **Stale test** |
| `pushToken.create()` missing required `platform` | 1 | **Stale test** |
| `warmMarketCache` skip-on-`GEMINI_API_KEY` | 1 | **Stale test** — the LLM it guarded is gone |
| Non-UUID product id expecting 404, guard answers 400 | 1 | **Stale test** |
| Cycle ownership 403 vs 404 | 2 | **Stale tests** — 403 is the pinned criterion |
| `financial-summary` returns 500 | 1 | **Real defect** |
| `areaAllocatedAcres` error message swallowed | 1 | **Real defect** |
| Booking race → nine `500`s | 1 | **Real defect** (was unreachable) |
| Review aggregate lost update | 1 | **Real defect** (was unreachable) |

The 422-vs-400 question was settled by evidence, not preference. `validate.js`'s
own docstring says 400; `inputValidation.test.js` — the systematic, route-by-route
validator suite — asserts 400 and passes; 86 assertions say 400 against 27;
several 422-asserting tests still carried `'400 — …'` in their own names; and a
previous engineer had already resolved exactly this contradiction in
`rent.api.test.js` with the note *"this test asserted 422 and had never passed."*
Flipping the middleware to 422 was measured first and made it **worse** (38 → 50
failures), which confirmed the direction.

### The four real defects, all previously invisible

**1. `randomPhone()` could not produce unique numbers** — `factories.js:12`

Nine of ten digits came from `String(Date.now()).slice(-9)`, a millisecond clock.
Two users built in the same millisecond got identical suffixes with only a
1-in-4 leading digit between them. `users.phone` is UNIQUE, so any test
provisioning actors in a tight loop was a coin flip — and the two that provision
the most are the suites asserting **the marketplace does not oversell a slot**
and **does not lose a rating update**. Both had never executed.

**2. Booking race answered `500` nine times out of ten** — `rent.routes.js`

With the fixture fixed, the booking test ran for the first time: 1 created, **9 ×
HTTP 500**. The no-double-booking property held — the `Serializable` isolation
works — but the losers got a server error. `withSerializableRetry` already
existed and was used at six AgriStore sites; the rent booking transaction was
never wrapped. A 5xx is also what the mobile client retries, so the losers came
straight back.

Now: **1 created, 9 × `409`**.

**3. Concurrent reviews silently discarded ratings** — `agristore.routes.js`

The review handler recomputes `products.rating` / `ratingCount` with an
aggregate inside a **default-isolation** transaction. Each concurrent reviewer
counted the subset committed at its own snapshot and wrote that stale total —
last writer wins, undercounting. Five simultaneous reviews reproducibly left
`ratingCount` at **3, not 5**, on every run. Those two columns order the
storefront and feed the buy box, so the discarded ratings are not cosmetic.

Fixed with `Serializable` + `withSerializableRetry({ attempts: 6 })`. The larger
budget is deliberate: unlike checkout, where racers conflict only over the same
listing, every reviewer of one product conflicts with every other by
construction, so with N reviewers one can lose N−1 times. Verified 12/12 runs.

**4. `GET /farms/:id/financial-summary` returned 500** — `farm.service.js:151`

`D(c.totalInputCostInr).plus(c.laborCostInr)` passed the **raw** column to
`Decimal.plus()`. All four cost columns are `Decimal?`, and `Decimal.plus(null)`
throws — so the screen a farmer opens to see whether a season made money crashed
for any cycle with an unrecorded cost, which is the state every cycle starts in.
`D()` already maps null to 0; the operands just weren't going through it.
`cropCycle.service.js` does this correctly and was left alone.

Also fixed alongside it: `createCropCycle` threw a precise message
(*"Area 999 exceeds farm size 2 acres"*) that `sendServerError` discarded because
the error was not marked `expose`, so the farmer saw only *"Could not create crop
cycle."* And the route forced **every** failure to 400, including a Prisma
outage — a real server fault was reported as a client error and never surfaced
as a 5xx. The business error now carries its own `statusCode`, and the forced
400 is gone.

### Deliberately not changed

`requireCycleOwner` answers **403** for another farmer's cycle and 404 for an
absent one. That split is an explicit acceptance criterion, documented and pinned
by `tests/backend/security/cycleOwnership.test.js`. It differs from the sibling
farm routes, which answer 404 for anything the caller does not own. I aligned the
two stale API assertions to the pinned 403 rather than flipping a documented
security decision as a side effect of a test cleanup. The inconsistency is
recorded as **PERF-014** for a deliberate call.

### Files

```
backend/src/routes/rent.routes.js                       + withSerializableRetry
backend/src/routes/agristore.routes.js                  + Serializable + retry(6)
backend/src/routes/farmCropCycle.routes.js              statusCode passthrough
backend/src/services/farm.service.js                    D() on every operand
backend/src/services/cropCycle.service.js               expose the real message
backend/src/services/cacheWarmer.service.js             stale @returns
backend/tests/fixtures/factories.js                     collision-free randomPhone
backend/tests/backend/api/{agristore,auth,farm,rent,user}.api.test.js
backend/tests/backend/db/prisma.test.js
backend/tests/backend/load/booking-concurrency.test.js
backend/tests/backend/unit/cacheWarmer.test.js
```

### Measurement

| | Suites | Tests failing | Passing |
|---|---|---|---|
| Before | 7–8 of 93 (flaky) | 37–38 | 1072–1073 |
| After | **0 of 93** | **0** | **1111** |

Three consecutive full runs, identical result. The two concurrency suites were
additionally run 12× and 4× respectively to confirm the fixes are not timing luck.

No production behaviour was changed except the four defects above. No status code
that any client branches on was altered.

### Rollback

`git revert` the commit. The test-only changes are inert; the four code changes
are independent of each other and can be reverted individually.

---

## PERF-004 — Legacy products could be oversold without limit

```
ID:        PERF-004
Feature:   AgriStore checkout (pre-backfill / DUAL-READ branch)
Priority:  P0 — money and stock (claude.md §51, §52)
Status:    COMPLETE — verified
```

A product predating the catalog split has no variants, so no `seller_listing`, so no
`listingId` on its cart row. Checkout takes the DUAL-READ branch, where stock lives on
`products.stock` and the listing-targeted statement cannot reach it.

That branch validated `p.stock < item.quantity` and recorded **no decrement anywhere**.
`applyStockDeltas` — the only function in the codebase that writes `products.stock` —
had **zero call sites**; its own docstring called it "retained only for the dual-write
window". So the check ran forever against a number no order had ever moved, and the
last unit could be sold again and again. **20 of 67 products** in the dev database have
no variants, all active and APPROVED, with a legacy cart row already present.

The buyer-cancel handler claimed in a comment that pre-backfill items were "restored by
the legacy path below". No such path existed, there or anywhere.

**Fixed.** `validateCartForCheckout` now returns `productDeltas`; both checkout paths
apply them inside the same Serializable transaction that validated them; both cancel
paths restore them. `applyStockDeltas` gained the `stock + delta >= 0` guard and
`RETURNING` shape its listing sibling already had — not `GREATEST(..., 0)`, because
clamping turns an oversell into a successful order for the wrong quantity.

On the paid path the product decrement deliberately runs **outside** the `consumed`
check: that flag means the *listing* reservation from `/orders/initiate` was converted,
and a pre-backfill line never had one.

**Tests.** `backend/tests/backend/api/shopLegacyStock.api.test.js` — 4 tests, confirmed
to fail with the decrement removed. The fixture asserts the product genuinely has no
variants, so the suite cannot drift onto the listing path and keep passing.

**Found by** the adversarial pass over the load audit, which noted no audit dimension
had opened this branch.

**Rollback.** `git revert f326cfa`.

---

## PERF-003 — `mark_read` let a stranger clear someone else's unread badge

```
ID:        PERF-003
Feature:   Socket.IO chat
Priority:  P0 — security (claude.md §54, object-level authorization)
Status:    COMPLETE — verified
```

`mark_read` was the only handler in `chat.socket.js` that took a `chatId` off the wire
and acted on it without checking membership. `join_chat` and `send_message` both check,
ten and thirty lines above it.

Any authenticated socket could name any chat id and set `readAt` across every message
in it that it had not sent. The harm lands on the victim: their unread count drops to
zero on messages they never opened, and a farmer who misses a buyer's enquiry that way
gets no signal at all. It also emitted `messages_read` into a room the caller had never
joined. The `read` token bucket throttled this to ~5/s; it never prevented it.

**Fixed** with the same `findFirst` on `buyerId`/`sellerId` its neighbours use.

**Tests.** `backend/tests/backend/security/socketChatOwnership.test.js` — the first
socket test in the repository, which is precisely why a missing check surrounded by
present ones went unnoticed. Confirmed to fail with the guard removed.

**Rollback.** `git revert 173620b`.

---

## PERF-002 — CI that actually runs

```
ID:        PERF-002
Feature:   Repository infrastructure
Priority:  P0 — claude.md §60
Status:    COMPLETE — verified
```

There was no `.github/` directory. Nothing ran any suite on any push, so "the tests
pass" was an assertion about someone's laptop.

Five jobs, each running the exact command a developer runs locally: backend jest
against real Postgres + Redis, FastAPI pytest, the frontend runner (whose config
already roots `../shared`, so one job covers both), admin typecheck **and** build, and
`prisma validate`. The admin build is not redundant — the Dockerfile compiles that SPA
into the backend image, so a break there breaks the backend deploy.

Two details are load-bearing: the CI database is named `cropsetu_test` because the
fixtures refuse any name not ending in `_test` (`cleanupTestData` wipes ~20 tables),
and the runner is pinned to `--runInBand` because parallel workers deadlock on `40P01`.

**What adding it caught.** FastAPI was at 4 failed / 311 passed, all four stale in the
same way — they predate WI-11, which made the LLM dispatch multi-provider. Two asserted
every non-Gemini model raises `ConfigError`, when the commit that made them route is
titled *"fix stale Gemini-only docs"*. The other two **never ran at all**: their stub
for `get_feature_config` was a one-argument lambda, so WI-11's `model_override` kwarg
raised `TypeError` before either assertion executed — meaning the no-cross-model-
fallback policy for crop diagnosis had been unverified this whole time. Now 315/315.

Simulating the CI environment before trusting it also caught a real flake:
`farmRateLimit` used the production rate-limit prefixes verbatim, so with `REDIS_URL`
set the keys landed in shared Redis for a full 15-minute window while the `beforeEach`
reset clears only the in-memory half. Namespaced per run.

**Rollback.** `git revert 9c9112e`.
