# CropSetu Admin Panel — Architecture & Code Reference

A complete walkthrough of the CropSetu admin system: the **React SPA** under [`admin/`](../admin/)
and the **ADMIN-gated, audited Express API** under
[`backend/src/routes/admin/`](../backend/src/routes/admin/). It is reference
documentation for anyone operating, extending, or auditing the admin surface.

> Companion docs: [`ADMIN_DEPLOY_RAILWAY.md`](./ADMIN_DEPLOY_RAILWAY.md) (same-origin
> Railway deploy) and [`admin/README.md`](../admin/README.md) (quick start).

---

## 1. What the admin panel is

A single web SPA that operates **every domain** of CropSetu — users, KYC, marketplace,
rentals, community, AI, CMS, broadcast, trust & safety, compliance, and ops — through
one server-enforced, fully-audited API at `/api/v1/admin/*`.

Two halves:

| Half | Stack | Location |
| --- | --- | --- |
| **Frontend SPA** | React 18 + Vite 5 + TypeScript 5 + Tailwind 3 + TanStack Query 5 | [`admin/`](../admin/) |
| **Backend API** | Express + Prisma (Postgres), JWT + cookie auth | [`backend/src/routes/admin/`](../backend/src/routes/admin/) + middleware/services/utils |

The SPA is served **same-origin** at `/admin` by the backend in production, so the auth
cookies stay first-party (no CORS, no `SameSite=None`). In local dev the SPA runs on its
own Vite server (port 5180) and proxies `/api` to the backend.

---

## 2. Security model (read this first)

The single most important property of the admin system:

> **ADMIN is enforced on the server, on every route. The UI's role check is cosmetic.**

### The gate

[`backend/src/routes/admin/index.js`](../backend/src/routes/admin/index.js) composes
every admin module under one router and applies the boundary **once**:

```js
router.use(authenticate, requireAdmin);   // JWT → req.user, then role === 'ADMIN'
```

[`requireAdmin`](../backend/src/middleware/admin.js) rejects any non-ADMIN token with
**403 before any handler runs**. The mobile/web auth stack is reused unchanged: phone
OTP → JWT (access token in memory) + httpOnly refresh cookie + CSRF double-submit.

### Cross-cutting guarantees

- **PII masked by default.** Phone, bank, Aadhaar, PAN, lat/lng, and income are masked on
  every response. Plaintext is returned **only** with `?reveal=true&reason=<why>`, and that
  reveal is itself written to the audit log. See
  [`utils/adminPii.js`](../backend/src/utils/adminPii.js).
- **Every mutation is audited.** Writes call `adminAudit()` →
  [`audit.service.js`](../backend/src/services/audit.service.js), persisting an `AuditLog`
  row (actor, action, entity, before/after, reason, IP, requestId) with PII redacted.
- **Keyset pagination with bounded limits** on every list — no offset scans, no
  unbounded fetches (`?limit=` is clamped to `[1, max]`). See
  [`utils/adminList.js`](../backend/src/utils/adminList.js).
- **CSV export only serialises already-masked rows** that are on screen — PII never
  leaves the backend unencrypted.

### Admin sub-roles (design decision)

This build ships the **single existing `ADMIN` role** — every admin gets the full surface,
**no schema migration**. Granular sub-roles (`KYC_REVIEWER`, `CONTENT_MODERATOR`, …) are a
clean follow-up: add `adminScopes String[]` on `User` and gate the sub-routers in
`routes/admin/index.js`.

---

## 3. How it is wired into the backend

In [`backend/src/app.js`](../backend/src/app.js):

```js
// Static SPA (same-origin), mounted BEFORE rate-limiter/body-parser/CSRF:
//   /admin            → admin/dist/index.html (SPA shell, no-cache)
//   /admin/*          → SPA fallback (client-side routes)
// Skipped entirely if admin/dist is absent (local dev).

// API routers (order matters — specific T&S routers win, then the catch-all):
app.use(`${API}/admin/incidents`,  incidentRoutes);    // Trust & Safety
app.use(`${API}/admin/fraud`,      fraudRoutes);
app.use(`${API}/admin/moderation`, moderationRoutes);
app.use(`${API}/admin`,            featuresRoutes);     // feature flags / api-health
app.use(`${API}/admin`,            adminRoutes);        // routes/admin/index.js — the rest
```

