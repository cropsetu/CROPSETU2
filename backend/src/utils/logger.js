/**
 * Backend logger with automatic PII redaction.
 *
 * Every logged argument is walked and known-sensitive object keys are masked
 * BEFORE anything reaches the console, so PII (phone, Aadhaar, PAN, bank, GST)
 * and secrets (passwords, OTPs, tokens, cookies) never land in logs even if a
 * caller passes a whole `user` / `req.body` / `{ err }` object.
 *
 * This module is intentionally dependency-free (no encrypt/env imports) to stay
 * at the bottom of the import graph and avoid cycles. Redaction is key-based:
 *   - secret-ish keys → '***REDACTED***'
 *   - phone-ish keys  → masked to last 4 digits (still useful to debug)
 * Error objects pass through untouched so stack traces are preserved (by
 * convention errors must not carry PII).
 */

const isDev = process.env.NODE_ENV !== 'production';

// Fully redacted — value is never useful and always sensitive.
const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'pwd',
  'otp', 'otphash', 'otp_hash',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'csrftoken', 'jwt',
  'authorization', 'cookie', 'setcookie', 'set-cookie',
  'aadhaar', 'aadhaarnumber', 'aadharnumber', 'aadhaarlast4', 'aadharlast4',
  'pan', 'pannumber',
  'bankaccountnumber', 'bankaccount', 'accountnumber',
  'bankifsc', 'ifsc', 'ifsccode',
  'gst', 'gstnumber',
  'cvv', 'cardnumber', 'pin',
  'secret', 'apikey', 'api_key', 'clientsecret',
]);

// Partially masked — keep the last 4 digits for debuggability.
const PHONE_KEYS = new Set([
  'phone', 'mobile', 'phonenumber', 'contact', 'contactnumber', 'contactphone', 'ownerphone',
]);

const MAX_DEPTH = 6;

function maskPhoneValue(v) {
  const digits = String(v).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `••••••${digits.slice(-4)}`;
}

/**
 * Return a redacted copy of `value` safe to log. Pure; exported for testing.
 * Primitives pass through; Errors pass through (preserve stack); objects/arrays
 * are deep-copied with sensitive keys masked. Handles circular refs + depth.
 */
export function redact(value, seen = new WeakSet(), depth = 0) {
  if (value == null) return value;
  const t = typeof value;
  if (t !== 'object') return value;          // string/number/boolean/bigint/symbol/function
  if (value instanceof Error) return value;  // keep message + stack intact
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen, depth + 1));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (SENSITIVE_KEYS.has(key)) out[k] = '***REDACTED***';
    else if (PHONE_KEYS.has(key)) out[k] = v == null ? v : maskPhoneValue(v);
    else out[k] = redact(v, seen, depth + 1);
  }
  return out;
}

const scrub = (args) => args.map((a) => redact(a));

const logger = {
  debug: (...args) => {
    if (isDev) console.log('[DEBUG]', ...scrub(args)); // eslint-disable-line no-console
  },
  info: (...args) => {
    console.log('[INFO]', ...scrub(args)); // eslint-disable-line no-console
  },
  warn: (...args) => {
    if (isDev) console.warn('[WARN]', ...scrub(args)); // eslint-disable-line no-console
  },
  error: (...args) => {
    // Errors always log; redaction still strips any PII passed alongside them.
    console.error('[ERROR]', ...scrub(args)); // eslint-disable-line no-console
  },
};

export default logger;
