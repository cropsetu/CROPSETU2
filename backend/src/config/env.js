import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

/**
 * Validate the field-encryption key at startup in EVERY environment.
 *
 * Without a valid key the encrypt() helpers silently fall back to writing PII
 * (Aadhaar, PAN, bank account) in plaintext. Allowing a service to boot in that
 * state is the bug — so we refuse to start anywhere rather than degrade quietly.
 * The key must be a 64-char hex string = 32 bytes (AES-256). Generate one with:
 *   openssl rand -hex 32
 */
function requiredEncryptionKey() {
  const val = process.env.FIELD_ENCRYPTION_KEY;
  if (!val) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is required in all environments — refusing to start ' +
      'to avoid writing PII unencrypted. Generate one with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(val)) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is invalid — it must be a 64-character hex string ' +
      '(32 bytes for AES-256). Generate a valid key with: openssl rand -hex 32',
    );
  }
  return val;
}

// ── Versioned encryption keys (key rotation) ─────────────────────────────────
// FIELD_ENCRYPTION_KEY is always available under the reserved id "0" (the legacy
// key). Additional keys for rotation are supplied via FIELD_ENCRYPTION_KEYS as
// comma-separated "id:hexkey" pairs, and FIELD_ENCRYPTION_ACTIVE_KEY_ID selects
// which key encrypts NEW data. All listed keys remain available for DECRYPTION,
// so a rotation can re-encrypt existing rows with zero downtime.
const ENC_KEY_ID_RE = /^[A-Za-z0-9_-]+$/;
const ENC_HEX64_RE  = /^[0-9a-fA-F]{64}$/;
export const LEGACY_ENCRYPTION_KEY_ID = '0';

function parseExtraEncryptionKeys() {
  const raw = process.env.FIELD_ENCRYPTION_KEYS;
  const keys = {};
  if (!raw || !raw.trim()) return keys;
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf(':');
    if (idx === -1) throw new Error(`FIELD_ENCRYPTION_KEYS entry "${entry}" must be "id:hexkey"`);
    const id  = entry.slice(0, idx).trim();
    const hex = entry.slice(idx + 1).trim();
    if (!ENC_KEY_ID_RE.test(id)) throw new Error(`FIELD_ENCRYPTION_KEYS: invalid key id "${id}" (allowed: letters, digits, _ and -)`);
    if (id === LEGACY_ENCRYPTION_KEY_ID) throw new Error('FIELD_ENCRYPTION_KEYS: id "0" is reserved for FIELD_ENCRYPTION_KEY');
    if (!ENC_HEX64_RE.test(hex)) throw new Error(`FIELD_ENCRYPTION_KEYS: key "${id}" must be a 64-character hex string`);
    if (keys[id]) throw new Error(`FIELD_ENCRYPTION_KEYS: duplicate key id "${id}"`);
    keys[id] = hex;
  }
  return keys;
}

function resolveActiveEncryptionKeyId(extraKeys) {
  const active = (process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID || LEGACY_ENCRYPTION_KEY_ID).trim();
  if (active !== LEGACY_ENCRYPTION_KEY_ID && !extraKeys[active]) {
    throw new Error(
      `FIELD_ENCRYPTION_ACTIVE_KEY_ID "${active}" is not defined — add it to ` +
      'FIELD_ENCRYPTION_KEYS (or use "0" for the legacy FIELD_ENCRYPTION_KEY).',
    );
  }
  return active;
}

const _extraEncryptionKeys = parseExtraEncryptionKeys();
const _activeEncryptionKeyId = resolveActiveEncryptionKeyId(_extraEncryptionKeys);

