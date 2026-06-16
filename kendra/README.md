# CropSetu — Krushi Seva Kendra portal

A standalone web SPA where **only Krushi Seva Kendras** (agri-input dealers) onboard
and respond to farmers' AI crop-diagnosis reports. Separate from the mobile farmer
app (`frontend/`) and the admin panel (`admin/`); it talks to the same backend API
(`backend/`, `/api/v1`).

## Flow

1. **Sign in** — phone OTP (reuses `/api/v1/auth`). Any account can sign in; a new
   account is a `FARMER` until it registers as a Kendra.
2. **Register** (`/kendra/register`) — business details + dealer **licence**
   (number / type / issuing authority / expiry) + optional GPS + licence document
   upload. This promotes `FARMER → SELLER` (consent-gated) and sets the account to
   `kycStatus = SUBMITTED`.
3. **Pending** — an **admin verifies the licence** in the admin panel
   (`/admin` → KYC). Until then the Kendra is *not* discoverable by farmers.
4. **Approved** — the Kendra appears in farmers' nearby-Kendra search (within a
   100–200 km radius) and receives crop-diagnosis reports in its **inbox**.
5. **Respond** — the Kendra reviews a report and confirms whether it stocks the
   recommended medicine ("Yes, we have this in stock") with dosage notes. The
   farmer is notified.

## Tech

React 18 + Vite 5 + TypeScript + Tailwind + TanStack Query + React Router. Auth is
in-memory access token + httpOnly cookie refresh + CSRF double-submit (identical
transport to `admin/`).

## Local development

```bash
npm install
npm run dev          # → http://localhost:5181/kendra/  (proxies /api → :3000)
```

Set `VITE_API_PROXY` to point at a non-default backend. Build with `npm run build`
(output `dist/`); the backend serves `kendra/dist` at `/kendra` when present
(`KENDRA_DIST_DIR`). In production the root `Dockerfile` builds and embeds it.

## Backend endpoints used

- `POST /api/v1/auth/send-otp`, `POST /api/v1/auth/verify-otp`, `POST /api/v1/auth/refresh`
- `GET  /api/v1/kendra/me` — onboarding stage (UNREGISTERED / PENDING / APPROVED / REJECTED)
- `POST /api/v1/kendra/register` — submit business details + licence
- `POST /api/v1/users/me/licence-documents` — upload licence scans (private)
- `GET  /api/v1/crop-reports/seller/inbox` — received reports
- `GET  /api/v1/crop-reports/seller/inbox/:shareId` — one report
- `POST /api/v1/crop-reports/seller/inbox/:shareId/reply` — confirm availability + advise
