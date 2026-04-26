# Production-Readiness Review — Cropsetu (Shared / Pre-flight)

Scope: cross-cutting concerns that affect both backend services and the
mobile app. Three remaining service-specific reports follow:
[backend-express.md](backend-express.md), [fastapi.md](fastapi.md),
[frontend-rn.md](frontend-rn.md).

## Verdict

**DO NOT SHIP.** The single most important reason: the FastAPI service
on disk at `Cropsetu/fastapi/` is untracked by any git repo, while the
backend repo's `AI_CROP_DISESE_DETECTION/` (the prior location) is
shown as deleted in the working tree but still committed on the remote
that Railway deploys. Local edits to `fastapi/` are not reaching
production, production is running stale code, and one wrong
`git push` will delete the deployed FastAPI service from the Railway
build context. That is a source-control hazard that gates everything
else here.

## Top 5 risks at 100 concurrent users

1. **FastAPI source-of-truth divergence.** `Cropsetu/fastapi/` is
   orphaned; production keeps shipping the old `AI_CROP_DISESE_DETECTION/`
   code from `cropsetu-backend@origin/main`. Any local change you have
   made to `fastapi/` since the move is not in production, and a
   well-meaning commit of the working-tree deletion will delete the
   prod service.
2. **OTP plaintext in DB.** `OtpSession.otp` is a plain `String`
   (schema.prisma:150). A read-only DB leak exposes every active OTP
   for its 10-minute TTL — attacker walks straight past phone-number
   ownership.
3. **Health check is a lie.** `GET /health` (app.js:133) returns 200
   even with DB and Redis offline. Railway keeps the dead instance in
   rotation and routes traffic to a process that can only return 5xx.
4. **Two backends sharing one Postgres with no connection budget.**
   FastAPI pool (`min=2, max=10`, db_pool.py:24) plus Prisma's default
   pool (`num_cpus*2 + 1`) plus per-Railway-instance multiplier — there
   is no documented total. At 100 concurrent users with cron syncs
   firing in parallel (server.js:118), connection exhaustion is the
   most likely failure mode before CPU is.
5. **All 92 DateTime columns are `TIMESTAMP` without time zone.**
   No `@db.Timestamptz` anywhere in the schema. Daily-sync cron
   schedules cross UTC/IST boundaries (server.js:126), payments and
   bookings carry user-local times — this is a backlog of subtle bugs
   waiting to compound.

---

## Secrets rotation runbook

Verified: **`.env` files are NOT committed.** Both `.gitignore` files
correctly exclude them and `git log --all --full-history -- .env`
returns no commits in either repo. The Explore agent's claim of
"committed `.env` with live API keys" was wrong.

What remains true and urgent:

- `backend/.env:18` contains `JWT_SECRET=
  "farmeasy-dev-secret-do-not-use-in-production-replace-before-deploy"`.
  This is 64 characters long, so the env.js length guard (env.js:20)
  passes silently. If this value was ever copied into a Railway
  variable by accident, every JWT issued is forgeable. **Verify the
  Railway value is different and rotate it on a schedule regardless.**
- Live keys exist on disk (Anthropic, Groq, Gemini, data.gov.in,
  Cloudinary, Sarvam, FIELD_ENCRYPTION_KEY). They have not leaked via
  git. Risk surface is local: backups, IDE indexers, screen-shares,
  unencrypted SSDs. Treat them as still-valid but rotate any that the
  user does not strictly need active.
- `FIELD_ENCRYPTION_KEY` in `backend/.env:47` — if Railway prod uses
  the same value as this dev key, an attacker who reads the dev
  machine can decrypt prod PII. Generate a separate prod key with
  `openssl rand -hex 32` and confirm it is not equal to the dev value.

Rotation order (rotate first what is most damaging if abused):

1. Anthropic + Groq + Gemini (financial impact: cost runaway).
2. JWT_SECRET — invalidates all sessions; coordinate with a forced
   logout / refresh wipe.
