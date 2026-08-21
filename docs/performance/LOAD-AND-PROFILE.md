# Load Test & Runtime Profile

`claude.md` §58 (Node profiling), §62/§63 (load testing) and §64 (performance
targets). These were the last sections with no measurement behind them at all.

**Read the caveats before the numbers.** They matter more than the numbers.

---

## What this is, and what it is not

Everything below was run on **one laptop**: the load generator (`ab`), the API,
and PostgreSQL all competing for the same cores. `ab` is single-threaded, so
above a few hundred concurrent it is measuring itself as much as the server.

So:

- **Absolute RPS is a floor, not a capacity figure.** A dedicated box with the
  database on its own host would do better; a container with a CPU quota would
  do worse.
- **The shape is trustworthy.** Where latency starts to bend, whether errors
  appear, whether the event loop blocks, whether memory or connections climb and
  stay climbed — those hold regardless of the absolute numbers.

**No AI endpoint was load-tested.** §62 is explicit: *"AI load tests must avoid
unintentionally spending real provider money. Mock providers unless explicitly
running controlled integration tests."* There is no mock provider wired, so that
scenario is **omitted rather than approximated**. A load test that silently bills
Gemini is worse than a gap in the report.

**No write path was load-tested.** Checkout, order confirm and booking take
Serializable transactions against real stock; hammering them against a database
shared with the test fixtures would corrupt them rather than measure anything.
Their correctness under concurrency is already covered by
`booking-concurrency.test.js` and `shopReservation.api.test.js`. What was missing
was read throughput, which is what carries the 100–300 req/s target.

**The rate limiter was raised, not disabled** (`RATE_LIMIT_MAX`), so its
per-request cost is still inside every number here. The first run without that
measured the limiter instead of the app — 19,000 rps of 429s, which is its own
kind of useful.

Reproduce with:

```
PROFILE=1 PROFILE_OUT=/tmp/prof.ndjson RATE_LIMIT_MAX=100000000 npm start
./scripts/loadtest.sh 100 500 1000 2000
node scripts/profile.js --summarise /tmp/prof.ndjson
```

Data: 5,000 products across 12 categories, 2,000 animal listings.

---

## §63 — Load levels

3,000–4,000 requests per cell, keep-alive on. **Zero errors at every level.**

| Scenario | Conc | RPS | p50 | p95 | p99 | max | err | DB conns |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| storefront (limit 20) | 100 | 5,028 | 15 | 22 | 170 | 281 | 0% | 3 |
| | 500 | 6,530 | 71 | 84 | 168 | 453 | 0% | 3 |
| | 1000 | 6,235 | 142 | 177 | 187 | 199 | 0% | 13 |
| | 2000 | 5,784 | 261 | 354 | 362 | 378 | 0% | 13 |
| products (limit 50) | 100 | 3,864 | 23 | 33 | 108 | 269 | 0% | 3 |
| | 500 | 4,215 | 114 | 128 | 135 | 135 | 0% | 3 |
| | 1000 | 3,973 | 241 | 272 | 283 | 288 | 0% | 13 |
| | 2000 | 3,654 | 421 | 582 | 599 | 602 | 0% | 13 |
| categories | 100 | 16,515 | 5 | 7 | 28 | 63 | 0% | 3 |
| | 2000 | 12,886 | 127 | 131 | 132 | 148 | 0% | 13 |
| healthz | 100 | 23,296 | 4 | 5 | 6 | 27 | 0% | 3 |
| | 2000 | 19,028 | 67 | 114 | 117 | 118 | 0% | 13 |

`/animals` was **excluded**: it carries its own route-level search limiter on top
of the global one, so driving it at load measures that limiter. Worth knowing
separately that the limiter is keyed per IP, and an entire village behind one
NAT shares that budget.

### What the shape says

**Throughput is flat from 500 concurrent upward.** The storefront holds
~5,000–6,500 rps at every level; latency rises roughly linearly with concurrency
while RPS does not. That is the signature of a saturated service queueing
work — not of a service falling over. Nothing errored even at 2,000.

