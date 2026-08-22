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

**P1 · COMPLETE · Component:** `backend/src/server.js:223-437`

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

**P1 · COMPLETE** *(downgraded from the audit's P0)*

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

**P2 · COMPLETE** — each confirmed by `EXPLAIN` against a live Postgres.

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

**P2 · COMPLETE** *(the backfill half closed by PERF-036)*

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


---

## PERF-022 — The two scan tables Prisma cannot see had no retention

**P1 · COMPLETE**

Component: `backend/src/services/retention.service.js`, `constants/retention.js`

`ai_scan_diagnoses` and `ai_scan_feedback` were the only tables in the §26 growth
list with no retention at all. Structural, not an oversight: the sweep is a loop
over `prisma[p.model].deleteMany()`, and both tables are created by the FastAPI
service through asyncpg and are absent from `schema.prisma`, so there is no
delegate to name. The policy file said as much and left them "tracked
separately", which meant not tracked. They are also the wrong tables to leave
unbounded — one row per crop scan, each carrying a full diagnosis payload.

Fixed with raw SQL beside the loop rather than inside it, so the data-driven
table stays data-driven. Existence probe runs BEFORE any statement, the same
shape `erasure.service.js` needed: Postgres aborts a whole transaction on a
missing relation (25P02), so a deployment where the AI service has never booted
must not lose the other eleven categories to these two.

Window is 365 days, deliberately longer than the log-shaped categories: these
rows are the only record of what the pipeline decided (model, prompt hash,
confidence, safety blockers), which is what a disputed diagnosis is investigated
from and what a prompt change is evaluated against.

Verified against a live database: absent tables skip and the other eleven
categories still complete; present tables delete exactly the rows past the line
(364 days survives, 366 does not); a second run deletes nothing.

---

## PERF-023 — §27: the payload split, answered with arithmetic

**P3 · CLOSED — do not split**

`diagnosis_repo.py` carried a comment claiming it stripped `_safety` from the
payload "so the JSONB isn't bloated". It stripped nothing, and the strip would
have been a no-op: the report's `treatment` section is built from an explicit key
allowlist in `report_generator_agent`, and `_safety` is not on it.

Measured a real report — three chemicals, two blockers, two warnings, four
differentials — by building it offline (the generator is template-based, no LLM):

| section | KB | % |
|---|---:|---:|
| annex_page | 3.4 | 21.5% |
| treatment | 3.0 | 18.6% |
| detailed_guidance_page | 2.5 | 15.4% |
| dispensing_sheet_page | 1.7 | 10.5% |
| meta | 1.5 | 9.1% |
| farmer_summary_page | 1.3 | 7.9% |
| weather_outlook | 1.1 | 6.8% |
| **total** | **15.9** | |

At 100,000 scans/year that is **1.5 GB/year** before TOAST compression, and with
PERF-022 it is a ceiling rather than a slope. The object-storage split §27 asks
about would buy about a gigabyte and cost every debugging session a round trip to
a bucket. **Rejected.**

The one genuine duplication (blocker/warning lists under both `meta.safety` for
the mobile badge and `annex_page` for the PDF) is 0.41 KB — 2.6% — and reshaping
a document two clients parse is not worth that.

If it ever does bite: `annex_page` + `weather_outlook.raw_forecast` are 28% of
the payload and nothing queries them. That is the first cut, not the column.

---

## PERF-024 — The offline write queue minted a new Idempotency-Key per retry

**P1 · COMPLETE**

Component: `frontend/src/services/writeQueue.js`, `farmApi.js`, `shared/services/api.js`

`writeQueue.js` promised that "api.js attaches an Idempotency-Key that survives
retries, so a retry never double-applies". It did not. api.js mints the key in a
request interceptor guarded by `!config.headers['Idempotency-Key']` — which makes
the key survive a retransmission of the SAME config object, i.e. the 401-refresh
replay, and nothing else. A `withWrite` retry calls `fn()` again and builds a
request from scratch: no header, fresh key.

So the retry produced exactly the failure the comment ruled out. Farmer on a
village connection saves a farm; the POST commits; the response is lost; axios
times out; the retry lands under an unrelated key; they have two farms. Same for
update and delete.

The key belongs to the logical write, so `withWrite` mints one up front and hands
it to every attempt as an axios config. A callback that ignores that argument
gets a dev-time warning. Backoff also gained jitter (§46) — a tower coming back
after an outage releases every phone under it at once, and a fixed 400/800/1600
grid turns that into a synchronised wave.

Six tests. Verified: restoring per-attempt keys fails the first and passes five.

---

## PERF-025 — Uploads were cut off while Cloudinary was still receiving them

**P1 · COMPLETE**

Component: `backend/src/app.js`, `config/env.js`

Both rental screens raise their own axios timeout to 120 s to post a video. The
server still tore the socket down at 30 s. That 30 s is an INACTIVITY timeout, so
it survives the upload itself — bytes keep arriving — and fires during the one
window where the client socket is legitimately idle: after multer has buffered
the file and while Express streams it to Cloudinary.

A large video would upload completely, start landing in Cloudinary, and have the
connection destroyed underneath it. The farmer sees a network error at ~30 s,
well inside their app's budget, retries, and sends the whole file again — while
the first copy carries on and lands as an orphan nothing references. Double
bandwidth on a metered connection, double storage.

Same asymmetry `/ai/*` already had fixed. Raised per-prefix so the Slowloris
default stays on every other route, and sized just above the client's 120 s so
the client always gives up first and owns the retry.

Test patches `IncomingMessage.setTimeout` to record what each path actually gets,
which asserts the middleware RAN rather than reading router internals — a
mount-order change is exactly how this regresses.

---

## PERF-026 — Native voice upload could not recover from an expired token

**P1 · COMPLETE**

Component: `frontend/src/services/aiApi.js`

Android's New Architecture drops `file://` URIs from FormData, so both native
voice paths use `FileSystem.uploadAsync` instead of axios. Leaving the axios
pipeline also left behind its response interceptor — the thing that refreshes an
expired access token and replays the request.

Access tokens live fifteen minutes. A farmer who opened the app, talked for
thirty seconds and hit an expired token got a bare 401: the recording was
discarded and they had to say the whole thing again, while every other screen
refreshed silently. On a voice-first product built for people who may not read,
that is the worst request in the app to make someone repeat.

Both call sites were the same forty lines with different parameters; they are one
helper now that does the refresh-and-replay by hand. Once only. Non-401s are not
retried — "out of AI credits" is a real answer. The replay reuses the SAME key,
so a turn that already charged a credit does not charge a second.

Seven tests. Verified: removing the refresh block fails five, passes two.

---

## PERF-027 — `npm test` did not mean what CI meant

**P0 · COMPLETE**

Component: `backend/package.json`, `.github/workflows/ci.yml`

`npm test` produced **143 failures**; the same suites with `--runInBand` produced
zero. The code was never the difference.

Every DB-backed suite truncates all tables in `afterAll` against ONE shared
database. At jest's default worker count, seven do that concurrently: workers
delete each other's fixtures mid-test and deadlock in the cleanup transaction
(40P01). `tests/fixtures/setup.js` already assumed "the single --runInBand
process" in its own comment; nothing enforced it.

The CI workflow passed the flag, so CI was right and the local command was wrong
— the worst arrangement, because the failures are stable (the same 143 twice) and
read as a real regression worth hunting through the diff for.

Moved the guarantee into the jest config as `maxWorkers: 1`, where it also covers
`npx jest <file>` — the way a single suite gets run while debugging, and the
invocation that would still have been wrong.

This also explains the "three suites failed once each, never reproduced" note
that closed the previous PROGRESS.md. Same family, and now enforced rather than
hoped for.

---

## PERF-028 — `reviews.@@index([userId])` is prefix-subsumed

**P3 · DROP-CANDIDATE, not dropped**

Its justification cited a `[userId, productId]` unique that does not exist; the
real one is `[userId, orderItemId]`, whose leading column already serves
`WHERE userId = ?`.

Measured on a 200k-row replica, 5,000 users, for the query that runs
(`admin/activity.routes.js:258`):

| | plan | time |
|---|---|---|
| with the index | Bitmap Index Scan on `reviews_userId_idx` | 0.071 ms |
| without it | Bitmap Index Scan on the composite | 0.069 ms |

Same plan shape, one extra buffer. **Not dropped**: §18 says not to drop a
production index on a structural argument alone, and `reviews` is written once
per order item, so this is not the write amplification §18 is aimed at. The
evidence now lives in the schema comment so the call is made on production
statistics rather than on a claim that was wrong about its own schema.

This is the first of the ~40 suspected redundant indexes to be *proven* rather
than suspected. The rest remain blocked on `pg_stat_user_indexes`.


---

## PERF-029 — Decimal `+` concatenates: two live wrong-number bugs

**P0 · COMPLETE**

Component: `backend/src/routes/mandi.routes.js`, `services/mandiPrice.service.js`,
`services/farm.service.js`

`Decimal.prototype.valueOf()` returns a **string**, so `a + b` on two Prisma
Decimals is string concatenation. It never throws and never produces NaN — it
produces a plausible-looking integer, which is why both instances shipped.

| Site | Input | Reported | Should be |
|---|---|---|---|
| `/mandi/prices/:c/trend` `stats.avg30` | 1200, 1300, 1400 | **40,004,333,800** | 1,300 |
| ↳ `stats.priceVsAvgPercent` | as above | **−100%** | +8% |
| farm financial summary `byCycle[].totalCostInr` | 12000+8000+5000+2000 | **12,000,800,050,002,000** | 27,000 |

The farm one is the sharper case: the `totals` block in the *same response* uses
`D().plus()` and is correct, so the summary showed a total that could not add up
from its own rows. On the existing fixture (2300 recorded, three costs null) the
shipped figure was 2,300,000 against a stated total of 2,300 — and the test
asserted `totals` while never looking at `byCycle`.

**Swept the whole backend.** `-`, `*` and `/` are safe: they force numeric
coercion. Only `+` prefers `valueOf`'s string. `Math.abs(decimal)` also coerces
correctly. Every other Decimal sum already used `.plus()` or `Number()`.

**What catches it:** not a type assertion — the value is a finite number. The
invariants that work are *a mean cannot fall outside the range it averaged* and
*a breakdown must sum to its total*. Both are now asserted.

---

## PERF-030 — `/mandi/prices/:commodity/trend` was unbounded

**P1 · COMPLETE**

`getPriceTrend` had no `take`, and `market` is a `contains` match rather than the
single market the endpoint's contract implies — `?market=a` matches nearly every
market name in India.

Measured on an Agmarknet-shaped dataset (400 markets reporting one commodity
daily for a year): **146,000 rows, 15.2 MB**, then 146,000 Decimals summed on the
event loop.

Capped at `min(days × 4, 1000)`. The scan is now **descending with a reverse
afterwards**, which is the part that matters: capping an ascending scan would
drop the NEWEST rows — the ones `currentPrice` and `avg7` are computed from — so
a truncated window would quietly report last year's price as today's. A
`truncated` flag reports when the cap bit, rather than serving a shortened window
as a whole one.


---

## PERF-031 — Keyset pagination was correct only because production runs in UTC

**P0 · COMPLETE**

Component: `backend/src/utils/keyset.js`

Prisma maps a bare `DateTime` to `timestamp(3) WITHOUT time zone` — every
`createdAt` in this schema is that type — but binds a JS Date through
`$queryRawUnsafe` as `timestamptz`. Comparing the two makes Postgres convert the
naive column using the **session** TimeZone. The stored value is a UTC wall
clock, so under a non-UTC session it reads as a local time and shifts.

Walking a 50-row probe to exhaustion:

| session TimeZone | result |
|---|---|
| UTC | 3 pages, 50/50 rows — correct |
| Asia/Kolkata | cursor stuck on page 2, **20/50 reachable** |
| America/New_York | cursor stuck on page 2, **20/50 reachable** |

At Asia/Kolkata every row looks 5h30m earlier than it is, so
`("createdAt","id") < cursor` matches the whole table and the seek returns page
one forever.

Fixed by passing the UTC wall clock as text and casting to `::timestamp` — with
no zone on either side there is nothing to convert.

**Scope is 3 routes, not 39.** `adminList.js`'s `keysetList` (36 admin call
sites) expresses the same seek through Prisma's `where` builder, which knows the
column type from the schema and binds correctly. Walked under all three
timezones: 50/50 every time. It needs no change, and the comment now says so —
"make them consistent" is the obvious wrong move.