3. FIELD_ENCRYPTION_KEY — requires re-encrypting all stored
   ciphertext or accepting a dual-key migration window
   (encrypt.js:55-59 already pass-throughs unrecognized formats —
   reuse that for the migration).
4. Cloudinary + Sarvam + data.gov.in.

---

## Findings

### 🔴 BLOCKERS — must fix before any production traffic

**[S-01] FastAPI service is orphaned from version control** —
`Cropsetu/fastapi/` (whole directory)

- Problem: `Cropsetu/fastapi/` is not inside any git repo
  (verified: `test -d .git` returns false at that level, and neither
  `cropsetu-backend` nor `cropsetu-frontend` repos contain it). Both
  parent repos show every file under `AI_CROP_DISESE_DETECTION/` as
  `D` in `git status` (uncommitted deletions). The remote on
  `github.com/cropsetu/cropsetu-backend` still contains the old code.
- Impact at 100 users: production is running whatever
  `AI_CROP_DISESE_DETECTION/` looked like at the last backend deploy.
  Any fix you have written into `Cropsetu/fastapi/` since (rate
  limits, AI timeouts, prompt changes) is not in production. Worse,
  a single `git add -A && git commit && git push` on backend
  deletes the FastAPI service from the deploy source, and Railway's
  next build of `cropsetu-ai` fails with "no main.py".
- Fix: pick one of:

```bash
# Option A — adopt fastapi/ into its own repo (recommended).
cd Cropsetu/fastapi
git init -b main
# add a .gitignore (.venv/, __pycache__/, *.pyc, .env)
git add .
git commit -m "feat: initial commit of fastapi service"
gh repo create cropsetu/cropsetu-ai --private --source=. --push
# Update Railway: point cropsetu-ai service at the new repo,
# delete AI_CROP_DISESE_DETECTION from backend repo only AFTER
# the new service builds successfully on the new source.

# Option B — move fastapi/ back inside backend/ as a subdir.
# Restore the deleted files in backend, then sync fastapi/ over them:
cd Cropsetu/backend
git checkout -- AI_CROP_DISESE_DETECTION/   # restore from index
rsync -av --delete ../fastapi/ AI_CROP_DISESE_DETECTION/
git add AI_CROP_DISESE_DETECTION/ && git commit -m "sync fastapi"
# Then delete the orphan top-level fastapi/.
```

Until this is resolved, do not touch `fastapi/` — every edit
widens the gap.

---

**[S-02] WITHDRAWN — OTPs are in fact bcrypt-hashed**

- I flagged this from the schema column name (`otp String`). After
  reading the service layer (`backend/src/services/otp.service.js:24`)
  the value stored is `await bcrypt.hash(otp, 10)` — not plaintext.
  Verification at line 71 uses `bcrypt.compare`. The schema's
  unhashed-looking column name was misleading; the implementation is
  correct.
- Residual nit (downgrade to LOW): bcrypt(rounds=10) is a heavy
  KDF for an ephemeral 6-digit code that already has 5-attempt and
  10-minute limits. HMAC-SHA256 with a per-deployment pepper would
  be ~1000× faster on the request path with equivalent security. See
  Express report [E-10] for the optional swap.

---

**[S-03] Every timestamp column is TIMESTAMP without time zone** —
`backend/prisma/schema.prisma` (92 occurrences)

- Problem: `grep -c "Timestamptz" prisma/schema.prisma` returns 0.
  Prisma's default `DateTime` maps to `TIMESTAMP(3)` in Postgres,
  which has no time-zone information. Two services write rows from
  potentially different process timezones (Railway containers vary;
  `cron.schedule('30 0 * * *', ...)` in server.js:126 is interpreted
  as UTC by node-cron, but reads from `new Date()` in DB rows
  inside `expiresAt: { lt: new Date() }` queries assume the server
  clock matches DB).