The new `routes/admin/*` sub-paths are **disjoint** from the pre-existing T&S routers, so
nothing is shadowed. The admin SPA path (`/admin`) and the API (`/api/v1/admin`) never
overlap.

### Seeding an admin

Admins log in with phone OTP like any user — they just need the `ADMIN` role.
[`backend/prisma/seed-admin.js`](../backend/prisma/seed-admin.js) creates or promotes a
user by 10-digit phone:

```bash
npm run db:seed:admin -- 9876543210     # from backend/
```

---

## 4. Backend — shared infrastructure

Four small modules keep every route file thin and consistent.

### [`middleware/admin.js`](../backend/src/middleware/admin.js)
`requireAdmin(req,res,next)` — the one ADMIN gate. `req.user.role !== 'ADMIN'` → 403.

### [`routes/admin/_helpers.js`](../backend/src/routes/admin/_helpers.js)
- `adminAudit(req, action, entity, entityId, {before, after, metadata})` — best-effort
  `AuditLog` write (never throws; routes still `await` it so the row lands before the response).
- `listParams(req, {def, max})` — standard `{cursor, limit}` parsing.
- `revealValidators()` — the audited-reveal contract: `?reveal=true` **requires** a
  non-empty `reason` (≤500 chars) or it's a 400 — never a silent unmasked response.
- `dateRange(from, to)` — ISO dates → Prisma range (`gte`/`lte`) or null.
- `sendList(res, sendSuccess, {items, hasMore, nextCursor})` — list envelope with the
  cursor in `meta`.

### [`utils/adminList.js`](../backend/src/utils/adminList.js)
- `boundedLimit(raw, def=25, max=100)` — clamps page size to `[1, max]`.
- `keysetList(model, {where, cursor, limit, include, select})` — Prisma keyset pagination
  on `(createdAt DESC, id DESC)`. Uses the row-value seek
  `(createdAt, id) < (cursor.createdAt, cursor.id)` (written as a nested OR) so deep pages
  stay flat (no offset) while admitting arbitrary `where` filters. Fetches `limit + 1` to
  detect a further page without a `COUNT`. Cursor tokens are the same opaque base64url the
  rest of the app uses.

### [`utils/adminPii.js`](../backend/src/utils/adminPii.js)
- `revealContext(req)` — `{reveal, wants, reason}`; reveal is honoured only when **both**
  `reveal=true` and a non-empty reason are present.
- `shapeUser(user, {reveal})` — returns a **new** object: masked path drops the encrypted
  blobs entirely (`hasLocation`/`hasIncome` booleans signal presence); reveal path decrypts
  lat/lng/income via `decryptNumber`. Phone → last-4 mask unless revealed; Aadhaar shown as
  `••••-••••-1234`.
- `auditReveal(req, {entity, entityId, fields, reason})` — writes an `ADMIN_PII_REVEAL`
  audit row (who/what/why/IP).

### Services
- [`adminMetrics.service.js`](../backend/src/services/adminMetrics.service.js) —
  `getDashboardMetrics({days})` (KPI roll-ups via Prisma `aggregate`/`groupBy`),
  `getTimeseries({metric, days})` (daily `date_trunc` GROUP BY for whitelisted metrics:
  `signups | gmv | ai_tokens | ai_cost`), `apiHealthSummary(hours)` (success-rate/latency by
  source). All read-only aggregates over existing tables — no new tables.
- [`adminBroadcast.service.js`](../backend/src/services/adminBroadcast.service.js) —
  `audienceWhere`/`estimateAudience` (target by district/state/role/crop, active users only)
  and `broadcastNotification(...)` which fans a `Notification` out via
  `push.service.sendPushToUser`. **Hard cap `MAX_RECIPIENTS = 5000`**; the response's
  `capped` flag is true when the true matching count exceeds what was delivered.

---

## 5. Backend — the admin API surface

All paths below are relative to `/api/v1/admin`. Every route is behind
`authenticate + requireAdmin`. **List** = keyset-paginated (`?cursor`, bounded `?limit`,
`meta.hasMore`/`nextCursor`). **Reveal** = supports the audited PII reveal. **Audited** =
writes an `AuditLog` row on mutation.