The test SETs TimeZone explicitly. UTC is included as a control and **passes with
the bug restored**, which is the argument for pinning the timezone rather than
testing in the ambient one: CI would have stayed green and kept lying.

---

## PERF-032 — Sellers could not see past their newest 20 products

**P1 · COMPLETE**

Component: `seller-app/src/screens/MyProductsScreen.js`, `backend/src/routes/agristore.routes.js`

The screen asked for CURSOR pagination (`?paginate=cursor`, then `?cursor=…`)
against a route that has only ever implemented OFFSET pagination. The shim
returns `{page, limit, total, totalPages}` and no `nextCursor`, so the hook's
cursor branch read undefined, set `hasMore=false`, and `loadMore()` returned
early forever.

Not a missing button — a lie. `onEndReached` did nothing, pull-to-refresh
re-fetched page 1, and the footer rendered "That's everything" under row 20. The
rest could not be edited, re-priced, hidden or deleted from the app. On the local
database one seller has 47 listings, **27 unreachable**.

Neither half was wrong alone, which is why it survived review: the sibling
`/agristore/listings` really does speak cursor. The mismatch lived only in the
pairing and no test crossed that boundary.

Fixed on the client (offset is right for a list bounded by one seller's own
inventory; `OrdersScreen` already uses this exact shape). Two companions:
`keyOf: listingId ?? id` — the shim flattens a LISTING into the product shape, so
two pack sizes share an `id` and the hook's dedupe would swallow one — and an
`id` tiebreak on the server's `orderBy`, since offset paging is only stable when
the sort is total.

