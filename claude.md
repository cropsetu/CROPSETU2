# CropSetu — Claude Code Continuous Architecture, Performance & Scalability Improvement Directive

> **Purpose:** Place this file at the repository root as `read.md`.
>
> This file is the persistent operating instruction for Claude Code when working on CropSetu.
> Claude must read this file before making architecture, performance, scalability, reliability, database, mobile, AI, security, or infrastructure changes.

---

# 0. PRIMARY DIRECTIVE

You are working on **CropSetu**, an India-first agricultural platform used by farmers, sellers/Krushi Seva Kendras, and internal administrators.

Your job is to continuously improve the existing system **feature by feature, one safe step at a time**, with the goal of making it:

- scalable to at least **100,000 registered users**
- capable of handling several thousand concurrent users
- resource efficient
- fast on low-end Android devices
- reliable on weak mobile networks
- secure
- observable
- horizontally scalable
- maintainable by a small engineering team
- cost-efficient for a startup

You must **not rewrite the entire application**.

You must improve the current architecture incrementally.

Your default loop is:

```text
READ
→ UNDERSTAND
→ MEASURE
→ IDENTIFY BOTTLENECK
→ DESIGN SMALLEST SAFE FIX
→ IMPLEMENT
→ TEST
→ PROFILE / VERIFY
→ DOCUMENT
→ CONTINUE TO NEXT ITEM
```

Do not stop after giving recommendations when you are operating in implementation mode.

Continue through the prioritized backlog **one item at a time**, unless:

1. the next change is destructive,
2. the next change requires production credentials or external access unavailable to you,
3. the change could cause data loss,
4. requirements are truly impossible to infer safely,
5. tests expose a blocking correctness issue that must be resolved first.

For ordinary implementation decisions, use engineering judgment and continue.

---

# 1. SYSTEM GOAL

Design and optimize CropSetu for approximately:

```text
Registered users:          100,000+
Daily active users:         20,000+
Peak concurrent users:       3,000–5,000 initially
Peak API traffic:              100–300 RPS initially
Future requirement:        horizontal scaling beyond this
```

Do NOT interpret 100,000 users as 100,000 simultaneous connections.

Capacity decisions must primarily consider:

```text
requests/sec
concurrent requests
DB queries/sec
DB connection count
Redis operations/sec
Socket connections
queue depth
media bandwidth
AI workload
external-provider limits
mobile network quality
device memory
```

---

# 2. CURRENT CROPSETU ARCHITECTURE — VERIFY AGAINST SOURCE

The repository currently contains approximately:

```text
Farmer App
Expo / React Native

Seller App
Expo / React Native

Admin SPA
React / Vite

                │
                ▼

        Express Backend
     Node.js + Prisma
       + Socket.IO
       + node-cron
       + BullMQ

                │
      ┌─────────┼──────────────┐
      │         │              │
      ▼         ▼              ▼
 PostgreSQL    Redis       Cloudinary
                │
                │
                ▼
            FastAPI
                │
                ▼
             Celery
                │
                ▼
         AI diagnosis worker

External systems include:

Google Gemini
Sarvam
Groq
OpenAI
Razorpay
MSG91
Open-Meteo
OpenWeatherMap
IMD
Nominatim/OSM
data.gov.in / Agmarknet
Expo Push infrastructure
```

The system is currently closer to a **modular monolith plus a specialized AI service** than a microservice architecture.

That is acceptable.

Do NOT introduce microservices simply because the product targets 100k users.

---

# 3. NON-NEGOTIABLE ENGINEERING RULES

## 3.1 Correctness before performance

Never trade correctness for benchmark improvements.

Priority order:

```text
1. Correctness
2. Security
3. Data integrity
4. Simplicity
5. Observability
6. Performance
7. Resource efficiency
8. Scalability
9. Developer convenience
```

## 3.2 Verify before modifying

This file contains known findings, but the repository may have changed.

For every recommendation:

1. locate the actual code,
2. verify the problem still exists,
3. inspect all callers,
4. inspect tests,
5. inspect database schema/indexes,
6. inspect failure behavior,
7. implement only after verification.

Do not blindly apply stale recommendations.

## 3.3 Do not overengineer

Do NOT introduce these by default:

```text
Kafka
Kubernetes
service mesh
database sharding
event sourcing everywhere
CQRS everywhere
20 microservices
multiple NoSQL databases
Elasticsearch/OpenSearch without evidence
```

Use them only if measurements prove the existing architecture cannot meet requirements.

---

# 4. CONTINUOUS EXECUTION MODE

Claude must work through the system in **small, ordered batches**.

Maintain a persistent engineering backlog.

Create or maintain:

```text
docs/performance/
    PROGRESS.md
    BASELINE.md
    FINDINGS.md
    COMPLETED.md
```

If these files do not exist, create them.

## 4.1 `PROGRESS.md`

Track:

```markdown
# Current Optimization Progress

## Current Item
PERF-XXX

## Status
AUDITING | IMPLEMENTING | TESTING | VERIFYING | COMPLETED | BLOCKED

## Current Feature
...

## What was discovered
...

## Files being changed
...

## Tests
...

## Metrics
...

## Next item
PERF-YYY
```

Update it before moving to the next optimization.

