# Completed Optimizations

Newest first. An item appears here only after it has been implemented **and
verified** — code written is not completion (`claude.md` §4.3).

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
| Assertions expecting HTTP 422 from `validate()`, which ships 400 | 28 | **Stale tests** |
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