---

## PERF-033 — Seller enumeration read every order item in the window

**P1 · COMPLETE**

Prisma does not push `distinct` into SQL. Captured statement:

    SELECT "id", "sellerId" FROM order_items
    WHERE ("sellerId" IS NOT NULL AND "createdAt" >= $1) OFFSET $2

No DISTINCT, no LIMIT, and it drags `id` along. Every order item in the 180-day
window crossed the DB→process boundary so the query engine could dedupe in memory.

| | rows moved | time | RSS |
|---|---:|---:|---:|
| `findMany` + `distinct` | 540,036 | 594 ms | +127.8 MB |
| `groupBy` | 5,000 | 89 ms | +0.1 MB |

The RSS did not come back across three consecutive runs. Hourly cron, on the
leader web replica, in the process serving HTTP.

**The 180-day window is NOT the defect** and is unchanged — it is
admin-configurable with a sound rationale (a low-volume Krushi Seva Kendra needs
~six months of terminal orders before a cancellation rate has a denominator worth
ranking on). Nor is the per-seller loop, measured at 1.3 ms/seller and already
index-served and batched. One line of query shape was the whole thing.

---

## PERF-034 — AI history counted every message on the platform

**P1 · COMPLETE**

Prisma compiles `_count: { select: { messages: true } }` into a LEFT JOIN over
`(SELECT "conversationId", COUNT(*) … WHERE 1=1 GROUP BY …)` — literally
`WHERE 1=1`. Uncorrelated to the page, so it groups every message on the platform
and the join discards other people's. Cost is a function of total platform
messages, not of the requesting user.

