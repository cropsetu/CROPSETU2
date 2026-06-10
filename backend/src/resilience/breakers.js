/**
 * Per-dependency circuit breakers + a shared failure classifier.
 *
 * Centralises breaker tuning so every call site for a given external service
 * shares one breaker (one health view) and a consistent policy. Wrap a call as:
 *
 *   import { fastapiBreaker, httpFailure } from '../resilience/breakers.js';
 *   return fastapiBreaker().execute(() => doFetch(), { isFailure: httpFailure });
 *
 * When the breaker is OPEN the call short-circuits with a CircuitOpenError
 * (status 503) instead of piling onto a dead dependency.
 */
import { getBreaker } from './circuitBreaker.js';

const NETWORK_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE',
]);

/**
 * Should this error count toward tripping the breaker?
 *
 * YES for genuine dependency ill-health: network/timeout errors and 5xx.
 * NO for healthy-but-rejected responses (4xx — the dependency answered, it just
 * said no; e.g. Razorpay 400, FastAPI 402 spend-cap, 404). Counting those would
 * trip the breaker on normal business outcomes.
 *
 * Handles both fetch-style errors (`err.status`) and axios-style
 * (`err.response.status`); a missing status implies a network-level failure.
 */
export function httpFailure(err) {
  if (!err) return true;
  if (err.code && NETWORK_CODES.has(err.code)) return true;
  const status = err.status ?? err.response?.status;
  if (status == null) return true; // no HTTP response reached us → network failure
  return status >= 500;
}

// ── Tuned breakers per external dependency ───────────────────────────────────
// timeoutMs is a backstop ABOVE each client's own timeout, so the client's
// AbortController/axios timeout fires first and the breaker timeout only catches
// a wedged call. resetTimeoutMs is how long we fail fast before probing recovery.

/** FastAPI AI service — calls can legitimately run up to ~120s (escalated scans). */
export const fastapiBreaker = () => getBreaker('fastapi', {
  timeoutMs: 130_000, failureThreshold: 0.5, volumeThreshold: 5, resetTimeoutMs: 30_000,
});

/** Razorpay payments — short calls; protect the checkout path. */
export const razorpayBreaker = () => getBreaker('razorpay', {
  timeoutMs: 15_000, failureThreshold: 0.5, volumeThreshold: 5, resetTimeoutMs: 30_000,
});

/** Sarvam voice (STT/TTS/translate) — best-effort; also supplies the missing timeout. */
export const sarvamBreaker = () => getBreaker('sarvam', {
  timeoutMs: 20_000, failureThreshold: 0.5, volumeThreshold: 5, resetTimeoutMs: 30_000,
});