## 4.2 `FINDINGS.md`

Every discovered optimization should receive an ID:

```text
PERF-001
PERF-002
PERF-003
...
```

Use this structure:

```markdown
## PERF-001 — Short title

Priority: P0 / P1 / P2 / P3
Status: TODO / IN_PROGRESS / COMPLETE / BLOCKED

Component:
Evidence:
Current behavior:
Current complexity:
Risk:
Recommended change:
Expected impact:
Files:
Tests:
Rollback:
```

## 4.3 `COMPLETED.md`

When an optimization is completed record:

```text
what changed
why
files changed
tests run
before/after measurements
known limitations
```

Never mark an item completed merely because code was written.

Completion requires verification.

---

# 5. WORK LOOP

For every feature or optimization use this exact loop.

## Step 1 — Understand

Read:

```text
route
controller/handler
service
repository/Prisma query
schema
Redis behavior
client caller
tests
background jobs
```

Understand the complete request lifecycle.

## Step 2 — Define current complexity

Determine:

```text
Time complexity
Space complexity
DB round trips
Redis round trips
External API calls
payload size
memory allocation
fan-out
```

Example:

```text
Current:
Presence broadcast

Time:
O(C)

C = all connected sockets
```

## Step 3 — Measure

Whenever possible use:

```text
EXPLAIN
EXPLAIN ANALYZE
EXPLAIN (ANALYZE, BUFFERS)
pg_stat_statements
pg_stat_user_indexes
Node CPU profiling
Node heap snapshots
event-loop lag
Python profiling
React Native profiling
Redis INFO
queue metrics
```

If production telemetry is unavailable, use local/staging measurements and clearly label them.

## Step 4 — Design smallest safe fix

Do not refactor unrelated files.

Prefer:

```text
small patch
clear rollback
existing abstractions
backward compatibility
feature flag when risk is high
```

## Step 5 — Implement

Keep each change focused.

Avoid unrelated cleanup.

## Step 6 — Test

Run relevant:

```text
unit tests
integration tests
database tests
concurrency tests
API tests
mobile logic tests
FastAPI tests
```

Add missing tests when modifying important behavior.

## Step 7 — Verify

Check:

```text
correctness
latency
CPU
RAM
DB queries
DB connections
Redis
payload
fan-out
```

## Step 8 — Document

Update:

```text
PROGRESS.md
FINDINGS.md
COMPLETED.md
architecture documentation when needed
```

## Step 9 — Continue

Move directly to the next highest-priority safe item.

Do not repeatedly ask:

> What should I work on next?

Use the backlog.

---

# 6. PRIORITY MODEL

Use:

## P0

Potential production scalability, correctness, data-loss, security, or severe cost blocker.

## P1

Important before meaningful growth.

## P2

Useful optimization based on telemetry.

## P3

Optional / premature.

When two items have similar priority, choose using:

```text
Impact × frequency × risk reduction ÷ implementation complexity
```

---

# 7. FIRST PASS — BASELINE AUDIT

Before broad optimization, create a baseline.

Inspect:

```text
backend/
fastapi/
frontend/
seller-app/
admin/
shared/
Prisma schema
Dockerfiles
Railway config
CI workflows
```

Produce `docs/performance/BASELINE.md`.

Include:

```text
service topology
number of workers
DB pool settings
Redis clients
queue configuration
cron jobs
major APIs
largest payload endpoints
pagination strategy
cache strategy
media strategy
Socket.IO behavior
AI pipeline
```

Also identify:

```text
known failing tests
CI gaps
production-risk schema deployment behavior
unbounded collections
unbounded tables
```

After baseline, begin P0 work.

---

# 8. P0-001 — POSTGRESQL CONNECTION POOLING

One of the first scaling ceilings to verify is database connection fan-out.

Current architecture may roughly allocate:

```text
Express replica:
>= ~20 Prisma connections

FastAPI replica:
up to ~10 asyncpg connections

Celery worker:
additional DB connections
```

Calculate exact current totals.

Formula:

```text
total_connections =
Express_replicas × Prisma_pool
+
FastAPI_replicas × asyncpg_pool
+
Celery_replicas × worker_pool
+
admin/manual connections
```

Compare against:

```text
PostgreSQL max_connections
```

If connection fan-out is still a bottleneck, introduce:

```text
PgBouncer
```

Prefer transaction pooling where compatible.

Alternative:

```text
Prisma Accelerate
```

only if intentionally chosen.

Do not simply increase PostgreSQL `max_connections`.

Measure:

```text
connection utilization
pool wait
DB CPU
query latency
transaction latency
```

---

# 9. P0-002 — AUTHENTICATION HOT-PATH CACHE

Verify whether every authenticated HTTP request currently does:

```text
JWT verification
↓
Redis JTI denylist GET
↓
Prisma user lookup:
    isActive
    tokenVersion
↓
actual endpoint
```

If true, the user read is one of the most frequent DB queries in the system.

Implement a bounded short-TTL cache:

```text
userId
   ↓
{
  isActive,
  tokenVersion
}
```

Suggested initial TTL:

```text
10–30 seconds
```

Requirements:

```text
bounded memory
TTL
tokenVersion invalidation when changed
deactivation-aware
no sensitive full-user object
metrics
```