Measured on a 20k-conversation / 400k-message probe: `GET /ai/conversations`
134 ms and **29,369 shared buffers to return 4 rows**; `/ai/scan/sessions`
74.7 ms where the same page without `_count` is 0.059 ms.

Three sites scoped with a `groupBy`, same shape as animaltrade's unread counts.
Wire shape `_count: { messages: n }` preserved — the shipped apps read
`item._count?.messages`. `?? 0` is load-bearing: groupBy returns no row for a
zero-message conversation where Prisma emitted `COALESCE(…, 0)`.

`/ai/conversations/:id` deliberately NOT converted: it emits the same SQL but is
fast because a single-PK outer row lets the planner push the qualifier down
(0.176 ms, 7 buffers). That is a property of the **plan**, not the query, and the
comment says to look here first if it ever shows up slow.

The counts were always CORRECT — a pure cost defect. Demonstrated: restoring
`_count` leaves all four behavioural tests GREEN and fails only the two
query-shape ones.

---

## PERF-035 — One process would buffer unbounded 100 MB videos

**P1 · COMPLETE**

multer uses `memoryStorage`, so each in-flight video upload holds the whole file
resident. Five concurrent 99 MB uploads: 85 MB → 1,073 MB RSS. Ten: 1,202 MB.
Three *rejected* 120 MB uploads still peaked at 618 MB, because multer only
errors after reading past the limit. The hourly rate limiter is a per-user
counter, not a concurrency gate.