// ── Fraud velocity limits (FRAUD-1) ──────────────────────────────────────────
// Per sensitive action, sliding-window velocity is tracked across the user /
// device / IP dimensions and compared to two thresholds:
//   • FLAG  — record a fraud signal (audit, and an incident on the block tier)
//             but ALLOW the action through.
//   • LIMIT — block the action (429) AND flag it. Only enforced when BLOCK=true
//             and LIMIT > 0; a rule with LIMIT=0 / BLOCK=false is flag-only.
// The decision uses the WORST (highest-count) dimension, so abuse from one IP
// spread across many fresh accounts is caught even though each user count is low.
// Defaults are deliberately generous (a normal farmer never approaches them) so
// flags mean something. Tune any value without code via the matching env var:
//   VELOCITY_<ACTION>_WINDOW_SEC | _FLAG | _LIMIT | _BLOCK   (ACTION = ORDER|REFUND|LOGIN)
function _velocityRule(prefix, defaults) {
  const num = (suffix, dflt) => {
    const v = parseInt(process.env[`VELOCITY_${prefix}_${suffix}`], 10);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  const blk = process.env[`VELOCITY_${prefix}_BLOCK`];
  return {
    windowSec: num('WINDOW_SEC', defaults.windowSec),
    flag:      num('FLAG', defaults.flag),
    limit:     num('LIMIT', defaults.limit),
    block:     blk != null ? blk === 'true' : defaults.block,
  };
}

// ── Refund / chargeback abuse (FRAUD-2 / COMP-5) ─────────────────────────────
// Account-level serial-abuse detection over ORDER HISTORY (the DB), distinct
// from the short-window velocity layer (FRAUD-1): on each refund/cancel attempt
// the user's refund RATE (refunds ÷ orders over the lookback window) is compared
// to two tiers, each gated by a MINIMUM refund count so a tiny sample (e.g. 1
// order, 1 cancel = 100%) can't false-positive:
//   • FLAG     — record a fraud signal for review, allow the action.
//   • RESTRICT — block the refund/cancel (403) AND flag for review.
// The window means abuse ages out over time (self-healing) without manual unflag.
// Tune any value without code via the matching env var.
function parseRefundAbuseRule() {
  const num = (key, dflt) => {
    const v = parseInt(process.env[key], 10);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  const rate = (key, dflt) => {
    const v = parseFloat(process.env[key]);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : dflt;
  };
  return {
    lookbackDays:  num('REFUND_ABUSE_LOOKBACK_DAYS', 90),
    flagCount:     num('REFUND_ABUSE_FLAG_COUNT', 3),
    flagRate:      rate('REFUND_ABUSE_FLAG_RATE', 0.5),
    restrictCount: num('REFUND_ABUSE_RESTRICT_COUNT', 5),
    restrictRate:  rate('REFUND_ABUSE_RESTRICT_RATE', 0.7),
  };
}

function parseVelocityRules() {
  return {
    // Placed orders (COD checkout + online confirm) — block runaway checkout velocity.
    order:  _velocityRule('ORDER',  { windowSec: 3600,  flag: 6, limit: 12, block: true }),
    // Buyer-initiated reversals (order cancellation today; real refunds reuse this
    // when wired). Longer window — refund abuse plays out over a day, not an hour.
    refund: _velocityRule('REFUND', { windowSec: 86400, flag: 3, limit: 6,  block: true }),
    // Successful logins — flag-only. The OTP send/verify limits + lockout already
    // cap login *attempts* per number; this catches many successful logins to
    // DIFFERENT accounts from one device/IP (account farming / credential reuse),
    // which should surface for review but must never block a user who proved OTP.
    login:  _velocityRule('LOGIN',  { windowSec: 3600,  flag: 8, limit: 0,  block: false }),
  };
}

// ── OTP development bypass (auth bypass — NEVER in production) ────────────────
// Accepting the fixed OTP "000000" to skip real verification is strictly a
// non-production convenience (local dev + automated tests with no SMS provider).
// Resolved ONCE here, FAIL-CLOSED, so verifyOtp() checks a single frozen flag and
// absent / loose config can never enable it. ALL three must hold:
//   • explicit opt-in : OTP_DEV_BYPASS_ENABLED === 'true'
//   • never in prod   : NODE_ENV must not be 'production'
//   • no live SMS     : MSG91_AUTH_KEY must be empty
// The opt-in is what closes the old hole: the previous gate keyed only on
// NODE_ENV !== 'production', so a prod deploy that forgot to set NODE_ENV (unset,
// "prod", "staging") with no SMS key silently accepted "000000". Requiring a
// positive opt-in means a misconfigured prod box is safe by default, and the boot
// guard below additionally REFUSES to start if the opt-in is set under
// NODE_ENV=production — so it fails fast instead of exposing the bypass.
const _otpDevBypass =
  process.env.OTP_DEV_BYPASS_ENABLED === 'true' &&
  process.env.NODE_ENV !== 'production' &&
  !process.env.MSG91_AUTH_KEY;

// ── Reverse-proxy trust (X-Forwarded-For) ────────────────────────────────────
// Behind Railway / any load balancer the socket peer is the proxy, so per-IP
// rate limiting must resolve the real client from X-Forwarded-For. Express does
// that SAFELY only when `trust proxy` is set to the exact number of proxy hops
// in front of the app: it then reads the client from the right-most untrusted
// hop, which a client cannot forge. Trusting too many hops (or `true`) lets a
// client prepend a fake XFF entry, mint a fresh per-IP bucket every request, and
// bypass the global limiter — i.e. silently disable it. Railway terminates at a
// single edge proxy → 1. Override via TRUST_PROXY: a number (hop count),
// true/false, or an Express trust-proxy string ('loopback', subnet list, …).
function parseTrustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (raw == null || raw.trim() === '') {
    // Default: 1 hop in production (Railway edge proxy); loopback in dev/test
    // where requests come straight from localhost and there is no real proxy.
    return process.env.NODE_ENV === 'production' ? 1 : 'loopback';
  }
  const t = raw.trim();
  if (t === 'true')  return true;
  if (t === 'false') return false;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return t; // pass-through: 'loopback', comma-separated subnet allowlist, etc.
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  API_PREFIX: process.env.API_PREFIX || '/api/v1',

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // ── Job queue (BullMQ) ──────────────────────────────────────────────────────
  // Offloads heavy side-effects (push/notification delivery, etc.) off the
  // request path. Default ON. The in-process worker lets a single-service deploy
  // process jobs without a separate worker; set QUEUE_INPROCESS_WORKER=false and
  // run `npm run worker` to scale workers independently of the web tier.
  QUEUE_ENABLED:           process.env.QUEUE_ENABLED !== 'false',
  QUEUE_INPROCESS_WORKER:  process.env.QUEUE_INPROCESS_WORKER !== 'false',
  QUEUE_CONCURRENCY:       parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),

  JWT_SECRET: (() => {
    const secret = required('JWT_SECRET');
    // [FIX #9] Enforce minimum secret length for HS256 security
    if (secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters for HS256 security');
    }
    return secret;
  })(),
  // Short-lived access token — a stolen token is only usable briefly. Clients
  // transparently mint a new one via refresh-token rotation (see utils/jwt.js).
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  REFRESH_TOKEN_EXPIRES_DAYS: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '30', 10),
  // Server-side session timeouts (enforced on refresh):
  //  - idle: max time between refreshes; slides forward on each use, so a session
  //    idle past this window can no longer refresh.
  //  - absolute: hard cap on total session lifetime from first login, regardless
  //    of activity. Beyond this the session must re-authenticate.
  SESSION_IDLE_TIMEOUT_DAYS: parseInt(process.env.SESSION_IDLE_TIMEOUT_DAYS || '7', 10),
  SESSION_ABSOLUTE_TIMEOUT_DAYS: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_DAYS || '30', 10),
  // Max concurrent sessions (refresh-token lineages) per user. Logging in beyond
  // this evicts the oldest session. 0 = unlimited.
  MAX_CONCURRENT_SESSIONS: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '5', 10),
  // Max simultaneous Socket.IO connections per user PER INSTANCE (SCALE-5).
  // Bounds WS handles so a reconnect-loop or abusive client can't exhaust the
  // instance. Generous enough for phone + tablet + web + transient reconnects.
  SOCKET_MAX_CONN_PER_USER: parseInt(process.env.SOCKET_MAX_CONN_PER_USER || '10', 10),

  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY || '',
  MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID || '',
  MSG91_SENDER_ID: process.env.MSG91_SENDER_ID || 'FRMESY',
  // Short code TTL — expire OTPs quickly to shrink the guessing window.
  OTP_EXPIRE_MINUTES: parseInt(process.env.OTP_EXPIRE_MINUTES || '5', 10),
  OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),

  // ── OTP brute-force lockout (tracked in Redis, keyed by phone) ──────────────
  // After OTP_LOCK_THRESHOLD failed verifications the number is temporarily
  // locked. Each successive lock within OTP_LOCK_CYCLE_WINDOW grows the lock
  // exponentially (base × 2^(cycle-1)) up to OTP_LOCK_MAX. Failures age out of
  // the counter after OTP_FAIL_WINDOW of inactivity.
  OTP_LOCK_THRESHOLD: parseInt(process.env.OTP_LOCK_THRESHOLD || '5', 10),
  OTP_LOCK_BASE_SECONDS: parseInt(process.env.OTP_LOCK_BASE_SECONDS || '60', 10),
  OTP_LOCK_MAX_SECONDS: parseInt(process.env.OTP_LOCK_MAX_SECONDS || '3600', 10),
  OTP_FAIL_WINDOW_SECONDS: parseInt(process.env.OTP_FAIL_WINDOW_SECONDS || '900', 10),
  OTP_LOCK_CYCLE_WINDOW_SECONDS: parseInt(process.env.OTP_LOCK_CYCLE_WINDOW_SECONDS || '86400', 10),

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',

  // ── AI & Weather (Krishi Raksha + FarmMind) ────────────────────────────────
  // Gemini is FREE (15 RPM / 1 M tokens/day). Get key: https://aistudio.google.com/app/apikey
  GEMINI_API_KEY:      process.env.GEMINI_API_KEY  || '',
  GEMINI_MODEL:        process.env.GEMINI_MODEL    || 'gemini-2.5-flash',
  OPENAI_API_KEY:      process.env.OPENAI_API_KEY  || '',
  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',

  // ── Voice transcription + speech (Sarvam — Indic STT/TTS) ──────────────────
  // CropSetu is Gemini-only for LLM and Sarvam-only for voice (Groq Whisper was
  // dropped). SARVAM_API_KEY (below) powers both speech-to-text and the spoken
  // reply. These AI_VOICE_STT_* vars are retained only for backwards-compat with
  // older deploys and are no longer used by the voice route.
  AI_VOICE_STT_MODEL:   process.env.AI_VOICE_STT_MODEL || process.env.VOICE_STT_MODEL || 'sarvam:saarika',
  AI_VOICE_STT_API_KEY: process.env.AI_VOICE_STT_API_KEY || process.env.SARVAM_API_KEY || '',
  VOICE_STT_MODEL: process.env.VOICE_STT_MODEL || process.env.AI_VOICE_STT_MODEL || 'sarvam:saarika',

  // ── FastAPI AI Backend (CropGuard agentic pipeline) ───────────────────────────
  // Run: cd AI_CROP_DISESE_DETECTION && .venv/bin/uvicorn main:app --port 8001 --reload
  AI_BACKEND_URL: process.env.AI_BACKEND_URL || 'http://localhost:8001',
  // Shared secret used to HMAC-sign every Express → FastAPI request so the
  // FastAPI public URL on Railway cannot be hit directly by anyone else.
  // Set BOTH services to the same value. In dev with AI_AUTH_REQUIRED=false
  // on FastAPI you can leave this empty.
  AI_SHARED_SECRET: process.env.AI_SHARED_SECRET || '',
  // Route /ai/scan to FastAPI's agentic pipeline instead of running Gemini
  // directly inside Express. Default: false (keeps the historic path during
  // rollout). Flip to true once the FastAPI service is reachable and tier
  // chains have been smoke-tested in staging.
  USE_FASTAPI_FOR_SCAN: String(process.env.USE_FASTAPI_FOR_SCAN || 'false').toLowerCase() === 'true',

  // ── AI Credits & token metering (company policy — tune without code) ─────────
  // Credits are debited per ACTUAL tokens consumed: credits = ceil(tokens / TOKENS_PER_CREDIT),
  // with a per-feature minimum (CREDIT_COSTS) as a floor. Free users get a monthly
  // grant that auto-refills on the 1st. Change these to update pricing/policy.
  AI_TOKENS_PER_CREDIT:    parseInt(process.env.AI_TOKENS_PER_CREDIT || '1000', 10),   // 100 credits ~ 1 lakh tokens
  AI_FREE_MONTHLY_CREDITS: parseInt(process.env.AI_FREE_MONTHLY_CREDITS || '100', 10), // free grant / month
  AI_MIN_CREDITS_PER_CALL: parseInt(process.env.AI_MIN_CREDITS_PER_CALL || '1', 10),   // floor per billable call

  // ── Sarvam AI (Indian multilingual STT / TTS / Translation) ─────────────────
  // Get key: https://dashboard.sarvam.ai  — supports 10+ Indian languages
  SARVAM_API_KEY: process.env.SARVAM_API_KEY || '',

  // ── Market Data (data.gov.in — FREE) ──────────────────────────────────────
  // Get your own free key at https://data.gov.in (1-min registration)
  DATA_GOV_API_KEY: process.env.DATA_GOV_API_KEY || '',

  // ── Field-level encryption (PII: Aadhaar, PAN, bank account) ─────────────────
  // 64-char hex string = 32 bytes. Generate with: openssl rand -hex 32
  // REQUIRED in ALL environments — a missing/invalid key aborts startup so PII
  // can never be written unencrypted (see requiredEncryptionKey above).
  FIELD_ENCRYPTION_KEY: requiredEncryptionKey(),
  // Additional rotation keys ({ id: hex }) + which id encrypts new data.
  FIELD_ENCRYPTION_KEYS: _extraEncryptionKeys,
  FIELD_ENCRYPTION_ACTIVE_KEY_ID: _activeEncryptionKeyId,

  // ── Payment Gateway (Razorpay) ────────────────────────────────────────────
  // Get keys from https://dashboard.razorpay.com — use test keys for dev
  RAZORPAY_KEY_ID:     process.env.RAZORPAY_KEY_ID     || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',

  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  // How long (seconds) browsers may cache a CORS preflight (Access-Control-Max-Age),
  // cutting the extra OPTIONS round-trip on every cross-origin call. Default 10 min;
  // browsers cap it (Chrome ≤ 2h, Firefox ≤ 24h). Keep modest so CORS policy
  // changes propagate quickly. Set 0 to disable caching.
  CORS_MAX_AGE: parseInt(process.env.CORS_MAX_AGE || '600', 10),
  // Number of trusted reverse-proxy hops (see parseTrustProxy above). Drives
  // app.set('trust proxy', …) so req.ip — and therefore the per-IP rate-limit
  // key — is the real, unspoofable client address.
  TRUST_PROXY: parseTrustProxy(),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  // Global per-IP limiter toggle. On by default in dev/prod; off under the
  // automated test suites (which fire hundreds of requests from one loopback
  // IP and would otherwise trip it). Force on with RATE_LIMIT_ENABLED=true.
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED != null
    ? process.env.RATE_LIMIT_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  // Fail-closed switch for security-critical rate limiters that have NO local
  // fallback (the Redis-only AI cost limiters in middleware/redisRateLimit.js).
  // When Redis is unavailable the limit cannot be enforced across instances, so
  // rather than silently allowing unlimited requests we REJECT with 503. Defaults
  // ON in production (security over availability for these paths) and OFF in
  // dev/test, where Redis is often absent and requests must still flow. The
  // OTP/global/user limiters in middleware/rateLimit.js are unaffected — they keep
  // their per-instance in-memory fallback so login never hard-fails on a Redis blip.
  RATE_LIMIT_FAIL_CLOSED: process.env.RATE_LIMIT_FAIL_CLOSED != null
    ? process.env.RATE_LIMIT_FAIL_CLOSED === 'true'
    : process.env.NODE_ENV === 'production',
  // Cache warming: preload the hottest mandi-price keys on startup + on a
  // schedule so the first post-deploy request hits a warm cache instead of the
  // cold Groq latency (see services/cacheWarmer.service.js). On by default;
  // auto-off under tests. Warming no-ops gracefully when GROQ_API_KEY is unset.
  CACHE_WARMING_ENABLED: process.env.CACHE_WARMING_ENABLED != null
    ? process.env.CACHE_WARMING_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  // Cache observability alert thresholds (see utils/cacheMetrics.js). A periodic
  // check emits a loud [ALERT] log when the windowed cache hit rate drops below
  // CACHE_HIT_RATE_ALERT_THRESHOLD (0..1) or Redis used-memory exceeds
  // REDIS_MEMORY_ALERT_PCT (% of maxmemory) — picked up by OPS-4 log alerting.
  CACHE_HIT_RATE_ALERT_THRESHOLD: parseFloat(process.env.CACHE_HIT_RATE_ALERT_THRESHOLD || '0.5'),
  REDIS_MEMORY_ALERT_PCT: parseFloat(process.env.REDIS_MEMORY_ALERT_PCT || '85'),
  // OTP send limits — sliding window per phone and per IP (see middleware/rateLimit.js).
  // Per-phone caps SMS-bombing of a single number; per-IP caps total cost from
  // one network/NAT across many numbers. Window defaults to 1 hour.
  OTP_RATE_LIMIT_WINDOW_MS: parseInt(process.env.OTP_RATE_LIMIT_WINDOW_MS || '3600000', 10),
  OTP_RATE_LIMIT_MAX: parseInt(process.env.OTP_RATE_LIMIT_MAX || '5', 10),
  OTP_IP_RATE_LIMIT_MAX: parseInt(process.env.OTP_IP_RATE_LIMIT_MAX || '50', 10),
  // Verify-attempt rate limits — cap the RATE of OTP guessing in a short window
  // (complements the AUTH-4 lockout, which caps total failures). Kept above the
  // lockout threshold so a locked number surfaces 423 before this 429.
  OTP_VERIFY_RATE_LIMIT_WINDOW_MS: parseInt(process.env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS || '60000', 10),
  OTP_VERIFY_RATE_LIMIT_MAX: parseInt(process.env.OTP_VERIFY_RATE_LIMIT_MAX || '10', 10),
  OTP_VERIFY_IP_RATE_LIMIT_MAX: parseInt(process.env.OTP_VERIFY_IP_RATE_LIMIT_MAX || '30', 10),

  // ── Proof-of-work gate on OTP send (anti-enumeration / anti-bulk-abuse) ──────
  // Under suspicion (more than OTP_POW_SUSPICION_THRESHOLD sends from one IP in
  // the OTP window, still below the hard per-IP cap), /send-otp demands a solved
  // proof-of-work before sending. Cheap for a human sending once; expensive at
  // scale, so bulk automated sends become costly. Pairs with the AUTH-1 limits.
  // Disabled automatically when OTP_POW_SECRET is unset (fail-safe — never blocks
  // login if misconfigured). Secret signs challenges so verification is stateless.
  // Defaults ON in dev/prod (reuses the JWT secret) but OFF under the test runner
  // so the existing OTP/rate-limit suites aren't forced through a PoW challenge.
  OTP_POW_SECRET: process.env.OTP_POW_SECRET
    || (process.env.NODE_ENV === 'test' ? '' : process.env.JWT_ACCESS_SECRET || ''),
  OTP_POW_DIFFICULTY: parseInt(process.env.OTP_POW_DIFFICULTY || '18', 10), // leading zero BITS
  OTP_POW_SUSPICION_THRESHOLD: parseInt(process.env.OTP_POW_SUSPICION_THRESHOLD || '3', 10),
  OTP_POW_CHALLENGE_TTL_MS: parseInt(process.env.OTP_POW_CHALLENGE_TTL_MS || '180000', 10), // 3 min

  // Resolved, frozen OTP dev-bypass decision (see _otpDevBypass above). Always
  // false in production. verifyOtp() must gate the "000000" bypass on THIS only.
  OTP_DEV_BYPASS: _otpDevBypass,

  // ── Fraud velocity limits (FRAUD-1) ─────────────────────────────────────────
  // Master switch for the velocity risk layer (see parseVelocityRules above and
  // services/velocity.service.js). On by default in dev/prod; auto-OFF under the
  // test runner (the API suites fire many orders/logins from one loopback IP and
  // would otherwise trip it) — force on with VELOCITY_ENABLED=true.
  VELOCITY_ENABLED: process.env.VELOCITY_ENABLED != null
    ? process.env.VELOCITY_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  VELOCITY_RULES: parseVelocityRules(),

  // ── Refund / chargeback abuse (FRAUD-2 / COMP-5) ────────────────────────────
  // Master switch for the account-level refund-abuse layer (see
  // parseRefundAbuseRule above and services/refundAbuse.service.js). On by default
  // in dev/prod; auto-OFF under the test runner (the order/cancel API suites
  // create + cancel many orders for one user and would otherwise trip it) —
  // force on with REFUND_ABUSE_ENABLED=true.
  REFUND_ABUSE_ENABLED: process.env.REFUND_ABUSE_ENABLED != null
    ? process.env.REFUND_ABUSE_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  REFUND_ABUSE: parseRefundAbuseRule(),

  // ── Device fingerprinting & multi-account detection (FRAUD-3) ───────────────
  // Persist (device, account) links at login/order; when one strong device id
  // (the client's X-Device-Id) backs ≥ FLAG_ACCOUNTS distinct accounts within the
  // lookback window, surface the linked cluster for review (flag-only, never
  // blocks). On by default in dev/prod; auto-OFF under the test runner.
  DEVICE_FINGERPRINT_ENABLED: process.env.DEVICE_FINGERPRINT_ENABLED != null
    ? process.env.DEVICE_FINGERPRINT_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  DEVICE_LINK: {
    lookbackDays: (() => { const v = parseInt(process.env.DEVICE_LINK_LOOKBACK_DAYS, 10); return Number.isFinite(v) && v > 0 ? v : 30; })(),
    flagAccounts: (() => { const v = parseInt(process.env.DEVICE_LINK_FLAG_ACCOUNTS, 10); return Number.isFinite(v) && v >= 2 ? v : 3; })(),
  },

  // ── Geo-anomaly login detection (FRAUD-4) ───────────────────────────────────
  // Score each login on geo/IP anomalies (impossible travel + new country) using
  // the auth-audit history (AUTH-18), and alert + signal step-up on a hit. IP→geo
  // is resolved OFFLINE (optional geoip-lite — no IP ever leaves the server, DPDP-
  // safe); inert until that lib is installed. On by default in dev/prod; auto-OFF
  // under the test runner.
  //   • maxSpeedKmh — implied travel speed between consecutive logins above which
  //     it's "impossible" (≈ jet cruise; >900 km/h is implausible ground travel).
  //   • minKm       — minimum hop distance before impossible-travel applies, so
  //     coarse IP-geo jitter within a region doesn't false-positive.
  GEO_ANOMALY_ENABLED: process.env.GEO_ANOMALY_ENABLED != null
    ? process.env.GEO_ANOMALY_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  GEO_ANOMALY: {
    maxSpeedKmh:    (() => { const v = parseInt(process.env.GEO_ANOMALY_MAX_SPEED_KMH, 10); return Number.isFinite(v) && v > 0 ? v : 900; })(),
    minKm:          (() => { const v = parseInt(process.env.GEO_ANOMALY_MIN_KM, 10); return Number.isFinite(v) && v >= 0 ? v : 500; })(),
    lookbackDays:   (() => { const v = parseInt(process.env.GEO_ANOMALY_LOOKBACK_DAYS, 10); return Number.isFinite(v) && v > 0 ? v : 90; })(),
    lookbackLogins: (() => { const v = parseInt(process.env.GEO_ANOMALY_LOOKBACK_LOGINS, 10); return Number.isFinite(v) && v > 0 ? v : 20; })(),
  },

  // ── Fake-review / fake-listing signals (FRAUD-5) ────────────────────────────
  // Heuristics on new reviews/listings — burst (many in a short window),
  // duplication (same normalized text re-posted), and author account age — score
  // the item; at/above flagScore it routes to the moderation queue (REV-5) for
  // human review (it is NOT auto-removed). Weights: burst/duplicate = 2,
  // new_account = 1 (so a lone new account never flags; it only amplifies).
  // On by default in dev/prod; auto-OFF under the test runner.
  CONTENT_FRAUD_ENABLED: process.env.CONTENT_FRAUD_ENABLED != null
    ? process.env.CONTENT_FRAUD_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
  CONTENT_FRAUD: {
    burstWindowMin:   (() => { const v = parseInt(process.env.CONTENT_FRAUD_BURST_WINDOW_MIN, 10); return Number.isFinite(v) && v > 0 ? v : 60; })(),
    reviewBurstCount: (() => { const v = parseInt(process.env.CONTENT_FRAUD_REVIEW_BURST_COUNT, 10); return Number.isFinite(v) && v >= 2 ? v : 5; })(),
    listingBurstCount:(() => { const v = parseInt(process.env.CONTENT_FRAUD_LISTING_BURST_COUNT, 10); return Number.isFinite(v) && v >= 2 ? v : 5; })(),
    newAccountDays:   (() => { const v = parseInt(process.env.CONTENT_FRAUD_NEW_ACCOUNT_DAYS, 10); return Number.isFinite(v) && v >= 0 ? v : 3; })(),
    flagScore:        (() => { const v = parseInt(process.env.CONTENT_FRAUD_FLAG_SCORE, 10); return Number.isFinite(v) && v > 0 ? v : 2; })(),
  },

  // ── Payment-amount tamper alarms (FRAUD-6) ──────────────────────────────────
  // The checkout-confirm flow already BLOCKS when the paid/authorized amount (or
  // a client-sent total, or the payment's owner) disagrees with the authoritative
  // order amount (PAY-3 verification). This switch controls the ALARM raised on
  // such a block — an audit row + a deduped FRAUD incident — so tamper attempts
  // don't go unnoticed. On by default in dev/prod; auto-OFF under the test runner.
  PAYMENT_TAMPER_ALARM_ENABLED: process.env.PAYMENT_TAMPER_ALARM_ENABLED != null
    ? process.env.PAYMENT_TAMPER_ALARM_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',

  IS_DEV: process.env.NODE_ENV !== 'production',
};

