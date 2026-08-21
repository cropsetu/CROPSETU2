# Queue Architecture

`claude.md` §32 asks for every piece of work to be classified, and §33 asks for
each job's failure semantics to be documented. This is that classification.

It is written against what the code actually does, not against what a queue
diagram would like it to do — where the honest answer is "this is a
fire-and-forget promise with a swallowed rejection", it says so.

---

## The six classes

| Class | Meaning | Loss is acceptable? |
|---|---|---|
| **sync** | Runs inside the request. The caller waits and the answer depends on it. | No — the request fails |
| **short async** | Offloaded, expected to finish in seconds. | No — retried |
| **long async** | Offloaded, seconds to minutes. Needs progress reporting. | No — retried, and the client polls |
| **scheduled** | Runs on a timer, not in response to a request. | Yes for one tick — the next tick catches up |
| **durable critical** | Must happen exactly once, eventually. | **No** |
| **best-effort** | Nice to have. May be dropped under load. | **Yes, deliberately** |

---

## What runs where

### Synchronous — inside the request

Everything that decides an answer: auth, pricing, stock validation, the
Serializable checkout transaction, payment signature verification. `claude.md`
§32 says heavy work must not run in HTTP handlers, and none of this is heavy —
it is the request.

The one deliberate exception is the **scan submit** path, which does real work
(image validation, credit reserve, enqueue) before returning a job id. It is
sync because the farmer has to be told immediately whether their credit was
taken.

### Long async — Celery, `fastapi/jobs/tasks.py`

| Job | Class | On failure |
|---|---|---|
| `run_diagnosis_task` | **long async** | `max_retries=0` deliberately — the orchestrator already handles transient LLM errors through its own fallback chain, and a retried diagnose stage costs real provider money. The credit hold is RELEASED on timeout or crash, so a job that produced nothing does not lock a farmer out for the day. |

`task_acks_late=True` so a worker OOM requeues rather than loses.
`worker_prefetch_multiplier=1` so one worker cannot hog four 120-second jobs.
Hard limit 300 s, soft 270 s.

**Liveness:** queue depth and time-since-last-completion are exposed through
`/health/details` and `/admin/ops/status` (§35). Without that a missing worker
was indistinguishable from an idle one.

### Short async — BullMQ, `backend/src/queue/`

| Job | Class | On failure |
|---|---|---|
| `notifications / user-notification` | **best-effort** | 3 attempts, exponential backoff from 2 s. With Redis down it runs inline, **bounded** — past the ceiling it is SHED with a log line rather than queued. |

That shed is the §33 answer for this job specifically: a Redis outage must not
turn into an API outage because 5,000 notifications suddenly execute on the
request path. Losing one push is a farmer missing one alert; running five
thousand inline takes the API down for everyone.

`BEST_EFFORT` in `queue/processors.js` is the machine-readable half of this
table. **Anything absent from it is treated as critical and still runs inline**,
so a job added later without a thought about its criticality cannot become
silently droppable.

### Scheduled — node-cron, `backend/src/server.js`

Twelve schedules, all behind `CRON_ENABLED` so they can move off the
latency-serving tier (§34). Nine take a Redis leader lock; three deliberately do
not.

| Schedule | Class | Loss of one tick |
|---|---|---|
| `shop-reservation-sweep` (2 min) | **durable critical** | Stock stays held until the next tick — the only thing returning abandoned reservations to the shelf |
| `shop-payment-reconcile` (10 min) | **durable critical** | An orphaned payment stays unreconciled |
| `retention-sweep` (daily) | scheduled | A day of extra retention |
| `animal-listing-expiry` (hourly) | scheduled | Stale ads stay up an hour longer |
| `mandi-daily-sync` (daily) | scheduled | Yesterday's prices persist |
| `seller-stats` / `seller-metrics` | scheduled | Metrics go stale |
| `shop-batch-expiry-sweep` (daily) | **durable critical** | An expired agri-chemical batch stays sellable a day longer |
| `prediction-cache-purge` (monthly) | scheduled | Cache grows |
| cache warm, alert check, metrics (3, unlocked) | best-effort | Nothing |

The two marked **durable critical** that are leader-locked are only as durable as
the leader lock: if no replica wins the lock for an extended period, nothing
runs and nothing says so. That is a known gap, recorded below.

### Fire-and-forget — 112 sites

`grep '\.catch(() => {})'` over `routes/` and `services/` returns **112**
matches. These are promises started and never awaited, with the rejection
swallowed.

Most are correct and deliberate: an audit-log write, a cache invalidation, a
notification, an insight refresh. The pattern is right for anything whose
failure genuinely should not fail the request.

But it is **not a queue**, and it is worth being clear that it has none of a
queue's properties — no retry, no backoff, no visibility, no ordering, and if
the process exits between the call and the resolution the work is simply gone.
Anything in this category that is later found to matter should move to BullMQ
rather than gaining a retry loop of its own.

---

## Known gaps

**Leader-lock silence.** The two durable-critical sweeps depend on a Redis
leader lock. Nothing alerts if no replica holds it. `claude.md` §55 asks for
leader-lock failure to be observable; the lock miss is logged now that
`logger.warn` is ungated, but nothing aggregates it.

**No durable fallback for a critical job.** §33 says critical jobs should use a
durable mechanism when the queue is unavailable. Today the only BullMQ job is
best-effort, so the question has not arisen — but the moment a critical job is
added, `enqueue()`'s inline path is the whole story, and it is bounded by a
concurrency ceiling rather than by durability.

**Fire-and-forget is unmeasured.** 112 sites, no counter on how often those
rejections fire. They are logged individually where the handler logs, and
invisible where it does not.