Being accurate about the size: "one account's hourly allowance in parallel is
2 GB" treats a quota as a concurrency budget. Memory accrues only as bytes
arrive and the socket timeout is 130 s, so the real bound is
`attacker_uplink × 130 s` — still ~1 GB from any cloud host. These are Buffers,
so they live outside the V8 old space and `--max-old-space-size` never sees it;
the failure is the container OOM-killing the replica.

Bounded at 4 in flight, **shedding** rather than queueing (a queued request keeps
its socket, converting a memory problem into a connection problem). Per-process
on purpose.

Latent, not live — zero rows carry a video today. The five image uploaders share
the same `memoryStorage` at 15 MB and are deliberately left alone, with a note.

Tested against the guard directly rather than by racing HTTP, because the risk is
counter DRIFT. Catches three distinct regressions: no ceiling (3 fail),
`res.on('finish')` which misses client aborts (all 6 fail), `on` instead of
`once` (2 fail).

---

## PERF-036 — The i18n backfill built ten languages to display one

**P2 · COMPLETE** — closes the second half of PERF-020

`lang/_backfill.js` was one 690 KB module of ten dictionaries, 861 keys each,
imported at module scope and constructed at every cold start.

Split into `lang/backfill/<code>.js` behind a shim at the original path, so no
consumer changed. Measured on node v24, importing then touching `en`:

| | eval | heapUsed |
|---|---:|---:|
| before | 7.18 ms | 5,136 KB |
| after | 4.27 ms | 3,939 KB |

177,188 bytes eager, 501,998 deferred — 73%. The ~1.2 MB of heap is the point,
not the milliseconds. Hermes behaves differently and is **not measured**.

**The trap worth remembering:** babel compiles an object literal that mixes a
SPREAD with getter definitions through `_objectSpread`, which READS every
property while assembling the result — invoking the getters and flattening them
to values. The first attempt still worked, every content test passed, and all ten
languages loaded at import anyway. Only the "evaluates none at import" assertion
caught it.

Verified equivalent, not assumed: all ten languages, 861 keys, same order and
values, and `checkCoverage.js` (through `loadBundles.js`, the strictest resolver
here) reports byte-identical output. The file's "AUTO-GENERATED — 612 keys"
banner was wrong twice: no generator exists, and there are 861.

---

## PERF-037 — Expo receipt polling: investigated, deliberately NOT built

**P3 · CLOSED — the blocker is the client half, not this one**

`push.service.js` discards `ticket.id` (the receipt id) and nothing ever calls
`getPushNotificationReceiptsAsync`. All of that is true. It is also, today,
irrelevant.

**Nothing ever writes a row to `push_tokens`.** The only writer is
`POST /users/me/push-token`, and no client calls it: neither app depends on
`expo-notifications`, and `getExpoPushTokenAsync` appears nowhere. So
`deliverUserNotification` hits `if (!messages.length) return;` on every call —
Expo is never contacted, no ticket is ever minted, and there is no receipt to
poll. The table has 0 rows.

