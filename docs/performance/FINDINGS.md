# Findings

Ranked backlog. Every entry below was re-verified against the working tree by an
independent adversarial pass instructed to refute it — items that died there are
in §Refuted, because negative results are worth as much as positive ones
(`claude.md` §4.2).

`COMPLETE` items have their full report in `COMPLETED.md`.

| ID | Title | P | Status |
|---|---|---|---|
| PERF-001 | Restore the regression signal, and fix what it hid | P0 | COMPLETE |
| PERF-002 | CI that actually runs | P0 | COMPLETE |
| PERF-003 | `mark_read` chat IDOR | P0 | COMPLETE |
| PERF-004 | Legacy products can be oversold without limit | P0 | COMPLETE |
| PERF-005 | Socket handshake auth is weaker than HTTP auth (RT-02) | P0 | COMPLETE |
| PERF-006 | Chat inbox reads every message of every listed chat | P0 | COMPLETE |
| PERF-007 | Celery reuses one asyncpg pool across event loops (DB-05) | P0 | COMPLETE |
| PERF-008 | Broadcast fan-out runs inline on a Redis outage (OPS-03) | P0 | COMPLETE |
| PERF-009 | FastAPI tables invisible to erasure (GROW-10) | P0 | COMPLETE |
| PERF-010 | No Celery/queue/breaker observability | P0 | COMPLETE |
| PERF-011 | 12 cron schedules on every web replica | P1 | COMPLETE |
| PERF-012 | Auth hot-path user read is uncached (AUTH-01) | P1 | COMPLETE |
| PERF-013 | Blocking Redis inside FastAPI `async def` | P1 | TODO |
| PERF-014 | 403-vs-404 disagreement between farm and cycle routes | P2 | DECIDED — convention documented in utils/response.js |
| PERF-015 | Missing composite indexes (comments, posts added; chats rejected) | P2 | COMPLETE |
| PERF-016 | Mobile: duplicate fetches + i18n bundles at boot | P2 | COMPLETE (backfill split still open) |
| PERF-017 | Stale "422" comments contradict the 400 contract | P3 | TODO |

---

## PERF-005 — Socket handshake auth is strictly weaker than HTTP auth

**P0 · COMPLETE — see COMPLETED.md · Component:** `backend/src/socket/chat.socket.js:43-53`

**Evidence.** The handshake verifies the JWT signature and nothing else. HTTP
(`middleware/auth.js:36-68`) additionally checks the Redis `jti` denylist, `isActive`,
and `tokenVersion`. An established socket is never re-authenticated, so a banned,
logged-out or token-bumped user keeps a live channel — including AI/voice turns that
spend provider money (`ai.routes.js:475`) — until they choose to disconnect.

**Verified.** Unchanged since the initial commit; `50b2c53` touched this file only to
delete the presence broadcast. 9 `tokenVersion` write sites exist, only 2 via
`bumpTokenVersion` — so a publish hook on that helper would miss ban, force-logout
and DPDP erasure. There are no socket-auth tests.

**The trap the adversarial pass found.** Hardening the handshake *alone* causes a
client reconnect storm. `shared/services/api.js:385-402` returns the *same* token
unrefreshed when it is >30 s from expiry, and `shared/services/socket.js:69-76` reads
any truthy return as "session alive" and keeps reconnecting. So rejecting with
`'Invalid token'` only stops the loop when the *refresh* also fails — true for ban,
force-logout, logout-all, team-revoke and phone-change; **false** for admin role
change, KYC role flip, team scope change and single-device denylist. Those users
would spin at 1–5 s for up to 15 minutes, each attempt now costing a Redis GET **and**
a Prisma query. This is therefore *not* a backend-only change.

**Recommended shape.**
1. Mirror `auth.js:36-68` in the handshake; stash `socket.data.auth`.
2. **Required alongside:** either export a forced refresh from `shared/services/api.js`
   (`performRefresh` is module-private today) and have `socket.js` call it, or return
   two distinct error strings — "re-mint" vs "session dead" — and teach the client.
   Keep DB errors on a **third** string so a Postgres stall is retried, not treated as
   a dead session (the socket analogue of the 503-not-401 fix in `1c66a90`).
3. Periodic per-process sweep (`socket/socketReauth.js`), one `findMany` + one Redis
   pipeline per tick, failing **open**. This is what converges the cases step 2 cannot.

**Risk.** Handshake fails closed, sweep fails open — deliberately asymmetric.
Do **not** add a handshake cache; it reintroduces the staleness this finding is about.

**Still open after this fix:** nothing — but note `mark_read` was a separate IDOR on
the same file, fixed in PERF-003.