### Dashboard — [`metrics.routes.js`](../backend/src/routes/admin/metrics.routes.js)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/metrics?days=30` | KPI snapshot: users (total/active/new, byRole, byKyc), orders + GMV (lifetime + window), bookings, AI (scans/chats/tokens/cost/reports), trust-safety counters, apiHealth. |
| GET | `/metrics/timeseries?metric=&days=` | Daily series for `signups\|gmv\|ai_tokens\|ai_cost` (unknown metric → 400). |

### Users & identity — [`users.routes.js`](../backend/src/routes/admin/users.routes.js)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users` | **List.** Search phone/name/district; filter role/kyc/isActive/isMinor. |
| GET | `/users/:id` | **Reveal.** Full profile + activity counts + recent activity. Masked PII unless `?reveal=true&reason=`; reveal is audited. |
| PATCH | `/users/:id` | **Audited.** Change role / isActive. A role change bumps `tokenVersion` (silent re-auth picks up new role). |
| POST | `/users/:id/force-logout` | **Audited.** Bump `tokenVersion` **and** delete all `RefreshToken` rows — true logout everywhere. |
| GET | `/users/:id/consents` | Effective consents + history (DPDP). |
| GET | `/users/:id/audit` | **List.** Audit trail scoped to this user. |

### KYC / sellers — [`kyc.routes.js`](../backend/src/routes/admin/kyc.routes.js)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/kyc` | **List.** Seller KYC queue, filtered by `User.kycStatus`; phones masked. |
| GET | `/kyc/:userId` | **Reveal.** Masked bank/Aadhaar/PAN + short-lived signed document URLs (Cloudinary). Every view logs `KYC_DOCS_ACCESS`; `?reveal=` decrypts and additionally audits. |
| POST | `/kyc/:userId/verify` | **Audited.** kycStatus → VERIFIED; eligible roles flip to SELLER (`tokenVersion` bumped). |
| POST | `/kyc/:userId/reject` | **Audited.** kycStatus → REJECTED + reason (3–1000 chars). |

### Marketplace — [`catalog.routes.js`](../backend/src/routes/admin/catalog.routes.js)
Exports `categoriesRouter` / `productsRouter` / `reviewsRouter`.
| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/categories` · `/categories` | List all (no pagination) / create (multilingual name in 9 langs, icon/color/sortOrder). Duplicate name → 409. |
| PATCH / DELETE | `/categories/:id` | Update / delete (**blocked 409 if it still has products**). |
| GET | `/products` | **List.** Filter categoryId/sellerId/isActive/isFeatured; search name/description. |
| GET | `/products/:id` | Detail + review/orderItem counts. |
| PATCH | `/products/:id` | **Audited.** isActive / isFeatured / stock (0–1e6) / price (≥0). |
| DELETE | `/products/:id` | **Audited.** Soft-delete (isActive=false) — hard delete blocked by FK on order items. |
| GET | `/reviews` | **List.** Filter productId/userId. |
| DELETE | `/reviews/:id` | **Audited.** Abuse removal. |

### Orders — [`orders.routes.js`](../backend/src/routes/admin/orders.routes.js)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/orders` | **List.** Filter status/paymentStatus/userId + date range. |
| GET | `/orders/:id` | Full order + items + buyer; delivery-address phone masked. |
| PATCH | `/orders/:id` | **Audited.** Change status / paymentStatus; `refund=true` sets status=REFUNDED + paymentStatus=refunded atomically. |

### Rentals & trade — [`listings.routes.js`](../backend/src/routes/admin/listings.routes.js)
Exports `animalsRouter` / `machineryRouter` / `labourRouter` / `bookingsRouter`. Status enum
`ACTIVE | SOLD | RENTED | INACTIVE`.
| Method | Path | Notes |
| --- | --- | --- |
| GET / PATCH | `/animals` · `/animals/:id` | **List** (search animal/breed/location) / **audited** update `verified` + `status`. |
| GET / PATCH | `/machinery` · `/machinery/:id` | **List** / **audited** update `available` + `status`. |
| GET / PATCH | `/labour` · `/labour/:id` | **List** / **audited** update `available` + `status`. |
| GET | `/bookings` | **List.** Filter status / type (`machinery`/`labour`) / userId. |

