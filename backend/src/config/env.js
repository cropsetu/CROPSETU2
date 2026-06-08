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

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  API_PREFIX: process.env.API_PREFIX || '/api/v1',

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

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

  // ── Groq (free tier: 30 RPM / 14,400 RPD — used for all text AI tasks) ──────
  // Get free key: https://console.groq.com
  GROQ_API_KEY:   process.env.GROQ_API_KEY  || '',
  GROQ_MODEL:     process.env.GROQ_MODEL    || 'llama-3.3-70b-versatile',

  // ── Voice transcription (Speech-to-Text) ──────────────────────────────────
  // One model + one API key, no fallback — same flat-config pattern as the
  // FastAPI services. Mirrors AI_VOICE_STT_* in fastapi/.env.example.
  //
  // To swap providers, edit both lines:
  //   AI_VOICE_STT_MODEL=whisper-large-v3-turbo   (Groq Whisper, default)
  //   AI_VOICE_STT_MODEL=whisper-large-v3          (Groq Whisper, slower/more accurate)
  //   AI_VOICE_STT_MODEL=whisper-1                 (OpenAI Whisper, set AI_VOICE_STT_API_KEY=sk-...)
  AI_VOICE_STT_MODEL:   process.env.AI_VOICE_STT_MODEL    || process.env.VOICE_STT_MODEL || 'whisper-large-v3-turbo',
  AI_VOICE_STT_API_KEY: process.env.AI_VOICE_STT_API_KEY  || process.env.GROQ_API_KEY    || '',

  // Backwards-compat alias for the older VOICE_STT_MODEL env var.
  VOICE_STT_MODEL: process.env.VOICE_STT_MODEL || process.env.AI_VOICE_STT_MODEL || 'whisper-large-v3-turbo',

  // ── Anthropic / Claude (second-tier fallback for text tasks) ──────────────────
  // Models: claude-sonnet-4-6 (powerful), claude-haiku-4-5-20251001 (fast, cheap)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL:   process.env.ANTHROPIC_MODEL   || 'claude-haiku-4-5-20251001',

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
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  // Global per-IP limiter toggle. On by default in dev/prod; off under the
  // automated test suites (which fire hundreds of requests from one loopback
  // IP and would otherwise trip it). Force on with RATE_LIMIT_ENABLED=true.
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED != null
    ? process.env.RATE_LIMIT_ENABLED === 'true'
    : process.env.NODE_ENV !== 'test',
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

  IS_DEV: process.env.NODE_ENV !== 'production',
};

// ── Production secret validation (fail-fast at boot) ──────────────────────────
// An empty AI_SHARED_SECRET ⇒ the Express↔FastAPI HMAC is computed over an empty
// key ⇒ FastAPI is effectively unauthenticated. Empty provider keys ⇒ AI fails
// silently at runtime. Refuse to start in production so these can't ship unnoticed.
if (ENV.NODE_ENV === 'production') {
  const problems = [];
  if (!ENV.AI_SHARED_SECRET || ENV.AI_SHARED_SECRET.length < 16) {
    problems.push('AI_SHARED_SECRET missing/weak (Express↔FastAPI auth)');
  }
  if (!ENV.GEMINI_API_KEY) problems.push('GEMINI_API_KEY missing (chat + crop scan)');
  if (!ENV.GROQ_API_KEY)   problems.push('GROQ_API_KEY missing (voice STT)');
  if (problems.length) {
    throw new Error(`FATAL: production config invalid — ${problems.join('; ')}`);
  }
}
