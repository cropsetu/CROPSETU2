# Production-Readiness Review — Cropsetu Backend (Express)

Scope: `Cropsetu/backend/` only — Express 4 + Prisma 5 + Postgres +
Redis + Socket.IO. The shared review at [shared.md](shared.md) covers
secrets, schema, deployment, and CI; this report does not duplicate
those findings.

## Verdict

**DO NOT SHIP.** The single most important reason: synchronous
filesystem calls live on the hot request path of every AI scan and
voice request (`fs.statSync`, `fs.readFileSync`, `fs.renameSync`,
`fs.unlinkSync` in `ai.routes.js`). Node is single-threaded — these
calls block the entire event loop for the duration of the disk I/O.
At 100 concurrent users uploading 25 MB voice notes or 10 MB scan
images, the loop stalls for hundreds of milliseconds at a time, and
your p95 latency target (300 ms) is unreachable. Combine that with
multer's `memoryStorage` for video at 100 MB and you have a
memory blow-up at the same time. Fix both before any load test.

## Top 5 risks at 100 concurrent users

1. **Sync filesystem on the request path.** `ai.routes.js:461,746`
   block the event loop. Node serves no other request while
   `fs.readFileSync(25MB)` returns.
2. **Multer `memoryStorage` everywhere with generous limits.**
   `config/cloudinary.js:13,118` keep upload bytes in RAM until
   Cloudinary returns. 100 concurrent video uploads at 100 MB =
   10 GB resident.
3. **Refresh-token rotation race.** `auth.routes.js:123-136` runs
   three Prisma calls outside any transaction. Two concurrent
   refreshes against the same token both succeed; a stolen-then-
   rotated token can be replayed undetected.
4. **OTP brute-force is barely throttled.** Per-phone rate limit of
   5 OTP requests per 10 min × 5 attempts per OTP = 25 guesses per
   phone per 10 min. Across many phones from one IP, no per-IP cap
   applies on `/verify-otp`.
5. **Cloudinary outage stalls the request.** `uploadBuffer` has its
   own 55 s timeout (config/cloudinary.js:56) but the global Express
   `httpServer.timeout` is never set, so other middleware
   downstream of a hung upload also stall.

---

## Findings

### 🔴 BLOCKERS — must fix before any production traffic

**[E-01] Sync filesystem calls on the request path** —
`backend/src/routes/ai.routes.js:461, 746, 448, 716, 728, 735, 790,
922`

- Problem: every `fs.*Sync` call in a request handler blocks Node's
  event loop until disk I/O completes. The voice route reads up to
  25 MB synchronously:

```js
// ai.routes.js:461
const audioBuffer = fs.readFileSync(renamedPath);

// ai.routes.js:448
fs.renameSync(file.path, renamedPath);

// ai.routes.js:746
const imageSize = fs.statSync(file.path).size;

// ai.routes.js:716, 728, 735, 790, 922
fs.unlinkSync(file.path);
```

- Impact at 100 users: on a Railway shared CPU container, reading
  25 MB sync takes 50-200 ms. During that window, *zero other
  requests get serviced*. With 100 users sending voice messages,
  the event loop spends most of its time blocked. p95 explodes
  past your 300 ms target.
- Fix: switch every sync call to `fs/promises`.

```js
import fs from 'fs/promises';
import { createReadStream } from 'fs';

// Instead of fs.readFileSync — stream into the buffer or, better,
// pipe directly into the STT call so 25 MB never sits in memory:
await sarvamSTT(createReadStream(renamedPath), `audio.${ext}`, detectedLanguage);

// Instead of fs.renameSync:
await fs.rename(file.path, renamedPath);

// Instead of fs.statSync:
const { size: imageSize } = await fs.stat(file.path);

// Instead of fs.unlinkSync (and wrap in try/catch instead of `try { } catch { /* ignore */ }`):
await fs.unlink(file.path).catch(() => {});
```

The Sarvam SDK at sarvam.service.js (not read in this pass) needs
to accept a stream, not a buffer. If it cannot, at minimum stream
the file via `fs.createReadStream` into an internal piping rather
than `fs.readFileSync` followed by buffer-passing.

---

**[E-02] Multer `memoryStorage` with 100 MB video / 15 MB image
limits** — `backend/src/config/cloudinary.js:13, 22, 41, 117`

- Problem:

```js
// cloudinary.js:13
const memoryStorage = multer.memoryStorage();

// cloudinary.js:117
export function createVideoUploader() {
  return multer({
    storage: memoryStorage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    ...
```

Every uploaded video is buffered into the worker process's RAM
until Cloudinary returns. The image uploader (line 22) does the
same with 15 MB × `array('images', 5)` = 75 MB per request.
- Impact at 100 users: a 100-user burst of video uploads at the
  configured ceiling = 10 GB resident memory in one worker.
  Railway containers are typically 512 MB - 8 GB. The worker is
  OOM-killed long before that, taking every other in-flight
  request with it.
- Fix: switch video uploads to disk storage; for images, lower the
  per-request ceiling and stream where Cloudinary supports it.

```js
// cloudinary.js
import os from 'os';

const diskStorage = multer.diskStorage({
  destination: os.tmpdir(),
  // unique filename to avoid collisions across concurrent uploads
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${file.originalname}`),
});

