import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

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

  // ── Sarvam AI (Indian multilingual STT / TTS / Translation) ─────────────────
  // Get key: https://dashboard.sarvam.ai  — supports 10+ Indian languages
  SARVAM_API_KEY: process.env.SARVAM_API_KEY || '',

  // ── Market Data (data.gov.in — FREE) ──────────────────────────────────────
  // Get your own free key at https://data.gov.in (1-min registration)
  DATA_GOV_API_KEY: process.env.DATA_GOV_API_KEY || '',

  // ── Field-level encryption (PII: Aadhaar, PAN, bank account) ─────────────────
  // 64-char hex string = 32 bytes. Generate with: openssl rand -hex 32
  // REQUIRED in production — without it PII is stored unencrypted (dev warning only).
  FIELD_ENCRYPTION_KEY: process.env.NODE_ENV === 'production'
    ? (process.env.FIELD_ENCRYPTION_KEY || (() => { throw new Error('FIELD_ENCRYPTION_KEY is required in production'); })())
    : (process.env.FIELD_ENCRYPTION_KEY || ''),

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