Architecture:

```text
Request
 ↓
JWT
 ↓
denylist
 ↓
auth cache
 ├── HIT  → continue
 └── MISS → PostgreSQL → cache → continue
```

Measure:

```text
auth DB queries/sec before
auth DB queries/sec after
cache hit rate
p95 auth middleware latency
```

---

# 10. P0-003 — REMOVE UNBOUNDED PROCESS MAPS

Search all long-lived:

```javascript
new Map()
new Set()
[]
```

and Python equivalents.

Especially inspect:

```text
rate-limit fallback
pending scans
socket connection tracking
temporary caches
voice state
request dedupe
```

Every process-level collection whose cardinality depends on users/IPs/requests must use at least one:

```text
max size
TTL
LRU
explicit lifecycle cleanup
periodic sweep
```

Known area to verify:

```text
rate-limit fallback Map
```

Replace with:

```text
BoundedMap
or
TTL-LRU
```

Target:

```text
Memory:
O(configured maximum)
```

not:

```text
O(all unique request keys encountered)
```

---

# 11. P0-004 — SOCKET.IO GLOBAL PRESENCE FAN-OUT

Search for:

```javascript
io.emit(...)
```

especially:

```text
user_online
user_offline
presence
typing
chat state
```

If presence is globally broadcast:

```text
1 connection event
×
all connected sockets
```

Complexity:

```text
O(C)
C = all connected users
```

This is unacceptable at scale when most clients do not care about each other's presence.

Design scoped delivery.

Possible rooms:

```text
user:<id>
chat:<id>
group:<id>
presence:<scope>
```

Target:

```text
O(R)
R = relevant recipients
```

Preserve cross-instance Socket.IO behavior through Redis adapter.

Also review WebSocket authentication versus HTTP authentication.

Socket authentication should not silently skip critical checks such as:

```text
tokenVersion
isActive
authorization to room
```

---

# 12. P0-005 — AI SCAN BASE64 PAYLOAD

Verify the crop scan path.

Current design may send:

```text
1–5 compressed images
→ Base64
→ JSON
→ Express
→ FastAPI
```

The route may allow very large JSON bodies.

Base64 causes:

```text
larger network representation
large JS strings
JSON parsing CPU
Buffer allocation
GC pressure
Node memory
FastAPI decoding memory
```

Design migration toward:

```text
Mobile
 ↓
request signed upload
 ↓
Cloudinary/object storage
 ↓
upload directly
 ↓
receive publicId/mediaId
 ↓
submit lightweight scan metadata
 ↓
Express
 ↓
FastAPI/Celery
```

Example lightweight request:

```json
{
  "imageIds": [
    "scan/abc",
    "scan/xyz"
  ],
  "crop": "...",
  "metadata": {}
}
```

Requirements:

```text
signed upload
ownership
size limits
content-type validation
quota
cleanup
backward compatibility for older apps
```

Roll out gradually.

---

# 13. P0-006 — AI SCAN IDEMPOTENCY

Inspect the crop-scan retry path.

The client should generate a true **operation ID**.

Required behavior:

```text
network retry of same scan
→ same Idempotency-Key
→ same job

farmer intentionally scans same photo again
→ new Idempotency-Key
→ new job
```

Avoid relying only on image body hashes.

Preserve:

```text
credit reserve
settle
release
ownership
job dedupe
```

---

# 14. DATABASE QUERY AUDIT

For each important endpoint record:

```text
WHERE
ORDER BY
JOIN/include
LIMIT
pagination
number of queries
index
```

Use a table:

| Endpoint | Query count | Index | Pagination | Problem | Fix |
|---|---:|---|---|---|---|

Prioritize:

```text
authentication
home/feed
AgriStore
AnimalTrade
Rent
chat
AI
admin metrics
```

---

# 15. N+1 QUERY AUDIT

Search for:

```javascript
for (...) {
    await prisma...
}
```

and:

```python
for ...:
    await database_call(...)
```

Also inspect hidden ORM lazy-loading patterns.

Bad:

```text
1 product query
+
N seller queries
```

Preferred:

```text
JOIN
IN (...)
Prisma include/select
batch query
```

For each fix report:

```text
before DB round trips
after DB round trips
```

---

# 16. DATABASE FILTERING

Never do this on large datasets:

```javascript
const rows = await prisma.model.findMany();
const result = rows.filter(...)
```

if PostgreSQL can do:

```text
WHERE
ORDER BY
LIMIT
JOIN
GROUP BY
```

Application code should not become a replacement query engine.

---

# 17. INDEX STRATEGY

The repository already contains many indexes.

Do NOT add indexes indiscriminately.

For every candidate use:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

Known query shapes to verify include:

```text
chats:
buyerId + updatedAt DESC
sellerId + updatedAt DESC

community posts:
deletedAt + isPinned + createdAt DESC

comments:
parentId

disputes:
refId
```

Also inspect popularity sorting based on:

```text
products.viewCount
```

If the value is never incremented or feature is dead:

```text
remove dead sort
```

rather than indexing useless data.

---

# 18. REMOVE REDUNDANT INDEXES

Some heavily written tables may have many indexes.

Audit:

```text
products
animal_listings
orders
messages
listings
```

Look for:

```text
duplicate indexes
prefix-subsumed indexes
unused indexes
indexes for dead queries
```

Use:

```sql
pg_stat_user_indexes
```

Classify:

```text
KEEP
ADD
DROP-CANDIDATE
```

Do not automatically drop production indexes.

---

# 19. KEYSET PAGINATION

Use cursor/keyset pagination for large dynamic collections.

Preferred:

```sql
WHERE ("createdAt", "id") < ($1, $2)
ORDER BY "createdAt" DESC, "id" DESC
LIMIT 21;
```

with:

```text
(createdAt DESC, id DESC)
```

index.

Response:

```json
{
  "items": [],
  "hasMore": true,
  "nextCursor": "..."
}
```

---

# 20. PRISMA NESTED-OR KEYSET

Inspect cursor logic such as:

```javascript
OR: [
  { createdAt: { lt: cursor.createdAt } },
  {
    createdAt: cursor.createdAt,
    id: { lt: cursor.id }
  }
]
```

Run EXPLAIN.

If PostgreSQL shows:

```text
Filter
Rows Removed by Filter
```

instead of efficient index condition at deep cursors, use safe parameterized row comparison where appropriate:

```sql
("createdAt", "id") < ($1, $2)
```

Do not use unsafe raw SQL.

---

# 21. REMOVE HIGH-VOLUME OFFSET PAGINATION

Find:

```text
skip
offset
page × limit
COUNT(*) per page
```

Prioritize high-growth endpoints.

Possible candidates to verify:

```text
community
rent bookings
saved items
admin QC
```

Convert to keyset when product UX does not require random page jumps.

---

# 22. DATA STRUCTURE REVIEW

Audit JavaScript and Python for:

```text
Array.includes
Array.find
Array.filter
nested loops
Map
Set
sort
reduce
large spreads
deep copies
Promise.all
large comprehensions
```

## 22.1 Array membership

Repeated:

```javascript
array.includes(id)
```

is:

```text
O(n)
```

For frequent membership use:

```javascript
set.has(id)
```

average:

```text
O(1)
```

Do not replace tiny bounded arrays unnecessarily.

## 22.2 Repeated find

Repeated:

```javascript
items.find(x => x.id === id)
```

can become:

```javascript
Map(id → item)
```

when multiple lookups justify map construction.

## 22.3 Nested loops

Find relevant:

```text
O(n²)
O(n×m)
```

hot paths.

Use:

```text
Map
Set
batch query
index
precomputation
```

when appropriate.

## 22.4 Generators

In Python, avoid huge temporary lists where streaming is sufficient.

Use:

```python
yield
```

or generator expressions when repeated/random access is not required.

## 22.5 Unnecessary copies

Inspect:

```text
[...largeArray]
slice()
Array.from()
deepcopy()
JSON.parse(JSON.stringify())
list(...)
```

Avoid temporarily doubling memory without need.

---

# 23. BATCH OPERATIONS

General rule:

Bad:

```text
for item:
    await DB(item)
```

Better:

```text
DB(all items)
```

Audit:

```text
buy-box ranking
seller hydration
notifications
availability
review statistics
variants
```

---

# 24. BUY-BOX READ AMPLIFICATION

Verify product-detail buy-box behavior.

If:

```text
N variants
→ N ranking/cache calls
→ potentially N DB queries
```

create a batch method:

```text
getBuyBoxesForVariants(variantIds)
```

Try to reduce:

```text
O(N network/DB round trips)
```

toward:

```text
O(1) bounded batch query
```

---

# 25. MANDI PRICE DATA

Verify whether mandi sync truly performs a business-key upsert.

Business key may be:

```text
commodity
market
priceDate
```

If duplicates are being created:

1. establish correct unique key,
2. deduplicate existing data,
3. add DB uniqueness,
4. perform real upsert,
5. add retention,
6. later consider monthly partitioning.

Do not partition broken duplicated data.

---

# 26. UNBOUNDED TABLE GROWTH

Audit:

```text
mandi_prices
chat_messages
group_messages
direct_messages
ai_messages
voice_messages
error_logs
api_health_logs
audit_logs
AI scan diagnoses
stock reservations
payment/event tables
```

Classify:

```text
HOT
ARCHIVE
RETENTION TTL
LEGAL RETENTION
PARTITION
OBJECT STORAGE
```

Never delete legally/financially important records without explicit policy.

---

# 27. AI DIAGNOSIS PAYLOAD STORAGE

If full AI diagnostic JSON payloads are large and stored indefinitely:

consider:

```text
summary columns in PostgreSQL
+
full raw payload in object storage
```

only after verifying:

```text
audit requirements
debugging requirements
replay requirements
data-retention policy
```

---

# 28. CONSENT HISTORY

If effective consent loads all consent rows and reduces in JavaScript:

consider:

```text
latest-per-purpose SQL
```

or:

```text
ConsentHistory
+
EffectiveConsent
```

Keep immutable history if required.

Optimize the read path without weakening auditability.

---

# 29. ADMIN METRICS

If `/metrics` triggers many aggregate queries:

add short cache:

```text
TTL 10–30 sec
```

or precomputed aggregates when justified.

Admin dashboards rarely require millisecond freshness.

Measure DB query reduction.

---

# 30. REDIS AUDIT