### Community — [`community.routes.js`](../backend/src/routes/admin/community.routes.js)
Exports `postsRouter` / `commentsRouter` / `groupsRouter`.
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/posts` | **List.** Search title/description; `?includeDeleted=true` shows soft-deleted. |
| PATCH | `/posts/:id` | **Audited.** Pin/unpin (`isPinned`) or `restore=true` (clears `deletedAt`). |
| DELETE | `/posts/:id` | **Audited.** Soft-delete (set `deletedAt`). |
| GET | `/comments` | **List.** Filter postId/authorId. |
| DELETE | `/comments/:id` | **Audited.** Hard delete + atomic `post.commentCount` decrement. |
| GET | `/groups` | **List.** Search name; includes creator + member count. |
| PATCH | `/groups/:id` | **Audited.** isPublic / name / description (HTML-stripped). |

### AI ops — [`ai.routes.js`](../backend/src/routes/admin/ai.routes.js)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/ai/usage?days=&limit=` | Per-user token/cost roll-up (top spenders). |
| GET | `/ai/credits/:userId` | Credit ledger summary: balance, tier, allowance, lifetime earned/spent, recent transactions. |
| POST | `/ai/credits/:userId/adjust` | **Audited.** Manual grant/deduct `{amount, reason}`. `amount` non-zero, range ±100,000; **reason required** (3–500). |
| GET | `/ai/feedback` | **List.** Disease-feedback retrain queue; filter usedForRetrain/farmerAgreed. |
| PATCH | `/ai/feedback/:id` | **Audited.** Mark/unmark `usedForRetrain`. |
| GET | `/ai/reports?days=` | Crop-disease report analytics: total, byRisk, byCrop (top 15), recent 20. |

### CMS — [`cms.routes.js`](../backend/src/routes/admin/cms.routes.js)
Exports `schemesRouter` / `mspRouter` / `cropMasterRouter` / `pestAlertsRouter` / `mandiRouter`.
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST/PATCH/DELETE | `/schemes` (+`/:id`) | Govt schemes (multilingual). `schemeCode` unique (dup → 409). DELETE = soft (isActive=false, keeps `SchemeApplication`). |
| GET/POST/PATCH/DELETE | `/msp` (+`/:id`) | MSP rates. `commodity+season+year` unique. DELETE = hard. |
| GET/POST/PATCH/DELETE | `/crop-master` (+`/:id`) | Crop reference data (agronomic fields, Kc coefficients). Name unique. DELETE = hard. |
| GET/POST/PATCH | `/pest-alerts` (+`/:id`) | Pest alerts by state/district. `broadcast=true` → fans a notification to the alert's state (± districts). |
| GET/POST | `/mandi/sync` | Sync-job status (recent 25) / **audited** manual trigger — records a `PriceDataSync` row (`status: queued`). *Wiring to the data.gov.in worker is a follow-up.* |

### Broadcast — [`broadcast.routes.js`](../backend/src/routes/admin/broadcast.routes.js)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notifications/preview` | Estimate audience for a filter (district/state/role/crop) — dry run, no send. |
| POST | `/notifications` | **Audited.** Send to the targeted audience (title 2–120, body 2–1000). Capped at 5000 recipients; response returns `{estimated, sent, capped}`. |

### Ops — [`ops.routes.js`](../backend/src/routes/admin/ops.routes.js)
Exports `flagsRouter` / `healthRouter` / `queuesRouter`.
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/flags` | List feature flags. |
| PATCH | `/flags/:key` | **Audited.** Toggle `isEnabled` (+ `disabledReason` when disabling). Upserts and calls `invalidateCache(key)`. |
| GET | `/health?hours=24` | External-API health summary + recent logs. |
| GET | `/queues` | BullMQ job counts per queue (falls back gracefully when the queue layer is down). |

### Compliance (DPDP) — [`compliance.routes.js`](../backend/src/routes/admin/compliance.routes.js)
Exports `consentsRouter` / `erasureRouter` / `auditRouter`.
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/consents` | **List.** Filter purpose/userId/granted. Append-only proof trail (IP/UA). |
| GET | `/erasure-requests` | **List.** Processed erasures (reads `AuditLog` where action=`ACCOUNT_ERASURE`). |
| POST | `/erasure-requests/:userId/process` | **Audited, irreversible.** DPDP §8 erasure; reason required (3–500); attempts media deletion. |
| GET | `/audit` | **List, read-only.** Forensic viewer; filter action/entity/entityId/userId + date range. |

