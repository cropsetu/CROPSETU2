# Deploying the Admin Panel on Railway (same-origin)

The admin panel is **not a separate service**. The backend serves the built admin
SPA at **`/admin`** on the same origin as the API, so the auth cookies (httpOnly
refresh + CSRF, both `SameSite=Lax`) stay first-party and login + silent refresh
work with **no CORS and no cookie weakening**.

```
https://<your-backend-domain>/api/v1/...   ← API
https://<your-backend-domain>/admin        ← admin panel (this SPA)
```

## What changed in the repo (already done)

- `admin/` — served under `/admin`: `base: '/admin/'` in [admin/vite.config.ts](../admin/vite.config.ts), `basename="/admin"` in [admin/src/main.tsx](../admin/src/main.tsx).
- `backend/src/app.js` — serves `admin/dist` at `/admin` when the folder is present (skipped in local dev, where the admin runs on its own Vite server).
- `Dockerfile` (repo root) — multi-stage: builds the admin SPA, then a backend image that serves it. `ADMIN_DIST_DIR=/app/admin/dist`.
- `railway.json` (repo root) — points the **backend** service at the Dockerfile.

## One-time Railway setup (dashboard)

The backend service must build from the **repo root** so the Docker build can see
both `admin/` and `backend/`.

1. **Backend service → Settings → Source**
   - **Root Directory:** set to `/` (repo root). *(It was `backend`; with the new root, Railway reads the repo-root `railway.json` → Dockerfile build.)*
   - The `fastapi` and `frontend` services keep their own root directories — unchanged.
2. **Backend service → Variables** — confirm/add:
   - `DATABASE_URL` (already set — the Postgres plugin).
   - `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID` — **required to receive the login OTP by SMS in production.** Without a key, the server returns the OTP in the API response instead of sending it (a dev fallback you should not rely on in prod). Note: the `000000` dev bypass is hard-refused under `NODE_ENV=production`.
   - You do **not** need `ALLOWED_ORIGINS` for the admin panel — it's same-origin.
3. **Deploy.** Railway builds the Dockerfile (admin build → backend image) and starts with `npx prisma db push --skip-generate && node src/server.js`. Healthcheck stays on `/healthz`.

## Create an admin login

Admins sign in with phone OTP like any user — they just need the `ADMIN` role.
Seed it **against the production database** (so it uses Railway's `DATABASE_URL`):

```bash
# From the repo root, with the Railway CLI linked to the project:
railway run --service <backend-service-name> npm run db:seed:admin -- 9876543210
```

(Use the 10-digit phone the OTP flow normalises to.) This runs
[backend/prisma/seed-admin.js](../backend/prisma/seed-admin.js), which creates or
promotes that phone to `ADMIN`.

## Log in

1. Open `https://<your-backend-domain>/admin`.
2. Enter the seeded phone number → you receive an OTP by SMS (MSG91).
3. Enter the OTP. The server enforces `ADMIN` on every `/api/v1/admin/*` route, so a
   non-admin is rejected with 403 regardless of the UI.

## Updating the admin panel later

Any change under `admin/` is picked up on the **backend's** next deploy — the
Dockerfile rebuilds `admin/dist` from source. No separate build/commit step, and no
committed build artifacts (`admin/dist` is git-ignored).

## Troubleshooting

- **`/admin` returns the API 404 JSON** → the backend image didn't include
  `admin/dist`. Confirm the backend service **Root Directory is `/`** (so the
  Dockerfile build can reach `admin/`), and that the build logs show the admin
  `vite build` stage running.
- **Login works, then logs out after ~15 min** → that's the cross-site cookie
  symptom and should **not** happen here (same-origin). If it does, you're hitting
  the API on a *different* host than the page — verify the admin is opened at
  `…/admin` on the backend domain, not a separate URL, and that
  `VITE_API_URL` was `/api/v1` at build time (it's hard-set in the Dockerfile).
- **No OTP arrives** → `MSG91_AUTH_KEY` isn't set on the backend service.