export function createVideoUploader() {
  return multer({
    storage: diskStorage,            // ← was memoryStorage
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!/video\/(mp4|mov|avi|quicktime|x-msvideo)/.test(file.mimetype)) {
        return cb(new Error('Only MP4, MOV, AVI videos are allowed'));
      }
      cb(null, true);
    },
  }).single('video');
}

// uploadVideoBuffer must change to uploadVideoFile(filePath, folder),
// using fs.createReadStream(filePath).pipe(stream) and unlinking
// after the upload promise resolves.
```

---

**[E-03] Base64 image upload doubles the memory footprint** —
`backend/src/routes/upload.routes.js:14-57`,
`backend/src/app.js:118`

- Problem:

```js
// app.js:118
app.use(`${API}/upload`, skipMultipart(express.json({ limit: '10mb' })));

// upload.routes.js:44
const buffer = Buffer.from(raw, 'base64');
```

Every `/upload/image` request:
1. Express body-parser allocates the JSON string (up to ~13 MB
   including base64 overhead).
2. The route slices the data-URI prefix and decodes base64 into a
   second buffer (up to 8 MB).
3. Both stay resident until Cloudinary returns.

That is ~18-21 MB per request before any Cloudinary streaming
begins. At 100 concurrent users, ~2 GB of buffers.
- Impact at 100 users: same OOM failure mode as [E-02]. Plus the
  duplicate decode is wasted CPU.
- Fix: use multipart/form-data for image uploads instead of
  base64-in-JSON. The mobile client (`@react-native-compressor` is
  already in frontend deps) can post `multipart/form-data` with a
  blob; multer with `diskStorage` writes to /tmp; the route streams
  the temp file to Cloudinary via `fs.createReadStream`. No buffer
  ever exceeds Node's stream high-water mark (16 KB).

```js
// upload.routes.js — replace base64 path
import { createUploader } from '../config/cloudinary.js'; // disk-backed multer
import fs from 'fs/promises';
import { createReadStream } from 'fs';