The stated harm (dead tokens accumulating forever, wasted Expo sends, multiplied
by broadcasts) therefore cannot be occurring. Building a table, a manual SQL
migration, a leader-locked cron and a five-case suite for a path that will
process zero rows on every tick until client registration ships is exactly the
speculative work §7 and §73 forbid.

**If §45 is the goal, the work is in the app**: add `expo-notifications`, call
`getExpoPushTokenAsync`, and POST to the endpoint that already exists. Receipt
polling becomes worth building the moment that lands — not before.


---

## PERF-038 — The AI daily spend cap was only ever measuring scans

**P0 · COMPLETE** — §36

`/ai/chat` and `/ai/alerts` read `token_info["total_cost_usd"]`. That key exists
only on the orchestrator's rolled-up `pipeline_token_usage`; a per-call
`token_info` — from `llm_utils._make_token_info`, `empty_token_info` and
`chat_service._new_usage` alike — carries **`cost_usd`**. So `cost` was always
0.0, the `if cost > 0` guard never opened, and `record_spend` never ran. The
docstring at those call sites describes fixing exactly this defect.

Two further paths had no meter at all: `/ai/chat/stream` (the VOICE path, the one
farmers who cannot read use most) and `/ai/soil-card-ocr` (a vision call over a
full-page photograph).

Nothing threw, which is why it survived: a missing key reads as 0.0 and the guard
quietly closes.

One `cost_of()` helper now reads either shape. The stream is metered on its
`final` frame, so a client that disconnects mid-stream still pays for what it
consumed. **User-visible billing was never affected** — the Express credit ledger
reads `cost_usd` correctly; this was the FastAPI-side provider cost cap.

The atomic-reservation half of §36 was and is correct — only the meters feeding
it were wrong.

---

## PERF-039 — Two unbounded fallback maps

**P1 · COMPLETE** — §10

`velocity.service.js` pruned timestamps INSIDE each key, so it read as bounded —
but the KEY SET grew once per distinct userId, device fingerprint and IP the
process ever saw. `otpLockout.service.js` was worse: `memEntry()` creates an
entry on every CHECK, not only on a failure, and only deletes on a successful
verification, so an OTP flood against enumerated numbers grew it one entry per
number tried.

Both now use `BoundedMap` at 50,000, no TTL, matching `rateLimit.js`.

**The question a cap raises here, answered:** LRU evicts the COLDEST keys, and an
identity under active attack is by definition the hottest — so it is the last
thing evicted, not the first. Both test files assert that, not merely the size
bound; a cap that discarded the attacker's own counter would be worse than none.

Checked the rest rather than assuming: `proofOfWork`'s maps are already
FIFO-capped, and `shopMetrics` is keyed by code-defined labels rather than
anything a caller controls.

---

## PERF-040 — The last credit path that charged without gating

**P1 · COMPLETE** — §53

`/agripredict/predict` called `deductCredits(...).catch(() => {})`
fire-and-forget with **no gate at all** — worse than the read-then-write race
§53 warns about. A farmer with zero credits still got the prediction, a failed
deduction was swallowed, and there was no hold to release when the 120-second
upstream timed out, so a farmer whose prediction failed had simply paid.

Now reserve → settle / release. `proxyPost` writes its own response and never
throws, so the outcome is read off the status code.

**Price deliberately unchanged.** The old `ai_chat_claude` key names a dead
provider but costs 2, and the route was already charging it; the new
`ai_predict` is also 2. §72 puts repricing among the things to raise as a product
decision rather than fold into a correctness fix. A separate unmocked test pins
that equality, and also checks every key any route gates on is defined —
`reserveCredits` falls back to a 1-credit minimum for an unknown key, which
under-gates a 3-credit feature and only warns.

---

## PERF-041 — The three overturned DONEs

**P1/P2 · COMPLETE** — §15, §24, §49

All three were marked DONE by an auditor and overturned by its challenger.

**§15 — the DM inbox.** `GET /messages/conversations` ran `user.findUnique` +
`findFirst` + `count` inside a map over every partner, with no `take` anywhere:
40 partners cost 2 + 120 queries. Both seed queries also used Prisma `distinct`,
which is not pushed into SQL, so they streamed every DM the user had ever sent or
received just to learn who they had talked to. Now three queries for the whole
inbox — batched users, one LATERAL seek, one scoped groupBy.