// ── Production secret validation (fail-fast at boot) ──────────────────────────
// An empty AI_SHARED_SECRET ⇒ the Express↔FastAPI HMAC is computed over an empty
// key ⇒ FastAPI is effectively unauthenticated. Empty provider keys ⇒ AI fails
// silently at runtime. Refuse to start in production so these can't ship unnoticed.
if (ENV.NODE_ENV === 'production') {
  const problems = [];
  // The OTP dev-bypass is already forced off in production (_otpDevBypass), but
  // a deploy that ships OTP_DEV_BYPASS_ENABLED=true signals a dangerous config
  // mistake — refuse to boot rather than leave a foot-gun one NODE_ENV slip away.
  if (process.env.OTP_DEV_BYPASS_ENABLED === 'true') {
    problems.push('OTP_DEV_BYPASS_ENABLED must not be enabled in production (OTP auth bypass)');
  }
  if (!ENV.AI_SHARED_SECRET || ENV.AI_SHARED_SECRET.length < 16) {
    problems.push('AI_SHARED_SECRET missing/weak (Express↔FastAPI auth)');
  }
  if (!ENV.GEMINI_API_KEY) problems.push('GEMINI_API_KEY missing (all LLM features: chat, scan, alerts, pest)');
  if (!ENV.SARVAM_API_KEY) problems.push('SARVAM_API_KEY missing (voice STT + TTS)');
  if (problems.length) {
    throw new Error(`FATAL: production config invalid — ${problems.join('; ')}`);
  }
}