### Pre-existing Trust & Safety routers (mounted separately in `app.js`)
The SPA's Trust & Safety pages call these (under `/api/v1/admin/...`, outside `routes/admin/`):
- `/moderation`, `/moderation/:flagId`, `POST /moderation/:flagId/resolve` — content moderation queue.
- `/fraud/device-clusters` — device-fingerprint multi-account clusters.
- `/incidents` (+ `/:id`, `POST /:id/updates`, `POST /:id/notify`) — security incidents with the DPDP breach-notification SLA.

---

## 6. Frontend — the SPA

### Tech stack & build ([`admin/package.json`](../admin/package.json), [`vite.config.ts`](../admin/vite.config.ts))
- **React 18.3** + **React Router 6.28**, **Vite 5.4**, **TypeScript 5.7**, **Tailwind 3.4**.
- **TanStack Query 5.62** (server state + keyset pagination), **Axios 1.7**.
- **react-hook-form 7.54** + **@hookform/resolvers** + **Zod 3.24** (CMS forms).
- **Recharts 2.15** (dashboard/report charts), **lucide-react** (icons), **clsx**.
- Vite: `base: '/admin/'`, dev server on **port 5180**, dev proxy `/api → VITE_API_PROXY`
  (default `http://localhost:3000`) to keep cookies same-origin.
- Scripts: `dev`, `build` (`tsc -b && vite build → admin/dist`), `typecheck`, `preview`.
- Env: `VITE_API_URL` (default `/api/v1`), `VITE_API_PROXY` (dev), `VITE_ENV_NAME`
  (top-bar badge).

### Bootstrap & routing
- [`main.tsx`](../admin/src/main.tsx) nests providers: `QueryClientProvider → ToastProvider
  → BrowserRouter (basename="/admin") → AuthProvider → App`.
- [`App.tsx`](../admin/src/App.tsx) — route table. `/login` is public; everything else
  renders inside `AppShell` and requires an authed ADMIN session, else redirect to `/login`.
- [`nav.ts`](../admin/src/nav.ts) — the left-nav structure (11 groups) that also drives the
  ⌘K palette. Groups: Overview · Users & Identity · Marketplace · Rentals & Trade ·
  Community · AI Operations · Content (CMS) · Broadcast · Trust & Safety · Compliance (DPDP)
  · Ops.

### `lib/` — core modules
| Module | Responsibility |
| --- | --- |
| [`api.ts`](../admin/src/lib/api.ts) | Axios client: `baseURL=VITE_API_URL`, `withCredentials`, `X-Auth-Transport: cookie`. Request interceptor adds `Authorization: Bearer` (in-memory token) + `X-CSRF-Token` on mutations. Response interceptor does **deduped silent refresh** on 401 (one refresh promise, retries the original), and on hard failure notifies `onSessionLost`. Exposes `apiGet/Post/Patch/Delete`, `setAccessToken`, `decodeJwt`, `errorMessage`. |
| [`auth.tsx`](../admin/src/lib/auth.tsx) | Auth context: `status` (`loading\|unauthed\|authed`), `user`, `notAdmin`. `sendOtp`/`verifyOtp` login, session recovery via refresh cookie on load (extracts role from JWT, rejects non-ADMIN), **20-min idle-timeout auto-logout**, and the hard session-loss listener. |
| [`queryClient.ts`](../admin/src/lib/queryClient.ts) | TanStack Query defaults: `retry: 1`, no refetch-on-focus, `staleTime: 30s`. |
| [`useKeyset.ts`](../admin/src/lib/useKeyset.ts) | Cursor-stack pagination hook → `{items, meta, next, prev, canNext, canPrev, page, isLoading, …}`; keeps previous data so the UI doesn't flash; resets when url/params change. |
| [`hooks.ts`](../admin/src/lib/hooks.ts) | `useDebounced(value, 350)` and `useInvalidateList()` (invalidate all pages of a keyset list after a mutation). |
| [`csv.ts`](../admin/src/lib/csv.ts) | `downloadCsv(filename, headers, rows)` — escapes + Blob download of the **already-masked** on-screen rows. |
| [`format.ts`](../admin/src/lib/format.ts) | en-IN formatters: dates, relative time, `formatINR`, `formatNumber`, `formatUsd`, `titleCase`. |
| [`toast.tsx`](../admin/src/lib/toast.tsx) | Global toast provider (`success/error/info`, auto-dismiss). |