---

## PERF-006 — The chat inbox reads every message of every listed chat

**P0 · COMPLETE — see COMPLETED.md · Component:** chat inbox query (`animalListing`/chat list path)

**Evidence (EXPLAIN, live Postgres).** Two independent defects in one query:

1. The unread `_count` compiles to a **Seq Scan of the whole `chat_messages`
   table**. The `buyerId OR sellerId` predicate yields no equivalence class for
   Postgres to push down, so the subquery cannot use `[chatId]`.
2. The `messages: { take: 1 }` include emits
   `WHERE chatId IN (…) ORDER BY createdAt DESC` **with no LIMIT** — Prisma applies
   `take: 1` in JavaScript. Every message of all 30 listed chats is loaded into Node
   and 29/30 of them discarded.

Both scale with total message volume, on the screen farmers open most.

**Recommended change.** Replace the nested include with an explicit grouped query
(last message per chat via a lateral join or a `DISTINCT ON`), and add the partial
index `(chatId, senderId) WHERE readAt IS NULL` for the unread count. Measure with
`EXPLAIN (ANALYZE, BUFFERS)` before and after.

**Why this outranks the auth cache.** It is unbounded in table size; the auth read is
a bounded PK probe. See PERF-012.

---

## PERF-007 — Celery reuses one asyncpg pool across `asyncio.run` event loops

**P0 · COMPLETE — see COMPLETED.md · Component:** `fastapi/db_pool.py:15-26`, `fastapi/jobs/tasks.py`

**Evidence.** Reproduced end-to-end against a live Postgres using the repo's own
`db_pool.py`: task 1 succeeds, tasks 2 and 3 raise `RuntimeError: Event loop is
closed` plus leaked `ConnectionDoesNotExistError` futures. The raising frame is
`asyncpg/protocol/protocol.pyx:768` (`self.loop.call_later` in `_new_waiter`),
reached because `command_timeout=15` is set. `git log -- fastapi/db_pool.py` shows
one commit ever; `fe95648` pinned the *Prisma* pool, not this one.

Failures are logged (`diagnosis_repo.py:292` is `logger.exception`) but invisible to
the caller and to metrics — they surface as connection errors that look like Postgres
problems and are not.

**Recommended change.** A per-loop pool registry, or make the Celery task own the
pool lifecycle. Both were executed by the verifier and work; note `terminate()` itself
raises "Event loop is closed" and must be handled.

---

## PERF-008 — A Redis outage moves the broadcast fan-out onto the request path

**P0 · COMPLETE — see COMPLETED.md · Component:** `backend/src/queue/jobQueue.js:52-67`

**Evidence.** `enqueue()` fails open by running the job inline with no concurrency
bound. One admin broadcast fans out to **5,000** recipients — and 5,000 is the shipped
**default**, not a worst case (`settings.service.js:177`: `default: 5000, max: 5000`).
Each inline call is **3 DB operations** (2 awaited + a floating
`notification.create` at `push.service.js:74` that still holds a pool connection) plus
a *conditional* Expo HTTPS round-trip.

**Two traps.**
- Changing `PROCESSORS` values from bare functions to `{ run, critical }` **breaks
  production**: `worker.js:28-34` indexes the registry directly and invokes the value,
  so every queued job becomes a `TypeError`. No test covers `worker.js`, so CI stays
  green. Use a sibling `JOB_CRITICALITY` map instead.
- `jobQueue.test.js:21` mocks `ENV` as exactly `{ QUEUE_ENABLED, QUEUE_CONCURRENCY }`,
  so a new `ENV.QUEUE_INLINE_MAX_CONCURRENCY` read resolves `undefined`.

The sent/failed count is **persisted** (`BroadcastLog`) and audited, so changing it is
a contract change, not bookkeeping. Chunking the fan-out *serializes* it and makes the
30 s socket death at `broadcast.routes.js:117` more likely, not less.

---

## PERF-009 — FastAPI-owned tables are invisible to DPDP erasure

**P0 · TODO · Compliance, not performance**

`ai_scan_diagnoses` and `ai_scan_feedback` are created by FastAPI's `_ensure_schema()`
via asyncpg and absent from `schema.prisma`, so neither the retention sweep nor
`erasure.service.js` can see them.

**Narrowed by verification.** The severity is lower than the audit claimed:
- `ai_scan_feedback` has **no live writer** — its FastAPI route is behind
  `verify_signed_request` and no Express code calls it. Express writes Prisma's
  `disease_feedback` instead, which *is* erased. Future-facing schema gap, not present
  data exposure.