**DB connections stayed at 13.** Against a pinned pool of 12 per replica and a
`max_connections` of 100. The pool was never the limit at any level tested.

**Payload size is the dominant cost.** `limit=50` costs ~40% of `limit=20`'s
throughput at every level. Serialisation, not the query — which is exactly what
§47 (API response size) is about, and the strongest argument in this document
for the list-payload trimming still open in `FINDINGS.md`.

---

## §64 — Against the stated targets

| Target | Measured | Verdict |
|---|---|---|
| Peak API traffic **100–300 rps** | 5,028 rps on the storefront at 100 concurrent | **Met, ~17× over** |
| Cached read **p95 < 300 ms** | 22 ms @100, 84 ms @500, 177 ms @1000, **354 ms @2000** | Met to ~1,000 concurrent |
| DB-backed API **p95 < 500 ms** | 33 ms @100 … **582 ms @2000** (limit=50) | Met to ~1,000 concurrent |
| Peak concurrent **3,000–5,000 users** | not reached — `ab` is the limit, not the server | **Unverified** |

The concurrency target is the honest gap. 3,000–5,000 *concurrent users* is not
3,000 concurrent *requests* — users spend most of their time reading a screen —
so 2,000 concurrent in-flight requests is already well beyond a 5,000-user peak.
But that is an argument, not a measurement, and it needs a real load generator
on separate hardware to settle.

---

## §58 — Runtime profile

Sampled every 500 ms from Node's own `perf_hooks` and `v8`, inside the process,
while the load above was applied. No profiler dependency, no agent.

| Metric | Value |
|---|---|
| event-loop delay p50 (avg) | **12.84 ms** |
| event-loop delay p99 (max) | **157.68 ms** |
| event-loop utilisation (avg / max) | 0.249 / **1.000** |
| RSS start → peak → idle | 224 → 696 → 306 MB |
| heap start → peak → **after GC** | 60.5 → 438 → **89 MB** |
| GC | 89 collections, 286 ms total, **10.4 ms max pause** |
| GC kinds | 82 minor, 4 incremental, **0 major** |

### The heap growth is not a leak

The raw run looks alarming — heap 60 MB → 438 MB, +377 MB. It would be easy to
report that as a leak, and it is not one.

**Zero major GCs ran.** V8 had no memory pressure and never bothered collecting;
`heapUsed` is accounting that only updates when a collection happens, which is
why it sat frozen at 438 MB through 25 seconds of idle while RSS fell to 306 MB
on its own.

Applying a light burst to force allocation dropped it to **89 MB** immediately.
Against a 60.5 MB cold baseline that is a ~28 MB residual — consistent with warm
caches (auth cache, listing cache, the Prisma query engine) and not with
retention.

**Method note:** an idle process is the wrong place to look for a leak in V8. The
test is whether the heap comes down *after a collection*, not whether it comes
down on its own.

### Event-loop delay is the one number to watch

p99 reached **157 ms** at 2,000 concurrent, and ELU reached **1.000** — the loop
was fully saturated. That is expected at that concurrency and it is why RPS
plateaus: the process is CPU-bound, and more concurrency will not help. It needs
another replica, or the work moved off the loop.

At 100 concurrent — nearer the actual target — p99 delay was well under the
50 ms threshold §58 implies. Nothing here points to a synchronous block of the
kind §58 warns about (large `JSON.parse`, Base64 decode, sync crypto). The 12 MB
body-parser cap and the single-image scan change removed the biggest candidate
before this was measured.

---

## What to do with this

1. **Nothing is on fire.** Throughput exceeds the stated target by more than an
   order of magnitude, with zero errors and no connection pressure.
2. **The next real limit is CPU on the event loop**, not the database. That is a
   replica-count decision, and it is what §8's PgBouncer arithmetic was already
   pointing at from the other side.
3. **Payload size is the cheapest remaining win** — `limit=50` costing 40% of
   throughput is the measured case for the response-trimming work in
   `FINDINGS.md`.
4. **The AI path is still unmeasured**, and it is the one with a per-request cost
   in rupees. It needs a mock provider before it can be load-tested at all.