### `components/` — shared UI
| Component | Role |
| --- | --- |
| [`AppShell.tsx`](../admin/src/components/AppShell.tsx) | Layout: grouped left sidebar (`nav.ts`), top bar with **env badge** (local/staging/prod, tone-coded), ⌘K button, admin name/phone, logout; mobile slide-in sidebar. |
| [`CommandPalette.tsx`](../admin/src/components/CommandPalette.tsx) | ⌘K / Ctrl-K quick-nav over all nav items (label + keywords), arrow/Enter/Esc. |
| [`DataTable.tsx`](../admin/src/components/DataTable.tsx) | Server-paginated table: typed columns (render + csv fns), prev/next, loading/error/empty states, optional CSV export of the current page. |
| [`Modal.tsx`](../admin/src/components/Modal.tsx) | Accessible centered modal + right-side `Drawer` (Esc/backdrop close, focus handling). |
| [`confirm.tsx`](../admin/src/components/confirm.tsx) | `useConfirm()` promise dialog with optional **required reason** and **type-to-confirm** phrase; `danger` tone. Backs every destructive action. |
| [`filters.tsx`](../admin/src/components/filters.tsx) | `Toolbar`, `SearchInput` (debounced 350ms), `FilterSelect`, `DescList`. |
| [`ui.tsx`](../admin/src/components/ui.tsx) | Primitives: `Button` (primary/secondary/danger/ghost + loading), `Card`, `Spinner`, `PageHeader`, `EmptyState`, `ErrorState`, `Field/Input/Textarea/Select`, `Badge`, `StatusBadge`, `BoolBadge`. |

### `pages/` — screens
| Page | What it does |
| --- | --- |
| [`Login.tsx`](../admin/src/pages/Login.tsx) | Phone-OTP login (2-step). Shows the dev OTP when the backend returns one. Surfaces the "valid but not an administrator" case. |
| [`Dashboard.tsx`](../admin/src/pages/Dashboard.tsx) | KPI cards (users/GMV/bookings/AI tokens + deep-link counters for pending moderation / open incidents / breach-SLA), 30-day Recharts trends, and external-API health grid. |
| [`Users.tsx`](../admin/src/pages/Users.tsx) | List + filters; **detail page** with masked PII, audited **Reveal** (reason), consents, audit trail, and role / deactivate / force-logout actions. |
| [`Kyc.tsx`](../admin/src/pages/Kyc.tsx) | Review queue; detail with audited doc access (signed URLs), masked bank/ID + audited reveal, verify / reject. |
| [`Catalog.tsx`](../admin/src/pages/Catalog.tsx) | Categories CRUD (multilingual modal), Products (activate/feature/stock/remove drawer), Reviews (delete). |
| [`Orders.tsx`](../admin/src/pages/Orders.tsx) | Filters + detail drawer; change status / payment status / refund. |
| [`Listings.tsx`](../admin/src/pages/Listings.tsx) | Animals / Machinery / Labour moderation (verify, availability, status) + Bookings list. |
| [`Community.tsx`](../admin/src/pages/Community.tsx) | Posts (pin / soft-delete / restore), Comments (delete), Groups (public/private). |
| [`AiOps.tsx`](../admin/src/pages/AiOps.tsx) | Usage & cost, per-user credit ledger with grant/deduct (reason), disease-feedback retrain queue, report analytics. |
| [`Cms.tsx`](../admin/src/pages/Cms.tsx) | Schemes (react-hook-form + zod), MSP, Crop Master, Pest Alerts (+ region broadcast), Mandi-sync status/trigger. |
| [`Broadcast.tsx`](../admin/src/pages/Broadcast.tsx) | Compose → estimate recipients → confirm → send. |
| [`TrustSafety.tsx`](../admin/src/pages/TrustSafety.tsx) | Moderation queue, fraud device-cluster explorer, incident manager with timeline + DPDP breach-SLA. |
| [`Compliance.tsx`](../admin/src/pages/Compliance.tsx) | Consent explorer, erasure processor (type-to-confirm), read-only audit-log viewer. |
| [`Ops.tsx`](../admin/src/pages/Ops.tsx) | Feature flags, external-API health, BullMQ queue stats (auto-refresh). |

