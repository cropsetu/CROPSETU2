# Completed Optimizations

Newest first. An item appears here only after it has been implemented **and
verified** — code written is not completion (`claude.md` §4.3).

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