- The farmer-facing scan record is `CropDiseaseReport`, which **is** hard-deleted.
  What survives is one orphaned FastAPI audit row per scan — a genuine DPDP §8 miss,
  but not "the user's scan history".
- Every pre-`dca4d0b` row was written with `user_id` **NULL**, so any erasure keyed on
  `user_id` structurally cannot reach the backlog. That needs its own decision.

---

## PERF-010 — Queue depth, Celery heartbeat and breaker state are not exposed

**P0 · COMPLETE — see COMPLETED.md**

FastAPI reports healthy while zero Celery workers are deployed and every crop scan
queues forever. There is no worker liveness signal anywhere. Circuit-breaker state
(`resilience/breakers.js`) is not surfaced in any health endpoint or metric.

`claude.md` §35 calls this critical for crop scans; §56 requires breaker state to be
observable. This is what makes everything below it measurable.

---

## PERF-011 — 12 cron schedules run on every web replica

**P1 · TODO · Component:** `backend/src/server.js:223-437`

12 `cron.schedule` calls; **9 leader-locked, 3 not** (`:223`, `:312`, `:375`). None
declares a timezone, so all fire at container-local time. There is no `CRON_ENABLED`
flag, so cron cannot be moved off the latency-serving tier.

**Two traps.** `const AI_BASE` (`:229`) and `triggerMandiSync` (`:232-239`) are called
by the cron at `:280-297`; gating them in two separate blocks throws
`ReferenceError` on the 00:30 tick. And `setSerializableConflictObserver` (`:353`) is
**not** a cron — gating it silently stops `INVENTORY_CONFLICT` recording.

**A cost the audit missed:** on L1-cache-hit ticks the unlocked warm cron still fires
`recordCacheHit('market')` 12× per replica per tick, inflating the very windowed hit
rate that the `:312` alert job evaluates. The cron biases its own alerting signal.

---

## PERF-012 — The auth hot path reads the user on every request