---

## 7. Request lifecycle (end to end)

A representative mutation — **revealing a user's phone**:

1. Admin clicks *Reveal* on a user detail page → `confirm.tsx` collects a **required reason**.
2. `apiGet('/admin/users/:id', {reveal: true, reason})` → Axios attaches `Authorization:
   Bearer <in-memory token>` and (on a write) `X-CSRF-Token`.
3. Backend: `authenticate` resolves `req.user`; `requireAdmin` confirms ADMIN (else 403).
4. `revealValidators()` enforces that a reveal carries a non-empty reason (else 400).
5. The handler shapes the user with `shapeUser(user, {reveal:true})` (decrypting PII) **and**
   `await auditReveal(...)` writes an `ADMIN_PII_REVEAL` row before responding.
6. SPA renders the plaintext; the action is now permanently in the audit log, visible under
   **Compliance → Audit Log**.

---

## 8. Local dev quick start

```bash
# 1. Seed an admin (from backend/)
npm run db:seed:admin -- 9876543210

# 2. Run the admin SPA (from admin/)
cp .env.example .env
npm install
npm run dev            # http://localhost:5180/admin/  (proxies /api → backend)
```

Dev tip: with `OTP_DEV_BYPASS_ENABLED=true` (non-production, no live SMS key) the OTP
`000000` is accepted. The `000000` bypass is hard-refused under `NODE_ENV=production`.

Production deploy (same-origin on Railway) is covered in
[`ADMIN_DEPLOY_RAILWAY.md`](./ADMIN_DEPLOY_RAILWAY.md).

---

## 9. Known follow-ups

- **Admin sub-roles** — ✅ shipped in v2 (WI-2): `User.adminScopes` + `requireScope` gate
  every sub-router. See §10.
- **Mandi sync worker** — `POST /admin/mandi/sync` now attempts the FastAPI fetch (WI-9), but
  the FastAPI `/agripredict/sync/trigger` route is still missing, so it records `failed`
  cleanly until that route exists.

---

## 10. Admin panel v2 — runtime settings, RBAC, and 8 new domains (WI-1…WI-10)

A second build cycle (on `main`) added a runtime-config layer, fine-grained admin RBAC, and
eight new operational domains. All follow the §2–§4 patterns (server-enforced gate, keyset
lists, masked PII + audited reveal, audited mutations, `prisma db push` for new tables).

### RBAC scopes (WI-2)
`User.adminScopes String[]` gates each sub-router via `requireScope(scope)` in
`routes/admin/index.js`, resolved once per request by `loadAdminContext` (→ `req.admin`).
**An ADMIN with an empty `adminScopes` is treated as SUPER_ADMIN**, so existing admins keep
full access (zero migration). Manage via `/admin/team` (SUPER_ADMIN only); the SPA
cosmetically hides nav the admin lacks scope for (`lib/scopes.ts` + `GET /admin/me`).

| Scope | Sub-routers gated |
|---|---|
| `SUPER_ADMIN` | team, settings, consents, erasure-requests, audit |
| `SUPPORT` | users, orders, bookings, returns, activity |
| `KYC_REVIEWER` | kyc |
| `CMS_EDITOR` | categories, products, schemes, msp, crop-master, pest-alerts, mandi |
| `CONTENT_MODERATOR` | reviews, animals, machinery, labour, posts, comments, groups, notifications, disputes |
| `OPS` | ai, flags, health, queues, jobs, error-logs |
| `FINANCE` | sellers, payouts |