- Impact at 100 users: OTP expiry, refresh-token expiry, booking
  start/end ranges, prediction-cache purge can all drift by hours
  across a daylight-savings boundary or a region change for the DB
  host. This is the kind of bug that passes every test in the
  developer's timezone and explodes once users span two of them.
- Fix: change every `DateTime` field to use `@db.Timestamptz(3)` and
  generate a single Alembic-equivalent migration. Prisma does not
  ship Alembic; use `prisma migrate dev --name timestamps_to_tz`
  after editing the schema. Sample edit:

```prisma
// before
createdAt   DateTime  @default(now())
expiresAt   DateTime
updatedAt   DateTime  @updatedAt

// after
createdAt   DateTime  @default(now()) @db.Timestamptz(3)
expiresAt   DateTime                  @db.Timestamptz(3)
updatedAt   DateTime  @updatedAt       @db.Timestamptz(3)
```

The `ALTER TABLE ... ALTER COLUMN ... TYPE timestamptz USING ... AT
TIME ZONE 'UTC'` rewrite is a full-table read on every table — do it
in a maintenance window, not under load. Verify with
`SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND data_type LIKE 'timestamp%';`

---

**[S-04] Socket.IO CORS reflects `*` with `credentials: true`** —
`backend/src/server.js:34-40`

- Problem:

```js
const io = new SocketIO(httpServer, {
  cors: {
    origin: ENV.ALLOWED_ORIGINS.length ? ENV.ALLOWED_ORIGINS : '*',
    credentials: true,
  },
  ...
});
```

This is the exact A05 footgun the master prompt names. The CORS
spec forbids `Access-Control-Allow-Origin: *` together with
`Access-Control-Allow-Credentials: true`. Browsers reject the
combination — but Socket.IO's polling fallback runs over fetch and
some custom WebSocket clients (the React Native client) accept it.
- Impact at 100 users: if a malicious site can convince a browser-
  side admin user to load a script (XSS in any cropsetu page,
  attacker domain that loads the panel via iframe), that script can
  open a Socket.IO connection with the user's session cookies and
  receive private messages, group chat, push events.
- Fix: drop the wildcard and refuse to start without an explicit
  list in production.

```js
// server.js
if (!ENV.IS_DEV && !ENV.ALLOWED_ORIGINS.length) {
  throw new Error('ALLOWED_ORIGINS must be set in production');
}
const io = new SocketIO(httpServer, {
  cors: {
    origin: ENV.ALLOWED_ORIGINS.length ? ENV.ALLOWED_ORIGINS : false,
    credentials: true,
  },
  ...
});
```

For mobile RN clients there is no Origin header; they connect
unimpeded. The wildcard exists only to serve browsers, which is
exactly the case you don't want unrestricted.

---

**[S-05] `/health` lies — never checks DB or Redis** —
`backend/src/app.js:133`

- Problem:

```js
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
```

The endpoint always returns 200. Railway's load balancer health
probe (set on the same path by default) sees green even when DB or
Redis is down.
- Impact at 100 users: a pgbouncer hiccup, an `IDLE_IN_TRANSACTION`
  spike, or a Redis OOM kill leaves the instance up but unable to
  serve any request. Railway keeps routing to it. Users see 5xx
  storm; auto-rollback and auto-restart never trigger.
- Fix: split into liveness + readiness, configure Railway's probe
  to use `/readyz`.

```js
// liveness: process is alive
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// readiness: dependencies are reachable
app.get('/readyz', async (_req, res) => {
  const checks = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch (e) { checks.db = 'down'; }
  try {
    if (redis.status === 'ready') {
      await redis.ping();
      checks.redis = 'ok';
    } else { checks.redis = 'degraded'; }
  } catch (e) { checks.redis = 'down'; }
  const ready = checks.db === 'ok';   // redis is optional, db is not
  res.status(ready ? 200 : 503).json({ ready, checks });
});
```

