# CropSetu Admin Panel

Web SPA (React + Vite + TypeScript + Tailwind + TanStack Query) for operating every
domain of CropSetu through the **ADMIN-gated, audited** `/api/v1/admin/*` API.

It reuses the platform's existing auth unchanged: **phone OTP → JWT (access in
memory) + httpOnly refresh cookie + CSRF double-submit**, with silent refresh-rotation
and an idle-timeout auto-logout. A non-ADMIN account is hard-rejected (and the server
enforces ADMIN on every route regardless of the UI).

---

## 1. Seed an ADMIN user

Admins log in with phone OTP like any user — they just need the `ADMIN` role. From
`backend/`:

```bash
npm run db:seed:admin -- 9876543210      # creates or promotes that phone to ADMIN
```

(Use the 10-digit form the OTP flow normalises to.) Then sign in at the admin app
with that number and the OTP.

> Local dev tip: the backend has an OTP dev-bypass (`OTP_DEV_BYPASS_ENABLED=true`,
> non-production, no live SMS key) where the OTP `000000` is accepted — handy for
> signing in without an SMS provider.

## 2. Configure & run the admin app

From `admin/`:

```bash
cp .env.example .env       # then edit if needed
npm install
npm run dev                # http://localhost:5180/admin/  (served under /admin)
```

> The app is served under **`/admin`** (Vite `base` + router `basename`) so the
> backend can host the production build same-origin. See
> [`docs/ADMIN_DEPLOY_RAILWAY.md`](../docs/ADMIN_DEPLOY_RAILWAY.md) for the Railway
> deploy (the backend serves `admin/dist` at `/admin` — no separate service).

### Environment variables (`admin/.env`)

| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | Base path the client calls (`${VITE_API_URL}/admin/*`, `/auth/*`). Keep relative to use the dev proxy / a same-origin reverse proxy in prod. Set to an absolute origin only if the admin app is served from a **different** origin than the API. |
| `VITE_API_PROXY` | `http://localhost:3000` | Dev only — where `vite dev` proxies `/api` to your running backend. |
| `VITE_ENV_NAME` | `local` | Shown in the top-bar environment badge (`local` / `staging` / `production`). |

In dev, Vite proxies `/api` → the backend, so the browser stays **same-origin** and
cookies + CSRF "just work" with no CORS. For production behind a reverse proxy, serve
the built `admin/dist` and proxy `/api` to the backend the same way.

## 3. Backend setup for the admin app

The admin API lives in `backend/src/routes/admin/*` and is mounted at
`/api/v1/admin` (in `backend/src/app.js`). Two things to know:

- **CORS** — only needed if the admin SPA is on a **different origin** than the API.
  Add that origin to the backend's `ALLOWED_ORIGINS` (comma-separated) in
  `backend/.env`, e.g.:

  ```env
  ALLOWED_ORIGINS=https://admin.cropsetu.app
  ```

  If you serve the admin app same-origin (recommended — dev proxy or a prod reverse
  proxy), no `ALLOWED_ORIGINS` change is required.

- The backend keeps its existing OTP + JWT + CSRF + cookie auth **unchanged**. The
  admin client sends `X-Auth-Transport: cookie`, `withCredentials`, and the
  `X-CSRF-Token` header on mutations — the same contract the mobile web build uses.

## 4. Build

```bash
npm run typecheck     # tsc, no emit
npm run build         # tsc -b && vite build  → admin/dist
npm run preview       # serve the production build locally
```

---

## What's inside

Left nav grouped by phase, ⌘K command palette, global toasts, and confirm-+-reason
dialogs for every destructive action.

- **Dashboard** — KPI cards + time-series (signups, GMV, AI tokens), API-health, and
  deep-link counters for pending moderation / open incidents / breach-SLA.
- **Users** — search + filters; detail page with **masked PII**, an audited
  **Reveal** (reason required), consents, audit trail, and role / deactivate /
  force-logout actions.
- **KYC / Sellers** — review queue, audited document access (short-lived signed
  URLs), masked bank/ID with audited reveal, verify / reject.
- **Marketplace** — categories CRUD (multilingual), products (approve / feature /
  stock / remove), reviews.
- **Orders** — filters, detail, status / payment / refund.
- **Rentals & Trade** — animals / machinery / labour moderation + bookings.
- **Community** — posts (pin / soft-delete / restore), comments, groups.
- **AI Ops** — usage & cost, per-user credit ledger with manual grant/deduct (reason
  required), disease-feedback retrain queue, report analytics.
- **CMS** — schemes (react-hook-form + zod), MSP, crop master, pest alerts (+ region
  broadcast), mandi-sync status/trigger.
- **Broadcast** — compose + audience preview (estimated recipients) + send.
- **Trust & Safety** — moderation queue, fraud device-cluster explorer, incident
  manager with timeline + DPDP breach-notification SLA.
- **Compliance** — consent explorer, erasure processor (type-to-confirm), read-only
  audit-log viewer.
- **Ops** — feature flags, external-API health, BullMQ queue stats.

### Cross-cutting guarantees

- **ADMIN enforced server-side** on every `/api/v1/admin/*` route (UI gating is
  cosmetic).
- **Every mutation is audited** (`AuditLog`), with PII redacted in before/after.
- **PII masked by default**; reveals/exports need a logged reason. CSV export only
  ever serialises the already-masked rows on screen.
- **Keyset pagination** with bounded limits on every list.

## Design decision — admin sub-roles

The spec flags an optional DB migration for admin sub-roles. This build ships the
single existing `ADMIN` role (no schema migration) — every admin has the full
surface. Granular sub-roles (e.g. `KYC_REVIEWER`, `CONTENT_MODERATOR`) are a clean
follow-up: add an `adminScopes String[]` column on `User` (or a join table) and gate
sub-routers on it in `routes/admin/index.js`. Not included here to avoid an
unrequested migration.

## Mandi sync note

`POST /admin/mandi/sync` records an audited manual trigger row in `PriceDataSync`
(`status: 'queued'`). Wiring that record to the actual data.gov.in fetch worker is a
follow-up — the endpoint + status view are in place.