Redis currently serves many roles.

Create an inventory:

| Purpose | Key pattern | TTL | Correctness critical? | Failure mode |
|---|---|---:|---|---|

Include:

```text
cache
rate limiting
idempotency
leader locks
JWT denylist
Socket.IO adapter
scan context
voice cancellation
BullMQ
Celery
spend limits
job ownership
```

Distinguish:

```text
disposable cache
```

from:

```text
correctness-critical distributed state
```

They should not have identical failure strategies.

---

# 31. FASTAPI REDIS CLIENTS

Audit the number of independent Redis clients.

Consolidate shared clients/configuration when safe.

Do not merge clients that intentionally use different:

```text
DB numbers
connection pools
failure isolation
broker/result roles
```

Goal:

```text
fewer unnecessary connections
consistent timeout
consistent retries
consistent observability
```

---

# 32. QUEUE ARCHITECTURE

Classify work into:

```text
synchronous request
short async job
long async job
scheduled job
durable critical job
best-effort event
```

Heavy work should not run in HTTP handlers.

Examples:

```text
AI
large image work
video
mass notifications
reports
exports
external-provider chains
```

---

# 33. BULLMQ FAILURE FALLBACK

Verify whether BullMQ failure causes work to run inline.

A Redis outage must not turn into an API outage because heavy jobs suddenly execute synchronously.

For noncritical jobs consider:

```text
record pending
skip/drop low priority
alert
retry later
```

For critical jobs use a durable mechanism.

Document job-specific failure semantics.

---

# 34. MOVE CRON OFF THE WEB TIER

Web replicas should eventually focus on:

```text
HTTP
WebSocket
light coordination
```

Audit node-cron jobs.

Potential worker/scheduler candidates:

```text
retention
payment reconciliation
stock reservation sweep
mandi refresh
cache warm
cleanup
periodic aggregation
```

Keep per-process metric/counter jobs local if they intentionally inspect per-process state.

Preserve single-execution guarantees.

---

# 35. CELERY WORKER HEALTH

A healthy FastAPI web service does not guarantee a healthy Celery worker.

Add visibility for:

```text
worker heartbeat
queue depth
oldest job
completion rate
failure rate
task duration
```

Alert when:

```text
jobs are increasing
AND
completion is zero/abnormally low
```

This is critical for crop scans.

---

# 36. AI SPEND LIMIT CONCURRENCY

Audit spend-limit logic.

Unsafe pattern:

```text
read spend
if spend < cap:
   allow
later:
   write spend
```

Concurrent requests may all pass.

Use atomic reservation:

```text
INCRBYFLOAT
→ compare
→ release/reconcile
```

or Lua/transaction equivalent.

Ensure all AI paths that should be metered are actually metered.

---

# 37. AI MODEL COST

For each AI stage track:

```text
provider
model
input tokens
output tokens
cost
latency
errors
confidence
fallback
```

Do not use expensive models where cheaper models meet quality/safety requirements.

Do not enable multi-model ensemble globally without measuring the multiplication of:

```text
cost
latency
provider failure exposure
```

---

# 38. MEDIA UPLOAD LIMITING

Audit:

```text
/upload/image
/upload/video
seller media
rental media
AI media
KYC media
```

Use per-user limits in addition to global IP limits.

Store upload ownership metadata when practical:

```text
Upload
-----
id
userId
publicId
type
size
createdAt
linkedEntityType
linkedEntityId
status
```

This enables:

```text
quota
orphan cleanup
abuse detection
cost accounting
erasure
```

---

# 39. CLOUDINARY / OBJECT STORAGE

Do not store image binary in PostgreSQL.

Database should hold:

```text
publicId
URL
metadata
ownership
```

Use transformed delivery sizes:

```text
thumbnail
card
detail
original
```

Do not load a 3000px image into a 120px UI card.

---

# 40. MOBILE UI PERFORMANCE

Optimize first for:

```text
low-end Android
limited RAM
slow storage
unstable network
2G/3G/weak LTE
```

Audit:

```text
rerenders
large lists
large images
duplicate requests
polling
bundle size
large language bundles
heavy animation
large screen state
```

---

# 41. VIRTUALIZED LISTS

Use:

```text
FlatList
SectionList
```

for large lists.

Avoid huge:

```javascript
items.map(...)
```

render trees.

Tune only with profiling:

```text
initialNumToRender
maxToRenderPerBatch
windowSize
getItemLayout
removeClippedSubviews
```

---

# 42. MOBILE REQUEST DUPLICATION

Inspect screens for:

```text
effect triggered twice
focus listener + mount request
multiple components loading same endpoint
retry + refresh duplication
```

Use:

```text
request dedupe
query cache
AbortController/cancellation
stable query keys
```

where appropriate.

---

# 43. MOBILE IMAGE UPLOAD CONCURRENCY

Sequential uploads are acceptable for low-memory devices.

Do NOT replace with unlimited:

```javascript
Promise.all(images.map(upload))
```

Use bounded concurrency:

```text
1–2
```

unless profiling shows higher concurrency is safe.

Preserve upload retry cache.

---

# 44. CHAT POLLING

If chat falls back to fixed 10-second HTTP polling:

at scale:

```text
5000 active chats / 10 sec
≈ 500 RPS
```

just for polling.

Preferred:

```text
foreground:
Socket.IO

background:
push

socket reconnect:
incremental sync

prolonged outage:
adaptive bounded polling
```

Use exponential/adaptive polling rather than permanent aggressive polling.

---

# 45. PUSH NOTIFICATIONS

Complete Expo push delivery if currently incomplete.

Use push for:

```text
chat
order status
booking
seller action
important farm alert
AI job completion when appropriate
```

Push complements Socket.IO; it does not replace every realtime event.

---

# 46. MOBILE OFFLINE BEHAVIOR

Audit:

```text
timeouts
retry
offline cache
draft persistence
upload recovery
request cancellation
stale content
```

Use:

```text
exponential backoff
+
jitter
```

Avoid synchronized retry storms.

---

# 47. API RESPONSE SIZE

Audit responses for unnecessary data.

Use:

```text
Prisma select
purpose-specific DTOs
screen-specific payloads
```

Feed/list APIs should return minimal cards.

Detail API can return full details.

Measure compressed/uncompressed payload sizes.

---

# 48. HTTP COMPRESSION

Verify gzip/Brotli where appropriate.

Do not recompress:

```text
JPEG
WebP
video
other already-compressed media
```

Measure CPU cost against bandwidth savings.

---

# 49. LOCATION SEARCH

Do not loop through all listings in JS/Python to calculate distance.

If location traffic becomes significant, evaluate:

```text
PostGIS
```

with spatial indexes.

Only add PostGIS when current bounding-box/index strategy fails performance goals.

---

# 50. SEARCH

PostgreSQL trigram/full-text search may be sufficient.

Do NOT introduce:

```text
Elasticsearch
OpenSearch
Typesense
Meilisearch
```

without measurements showing PostgreSQL cannot meet requirements.

---

# 51. MONEY

Never optimize away financial correctness.

Preserve:

```text
integer paise at Razorpay boundary
Decimal in DB
server-authoritative pricing
signature verification
idempotency
stock reservation
unique constraints
serializable transaction where required
```

Never trust client totals.

---

# 52. STOCK

Preserve:

```text
atomic reservation
stock decrement
expiry
Serializable transaction
retry on serialization/deadlock conflicts
unique DB constraints
```

Performance optimization must not allow overselling.

---

# 53. AI CREDIT LEDGER

Preserve:

```text
reserve
→ execute
→ settle
or
→ release
```

Do not replace atomic decrement with:

```text
read
if sufficient
write
```

which creates TOCTOU races.

---

# 54. SECURITY

Never remove security checks for speed.

Preserve:

```text
HTTPS
JWT
refresh rotation
token version
object-level authorization
CSRF for browser
internal HMAC
Razorpay raw-body HMAC
input validation
file validation
PII masking
AES encryption
admin scopes
audit trail
```

Never trust client-supplied:

```text
role
userId ownership
price
payment status
seller status
admin scope
```

---

# 55. LOGGING & OBSERVABILITY

Critical degradation must be visible.

Ensure operators can observe:

```text
Redis failure
Redis fallback
rate-limit fallback
queue fallback
leader-lock failure
Socket.IO adapter failure
FastAPI breaker
AI provider errors
Razorpay webhook failure
worker absence
DB connection saturation
```

Do not rely on suppressed log levels for important production events.

---

# 56. CIRCUIT BREAKERS

Expose circuit-breaker state through appropriate:

```text
metrics
health details
ops dashboard
```

Possible states:

```text
CLOSED
OPEN
HALF_OPEN
```

Operators should know when:

```text
Gemini
Sarvam
Razorpay
FastAPI
```

are degraded.

---

# 57. HEALTH CHECKS

Separate:

```text
liveness
readiness
dependency detail
```

Example:

```text
/livez
/readyz
/health/details
```

Readiness should focus on dependencies necessary to serve traffic correctly.

Do not fail readiness solely because a noncritical external provider is temporarily unavailable.

---

# 58. NODE.JS PROFILING

Measure:

```text
heap
RSS
GC
event-loop lag
event-loop utilization
CPU
request latency
```

Look for:

```text
large JSON parse
Base64 strings
large Buffers
JSON stringify
large arrays
long-lived Maps
large sorting
sync crypto in loops
```

Move CPU-heavy work away from HTTP event loop.

---

# 59. FASTAPI / PYTHON PROFILING

Inspect:

```text
blocking I/O in async
large image copies
temporary files
large comprehensions
recreated HTTP clients
recreated Redis clients
recreated model/provider clients
DB pool configuration
```

Reuse expensive clients.

Do not assume `async def` makes blocking libraries asynchronous.

---

# 60. CI MUST BE TRUSTWORTHY

Inspect root CI.

Make sure actual repository CI eventually runs:

```text
backend tests
FastAPI tests
Prisma validation
syntax/lint
admin typecheck/build
shared tests
mobile logic tests
integration tests
```

Fix paths before relying on CI.

If there is a known failing baseline:

```text
classify failures
record them
do not hide them
```

Do not accept new regressions simply because old failures exist.

---

# 61. SCHEMA DEPLOYMENT

Audit production schema deployment.

Avoid unsafe automatic schema push when it can conflict with:

```text
manually managed SQL
FastAPI-owned tables
destructive drift
```

Prefer:

```text
reviewed migrations
expand
backfill
contract
```

for important changes.

Never make destructive production schema changes automatically.

---

# 62. LOAD TESTING

Use:

```text
k6
or
Locust
```

Create realistic workflows.

## 62.1 Auth scenario

```text
login
refresh
profile
home
```

## 62.2 Marketplace

```text
search
product list
product detail
cart
checkout
```

## 62.3 AnimalTrade

```text
nearby
filter
detail
create
```

## 62.4 Rent

```text
search
availability
booking
```

## 62.5 Chat

```text
connect
join
send
receive
disconnect/reconnect
```

## 62.6 AI

```text
submit
queue
poll
complete
```

AI load tests must avoid unintentionally spending real provider money. Mock providers unless explicitly running controlled integration tests.

---

# 63. LOAD LEVELS

Progressively test:

```text
100 concurrent
500
1000
2000
5000
```

Record:

```text
RPS
p50
p95
p99
error %
CPU
RAM
DB connections
DB CPU
Redis
queue depth
```

Stop increasing when the current bottleneck is clearly identified.

Fix it first.

---

# 64. PERFORMANCE TARGETS

Initial targets:

```text
Normal cached read:
p95 < 300 ms

Normal DB-backed API:
p95 < 500 ms where realistic

Long AI/media:
async

API availability:
> 99.9% target

Crash-free users:
> 99.5%
```

External-provider-dependent endpoints should have separate SLOs.

---

# 65. REQUIRED REPORTING FORMAT FOR EACH CHANGE

For every significant optimization write:

```text
ID:
Feature:
Priority:

Current implementation:

Current time complexity:
Current space complexity:

Current DB calls:
Current Redis calls:
Current external calls:

Problem:

Evidence:

Proposed implementation:

New time complexity:
New space complexity:

CPU impact:
RAM impact:
DB impact:
Redis impact:
Network impact:
Cost impact:

Correctness risk:
Security risk:
Backward compatibility:

Files affected:

Tests:

Before measurement:
After measurement:

Rollback:

Status:
```

---

# 66. DATA STRUCTURE AUDIT TABLE

Maintain:

| File | Structure | Operation | Complexity | Problem | Recommendation | Priority |
|---|---|---|---|---|---|---|

---

# 67. DATABASE INDEX TABLE

Maintain:

| Table | Query shape | Existing index | Plan | Change | Status |
|---|---|---|---|---|---|

---

# 68. API PERFORMANCE TABLE

Maintain:

| Endpoint | DB | Redis | External | Payload | Pagination | Cache | Issue |
|---|---:|---:|---:|---:|---|---|---|

---

# 69. RESOURCE TABLE

Maintain:

| Component | CPU | RAM | DB | Redis | Network | External cost |
|---|---|---|---|---|---|---|

---

# 70. IMPLEMENTATION ORDER

Unless measurements prove otherwise, work approximately in this order.

## Batch 0 — Safety & Baseline

```text
baseline architecture
tests
CI
metrics
DB pool math
profiling hooks
```

## Batch 1 — Process Memory & Auth

```text
auth cache
unbounded Maps
cache metrics
```

## Batch 2 — PostgreSQL

```text
PgBouncer
hot indexes
query plans
N+1
redundant indexes
```

## Batch 3 — Pagination

```text
keyset
nested-OR improvement
remaining OFFSET
COUNT reduction
```

## Batch 4 — Realtime

```text
presence fan-out
socket auth
chat polling
push
```

## Batch 5 — Media

```text
direct upload
upload ownership
rate limiting
image sizes
AI scan media
```

## Batch 6 — Queues

```text
inline fallback
cron separation
worker monitoring
```

## Batch 7 — AI

```text
idempotency
spend race
provider metrics
model cost
payload storage
```

## Batch 8 — Data Growth

```text
mandi dedup
retention
partition candidates
archive
```

## Batch 9 — Mobile

```text
renders
requests
offline
image memory
language bundle
```

## Batch 10 — Load Test

```text
100
500
1000
2000
5000
```

Then repeat the cycle based on real telemetry.

---

# 71. FEATURE-BY-FEATURE MODE

Do not make one giant "performance refactor".

Treat each product area independently.

Recommended order after cross-cutting P0 work:

```text
1. Authentication
2. User/Profile
3. Home
4. AgriStore
5. Catalog
6. Cart
7. Checkout/Payments
8. Orders
9. AnimalTrade
10. Rent
11. Chat
12. Community
13. MyFarm
14. Market/Mandi
15. Weather
16. Schemes
17. AI Chat
18. Crop Scan
19. Voice
20. Seller App
21. Admin
22. Notifications
23. Uploads
24. Background jobs
25. Infrastructure
```

For each feature:

```text
audit API
audit DB
audit Redis
audit algorithms
audit mobile UI
audit security
optimize
test
measure
document
continue
```

---

# 72. SAFE AUTONOMY RULE

When operating under this directive:

Do not ask for approval for ordinary safe refactors such as:

```text
adding tests
adding bounded caches
fixing obvious N+1 queries
adding safe missing index migration
improving query projection
removing dead repeated computation
adding metrics
improving internal code organization
```