Then in Railway → Service → Settings → Healthcheck Path: `/readyz`.
FastAPI already does part of this in `main.py:120-136` but also
under the name `/health` — same fix applies there: rename the
DB-checking endpoint to `/readyz` and add a no-op `/healthz`.

---

**[S-06] No service-to-service auth between Express and FastAPI** —
`backend/src/server.js:85-90`, `Cropsetu/fastapi/routes/agripredict.py`
(referenced; verify in Pass 3)

- Problem: Express's cron triggers FastAPI with an unauthenticated
  POST:

```js
return fetch(`${AI_BASE}/agripredict/sync/trigger`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },   // no auth header
  body:    JSON.stringify({ ... }),
  signal:  AbortSignal.timeout(8_000),
});
```

If FastAPI is exposed only on Railway's private network
(`http://cropsetu-ai.railway.internal:8001` per `.env.example:24`)
the network is the only access control — there is no defence in
depth.
- Impact at 100 users: if FastAPI ever gets a public hostname (for
  AI playground access, for the React Native app calling AI directly,
  for an admin panel), every internal endpoint becomes worldwide
  open. AgriPredict sync triggers at any rate, AI prompt-injection
  via untrusted input, and the data.gov.in API key gets burned
  through your free tier in minutes.
- Fix: a shared static token, both ends.

```py
# fastapi/main.py
from fastapi import Depends, HTTPException, Header
INTERNAL_TOKEN = os.environ["INTERNAL_API_TOKEN"]

async def require_internal_token(
    x_internal_token: str | None = Header(default=None),
):
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, INTERNAL_TOKEN,
    ):
        raise HTTPException(401, "internal-only endpoint")

app.include_router(
    agripredict_router,
    dependencies=[Depends(require_internal_token)],
)
```

```js
// backend/src/server.js
headers: {
  'Content-Type': 'application/json',
  'X-Internal-Token': ENV.INTERNAL_API_TOKEN,
},
```

Generate `INTERNAL_API_TOKEN` once with `openssl rand -base64 48`
and set it on both Railway services.

---

### 🟠 HIGH — fix within first week

**[S-07] JWT default expiry is 7 days when env var is unset** —
`backend/src/config/env.js:25`

- Problem: `JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d'`. The
  master prompt's target is ≤15 min for access tokens. The dev
  `.env` correctly sets `JWT_EXPIRES_IN="15m"`, but if a Railway
  variable is forgotten, every newly issued token is valid for a
  week with no revocation path other than rotating JWT_SECRET (which
  invalidates everyone).
- Fix: default to `'15m'` and add a startup check that warns if
  the parsed duration exceeds 1 hour.

```js
JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
```

---

**[S-08] WITHDRAWN — Refresh tokens are in fact SHA-256-hashed**

- Flagged from the schema (`RefreshToken.token String @unique`).
  After reading `backend/src/utils/jwt.js:21-31` the value stored is
  `crypto.createHash('sha256').update(raw).digest('hex')`. The plain
  token is returned to the client and never persisted. Verification
  (jwt.js:33-39) hashes the submitted value before lookup.
- Residual concern (now in Express report [E-04]): rotation has a
  TOCTOU race because revoke + create are not in one transaction,
  and there is no re-use-detection if a stolen rotated token is
  later replayed.

---

**[S-09] CI references a path that no longer exists on disk** —
`backend/.github/workflows/ci.yml:44`

- Problem: `working-directory: AI_CROP_DISESE_DETECTION`. Working
  tree shows that directory deleted; once the deletion lands on
  `origin/main`, the FastAPI CI job fails on every push with
  "directory not found".
- Fix: update CI to reference `fastapi/` (after S-01 places it in a
  reachable location), and add the missing checks the master prompt
  expects:

```yaml
fastapi:
  defaults:
    run:
      working-directory: fastapi   # post-S-01
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with: { python-version: '3.12', cache: 'pip' }
    - run: pip install -r requirements.txt
    - run: pip install pip-audit ruff bandit
    - run: pip-audit --strict
    - run: ruff check .
    - run: bandit -r . -ll
    - run: python -c "import main; from routes import chat, scan, alerts, agripredict, pest_prediction"
```

Same pattern on the Node job — add `npm audit --omit=dev`,
`npm test` (the script exists in package.json:20 but CI never
invokes it).

---

**[S-10] CI runs no tests, no audit, no SAST** —
`backend/.github/workflows/ci.yml`

- Problem: CI does syntax-check (`node --check`) and a console.log
  warning (which is `::warning::`, not `::error::` — passes the
  build). No `npm audit`, no `pip-audit`, no `npm test`, no
  `pytest`, no Semgrep.
- Fix: see S-09 sample. For the Node job add:

```yaml
- run: npm audit --omit=dev --audit-level=high
- run: npm test
```

Make the console.log check fail (exit 1) instead of warn — the
warning has been ignored long enough that 31 route files have
console.log in them (assumption; verify in Pass 2).

---

**[S-11] AgriPredict cron runs in-process — fires on every instance** —
`backend/src/server.js:126-151`

- Problem: `cron.schedule('30 0 * * *', ...)` runs inside every
  Express process. On Railway today there is one instance, so this
  works by accident. The moment the user enables horizontal scaling
  (the Socket.IO Redis adapter at server.js:42-55 is preparing for
  exactly that), every instance fires the same daily sync at the
  same minute, multiplying the data.gov.in API spend and the
  FastAPI load by N.
- Fix: leader election via a Postgres advisory lock, or a real
  scheduler (Railway cron jobs, BullMQ + Redis, or n8n). Cheapest
  patch:

```js
async function tryAcquireLeaderLock(name) {
  // 32-bit hash of name → unique advisory lock key
  const key = parseInt(crypto.createHash('sha1').update(name).digest('hex').slice(0, 8), 16);
  const [{ locked }] = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${key}) AS locked`;
  return locked;
}