**P1 · TODO** *(downgraded from the audit's P0)*

`auth.js:59-62` runs an unconditional `prisma.user.findUnique({ select: { tokenVersion,
isActive } })` after the denylist GET. Per request: 1 Redis GET + 1 Prisma query.

**Why P1, not P0.** At the stated scale this is ~240 qps of a primary-key probe —
under 2% pool occupancy. What it actually costs is 1–2.5 ms of serial latency on 100%
of traffic and a hard availability dependency of auth on Postgres. PERF-006 is
unbounded in table size; this one is not. Fix that first.

**Two corrections to the obvious fix.** Applying the cache verbatim makes
`authTransportFailure.test.js` **fail** (proven empirically). And `eraseUserAccount`
has **two** callers — `user.routes.js:706` and `admin/compliance.routes.js:77` — the
second is easy to miss when enumerating invalidation sites.

---

## PERF-013 — Blocking Redis calls inside FastAPI `async def`

**P1 · TODO**

All six FastAPI Redis clients are the **synchronous** `redis` library
(`weather_service.py:32`, `security/auth.py:75`, `security/spend.py:63`,
`agents/treatment_agent.py:58`, `jobs/queue.py:102`, `services/idempotency.py:65`).

Measured: the scan poll is **5** blocking round-trips per poll, not 4 —
`SlowAPIMiddleware` runs its own check because `_should_exempt` only exempts routes
registered on *that* limiter instance, and `ai_scan_status` uses a separate one. And
`task_track_started` is absent from `queue.py:57-69`, so state stays `PENDING` for the
whole run and `job_was_enqueued` fires on **every** poll. `POST /ai/scan` is ~14
blocking round-trips.

Separately: **`weather_service.py:32` hardcodes `host="localhost"`**, so it cannot
reach Railway's Redis at all.

---

## PERF-014 — 403-vs-404 disagreement between farm and cycle routes

**P2 · NEEDS A DECISION — not an engineering call**

`requireCycleOwner` (`farmCropCycle.routes.js`) answers **403** for another farmer's
cycle and 404 for an absent one — an explicit acceptance criterion pinned by
`tests/backend/security/cycleOwnership.test.js`. The sibling farm routes answer
**404** for anything the caller does not own and never call `sendForbidden`.

Both are defensible. 404 for both avoids an existence oracle; 403 distinguishes the
cases for a legitimate client. Practically the difference is near-nil because ids are
UUIDv4 and no client branches on it. It was left as-is during PERF-001 rather than
flipped as a side effect of a test cleanup. **Pick one and apply it everywhere.**

---

## PERF-015 — Missing composite indexes

**P2 · TODO** — each confirmed by `EXPLAIN` against a live Postgres.

| Table | Query shape | Action |
|---|---|---|
| `chats` | `WHERE buyerId=$1 OR sellerId=$1 ORDER BY updatedAt DESC` | ADD `[buyerId, updatedAt DESC]` + `[sellerId, updatedAt DESC]` |
| `comments` | `WHERE parentId IN (…) ORDER BY createdAt ASC` | ADD `[parentId, createdAt]` |
| `posts` | `WHERE deletedAt IS NULL ORDER BY isPinned DESC, createdAt DESC` | ADD partial index |
| `chat_messages` | unread count per listed chat | ADD partial `(chatId, senderId) WHERE readAt IS NULL` — see PERF-006 |
| `order_items` | `WHERE sellerId=$1 ORDER BY orders.createdAt DESC` | FIX the query; no index can sort on a joined table's column |
| `products` | `ORDER BY viewCount DESC` | DROP the sort — nothing increments `viewCount` |

Two audit rows were **corrected**: `products` has zero `@@unique` and zero field-level
`@unique`, so its redundancy is prefix-subsumption, not duplication; and the
`/agristore/filters` route that supposedly advertises the dead `viewCount` sort **does
not exist**.

Adding composites to `chats` costs write amplification on a column bumped by every
message. No index is dropped without `pg_stat_user_indexes` from production.

---

## PERF-016 — Mobile: duplicate fetches and the whole i18n corpus at boot

**P2 · TODO**

- Both AI history screens fetch on **mount and on focus**. Note `useFocusRefresh`
  defaults `runOnFirstFocus = true` (`useFocusRefresh.js:63`) — following its docs
  verbatim re-creates the duplicate.
- All **10** language dictionaries are built at cold start. Measured 58–68 ms and
  5.44 MB retained; achievable saving ~59%. (The audit's 197 ms / ~80% were ~3×
  overstated.) `accountI18n.test.js:19` imports `translations` directly and passes
  today, so a lazy accessor must keep that export working.
- `geoPageIds` has **four** callers, not three, and `animaltrade.routes.js:607` pays
  for a `COUNT` it discards — a `withTotal: false` option is a smaller, safer win than
  rewriting the window count.

---

## PERF-018 — `_init_lock` in diagnosis_repo can bind to a dead loop

**P3 · TODO · Component:** `fastapi/persistence/diagnosis_repo.py:100`

`_init_lock = asyncio.Lock()` is module-level. Python 3.10+ binds a lock to a
loop lazily, on first await, and raises *"is bound to a different event loop"* if
later awaited from another. `_ensure_schema` short-circuits on `_initialised`, so
this can only bite when the FIRST schema init fails and a later call retries on a
different loop — and `record_diagnosis` would swallow the raise, exactly as it
swallowed PERF-007.

Much less likely now that the Celery worker keeps one loop (PERF-007), and not
reproduced. Recorded rather than fixed, to keep that change focused.

---

## PERF-017 — Comments still claim the validator returns 422

**P3 · TODO**

`rateLimit.js:165` ("the proper 422") and `auth.routes.js:69` ("the validator below
(422)") contradict the shipped 400 contract settled in PERF-001 —
`auth.routes.js:72` then contradicts itself with "the validator's 400". Prose only.

---

## PERF-019 — Offset pagination: audited, deliberately not converted

**P2 · CLOSED — see TABLES.md §21**

25 `skip:` sites remain and none was converted. Keyset is already applied where
lists are genuinely deep (20 admin routers + AgriStore). The rest are per-user
lists bounded by one person's activity, plus one platform-wide feed that now
costs 0.013 ms at page 1 thanks to PERF-015's index.

A naive keyset on that feed measured **worse than OFFSET** — 16.16 ms against
8.97 ms — because it sorts `isPinned DESC, createdAt DESC` and a row-value
comparison cannot seek a mixed-direction multi-column index. Revisit only if a
Community screen ships in the farmer app.

---

## PERF-020 — The i18n backfill is still eager

**P2 · TODO**

`shared/i18n/lang/_backfill.js` is 676 KB — larger than all seven regional
bundles combined — and is still evaluated at every cold start, because it is one
generated module keyed by language and `en` needs its share of it. Splitting it
per language means changing the generator, not the consumer.

---

## PERF-021 — The §71 feature-by-feature sweep

Twelve product areas audited, each finding put through an adversarial pass. What
follows is the surviving backlog. **Fixed** items have their evidence in the
commit that closed them; everything else is open and ordered by severity.

### Fixed in this pass

| Area | Defect | Proof |
|---|---|---|
| MyFarm | `listCropCycles` scoped only by `farmId` — any farmer could read another's cropping history | scoped to `farmerId` |
| MyFarm | `updateCropCycle` passed the raw body to `prisma.update` — a farmer could re-parent their cycle onto another farm, or forge the derived financials | field allowlist |
| MyFarm | Four of eight field logs appended read-modify-write | **10 concurrent entries stored 5**; now 10 |
| Community | Admin "delete comment" always 500'd **and** decremented `commentCount` anyway | reproduced 3 → 2 with the comment still present |
| AgriStore | Checkout's post-split branch never checked the catalog row, so a **deactivated (recalled) product stayed purchasable** | parent-product check added |
| AI credits | Monthly refill was read-then-write | **10 concurrent requests granted 1000 credits**; now 100 |
| Seller app | `&status=` chip filter ignored by the backend — every chip returned the same list | verified 5 → 2/1/1/1 |
| Groups | `join` never checked `isPublic` | blocked (no caller today — P3, fixed because it is three lines) |

### Open, highest first

**P1 — AI history aggregates the whole message table.** The `_count` include on
the conversation list compiles to an uncorrelated aggregate over every message
on the platform, and `messages: { none: … }` becomes an uncorrelated `NOT IN`.
Same family as the chat-inbox defect fixed in PERF-006, same fix shape.

**P1 — `/mandi/prices/:commodity/trend` has no `LIMIT`** and serialises the whole
result set.

**P1 — a 100 MB video is buffered whole in process memory** with no cap on how
many can be in flight.

**P1 — seller "My Products" silently stops at 20** — a cursor client against an
offset-only endpoint.

**P1 — the hourly seller-metrics refresh reads every order item of the last 180
days into Node.**

**P2 — the cart summary freezes** after a quantity change or removal: the totals
are derived from a quote that is only refetched by `fetchCart`. Display-only —
checkout re-quotes twice before charging — but it is the one screen whose whole
job is a number a farmer can believe.

**P2 — orphaned PAID payment intents never reach a terminal state**, so the
reconciler re-processes them and re-fires its money alert every ten minutes with
a count that never falls.

**P2 — a seller cancelling a PAID order** restocks and closes it with no record
that a refund is owed, and no notification to the farmer.

**P2 — `GET /posts/:id/comments` returns the entire thread with no limit**;
`GET /groups` counts every membership on the platform per page.

**P2 — several list payloads ship far more than the screen renders**: 10 full
reviews joined to users on every product open, full-resolution images into
56×56 and 120px thumbnails, `GET /farms/:farmId` shipping every log array of
every active cycle.

**P3 — assorted**: `sort=popularity` orders by a `viewCount` nothing increments;
`inStock=true` is filtered in JS *after* `take` and `count`, so it truncates the
page and lies in the meta; socket `group_message` skips the sanitisation the
HTTP route enforces; `scope=city` without a district silently shows every
district.

---

## Refuted

Work not worth doing, and why.

**`GET /users/me` is 3 SQL statements, not 11–12.** Prisma 5.22 folds all 8 relation
`_count`s into the parent statement as grouped LEFT JOINs, and because the outer
predicate is `users.id = $const` Postgres pushes the constant into every subquery.
Measured: `Index Only Scan`, `Heap Fetches: 0`, **5 buffers total**. Do not optimise it.

**RT-04 — the chat poll is fixed.** `1c66a90` replaced the unconditional
`setInterval` with a socket-health-gated `setTimeout` with backoff and jitter:
6 req/min → **0** on a healthy socket.

**`randomPhone` was not the audit's described implementation.** It was already
counter-based at the audit's HEAD; the `Date.now()` version is documented in the past
tense. (It was still colliding for a different reason — see PERF-001.)

**Cache-warm cost was ~2× overstated.** The L1 TTL is 30 min ±10% jitter against a
25-min tick, and `getMarketPrices` returns on the L1 hit before any Redis call. Steady
state is far cheaper than claimed — though see the alerting-bias cost in PERF-011.

**`run_in_threadpool` positional-only risk.** False — starlette 1.0.0 uses
`functools.partial(func, *args, **kwargs)` and accepts kwargs.

**`GET /users/me` is 3 statements, not 11–12** (re-confirmed while building
TABLES.md). Prisma folds all 8 relation `_count`s into the parent statement;
measured at 5 buffers with `Heap Fetches: 0`.

**Mobile image uploads are already correct (§43).** Both apps upload
sequentially in a `for … await` loop, with a URI-keyed retry cache in the seller
app — exactly what §43 prescribes. No `Promise.all` over uploads exists.

**The `chats` composites are not worth their write cost.** `updatedAt` is bumped
on every message, so two composites on it would be rewritten on the hottest
write in the chat system, to speed up sorting one user's few dozen chats.
