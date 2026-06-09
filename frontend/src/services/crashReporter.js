/**
 * crashReporter — one place to capture unhandled frontend errors so production
 * crashes are visible to the team instead of dying silently on the device.
 *
 * Sinks (all best-effort; capturing must NEVER throw):
 *   1. Dev console — keeps the existing developer experience.
 *   2. Backend ingest (POST /telemetry/client-error) — errors land in the server
 *      logs (OPS-9) on every build, dev and prod. This is the default sink and
 *      needs no external account.
 *   3. Optional external provider (Sentry/Bugsnag/…) — register one via
 *      registerCrashReporter() once its SDK is installed. We do NOT statically
 *      import any SDK here: a require() of an uninstalled package would break the
 *      Metro bundle, so external providers are injected, not imported.
 *
 * Wire-up:
 *   - initCrashReporting() at startup (index.js) installs global handlers.
 *   - RootErrorBoundary calls captureException() for render-tree crashes.
 *   - To add Sentry: install @sentry/react-native, then in index.js
 *       import * as Sentry from '@sentry/react-native';
 *       Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN });
 *       registerCrashReporter((error, ctx) => Sentry.captureException(error, { extra: ctx }));
 */
import { Platform } from 'react-native';
import { API_BASE_URL } from '../constants/config';
import { getAccessToken } from './api';
import appJson from '../../app.json';

const APP_VERSION = appJson?.expo?.version || 'unknown';

// Optional external reporter (e.g. Sentry), injected at runtime — never imported.
let _externalReporter = null;

/** Register an external crash reporter: fn(error, context) => void. */
export function registerCrashReporter(fn) {
  _externalReporter = typeof fn === 'function' ? fn : null;
}

// Client-side flood guard so a crash loop can't spam the backend (which is also
// rate-limited). Independent of, and stricter than, any single render.
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 60_000;
let _windowStart = 0;
let _sentInWindow = 0;

function withinRateLimit() {
  const now = Date.now();
  if (now - _windowStart > WINDOW_MS) { _windowStart = now; _sentInWindow = 0; }
  if (_sentInWindow >= MAX_PER_WINDOW) return false;
  _sentInWindow += 1;
  return true;
}

function normalize(error, context = {}) {
  const err = error instanceof Error
    ? error
    : new Error(typeof error === 'string' ? error : 'Unknown error');
  const { componentStack, fatal, ...rest } = context;
  return {
    name:           err.name || 'Error',
    message:        String(err.message || 'Unknown error').slice(0, 1000),
    stack:          err.stack ? String(err.stack).slice(0, 10000) : undefined,
    componentStack: componentStack ? String(componentStack).slice(0, 10000) : undefined,
    fatal:          !!fatal,
    platform:       `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
    appVersion:     APP_VERSION,
    context:        Object.keys(rest).length ? rest : undefined,
  };
}

async function postToBackend(payload) {
  try {
    // Attach the access token (if any) so the server can tag the report with a
    // userId. Plain fetch with no cookies → the CSRF middleware is a no-op.
    const token = await getAccessToken().catch(() => null);
    await fetch(`${API_BASE_URL}/telemetry/client-error`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort: a failed report must never surface to the user or recurse.
  }
}

/**
 * Capture an error to all configured sinks. Safe to call from anywhere
 * (synchronous; network forwarding is fire-and-forget) and never throws.
 */
export function captureException(error, context = {}) {
  try {
    if (__DEV__) {
      console.error('[crashReporter]', error, context?.componentStack || '');
    }
    if (!withinRateLimit()) return;

    const payload = normalize(error, context);
    postToBackend(payload);

    if (_externalReporter) {
      try { _externalReporter(error, context); } catch { /* never let a sink break capture */ }
    }
  } catch {
    // Capturing must be bulletproof — swallow anything unexpected.
  }
}

/**
 * Install global handlers so uncaught errors and unhandled promise rejections
 * (not just render-tree crashes the error boundary catches) are reported too.
 * Call once at app startup. Idempotent enough to call again harmlessly.
 */
export function initCrashReporting() {
  // Native: wrap the global JS error handler, then delegate to the original so
  // RN's own fatal handling (RedBox in dev / crash in prod) still runs.
  if (typeof global !== 'undefined' && global.ErrorUtils?.setGlobalHandler) {
    const prev = global.ErrorUtils.getGlobalHandler?.();
    global.ErrorUtils.setGlobalHandler((error, isFatal) => {
      captureException(error, { fatal: !!isFatal, source: 'globalHandler' });
      if (typeof prev === 'function') prev(error, isFatal);
    });
  }

  // Web: unhandled promise rejections + uncaught window errors.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('unhandledrejection', (e) => {
      captureException(e?.reason || new Error('Unhandled promise rejection'), { source: 'unhandledrejection' });
    });
    window.addEventListener('error', (e) => {
      captureException(e?.error || new Error(e?.message || 'Window error'), { source: 'window.error' });
    });
  }
}