cron.schedule('30 0 * * *', async () => {
  if (!await tryAcquireLeaderLock('agripredict-daily')) {
    logger.info('[AgriPredict] Skipping — another instance holds the lock');
    return;
  }
  try { /* run sync */ } finally { /* release */ }
});
```

The lock auto-releases on session end (process death) so no manual
unlock needed for the simple case.

---

**[S-12] Startup auto-seed runs unconditionally per process** —
`backend/src/server.js:94-123`

- Problem: every fresh process whose DB has 0 mandi rows fires
  ~50 sync triggers in 5 batches of 10. With horizontal scaling
  during a deploy (rolling restart), all instances see "DB empty"
  for a brief window before any has finished seeding, and they all
  pile on at once.
- Fix: gate behind the same advisory lock as S-11.

---

**[S-13] 49 cascade-delete relationships — verify each is intentional** —
`backend/prisma/schema.prisma` (search `onDelete: Cascade`)

- Problem: `grep -c "onDelete: Cascade"` returns 49. Some are
  obviously correct (`ChatMessage` cascading from `Chat`). Others
  are not obvious — for example deleting a `User` cascades into
  `SellerProfile` (which holds bank/PAN/Aadhaar), `RefreshToken`,
  `PostBookmark`, `Comment` etc. If a user account is deleted by
  mistake (admin tooling slip, bot deletion), bank-account rows
  with money owed are gone.
- Fix: walk every cascade and decide: hard-delete or soft-delete?
  Bookkeeping rows (orders, bank, KYC) usually want soft-delete
  (`deletedAt DateTime?`) so audit trails survive. This is a
  half-day cleanup, not a one-line change.

---

**[S-14] Anthropic key in dev .env is sk-ant-api03-…** —
`backend/.env:63` and `Cropsetu/fastapi/.env:15`

- Problem: live Anthropic + Groq + Gemini keys are stored on disk in
  plaintext. Same key value is in both files. If the dev box is
  imaged, indexed by Spotlight/Time Machine, or shared via Dropbox,
  the key is out.
- Fix: rotate in the Anthropic console, set the new value only in
  the Railway service variables, leave both `.env` files with empty
  values for keys you do not personally need to call from the dev
  box (Express startup at server.js:25-29 already tolerates missing
  keys with a warning). Repeat for Groq, Gemini, data.gov.in,
  Cloudinary, Sarvam.

---

**[S-15] `FIELD_ENCRYPTION_KEY` may be identical between dev and prod** —
`backend/.env:47`, env.js:70

- Problem: `acbfcd43d402e93ce506c10a145845f1b450437b0e7eea9241588c3072402160`
  is the dev key. If a developer copy-pasted it into Railway during
  initial setup, prod PII (Aadhaar, PAN, bank account from
  `SellerProfile`) is decryptable by anyone who reads the dev
  machine.
- Fix: in Railway, regenerate via `openssl rand -hex 32`, set on the
  prod service, confirm `select aadharNumber from seller_profiles
  limit 1` returns ciphertext (not plaintext) and that the app can
  still read it via `decrypt()`. If it cannot, you have just
  confirmed the prod key was a different value — leave it alone but
  rotate it on a planned migration cadence.

---

### 🟡 MEDIUM — fix within first month

**[S-16] No Dockerfile / no docker-compose** — repo root, both
service roots

- Problem: Railway's Nixpacks auto-detection works for the happy
  path but gives you no declarative startup contract. A new
  contributor cannot run the stack locally with one command. Health
  probes, graceful shutdown timeouts, and resource limits are
  Railway-specific config that lives outside the repo.
- Fix: add `docker-compose.yml` for local dev and explicit
  `Dockerfile`s that pin Node 20-alpine and Python 3.12-slim. The
  master prompt's pre-launch checklist requires reproducible local
  runs.

---

**[S-17] Both services use `/health` only — no liveness/readiness split** —
`backend/src/app.js:133`, `Cropsetu/fastapi/main.py:120`

- Problem: see [S-05]. Same issue on the FastAPI side, where
  `/health` does check DB but there is no separate liveness.
- Fix: see [S-05] code sample.

---

**[S-18] FastAPI CORS uses `methods=["*"]`, `headers=["*"]`** —
`Cropsetu/fastapi/main.py:106-107`

- Problem: with `allow_credentials=True`, the wildcard is only
  permitted because origins are explicit, but it's still broader
  than necessary.
- Fix: enumerate. The service handles POST + GET only.

```py
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Internal-Token"],
)
```

---

**[S-19] FastAPI rate limit is per-IP only** —
`Cropsetu/fastapi/main.py:43`

- Problem: `Limiter(key_func=get_remote_address, default_limits=["60/minute"])`.
  At 100 concurrent users sharing carrier-NAT IPs (extremely common
  for Indian mobile users on Jio/Airtel), one or two IPs may carry
  most of your traffic and trip the limit while other users see no
  throttling.
- Fix: key by user-id when authenticated, fall back to IP otherwise.

```py
def rate_key(request: Request) -> str:
    uid = getattr(request.state, "user_id", None)
    return f"u:{uid}" if uid else f"ip:{get_remote_address(request)}"

