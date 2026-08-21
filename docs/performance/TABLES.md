# Audit Tables

The five tables `claude.md` asks to be maintained: §14 (query audit), §66 (data
structures), §67 (indexes), §68 (API cost), §69 (resources).

**Every number here was measured**, on a local Postgres with the row counts
stated. Nothing is estimated from reading code — where a figure is derived
rather than measured it says so. There is still **no production telemetry**, so
none of this is a claim about production behaviour; it is a claim about the
query plans and code paths, at the volumes named.

Seeded volumes used: 100,000 comments · 80,000 posts · 15,000 chat messages ·
320 consent rows for one account · 6-variant/3-seller product.

---

## §14 — Query audit (endpoints carrying load)

| Endpoint | Queries | Index-served | Pagination | Was | Now |
|---|---:|---|---|---|---|
| `GET /animals/chats/my` | 6 | partly | `take` | last-message read **all** messages of all listed chats; unread count scanned the whole table | LATERAL top-1 per chat + scoped aggregate |
| `GET /agristore/products/:id/offers` | 2 + 1 | yes | none | 1 offer query **per variant** | one query for all variants |
| `GET /consent` | 1 | yes | none | every consent row ever written, reduced in JS | `DISTINCT ON (purpose)` |
| `GET /admin/metrics` | 16 → 0 warm | n/a | n/a | 16 aggregates every refresh | 30 s cache |
| `GET /calendar/:id` | 1 + N | yes | none | one UPDATE per overdue task, in a loop, on a GET | one `updateMany` |
| `GET /community/posts` | 2 | **yes (new)** | OFFSET | seq scan + top-N sort of the whole live set | index scan, no sort |
| post detail → `replies` | 1 | **yes (new)** | none | seq scan of the whole comments table | bitmap index scan |
| authenticated request (all) | 1 → ~0 | PK | n/a | `SELECT tokenVersion, isActive` every request | 15 s cache, 50 requests → 1 read |

---

## §66 — Data structure audit

| File | Structure | Operation | Complexity | Problem | Action | P |
|---|---|---|---|---|---|---|
| `animaltrade.routes.js` | Prisma `take: 1` include | last message per chat | O(all messages of listed chats) | no `LIMIT` emitted; sliced in JS | LATERAL, O(page) | **done** |
| `animaltrade.routes.js` | `_count` include | unread per chat | O(all unread platform-wide) | subquery uncorrelated to the page | scoped `groupBy` | **done** |
| `consent.service.js` | array reduce | latest per purpose | O(rows ever written) | append-only table read in full | `DISTINCT ON` | **done** |
| `calendar.routes.js` | `for` + `await` | overdue sync | O(tasks) round trips | N+1 on a read path | `updateMany` + `Set` | **done** |
| `adminBroadcast.service.js` | `Promise.allSettled` | fan-out | O(recipients) concurrent | 5,000 at once, unbounded | `mapLimit(25)` | **done** |
| `jobQueue.js` | inline fail-open | Redis outage | unbounded concurrency | outage → API outage | ceiling + shed | **done** |
| `authCache` / `rateLimit` | `BoundedMap` | per-request | O(maxSize) | — | bounded already | ok |
| `i18n/translations.js` | 10 eager imports | cold start | O(all languages) | 692 KB for 6 unused languages | lazy getters | **done** |
| `i18n/lang/_backfill.js` | one eager module | cold start | O(10 langs × 612 keys) | 676 KB, still eager | needs generator split | **open** |
| `stockReservation.service.js` | `for` + `await` | expiry sweep | O(batch) | leader-locked cron; txns must stay independent | left alone | n/a |
| `catalogQc.routes.js` | `for` + `await` | admin merge | O(variants) | bounded by a product's variants | left alone | n/a |
| `catalogMatch.service.js` | `for` + `await` | merge chain | ≤5 hops | capped, normally 1 | left alone | n/a |

---

## §67 — Index table

| Table | Query shape | Existing | Plan before | Change | Status |
|---|---|---|---|---|---|
| `comments` | `WHERE parentId IN (…) ORDER BY createdAt ASC` | postId, (postId,createdAt), authorId | **Seq Scan** 5,109 buf / 8.31 ms | **ADD** `(parentId, createdAt)` → 346 buf / 0.79 ms | **done** |
| `posts` | `WHERE deletedAt IS NULL ORDER BY isPinned DESC, createdAt DESC` | authorId, category, district, createdAt, deletedAt, 2 GIN | **Seq Scan + sort** 8,001 buf / 13.07 ms | **ADD** `(isPinned DESC, createdAt DESC)` → 344 buf / 0.14 ms, no sort | **done** |
| `posts` | as above | — | — | partial `WHERE deletedAt IS NULL` measures better (27 buf / 0.02 ms) but Prisma cannot declare it and `db push` would drop it | **rejected** |
| `chats` | `WHERE buyerId=$1 OR sellerId=$1 ORDER BY updatedAt DESC` | sellerId, buyerId | sorts one user's own chats — tens of rows | **rejected**: `updatedAt` is bumped on every message, so two composites would be rewritten on the hottest write in chat, to sort tens of rows | **rejected** |
| `chat_messages` | last message per chat | chatId, (chatId,createdAt), (chatId,createdAt DESC,id DESC) | — | already served the LATERAL seek | ok |
| `products` | `ORDER BY viewCount DESC` | none names viewCount | — | nothing increments `viewCount`; no client sends `?sort=popularity` | **drop the sort, not add an index** |
| `reviews` | `WHERE userId=$1 ORDER BY createdAt DESC LIMIT N` | userId, (userId,orderItemId) unique, productId, sellerId | Bitmap Index Scan on `reviews_userId_idx`, **0.071 ms** | dropping `@@index([userId])` → planner uses the composite's leading column, **0.069 ms**, same plan, +1 buffer | **DROP-CANDIDATE**, not dropped |
| any | redundant / prefix-subsumed | ~40 of 282 candidates | — | **NOT dropped** — §18 requires `pg_stat_user_indexes` from production, which this environment does not have | blocked |

