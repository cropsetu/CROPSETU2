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
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  REFRESH_TOKEN_EXPIRES_DAYS: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '30', 10),

  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY || '',
  MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID || '',
  MSG91_SENDER_ID: process.env.MSG91_SENDER_ID || 'FRMESY',
  OTP_EXPIRE_MINUTES: parseInt(process.env.OTP_EXPIRE_MINUTES || '10', 10),
  OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),

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
  OTP_RATE_LIMIT_MAX: parseInt(process.env.OTP_RATE_LIMIT_MAX || '5', 10),

  IS_DEV: process.env.NODE_ENV !== 'production',
};