limiter = Limiter(key_func=rate_key, default_limits=["60/minute"])
```

Combine with per-endpoint stricter limits on `/ai/scan` (expensive
Claude pipeline) — `@limiter.limit("10/minute")`.

---

**[S-20] OPTIONAL_KEYS warning hides degraded startup** —
`backend/src/server.js:17-29`

- Problem: 6 keys are tagged optional; missing ones cause feature
  degradation that surfaces only when a user hits the affected route.
  At 100 concurrent users, a missed `MSG91_AUTH_KEY` means every
  signup flow throws once attempted.
- Fix: in production (`!ENV.IS_DEV`), refuse to start if any key in
  the list is required for a user-visible flow. Compute "required"
  from a feature flag, not a static list.

```js
const REQUIRED_IN_PROD = ['MSG91_AUTH_KEY', 'CLOUDINARY_CLOUD_NAME', 'GEMINI_API_KEY'];
if (!ENV.IS_DEV) {
  for (const k of REQUIRED_IN_PROD) {
    if (!process.env[k]) {
      logger.fatal({ k }, '[Config] missing required key — aborting startup');
      process.exit(1);
    }
  }
}
```

---

### 🟢 LOW — technical debt

**[L-01] `DEPLOYMENT.md` deleted in working tree** —
`backend/` working tree

- Problem: `git status` shows `D DEPLOYMENT.md`. The runbook is gone
  on disk but committed on `origin/main`. New on-call has no doc.
- Fix: restore (`git checkout -- DEPLOYMENT.md`) or rewrite, then
  commit. If it's outdated, write a fresh one — the master prompt's
  pre-launch checklist requires runbooks for the top three expected
  incidents.

---

**[L-02] `node-cron` 4.x in package.json without a job-history table** —
`backend/package.json:52`, `backend/src/server.js:126,145`

- Problem: missed runs (process crash during the scheduled minute)
  are lost silently.
- Fix: write a `cron_runs` row at the start of each job and update
  it on completion; alert on missing rows.

---

## Dead code & redundancy to delete

- `backend/App.js`, `backend/app.json`, `backend/eas.json`,
  `backend/babel.config.js`, `backend/src/screens/`,
  `backend/src/navigation/`, `backend/src/context/`,
  `backend/src/i18n/`, `backend/src/components/`,
  `backend/src/constants/` — leftover Expo/RN files inside the
  Express service. `backend/package.json:6` declares
  `"main": "src/server.js"` and lists no React/RN deps. These
  directories are orphaned. Delete and commit.
- `backend/AI_CROP_DISESE_DETECTION/` (currently shown as deleted
  in `git status`) — finalise the deletion only after S-01 puts the
  FastAPI code somewhere else.
- `frontend/AI_CROP_DISESE_DETECTION/` (also shown as deleted) —
  same comment. The FastAPI code historically lived inside both
  repos; finalise once.
- `frontend/prisma/` — Expo apps do not use Prisma. The schema
  files (`schema.prisma`, `seed*.js`) here are stale duplicates of
  `backend/prisma/`. Confirm with `diff -r backend/prisma
  frontend/prisma` and delete from frontend.

## Currently missing entirely (must add)

- [ ] `/healthz` (liveness, no deps) and `/readyz` (DB + Redis) on
      Express; rename FastAPI's `/health` accordingly.
- [ ] `INTERNAL_API_TOKEN` shared between Express and FastAPI.
- [ ] OTP plaintext → HMAC; column rename on `OtpSession`.
- [ ] Refresh token plaintext → SHA-256-at-rest.
- [ ] `@db.Timestamptz(3)` migration across the schema.
- [ ] Dockerfile + docker-compose for local dev parity with Railway.
- [ ] CI: `npm audit`, `pip-audit`, `npm test`, `bandit`, `ruff`.
- [ ] Console.log lint promoted from `::warning::` to build failure.
- [ ] Postgres advisory-lock leader election around cron jobs.
- [ ] Sentry (or equivalent error tracker) on both services with
      `before_send` PII scrubbing — referenced by neither file.

## Deadlock & race-condition map (cross-service)

Both services target one Postgres database (`farmeasy_db`). The
high-write tables touched by both:

| Endpoint / Job | Service | Tables touched | Lock order |
|----------------|---------|----------------|------------|
| `POST /api/v1/agripredict/sync/trigger` (FastAPI) | FastAPI | `mandi_prices`, `prediction_cache` | mandi → cache |
| Express startup auto-seed (server.js:94) | Express | reads `mandi_prices.count()` | read-only |
| Express daily cron (server.js:126) | Express | calls FastAPI; no direct DB write | n/a |
| Monthly cache purge (server.js:147) | Express | `prediction_cache` (deleteMany) | cache only |

Risk surface:
- The monthly purge runs at `0 1 1 * *` UTC. The FastAPI sync
  trigger can write to `prediction_cache` at any time. If the purge
  acquires a row-level lock while sync is mid-write, sync will
  block until 10 minutes of expired-row deletion completes — long
  enough to overflow the 8-second `AbortSignal.timeout` in
  server.js:89, leaving FastAPI with a half-completed transaction.
- Express does not write to `mandi_prices` directly. If that ever
  changes, you have a two-writer table with two different ORMs and
  no shared lock-order convention — exactly the deterministic
  deadlock the master prompt warns about. **Pick one writer per
  table** as a hard rule and document it.

## 100-user load math

Connection budget on Postgres (assume Railway default
`max_connections=100`, leave 20 for admin + replicas → 80 usable):

- FastAPI: `max_size=10` (db_pool.py:24) × N FastAPI workers. With
  the default Uvicorn single-worker `uvicorn main:app`, that is 10.
  At 4 workers (Gunicorn-Uvicorn `--workers 4`), it is 40.
- Express: Prisma's default `connection_limit = num_cpus * 2 + 1`.
  Railway's "starter" container reports 8 cores via Linux but is
  CPU-shared; Prisma sees 8 → pool of 17. With 1 process, 17.
- Total at 1+1 workers: **27 connections**, leaving 53 for admin,
  replicas, and headroom. Within budget.
- Total at 4+4 workers: **40 + 68 = 108**, **over the 100 ceiling**.
  Express will throw `Too many connections for role` under any
  Friday-evening burst.

Recommendation: **explicitly set the pool sizes so the math is
documented, not implicit.**

```bash
# Express — append to DATABASE_URL
DATABASE_URL="postgresql://...?connection_limit=10&pool_timeout=10"
```

```py
# FastAPI db_pool.py:24
_db_pool = await asyncpg.create_pool(
    DATABASE_URL,
    min_size=2, max_size=8, command_timeout=15,
)
```

At Express max=10, FastAPI max=8, both at 2 workers each: total
36 — well within budget, with room to scale to 4 workers each
(72 total).

p95 target < 300 ms — feasible for Express CRUD endpoints. The
FastAPI 5-agent Claude pipeline (`fastapi/orchestrator.py`) at
~2-5 s per call is **not** going to hit 300 ms — that is the
master prompt's "obviously can't hit it" case. Carve out
`/ai/scan` from the global SLO and target a separate p95
(e.g., 8 s) with a queue / progress endpoint.

## Pre-launch checklist (shared layer only)

- [ ] All BLOCKERS [S-01] through [S-06] resolved.
- [ ] HIGH [S-07] through [S-15] resolved.
- [ ] Secrets rotated per the runbook above; `git log --all -p ..
      | grep -i 'sk-ant-api'` returns no committed keys.
- [ ] `DATABASE_URL` connection-limit query parameter set; FastAPI
      `max_size` set explicitly; total ≤ 80 with headroom.
- [ ] Railway healthcheck path changed to `/readyz` on both
      services.
- [ ] `INTERNAL_API_TOKEN` set on both services; FastAPI rejects
      requests without it.
- [ ] CI passes `npm audit --omit=dev --audit-level=high` and
      `pip-audit --strict`.
- [ ] Dead RN code removed from `backend/`; dead Prisma copy
      removed from `frontend/`.
- [ ] One owner per table: document in `docs/db-ownership.md`.
- [ ] Schema migrated to `Timestamptz(3)` in a maintenance window,
      verified with information_schema query.