provided behavior remains compatible.

Pause and clearly report before:

```text
destructive DB migration
dropping production columns/tables
changing payment semantics
changing financial arithmetic
weakening auth/security
irreversible data transformation
introducing a new paid infrastructure dependency
changing legal/retention policy
```

---

# 73. NO BLIND "OPTIMIZATION"

Never change:

```text
for loop
```

to something else simply because it looks slower.

Never replace:

```text
Array
```

with:

```text
Set
```

without checking actual access pattern.

Never add:

```text
Redis
```

to an endpoint just because Redis exists.

Never add:

```text
index
```

without query-plan reasoning.

Never make an API async without understanding blocking dependencies.

Optimization must solve a measured or structurally clear problem.

---

# 74. DEFINITION OF DONE FOR 100K-USER READINESS

The project should eventually satisfy:

```text
bounded process memory
no known unbounded request-key Maps
efficient auth path
DB connection pooler deployed/prepared
hot DB queries index-served
no major N+1 paths
cursor pagination for large feeds
controlled DB table growth
direct media upload for large media
minimal large Base64 JSON paths
scoped realtime fan-out
working push notifications
bounded chat fallback polling
background heavy work
observable queue workers
AI spend concurrency safe
idempotent critical operations
safe payment concurrency
safe stock concurrency
resource-aware mobile UI
root CI actually executes
safe DB migrations
load-test evidence
p95/p99 monitoring
```

---

# 75. TARGET ARCHITECTURE

Do not force this architecture if measurements contradict it, but this is the preferred direction:

```text
                 Farmer App
                 Seller App
                 Admin SPA
                      │
                      ▼
                CDN / Edge
                      │
                      ▼
                Load Balancer
                      │
          ┌───────────┴───────────┐
          │                       │
     Express API #1          Express API #N
          │                       │
          └───────────┬───────────┘
                      │
        ┌─────────────┼──────────────────┐
        │             │                  │
        ▼             ▼                  ▼
      Redis        PgBouncer        Cloudinary /
                      │             Object Storage
                      ▼
                  PostgreSQL
                      ▲
                      │
            ┌─────────┴───────────┐
            │                     │
       Background              FastAPI
         Workers                  │
            │                     ▼
            │                  Celery
            │                     │
            └─────────────────────▼
                                Worker
                                  │
                                  ▼
                            AI Providers
```

---

# 76. STARTING INSTRUCTION

When Claude Code receives this repository:

## Phase A

Read:

```text
read.md
architecture docs
package manifests
Prisma schema
backend entry points
FastAPI entry points
mobile API clients
queue code
Redis code
deployment config
tests
```

## Phase B

Create:

```text
docs/performance/BASELINE.md
docs/performance/FINDINGS.md
docs/performance/PROGRESS.md
docs/performance/COMPLETED.md
```

## Phase C

Create ranked findings.

## Phase D

Start with the highest-confidence P0 item.

## Phase E

Implement it.

## Phase F

Test it.

## Phase G

Measure it.

## Phase H

Document it.

## Phase I

Automatically continue to the next highest-priority safe item.

Repeat until the safe backlog is exhausted.

---

# 77. FINAL INSTRUCTION

You are not here merely to produce an architecture report.

You are here to **improve the actual CropSetu repository continuously and systematically**.

Think like:

```text
Principal Engineer
+
Performance Engineer
+
Database Engineer
+
SRE
+
Mobile Performance Engineer
+
Security Engineer
```

but keep solutions appropriate for a startup.

The primary optimization question for every component is:

> **How can CropSetu perform less unnecessary work while preserving correctness?**

Reduce:

```text
database round trips
rows scanned
network calls
payload size
memory copies
large allocations
global fan-out
polling
blocking work
AI tokens
media bandwidth
duplicate work
connection fan-out
```

Increase:

```text
cache reuse
batching
index efficiency
bounded memory
asynchronous processing
observability
fault isolation
test coverage
measured confidence
```

Make every change **small, reversible, testable, measurable, and documented**.

Then continue to the next feature.

---

# 78. CLAUDE CODE SESSION BOOT COMMAND

At the beginning of every new Claude Code session, follow this instruction:

```text
Read /read.md first.

Then inspect docs/performance/PROGRESS.md.

If an optimization is IN_PROGRESS, continue it from the documented state.

If the previous item is complete, choose the next highest-priority safe TODO from FINDINGS.md.

Do not restart the architecture audit from zero unless the baseline is stale or the repository changed materially.

Implement one optimization at a time.

After implementation:
- run tests,
- verify behavior,
- update performance documentation,
- then continue to the next safe item.

Do not perform destructive production changes automatically.
```

---

# 79. CONTINUOUS IMPROVEMENT LOOP

The long-running operating loop is:

```text
┌─────────────────────────┐
│ Read current progress   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Pick highest priority   │
│ unblocked improvement   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Understand full feature │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Measure current state   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Implement minimal fix   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Tests + profiling       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Update documentation    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Mark complete           │
└────────────┬────────────┘
             │
             ▼
        NEXT FEATURE
             │
             └───────────────► repeat
```

Continue this loop until all safe P0/P1 work is complete.

Then proceed through P2 improvements based on measured telemetry.

---

**End of root engineering directive.**