router.post('/image', authenticate, createUploader(1), async (req, res) => {
  const file = req.files?.[0];
  if (!file) return sendError(res, 'image is required (field: images)', 400);
  try {
    const url = await uploadStream(createReadStream(file.path), 'products');
    return sendSuccess(res, { url });
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
});
```

If you cannot break the existing JSON contract, at least cap
`express.json({ limit: '2mb' })` on the upload route and require
the client to compress aggressively before send.

---

**[E-04] Refresh-token rotation race + no re-use detection** —
`backend/src/routes/auth.routes.js:121-138`,
`backend/src/utils/jwt.js:33-43`

- Problem:

```js
// auth.routes.js:121
const record = await validateRefreshToken(userId, rawToken);
if (!record) return sendUnauthorized(res, 'Invalid or expired refresh token');

// Rotate: revoke old, issue new
await revokeRefreshToken(record.id);          // ← race window opens here
...
const newRefreshToken = await createRefreshToken(user.id);
```

Two concurrent `/refresh` calls with the same token (legit user
double-tap, or attacker racing the legitimate user with a stolen
token) both call `validateRefreshToken` before either calls
`revokeRefreshToken`. Both succeed. Both get fresh tokens.

Worse: `revokeRefreshToken` (jwt.js:42) silently swallows
errors with `.catch(() => {})`, so a re-use of an *already*-
rotated (stolen but expired-by-rotation) token cannot be detected
because the delete just no-ops.

- Impact at 100 users: an attacker who steals a refresh token via
  device theft, RN local-storage exfiltration, or a network
  intermediary can keep refreshing forever in parallel with the
  victim — both sides hold valid sessions. The attacker is invisible
  to the user, the user, and your logs.
- Fix: rotate atomically inside a transaction, and detect re-use
  by storing a `replacedById` chain.

```prisma
// schema.prisma — add to RefreshToken
model RefreshToken {
  id           String        @id @default(uuid())
  token        String        @unique               // sha256 hash, already correct
  userId       String
  expiresAt    DateTime
  revokedAt    DateTime?                            // ← new
  replacedById String?                              // ← new — points to its successor
  ...
}
```

```js
// utils/jwt.js — rotate atomically
export async function rotateRefreshToken(userId, rawToken) {
  const oldHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return prisma.$transaction(async (tx) => {
    const old = await tx.refreshToken.findFirst({
      where: { token: oldHash, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!old) {
      // Re-use detection: was this token previously rotated?
      const stale = await tx.refreshToken.findUnique({ where: { token: oldHash } });
      if (stale && stale.revokedAt) {
        // SUSPICIOUS: someone replayed a rotated token. Revoke ALL of this
        // user's sessions and alert.
        await tx.refreshToken.updateMany({
          where: { userId: stale.userId, revokedAt: null },
          data:  { revokedAt: new Date() },
        });
        logger.warn({ userId: stale.userId }, '[Auth] Refresh token re-use detected — revoked all sessions');
      }
      return null;
    }

    const newRaw   = crypto.randomBytes(48).toString('hex');
    const newHash  = crypto.createHash('sha256').update(newRaw).digest('hex');
    const expiresAt = new Date(Date.now() + ENV.REFRESH_TOKEN_EXPIRES_DAYS * 86400_000);
    const fresh = await tx.refreshToken.create({
      data: { token: newHash, userId, expiresAt },
    });
    await tx.refreshToken.update({
      where: { id: old.id },
      data:  { revokedAt: new Date(), replacedById: fresh.id },
    });
    return newRaw;
  }, { isolationLevel: 'Serializable' });   // serialize concurrent /refresh
}
```

Replace the four-line block in auth.routes.js:121-138 with one
call to `rotateRefreshToken`. Drop the `userId` body field
(see [E-11]).

---

**[E-05] `/health` always returns 200** —
`backend/src/app.js:133`

- See [shared.md S-05]. Same finding, same fix. Repeated here
  because Railway's healthcheck is configured against this service
  specifically and so is the highest-priority blocker for *this*
  service. Implement `/healthz` and `/readyz` per the shared report.

---

**[E-06] Express cron jobs run on every instance** —
`backend/src/server.js:94-151`

- See [shared.md S-11, S-12]. Same finding. The fix (Postgres
  advisory lock per scheduled task) lives in this codebase, not
  the shared layer.

---

**[E-31] `devOtp` returned in API response when `MSG91_AUTH_KEY`
is empty — production OTP bypass** —
`backend/src/services/otp.service.js:37-47`

- Problem:

```js
if (ENV.MSG91_AUTH_KEY) {
  await sendViaMSG91(phone, otp);
  return { sessionId: session.id };
}
console.log(`[OTP DEV] Phone: ${phone} | OTP: ${otp}`);
return { sessionId: session.id, devOtp: otp };
```

The `else` branch is reached **whenever** the env var is empty,
regardless of `NODE_ENV`. The frontend at
`Cropsetu/frontend/src/screens/Auth/LoginScreen.js:42-44`
auto-fills the OTP from `result?.data?.devOtp` with no
`__DEV__` guard. Result: in any production deployment where
`MSG91_AUTH_KEY` is missing — a forgotten Railway variable, a
revoked MSG91 account, a misnamed key — every `/auth/send-otp`
call returns the OTP to the caller. Phone-ownership verification
collapses; account takeover requires only the phone number.

The shared report's [S-20] note that "missing optional keys
silently degrade features" understates this case — this is not
a degradation, it is a security bypass.
- Impact at 100 users: account takeover at scale, gated only by
  the existence of one env var on the prod deployment. No log
  signal — `console.log('[OTP DEV] ...')` (line 43) writes to
  the dev console; in prod, you simply don't notice.
- Fix: refuse to issue a non-deliverable OTP in production.

```js
// otp.service.js:37
if (ENV.MSG91_AUTH_KEY) {
  await sendViaMSG91(phone, otp);
  return { sessionId: session.id };
}

if (!ENV.IS_DEV) {
  // Refuse to issue an OTP we can't deliver in prod.
  // The route handler maps this to a 503 for the client.
  throw Object.assign(
    new Error('OTP delivery not configured'),
    { status: 503, expose: true },
  );
}

console.log(`[OTP DEV] Phone: ${phone} | OTP: ${otp}`);
return { sessionId: session.id, devOtp: otp };
```

Pair with [shared.md S-20] — promote `MSG91_AUTH_KEY` to the
required-in-prod list so the server fails to start without it,
not just at OTP issuance time. The frontend defence in
[frontend-rn.md M-02] (`if (__DEV__ && devOtp)`) is defence in
depth — both must land.

---

### 🟠 HIGH — fix within first week

**[E-07] JWT verify does not pin the algorithm** —
`backend/src/utils/jwt.js:16`

- Problem: `jwt.verify(token, ENV.JWT_SECRET)`. With
  `jsonwebtoken@9.x` and a symmetric secret string, the library
  auto-restricts to the HS family — so `alg: none` and HS/RS
  confusion are not actively exploitable in *this* configuration.
  But the moment someone migrates to RSA keys (asymmetric), the
  surface opens up, and best practice is to pin explicitly.
- Fix:

```js
export function verifyAccessToken(token) {
  return jwt.verify(token, ENV.JWT_SECRET, { algorithms: ['HS256'] });
}
```

Also pin on sign so the library doesn't drift to a stronger
default that breaks verify:

```js
export function signAccessToken(payload) {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: ENV.JWT_EXPIRES_IN,
    algorithm: 'HS256',
    issuer: 'cropsetu-backend',
    audience: 'cropsetu-mobile',
  });
}
```

The `iss` / `aud` claims let you distinguish tokens from this
service vs. a future admin-panel service vs. a partner integration.

---

**[E-08] bcrypt(rounds=10) for OTP is CPU-heavy** —
`backend/src/services/otp.service.js:24, 71`

- Problem: bcrypt at 10 rounds is roughly 100 ms of single-thread
  CPU per hash and per verify. At 100 users requesting + verifying
  OTPs in a one-minute burst (signup spike), the worker spends
  ~20 seconds of every minute on bcrypt alone.
- Impact at 100 users: latency spikes on `/auth/send-otp` and
  `/auth/verify-otp` of 100-300 ms even before any DB work.
- Fix: HMAC-SHA256 with a per-deployment pepper. OTPs are
  ephemeral 6-digit codes with a 10-min TTL and 5-attempt cap;
  bcrypt's slow-by-design property buys nothing here.

```js
// otp.service.js
import crypto from 'crypto';

const OTP_PEPPER = process.env.OTP_PEPPER;
if (!OTP_PEPPER || OTP_PEPPER.length < 32) {
  throw new Error('OTP_PEPPER must be set (32+ hex chars). Generate: openssl rand -hex 32');
}
function hashOtp(otp) {
  return crypto.createHmac('sha256', OTP_PEPPER).update(String(otp)).digest('hex');
}

// On send (line 24):
const hashed = hashOtp(otp);

// On verify (line 71):
const expected = hashOtp(otp);
const ok = devBypass || crypto.timingSafeEqual(
  Buffer.from(session.otp, 'hex'),
  Buffer.from(expected, 'hex'),
);
```

Add `OTP_PEPPER` to `.env.example` and the prod Railway variables.

---

**[E-09] MSG91 axios call has no timeout** —
`backend/src/services/otp.service.js:106`

- Problem:

```js
const res = await axios.post(url, null, { params });
```

Axios's default request timeout is `0` (unlimited). If MSG91 hangs
(rare but happens), `/auth/send-otp` hangs with it. Combined with
no rate limit at the body-parse step, a slow MSG91 cascades into
event-loop pile-up.
- Fix:

```js
const res = await axios.post(url, null, { params, timeout: 5000 });
```

5 seconds is generous for an SMS provider; anything beyond is a
sign of degraded service and you should fail fast and tell the
user to retry.

---

**[E-10] Deactivated users keep working tokens until expiry** —
`backend/src/middleware/auth.js:11-24`,
`backend/src/utils/jwt.js:11-13`

- Problem: `authenticate` decodes the JWT and trusts `payload.role`.
  No DB check verifies `User.isActive`. Setting `isActive=false`
  takes up to JWT_EXPIRES_IN to take effect (15 m on the dev value;
  7 d on the env.js default per [shared.md S-07]).
- Fix: cheap option — DB check on every authenticated request
  (adds one query per request, OK at 100 RPS with a covered index
  on `User.id`). Better option — token version:

```prisma
// schema.prisma
model User {
  ...
  tokenVersion Int @default(0)
}
```

```js
// utils/jwt.js
export function signAccessToken({ sub, role, tokenVersion }) {
  return jwt.sign({ sub, role, tv: tokenVersion }, ENV.JWT_SECRET, {
    expiresIn: ENV.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

// middleware/auth.js
export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return sendUnauthorized(res);
  let payload;
  try { payload = verifyAccessToken(header.slice(7)); }
  catch { return sendUnauthorized(res, 'Invalid or expired token'); }

  // Cheap DB check — id is the primary key, sub-millisecond
  const user = await prisma.user.findUnique({
    where:  { id: payload.sub },
    select: { id: true, role: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
    return sendUnauthorized(res, 'Session revoked');
  }
  req.user = { id: user.id, role: user.role };
  next();
}
```

Increment `tokenVersion` on logout-all, password change, role
change, account suspension. Every existing token is invalidated
immediately.

---

**[E-11] Refresh endpoint takes `userId` from body** —
`backend/src/routes/auth.routes.js:115-122`

- Problem: the client sends both `userId` and `refreshToken`, and
  the server validates `(token, userId)` together. Not a CVE — the
  attacker still needs the refresh token. But the contract is
  unnecessary: the userId is already implied by the token.
- Fix: as part of [E-04], drop `userId` from the body. Look up the
  token by hash alone (the column is `@unique`), then use the
  `userId` from the row.

---

**[E-12] Stored XSS sanitization is regex `<[^>]*>` only** —
`backend/src/socket/chat.socket.js:81, 155`,
`backend/src/utils/encrypt.js:110`

- Problem:

```js
text.trim().replace(/<[^>]*>/g, '').substring(0, 2000);
```

Catches well-formed tags but lets through:
- HTML entities (`&lt;script&gt;...&lt;/script&gt;`),
- Malformed (unclosed) tags inside code-fence-like content,
- `javascript:` URLs in markdown-style links,
- Newline-separated tag tricks.

Mobile RN clients render text as plain Text components, so
exploitation requires the eventual web admin / agent panel.
The threat is forward-looking, not current.

- Fix: switch to a proper sanitizer.

```js
// new util: utils/sanitize.js
import sanitizeHtml from 'sanitize-html';
const STRIP = { allowedTags: [], allowedAttributes: {} };
export const stripHtml = (s) => typeof s === 'string'
  ? sanitizeHtml(s, STRIP).slice(0, 2000)
  : s;
```

`npm i sanitize-html`. Replace the regex calls in chat.socket.js
and encrypt.js.

---

**[E-13] `io.emit('user_online')` global broadcast** —
`backend/src/socket/chat.socket.js:58, 187`

- Problem:

```js
io.emit('user_online', { userId });
```

Every Socket.IO connection notifies every other connected user.
At 100 concurrent users, every connect/disconnect is 100
broadcasts — quadratic in connection churn. Also leaks presence
info (who is online) to users who shouldn't see it.
- Fix: scope to the user's own contacts/chat partners.

```js
// On connect, look up the contact set; emit only to those rooms.
const contacts = await prisma.user.findMany({
  where:  { /* friends-of relation, or recent chat partners */ },
  select: { id: true },
});
contacts.forEach(c => socket.to(`user:${c.id}`).emit('user_online', { userId }));
```

If "online status" is not a product feature, drop the broadcast
entirely.

---

**[E-14] PII (farmer name, phone, OTP) in logs** —
`backend/src/routes/ai.routes.js:363`,
`backend/src/services/otp.service.js:43, 111`,
`backend/src/routes/upload.routes.js:28, 54, 72, 79`

- Problem: pino is used everywhere, but several places use
  `console.warn/error` (otp.service.js:111, upload.routes.js:54)
  which bypasses pino's redact list. ai.routes.js:43 logs the
  full OTP and phone in dev:

```js
console.log(`[OTP DEV] Phone: ${phone} | OTP: ${otp}`);
```

Even gated by `!ENV.MSG91_AUTH_KEY`, dev logs travel to error
trackers if Sentry is wired.
- Fix: configure pino redact, replace remaining `console.*` calls
  with `logger.*`, and never log a full phone or OTP.

```js
// utils/logger.js — add redact list
import pino from 'pino';
export default pino({
  redact: {
    paths: [
      'req.headers.authorization',
      '*.phone',
      '*.otp',
      '*.refreshToken',
      '*.aadharNumber',
      '*.panNumber',
      '*.bankAccountNumber',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
});

// otp.service.js:43 — log only phone-suffix
logger.info({ phoneTail: phone.slice(-4) }, '[OTP DEV] generated');
```

---

**[E-15] Cloudinary placeholder fallback in production** —
`backend/src/routes/upload.routes.js:27, 70`,
`backend/src/config/cloudinary.js:81`

- Problem: when `CLOUDINARY_CLOUD_NAME` is empty, every upload
  silently returns `https://placehold.co/400x400/...`. In dev
  this is convenient. In prod it means a "successful" upload that
  doesn't actually save anything — the user thinks their photo is
  on the listing, but the listing has a placeholder forever.
- Fix:

```js
// upload.routes.js:27
if (!ENV.CLOUDINARY_CLOUD_NAME) {
  if (!ENV.IS_DEV) return sendError(res, 'Image storage not configured', 503);
  return sendSuccess(res, { url: 'https://placehold.co/400x400/E65100/fff?text=Product' });
}
```

Same edit at line 70 (video) and cloudinary.js:81 (uploadFiles).

---

**[E-16] Race in `getOrCreateCredits`** —
`backend/src/services/aiCredit.service.js:57-72`

- Problem:

```js
let credit = await prisma.aICredit.findUnique({ where: { userId } });
if (!credit) {
  credit = await prisma.aICredit.create({ data: { userId, ... } });
}
```

Two concurrent first calls for the same user both find none, both
attempt to create, the second hits the `userId @unique`
constraint and throws. The thrown error short-circuits whatever
AI feature triggered the credit check.
- Fix: use `upsert` so the second caller no-ops.

```js
let credit = await prisma.aICredit.upsert({
  where:  { userId },
  create: {
    userId,
    balance: TIER_CONFIG.free.monthlyCredits,
    lifetimeEarned: TIER_CONFIG.free.monthlyCredits,
    freeRefillDate: getNextRefillDate(),
    tier: 'free',
  },
  update: {},   // no-op on conflict
});
```

The monthly-refill block at lines 75-96 is a separate write that
also lacks the same guard — wrap that in a transaction or a
conditional update with a `WHERE freeRefillDate <= NOW()` so only
one instance refills per user per month.

---

**[E-17] AI scan writes are not transactional** —
`backend/src/routes/ai.routes.js:849, 878, 915`

- Problem: `/ai/scan` does three separate writes — create
  conversation, create disease report, deduct credits. Wrapped in a
  single try/catch but not in a transaction. If the second write
  fails, the user sees a successful response but their scan has no
  report attached; if the third (credits) fails, the user got the
  diagnosis for free.
- Fix:

```js
const { sessionId, savedReportId } = await prisma.$transaction(async (tx) => {
  const convo = await tx.aIConversation.create({ ... });
  const saved = await tx.cropDiseaseReport.create({ data: { ..., conversationId: convo.id } });
  return { sessionId: convo.id, savedReportId: saved.id };
});

// Deduct credits AFTER the transaction commits — credits are
// idempotent-by-design (you can't accidentally double-deduct
// because the API call is non-replayable).
await deductCredits(req.user.id, 'ai_scan_gemini', { ... }).catch(...);
```

The "fire-and-forget" deduction at line 798 should still log
warnings when it fails so finance can reconcile.

---

**[E-18] No request-level timeout on the Express server** —
`backend/src/server.js:31, 75`

- Problem: `httpServer.listen(...)` does not set
  `httpServer.timeout`. Default is 0 (infinite). A slow client
  (Slowloris) or a stuck downstream (Cloudinary, FastAPI) holds the
  socket forever.
- Fix:

```js
httpServer.timeout       = 30_000;        // any response must complete in 30s
httpServer.keepAliveTimeout = 65_000;     // > the LB's idle timeout (Railway is 60s)
httpServer.headersTimeout   = 70_000;     // > keepAliveTimeout per Node docs
```

Long-running endpoints (`/ai/scan` at 175 s, voice at 90 s) need
a per-route override via `req.setTimeout(...)` rather than the
global cap. Keep the global cap conservative.

---

**[E-19] `requireRole` only checks JWT — stale by JWT_EXPIRES_IN** —
`backend/src/middleware/auth.js:39-47`

- Problem: tied to [E-10]. `req.user.role` is from the token and
  doesn't reflect a role change in the DB.
- Fix: see [E-10] sample — the DB lookup gives you the current
  role; pass that into `requireRole`.

---

**[E-20] Express error handler doesn't expose `request_id`** —
`backend/src/app.js:178-184`

- Problem:

```js
app.use((err, req, res, _next) => {
  logger.error({ err, requestId: req.id, path: req.path }, '[Server Error]');
  const safeMessage = err.expose ? err.message : 'Internal server error';
  sendError(res, safeMessage, err.status || 500);
});
```

The log carries `requestId`, but the client gets no way to refer
back to the failed request when contacting support. The
`x-request-id` response header (set in app.js:55) helps if the
client surfaces it; most don't.
- Fix:

```js
sendError(res, safeMessage, err.status || 500, undefined, { requestId: req.id });
```

And update `sendError` (utils/response.js:18) to accept and
include `requestId` in the error envelope:

```js
export function sendError(res, message, statusCode = 500, details, extra) {
  const error = { message: String(message || 'Something went wrong') };
  if (details !== undefined) error.details = details;
  if (extra?.requestId)     error.requestId = extra.requestId;
  return res.status(statusCode).json({ success: false, error });
}
```

---

### 🟡 MEDIUM — fix within first month

**[E-21] In-memory dedup / cooldown maps don't work across
instances** — `ai.routes.js:158, 170, 180`

- See [shared.md S-11]. Move to Redis-backed structures (use the
  existing `redisRateLimit` or an `ioredis` SETNX with TTL for the
  cooldown).

---

**[E-22] `validate` joins error messages with `, `** —
`backend/src/middleware/validate.js:11`

- Problem: clients can't tell which field failed. The mobile UI
  shows a single generic banner instead of inline field errors.
- Fix:

```js
const details = errors.array().map(e => ({
  field: e.path,
  message: e.msg,
  value:   e.value,
}));
return sendError(res, 'Validation failed', 400, details);
```

---

**[E-23] Mixed `console.*` and pino calls** —
`backend/src/services/otp.service.js:43, 111`,
`backend/src/routes/upload.routes.js:28, 54, 72, 79`

- Problem: console output is plain text; pino is JSON. Aggregators
  (Datadog, Logtail, Sentry breadcrumbs) miss console lines or
  parse them wrong. The CI lint at ci.yml:35 only warns.
- Fix: replace every `console.*` with the corresponding `logger.*`
  call. Promote the ci.yml check from `::warning::` to `exit 1`
  (covered in [shared.md S-09]).

---

**[E-24] `optionalAuth` swallows verify errors silently** —
`backend/src/middleware/auth.js:32`

- Problem: `try { ... } catch { /* token invalid — continue as anonymous */ }`
  hides invalid-token attempts. An attacker probing the API with
  malformed tokens generates no signal.
- Fix: at least log at `debug` level with the request id; if you
  add metrics later (Prometheus), increment an `auth_token_invalid`
  counter in the catch.

---

**[E-25] OTP brute-force window** —
`backend/src/routes/auth.routes.js:31-38`,
`backend/src/services/otp.service.js:74-77`

- Problem: combine the per-phone rate limit (5/10min) and per-OTP
  attempt cap (5) gives at most 25 guesses per phone per 10 min,
  but `/verify-otp` itself has no per-IP rate limit. A botnet that
  rotates phones from one IP can run unlimited verify attempts
  against many phones.
- Fix: add a Redis-backed per-IP rate limit on `/verify-otp`
  (e.g., 30/min) using `redisRateLimit`:

```js
import { redisRateLimit } from '../middleware/redisRateLimit.js';
const verifyOtpLimit = redisRateLimit({
  max: 30, windowSec: 60, prefix: 'rl:verify-otp',
  keyGenerator: (req) => `ip:${req.ip}`,
  message: 'Too many verification attempts. Try again in a minute.',
});
router.post('/verify-otp', verifyOtpLimit, [...validators], validate, async (req, res) => { ... });
```

Same on `/send-otp` — the existing `otpLimiter` is per-phone only.

---

**[E-26] `unhandledRejection` is silent** —
`backend/src/server.js:193-197`

- Problem: the comment says "do NOT exit". Correct for a long-
  running web server, but the user-visible logs do not include
  request id, route, or any context — only the error message. A
  bug rises through `await` chains in many places; you'll see a
  log line but never know which request caused it.
- Fix: use `domain` (deprecated but still works), `cls-hooked`, or
  AsyncLocalStorage to attach `req.id` to async contexts so the
  rejection handler can print it. Or wrap every async route
  handler with an `asyncHandler` higher-order function and let the
  global error handler handle it instead of the process-level
  hook.

```js
// utils/asyncHandler.js
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Use everywhere instead of bare async functions:
router.post('/chat', authenticate, aiChatLimit, asyncHandler(async (req, res) => { ... }));
```

This forces every async error into the Express error pipeline,
which already has `req.id` in scope.

---

**[E-27] `ai.routes.js` is 1187 lines** —
`backend/src/routes/ai.routes.js`

- Problem: `/chat`, `/voice`, `/scan`, `/scan/:id/chat`,
  `/conversations`, `/scan/sessions`, `/alerts`, `/scan/feedback`,
  `/usage`, `/tts`, `/translate` — all in one file with shared
  helpers, in-memory caches, and multer setup interleaved. New
  contributors get lost; merge conflicts during parallel feature
  work are routine.
- Fix: split into `ai.chat.routes.js`, `ai.voice.routes.js`,
  `ai.scan.routes.js`, `ai.alerts.routes.js`. Keep `callFastAPI`,
  `buildEnrichedProfile`, the cooldown / dedup helpers in
  `services/aiCommon.service.js`. The blocker fixes above are
  easier to land if the file is broken up first.

---

**[E-28] Group `mark_read` doesn't re-verify chat membership** —
`backend/src/socket/chat.socket.js:89-96`

- Problem:

```js
socket.on('mark_read', async ({ chatId }) => {
  if (!chatId) return;
  await prisma.chatMessage.updateMany({
    where: { chatId, readAt: null, NOT: { senderId: userId } },
    data: { readAt: new Date() },
  });
  io.to(chatId).emit('messages_read', { chatId, userId });
});
```

A malicious socket can spam `mark_read` for any `chatId` — the
filter `NOT: { senderId: userId }` only stops the user from
marking their own messages read. They can mark *other people's*
chat messages read across any chatId they discover.
- Fix: add the same `OR: [{sellerId: userId}, {buyerId: userId}]`
  guard as `join_chat`.

---

**[E-29] No content-type sniffing on `/upload/image`** —
`backend/src/routes/upload.routes.js:22-24`

- Problem: validation only checks `data:image/...` prefix in the
  data-URI, which is client-supplied and trivially spoofable. A
  client posts `data:image/jpeg;base64,<malware bytes>` — the
  server stores it. Cloudinary's `format: 'jpg'` re-encodes images
  but does not run malware scanning.
- Fix: server-side magic-byte sniff before upload.

```js
import { fileTypeFromBuffer } from 'file-type';
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !['jpg','png','webp','gif','heic'].includes(detected.ext)) {
  return sendError(res, 'Unsupported image type', 415);
}
```

`file-type` is ~20 KB, no native deps.

---

**[E-30] `/scan` temp-file cleanup misses some failure paths** —
`backend/src/routes/ai.routes.js:705-936`

- Problem: the `finally` at line 936 deletes the in-flight map
  entry but the `unlinkSync` on file paths happens in scattered
  `try/catch` blocks (lines 716, 728, 735, 790, 922). Several
  early returns (e.g., line 738) call `cleanUp` only if it's the
  duplicate path; the original file is on disk if the user's
  `inflightScans.has(req.user.id)` check fired. /tmp on Railway is
  ephemeral but not unbounded — a sustained burst can fill it.
- Fix: one `try { ... } finally { fs.promises.unlink(file.path).catch(()=>{}); }`
  wrapper around the whole handler body.

---

### 🟢 LOW — technical debt

**[L-01] `paginationMeta` exists but isn't used** —
`backend/src/utils/response.js:41`

- Most list endpoints (e.g., ai.routes.js:673) build pagination
  meta inline as `meta: { total, page, limit }`. The helper at
  response.js:41 is unused and drifts behind. Either delete the
  helper or refactor every list endpoint to call it.

**[L-02] `AI_BACKEND_URL` defaults to localhost in production** —
`backend/src/config/env.js:57`

- If the var is unset on Railway, every AI feature silently falls
  back to `http://localhost:8001` and times out. Move to the
  required-in-prod block: throw at startup.

**[L-03] Unused import / dead routes inside backend/** — see
`shared.md` Dead Code section. Removing the leftover RN files
(`App.js`, `app.json`, `eas.json`, `src/screens/`, etc.) will
remove ~50 % of the file count and stop the IDE from suggesting
the wrong files.

---

## Dead code & redundancy to delete

- `backend/App.js`, `backend/app.json`, `backend/eas.json`,
  `backend/babel.config.js` — leftover Expo files; package.json's
  `"main"` is `src/server.js` and there are no React deps.
- `backend/src/screens/`, `backend/src/navigation/`,
  `backend/src/context/`, `backend/src/i18n/`,
  `backend/src/components/`, `backend/src/constants/` — orphaned
  RN app code, never imported by any backend file.
- `backend/AI_CROP_DISESE_DETECTION/` — the now-deleted FastAPI
  copy (per `git status`); finalise the deletion only after the
  shared-pass [S-01] decision on where the FastAPI service
  actually lives.
- `backend/src/utils/response.js:41` `paginationMeta` — unused;
  delete or adopt.

## Currently missing entirely (must add)

- [ ] `/healthz` and `/readyz` (per [shared.md S-05]).
- [ ] Algorithm-pinned `jwt.verify` and explicit `iss`/`aud` claims
      (per [E-07]).
- [ ] `tokenVersion` column on `User` + middleware DB check
      (per [E-10]).
- [ ] `OTP_PEPPER` env var + HMAC-SHA256 OTP storage
      (per [E-08]).
- [ ] Atomic refresh-token rotation + re-use detection
      (per [E-04]).
- [ ] `httpServer.timeout` + `keepAliveTimeout` set explicitly
      (per [E-18]).
- [ ] `redact` config on pino + replace `console.*` calls
      (per [E-14], [E-23]).
- [ ] Per-IP rate limit on `/auth/verify-otp`
      (per [E-25]).
- [ ] Magic-byte content-type sniff on `/upload/image`
      (per [E-29]).
- [ ] `prisma.$transaction` wrappers for multi-write flows
      (`/ai/scan`, refresh, onboarding's third write — per [E-17]).
- [ ] Sentry / error tracker (mentioned in shared, owned here too).
- [ ] Multer `diskStorage` for video + image (per [E-02]).
- [ ] Upload route migrated off base64-in-JSON (per [E-03]).

## Deadlock & race-condition map (Express side)

| Endpoint / Job | Tables touched | Lock order | Risk |
|----------------|----------------|------------|------|
| `POST /auth/verify-otp` | `otp_sessions`, `users`, `refresh_tokens` | otp → user → refresh | OK (single user row) |
| `POST /auth/refresh` (current) | `refresh_tokens` × 2 | revoke → create | ⚠️ TOCTOU race [E-04] |
| `POST /onboarding/complete` | `users`, `farms`, `farm_details` | user → farm → farm_details | wrapped in tx — OK |
| `POST /ai/scan` | `ai_conversations`, `ai_messages`, `crop_disease_reports`, `ai_credits`, `ai_credit_transactions` | not locked | ⚠️ partial-write window [E-17] |
| `POST /ai/chat` | `ai_conversations`, `ai_messages`, `ai_usage`, `ai_credits` | not locked | partial-write OK (idempotent on retry) |
| Socket `group_message` | `group_messages`, `groups` | wrapped in tx (chat.socket.js:131) | OK |
| Socket `dm_send` | `direct_messages`, `users` (lookup) | not locked | OK (single insert) |
| Cron `agripredict-monthly-purge` | `prediction_cache` | row-level locks during deleteMany | ⚠️ blocks FastAPI sync writers — see [shared.md] |

The two-writer concern between Express and FastAPI is documented
in `shared.md`. Within Express alone, the only deterministic
deadlock surface is the refresh-token rotation race [E-04].

## 100-user load math

Assumes Railway "starter" container reporting 8 cores (CPU-shared)
and 1 GB RAM, single Express process.

- **Workers**: keep at 1 process for now (Node is single-threaded
  per process; cluster mode adds Prisma-pool multiplier without
  helping the sync-FS issue). After [E-01] is fixed, one process
  comfortably serves 100 concurrent users for I/O-bound routes.
- **Prisma pool**: explicitly set
  `?connection_limit=10&pool_timeout=10` on `DATABASE_URL`. With 1
  worker, total DB connections from Express = 10.
- **Memory budget at 100 users**, post-[E-02] and [E-03]:
  - 10 KB JSON per request + 16 KB stream high-water = ~26 KB/req
  - 100 × 26 KB = ~2.6 MB resident in flight
  - Disk-backed multer for video moves the 100 × 100 MB ceiling
    off the heap and into /tmp; Railway ephemeral storage is the
    new constraint, but a single 100 MB upload is bounded by
    Cloudinary's 110 s timeout (cloudinary.js:97).
- **Hottest endpoint**: `POST /ai/scan`. Even after [E-01], the
  Gemini call is on the request path and takes 4-15 s. p95 will
  exceed 300 ms by an order of magnitude. **Carve `/ai/scan`,
  `/ai/voice`, `/ai/chat` out of the global p95 SLO and budget
  separately** — e.g., p95 < 8 s for scan, p95 < 5 s for voice,
  p95 < 3 s for chat.
- **CPU**: bcrypt at 10 rounds is ~100 ms per OTP send/verify.
  After [E-08] (HMAC), under 1 ms.
- **Socket.IO**: 100 concurrent sockets on one Node process is
  trivial; it's the broadcast-on-every-connect ([E-13]) that
  scales as O(N²). Fix that.

## Pre-launch checklist (Express)

- [ ] All 6 BLOCKERS [E-01]…[E-06] resolved.
- [ ] All 14 HIGH findings [E-07]…[E-20] resolved.
- [ ] `npm audit --omit=dev --audit-level=high` returns 0.
- [ ] `npm test` covers `/auth/verify-otp`, `/auth/refresh`,
      `/onboarding/complete`, `/ai/scan` happy path and one
      failure path each.
- [ ] Load test at 150 concurrent users for 10 min:
      p95 (ex. AI routes) < 500 ms, error rate < 0.1 %, no
      memory growth, Prisma pool never saturated.
- [ ] 24-hour soak: process RSS stable; no FD leaks
      (`lsof -p <pid>` over time).
- [ ] Sentry firing on a deliberate `throw new Error('test sentry')`
      in a guarded route, with `request_id` and `user_id` redacted
      on PII fields.
- [ ] Deploying with the FastAPI deletion finalised and the new
      service location (per [shared.md S-01]) wired up.