The `reviews` row is the one prefix-subsumed index proven rather than suspected:
measured on a 200k-row replica of the shape, 5,000 distinct users. Its stated
justification in `schema.prisma` cited a `[userId, productId]` unique that does
not exist — the real one is `[userId, orderItemId]`, whose leading column
already covers the lookup.

It stays anyway. §18 says not to drop a production index on a structural
argument alone, and the win is small in the direction that matters: `reviews` is
written once per order item, so this is not the write amplification §18 is
aimed at. The comment now carries the plan output so the call can be made on
production statistics instead of on a claim about the schema that was wrong.

---

## §68 — API cost profile

Every authenticated row previously included one `users` read; that is now a
cache hit in the common case.

| Endpoint | DB | Redis | Payload | Pagination | Cached | Remaining issue |
|---|---:|---:|---|---|---|---|
| `GET /animals/chats/my` | 6 | 4 | ~14 KB / 30 | `take` | no | fine |
| `GET /agristore/products/:id/offers` | 3 | 1 | all offers | none | no | fine |
| `GET /agristore/products/:id` | 9 | 4 | ~12–20 KB | reviews `take:10` | buy box, 1 entry/product | — |
| `GET /agristore/cart` | 13 | 4–6 | ~5 KB/line | none | no | `/cart/count` still the right fix for the badge |
| `GET /users/me` | **3** | 4 | ~2–3 KB | n/a | no | **refuted** — Prisma folds the 8 `_count`s into one statement; 5 buffers, `Heap Fetches: 0` |
| `POST /agristore/orders/confirm` | 25–35 | 6+ | ~2–4 KB | n/a | no | correct by design; must not be weakened |
| `GET /admin/metrics` | 16 cold / **0 warm** | 4 | ~2 KB | n/a | **30 s** | — |
| `GET /consent` | 1 | 1 | bounded by purposes | n/a | no | — |
| `GET /ai/scan/job/:id` | 1/poll | 4/poll | ~150 B | n/a | no | FastAPI side is 5 **blocking** Redis RTs per poll (§13 open) |

---

## §69 — Resource table

| Component | CPU | RAM | DB | Redis | Network | External cost |
|---|---|---|---|---|---|---|
| Express replica | HTTP + JSON; no CPU-bound work on the loop | bounded caches only (auth ≤13 MB ceiling, rate-limit 50k LRU) | **12** connections, pinned | 3 clients (main, adapter pair, BullMQ) | gzip on | Cloudinary (per-user quota now) |
| Scheduler replica | 12 cron schedules | — | shares the 12 | leader locks | — | fans ~50 requests to FastAPI on boot seed |
| BullMQ worker | notification delivery | — | 5 concurrent | 1 | Expo push | Expo (free) |
| FastAPI web | AI orchestration | image buffers per scan | asyncpg 2–10 | **6 sync clients** — blocking in async handlers (§13 open) | 12 MB body cap | Gemini / Sarvam / Anthropic / OpenAI / Groq |
| Celery worker | the AI pipeline | 4–5 image copies per scan (§22 open) | **one pool, one loop** per process | shares the 6 | — | metered by the Express credit ledger |
| PostgreSQL | — | — | max_connections 100; ~72 available to Express → 6 replicas at 12 | — | — | — |
| Redis | — | correctness-critical state **and** disposable cache share one instance | — | — | — | — |

**Ceiling:** ~6 Express replicas before PgBouncer is required. `db push` on boot
was removed, so transaction pooling is now unblocked.

---

## §21 — Offset pagination: audited, and deliberately not converted

25 `skip: (page-1)*limit` sites remain. **None of them was converted, and the
measurements are why.**

Keyset is already applied where lists are genuinely deep: `utils/keyset.js` +
`adminList.js` back **20 admin routers and AgriStore**.

What the remaining sites are:

- **Per-user lists** (my bookings, my scans, my saved posts, my chats) — bounded
  by one person's activity. Measured on the feed index: `OFFSET 2000` costs
  **0.32 ms**. A farmer does not page past their own few hundred rows.
- **The community feed** — the only platform-wide unbounded one. With the index
  added in §67 it is **0.013 ms at page 1** and 3.1 ms at `OFFSET 20,000`.
- **The admin QC queue** — a queue, drained as it is reviewed, so page 1 is
  where the work is.

And the conversion is not free. A naive keyset on the feed measured **worse**:

| | buffers | exec |
|---|---:|---:|
| `OFFSET 60000` | 3,370 | 8.97 ms |
| keyset at the same depth | 5,832 | **16.16 ms** |

Because the feed sorts `isPinned DESC, createdAt DESC` — a **mixed-direction,
multi-column** sort. A row-value comparison cannot seek an index in that shape
(and `id` is not in the index to complete the tuple), so it degenerates to a
scan. `utils/keyset.js` documents this exact trap for the single-column case.

Converting these would be churn that makes one of them slower. Revisit if a
Community screen ships in the farmer app and deep paging becomes real.