### New API surface (all behind the gate + a scope)
| Area (WI) | Key routes | New tables | Audit actions |
|---|---|---|---|
| Settings (WI-1) | `GET /settings`, `PATCH /settings/:key`, `GET /settings/env-status`, `GET /settings/budget` | `app_settings` | `ADMIN_SETTING_UPDATE` |
| Team (WI-2) | `GET /me`, `GET /team`, `POST /team/invite`, `PATCH /team/:id/scopes`, `POST /team/:id/revoke` | `User.adminScopes` | `ADMIN_TEAM_*` |
| Returns (WI-3) | `GET/PATCH /returns(/:id)`, `GET /orders/:id/timeline`, partial refund on `PATCH /orders/:id` | `return_requests` | `ADMIN_RETURN_UPDATE` |
| Finance (WI-4) | `GET /sellers/:id/ledger`, `GET/POST /payouts`, `PATCH /payouts/:id` | `seller_ledger_entries`, `payouts` | `ADMIN_PAYOUT_*`, `ADMIN_LEDGER_ADJUST` |
| Catalog I/O (WI-5) | `GET /products/export`, `POST /products/import`, `GET /inventory/alerts` | — | `ADMIN_PRODUCT_IMPORT` |
| Disputes (WI-6) | `GET /disputes(/:id)`, `POST /disputes`, `PATCH /disputes/:id` | `disputes` | `ADMIN_DISPUTE_*` |
| Impersonation (WI-7) | `POST /users/:id/impersonate` — read-only context, **no user token minted** | — | `ADMIN_IMPERSONATE` |
| Notifications (WI-8) | CRUD `/notification-templates`, `GET /notifications/history`, `templateKey` on broadcasts | `notification_templates`, `broadcast_logs` | `ADMIN_NOTIFICATION_TEMPLATE_*` |
| Ops (WI-9) | `GET /jobs/:queue`, `POST /jobs/:queue/:id/retry`, `GET /error-logs` | `error_logs` | `ADMIN_JOB_RETRY` |
| Activity 360 (WI-10) | `GET /activity`, `/activity/users/:id`, `/activity/conversations/:id` (+voice) — masked content + audited reveal | — (reads existing) | reuses `ADMIN_PII_REVEAL` |

### New SPA pages / nav groups
Settings · Team & Access · Returns · Finance · Disputes · Activity (Feed + per-user 360) ·
Templates/History (in Broadcast) · Jobs + Error Logs (in Ops) · Low-stock + Import/Export
(in Catalog) · "View as user" (on Users detail). All nav items/groups are scope-gated.

### Runtime settings (`settings.service.js` manifest — NEVER stores secrets)
AI budget cap, free daily limits, tokens-per-credit, **per-service AI model routing**
(`ai.model.chat/diagnose/treatment/soilOcr/voiceStt`), `marketplace.commissionRatePct`,
`catalog.lowStockThreshold`, `broadcast.maxRecipients`, maintenance mode.
`GET /settings/env-status` reports expected env vars **present/absent only**.

These values now **drive runtime behavior** (not just stored), via `getSetting()` reads that
are awaited, cached 60s, and fail-safe (fall back to env→manifest default if `app_settings`
is missing, so a fresh DB behaves exactly as before):
- **Limits** — `ai.freeScanDailyLimit/freeTokenDailyLimit` enforce in `checkScanLimits`;
  all three surface in `GET /ai/usage`. A stored `0`/NaN falls back (won't block everyone).
- **Credits** — `ai.tokensPerCredit` (must be `> 0`) + `ai.freeMonthlyCredits` resolve live in
  `aiCredit.service.js` settle/deduct/grant/summary; the free-grant lookup is lazy (only on
  create / monthly refill) so the per-call hot path is unchanged.
- **AI model routing** — the chosen model is forwarded per request to the AI service: chat
  (`ai.model.chat`, all 3 `/ai/chat` sites; not the vision branch), scan (`ai.model.diagnose`
  + `ai.model.treatment`, inside `params` so they survive the Celery hop), soil OCR
  (`ai.model.soilOcr`), voice STT (`ai.model.voiceStt` → Sarvam model id).

### Caveats / open follow-ups
- **AI model routing now lands end-to-end** across two branches: `feat/settings-runtime-wiring`
  (Express forwards the choice) + `feat/ai-model-routing` (FastAPI `get_feature_config`
  honours the per-request override + the multi-provider dispatch layer: Gemini/OpenAI/Claude/
  Groq). Merge/deploy both for non-Gemini models to actually route. `ai.model.alert` is **not**
  exposed — smart-alerts stay env-only (`AI_ALERT_MODEL`) by design; the ensemble fan-out
  (off by default) picks its own voters, so `ai.model.diagnose` pins only the primary pass.
- **WI-5:** `Product` stores only `nameHi`/`nameMr`; CSV round-trips all 9 lang headers but
  fills 2 (the rest live on `Category`). **WI-8:** push `failed` counts are best-effort;
  multi-language broadcasts default to `en`. **WI-4:** ledger auto-seeding from completed
  orders is a follow-up (manual `ADJUSTMENT` works today).