*Why the audit missed it:* its scan matched only `for`/`while` headers followed by
`await prisma`, so it structurally could not see `map(async … await prisma …)`
inside `Promise.all` — the dominant N+1 idiom in this codebase.

**§24 — `GET /agristore/listings`.** Deduplicating by variantId helped but did
not change the shape: `rankOffersForVariant` is a wrapper over the batch method,
so each distinct variant still cost its own `findMany`. Page size up to 50 made
this the LARGER of the two §24 sites, with no Redis cache in front of it.

*Worth remembering:* settings reads are NOT the discriminator. `weights()` is six
`getSetting` calls per pass, but `getSetting` is TTL-cached, so they collapse
either way — that assertion passed against the broken code before I replaced it
with total query count.

**§49 — `GET /crop-reports/sellers/nearby`.** Took 1000 candidates with **no
`orderBy`**, so once verified Kendras exceed the cap the nearest one can be
excluded before its distance is ever computed, and the result reshuffled between
identical requests. Coordinates are encrypted at rest so there is no SQL distance
to order by; district is the one plaintext locality signal, so the budget is now
spent on the farmer's own district first. **Not the §49 answer** — a coarse
plaintext geocell, or a decision that seller coordinates need not be encrypted,
is the real fix — but an arbitrary cap was worth removing today.

---

## PERF-042 — The §71 tail PROGRESS.md claimed was closed

**P1 · COMPLETE**

`PROGRESS.md` said "the §71 backlog is drained". It was not.

**A page that lied about itself.** `?inStock=true` filtered in JS AFTER `take`
and `count`, so a 20-row page could return 11 while `meta` reported the
unfiltered total. Pushed into SQL — and it only ever needed to constrain the
legacy branch, since the split-catalog branch already requires `stockQty > 0`.

**An unbounded comment thread**, both levels, on a public unauthenticated route.
Capping only the outer level would have left one comment with a thousand replies
reopening the hole, so replies are a bounded preview with the true count beside
them. Response stays a bare array; counts go in `meta`.

**`sort=popularity` over a dead column.** Nothing increments
`products.viewCount` — the only writer is the QC merge transferring an existing
value. No client sends the sort. §17: remove the sort, do not index the column.

---

## PERF-043 — Two holes in cleanupTestData that presented as 78 unrelated failures

**P1 · COMPLETE**

`cleanupTestData` never deleted `direct_messages`, `posts` or `comments`. All
three FK the User without a cascade, so any suite creating one blocked
`user.deleteMany()`, which aborted the whole cleanup transaction and left every
table populated for the next suite.

The symptom is dozens of unrelated suites failing on stale fixtures, nowhere near
the test that caused it — twice today, 78 and 77 failures, both from tests I had
just added.

**Diagnostic worth keeping:** a large failure count concentrated in *setup*
errors (unique-constraint violations, missing fixtures) rather than assertions
means a poisoned cleanup, not a code regression. Check what the newest test
creates and whether cleanup deletes it, before reading the diff.

---

## PERF-044 — One test fails intermittently and has never been captured

**P2 · OPEN**

Three times today a full backend run reported exactly **one** failure that did
not reproduce — six consecutive clean runs afterwards each time. It has never
been captured with its name or assertion, so there is nothing to diagnose from.

It is NOT the parallel-worker problem fixed in PERF-027 (`maxWorkers: 1` is in
force), and it is not the cleanup poisoning in PERF-043 (that reproduces every
run and fails in the dozens).

Recorded rather than closed. The next person to see a `1 failed` line should
capture the output to a file **before** re-running — `npm test > /tmp/f.txt 2>&1`
then read the "Summary of all failing tests" block — because a re-run destroys
the only evidence. That is how the one reproducible case today was finally
identified (an ambiguous fixture: three DMs created in the same millisecond, with
the seek ordering by `createdAt DESC, id DESC` and uuid ids making the tiebreak
arbitrary).
