/**
 * FarmEasy API Client
 * - `api`    : default 15-s timeout, used for all CRUD / chat / fast endpoints.
 * - `aiApi`  : 120-s timeout, used only for long AI scan / pipeline calls.
 * Both share the same auth + refresh + safe-error interceptors.
 */
import axios from 'axios';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import { setItem, getItem, deleteItem } from '../utils/storage';
import { API_BASE_URL, STORAGE_KEYS } from '../constants/config';
import { isDefinitiveAuthFailure } from './authFailure';

// On web, opt into cookie-based refresh transport: the server keeps the refresh
// token in an httpOnly cookie and never returns it in the body.
const IS_WEB = Platform.OS === 'web';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// RN-safe UUID for the Idempotency-Key header (crypto.randomUUID when present).
function genIdemKey() {
  try { if (global.crypto?.randomUUID) return global.crypto.randomUUID(); } catch {}
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// CSRF double-submit token. The server sets a (JS-readable) `csrf` cookie; we
// echo it in X-CSRF-Token on mutating requests. Reading it from the cookie (not
// memory) means it survives a reload, so the silent cookie-refresh still passes.
function getCsrfToken() {
  if (!IS_WEB || typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── Token helpers ─────────────────────────────────────────────────────────────
export async function saveTokens({ accessToken, refreshToken, userId }) {
  const ops = [
    setItem(STORAGE_KEYS.ACCESS_TOKEN,  accessToken),
    setItem(STORAGE_KEYS.TOKEN_SAVED_AT, String(Date.now())),
  ];
  // On web the refresh token is undefined here (it's in the httpOnly cookie),
  // so there's nothing to persist. Only store what we actually received.
  if (refreshToken != null) ops.push(setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken));
  if (userId != null)       ops.push(setItem(STORAGE_KEYS.USER_ID, userId));
  await Promise.all(ops);
}

export async function clearTokens() {
  await Promise.all([
    deleteItem(STORAGE_KEYS.ACCESS_TOKEN),
    deleteItem(STORAGE_KEYS.REFRESH_TOKEN),
    deleteItem(STORAGE_KEYS.USER_ID),
    deleteItem(STORAGE_KEYS.TOKEN_SAVED_AT),
    deleteItem(STORAGE_KEYS.LAST_ACTIVE_AT),
  ]);
}

export const getAccessToken  = () => getItem(STORAGE_KEYS.ACCESS_TOKEN);
const getRefreshToken        = () => getItem(STORAGE_KEYS.REFRESH_TOKEN);
export const getUserId       = () => getItem(STORAGE_KEYS.USER_ID);

// ── Safe error message ────────────────────────────────────────────────────────
// Never forward raw server error strings to the UI — they may contain stack
// traces, SQL snippets, or internal paths. Map to generic user-facing messages.
export function safeErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return null;
  if (error.code === 'ECONNABORTED') return 'Request timed out. Please check your connection.';
  if (error.message === 'Network Error')  return 'No internet connection. Please try again.';
  const status = error.response?.status;
  if (status === 400) return 'Invalid request. Please check your details and try again.';
  if (status === 401) return 'Session expired. Please log in again.';
  if (status === 402) return error.response?.data?.error?.message || 'Insufficient credits.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 409) return 'A conflict occurred. Please refresh and try again.';
  if (status === 422) return 'Some details look invalid. Please review and try again.';
  // 429 covers BOTH a transient rate-limit AND a hard daily free-tier cap. The
  // backend sends a safe, specific message for the daily cap ("…free users can run
  // N scans per day. Try again tomorrow."); surface it so the farmer knows whether
  // to wait a minute or upgrade, instead of a misleading generic retry prompt.
  if (status === 429) return error.response?.data?.error?.message || 'Too many requests. Please wait a moment and try again.';
  if (status === 503) return 'Service temporarily unavailable. Please try again shortly.';
  if (status >= 500)  return 'Server error. Please try again later.';
  return fallback;
}

// ── Axios instances ───────────────────────────────────────────────────────────
const baseConfig = {
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    // Web: tell the API to use the httpOnly refresh cookie instead of body tokens.
    ...(IS_WEB ? { 'X-Auth-Transport': 'cookie' } : {}),
  },
  // Web: send/receive the httpOnly refresh cookie (cross-origin requires this).
  withCredentials: IS_WEB,
  // Accept 2xx + 3xx. Browsers can revalidate via If-None-Match and surface a
  // raw 304 to JS (depends on cache mode); the default 200-299-only policy
  // would reject that and break perfectly-good cached data.
  validateStatus: (status) => status >= 200 && status < 400,
};

// Default: snappy. For everything except AI scan / orchestrator pipelines.
const api   = axios.create({ ...baseConfig, timeout: 15_000  });

// AI: long-running. Crop scan can take 30–90 s on the 5-agent pipeline,
// and up to 120 s when the cascade-into-ensemble flow escalates (Gemini
// Pro + Claude Sonnet voted in parallel, then reconciled). Express now
// polls the FastAPI async job queue for up to 180 s server-side; this
// timeout sits above that so the mobile request doesn't abort before
// Express has a chance to return the result.
//
// TODO: switch to mobile-side polling of /ai/scan/{job_id} so we don't
// need long-lived HTTP connections from the device at all.
const aiApi = axios.create({ ...baseConfig, timeout: 200_000 });

// ── Shared interceptors ───────────────────────────────────────────────────────
function attachInterceptors(instance) {
  // For multipart/form-data, the platform's networking layer must set the
  // Content-Type itself so it includes the correct boundary parameter:
  //   - Native (RN OkHttp/NSURLSession): set to 'multipart/form-data' and
  //     the layer rewrites it with the boundary.
  //   - Web (browser XHR/fetch): DELETE Content-Type entirely; the browser
  //     refuses to add the boundary if we already specified the header.
  instance.interceptors.request.use((config) => {
    if (config.data instanceof FormData) {
      if (Platform.OS === 'web') {
        if (typeof config.headers?.delete === 'function') config.headers.delete('Content-Type');
        else delete config.headers['Content-Type'];
      } else {
        if (typeof config.headers?.set === 'function') {
          config.headers.set('Content-Type', 'multipart/form-data');
        } else {
          config.headers['Content-Type'] = 'multipart/form-data';
        }
      }
    }
    return config;
  });

  // Attach access token (+ CSRF token on web mutations) to every request.
  instance.interceptors.request.use(async (config) => {
    const token = await getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;

    // Web: echo the CSRF cookie on state-changing requests (double-submit).
    if (IS_WEB && MUTATING.has((config.method || 'get').toUpperCase())) {
      const csrf = getCsrfToken();
      if (csrf) config.headers['X-CSRF-Token'] = csrf;
    }

    // Idempotency-Key on mutations that must not double-apply. Set once per
    // config, so the 401-refresh replay — which re-sends this same config
    // object — carries the SAME key and the backend idempotency middleware
    // dedupes it.
    //
    // That is the ONLY retry this covers. A caller that builds a new request to
    // retry (writeQueue did) gets a fresh config, no header, and a fresh key —
    // which is not idempotent at all. Such callers must mint their own key and
    // pass it in a config; the `!config.headers[...]` guard below then leaves
    // it alone. writeQueue.js and the checkout screen both do this.
    //
    // `/animals` is here because a slow POST on a village
    // connection is exactly the case where a farmer taps Publish twice and ends
    // up with the same buffalo listed twice.
    if (MUTATING.has((config.method || 'get').toUpperCase())) {
      const url = config.url || '';
      const needsIdem = url.includes('/farms')
        || url.includes('/cycles')
        || url.includes('/animals')
        // Shop orders and payments. These were NOT covered, which is the single
        // most expensive omission in the list: a double-tap on "Place Order", or
        // the 401-refresh replay above, created a SECOND order and decremented
        // stock twice. The online path was accidentally protected by the unique
        // index on `paymentRef`; cash on delivery — what most farmers use — was
        // not protected at all.
        //
        // NOTE: the checkout screen sets its OWN key so it survives a user-driven
        // retry as the same order. This generated key is the safety net for any
        // other caller, and for the replay path, which reuses this same config.
        || url.includes('/agristore/orders');
      if (needsIdem && !config.headers['Idempotency-Key']) {
        config.headers['Idempotency-Key'] = genIdemKey();
      }
    }
    return config;
  });

  // Auto-refresh on 401 + attach userMessage on every error.
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config;

      if (error.response?.status === 401 && original && !original._retry) {
        return refreshAndRetry(instance, original).catch((err) => {
          err.userMessage = safeErrorMessage(err);
          return Promise.reject(err);
        });
      }

      error.userMessage = safeErrorMessage(error);
      return Promise.reject(error);
    }
  );
}

// ── Refresh-on-401 (shared queue across both instances) ──────────────────────
let isRefreshing = false;
let failedQueue  = [];

function processQueue(error, token = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
}

// Core refresh: POST /auth/refresh (web cookie / native body), persist the new
// tokens, and resolve with the new access token. Dedupes concurrent callers via
// the shared isRefreshing flag + failedQueue so only ONE network refresh runs at
// a time — whether triggered by a 401 retry or a proactive expiry check.
// ── Transient-failure cooldown ────────────────────────────────────────────────
// Destroying the tokens on any failure used to be an accidental circuit breaker:
// after one failed refresh there was nothing left to retry with, so the loop
// stopped. Now that a transport failure preserves the session, that brake is
// gone — and every 401 in the app funnels here, including the ones produced by
// screens that poll on a fixed interval. During a backend outage that is a
// synchronised retry storm from every device at once, against the service that
// is already struggling.
//
// So: after a non-definitive failure, refuse to touch the network for a growing,
// jittered interval. Jitter matters more than the delay — it is what stops
// thousands of phones retrying in lockstep. Any success clears it.
let refreshCooldownUntil = 0;
let transientFailures    = 0;

function noteRefreshSuccess() {
  transientFailures = 0;
  refreshCooldownUntil = 0;
}

function noteTransientRefreshFailure() {
  transientFailures += 1;
  const ceiling = Math.min(30_000, 1_000 * 2 ** (transientFailures - 1));
  refreshCooldownUntil = Date.now() + Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

async function performRefresh() {
  if (isRefreshing) {
    // Wait for the in-flight refresh; resolve with its new access token.
    return new Promise((resolve, reject) => failedQueue.push({ resolve, reject }));
  }

  // Cooling down after a transport failure — fail fast without a request. This
  // is NOT a session verdict, so it must not carry sessionExpired.
  if (Date.now() < refreshCooldownUntil) {
    throw Object.assign(new Error('Refresh is cooling down after a network failure'), {
      sessionExpired: false,
      refreshFailed:  true,
      refreshCoolingDown: true,
    });
  }

  isRefreshing = true;
  try {
    let data;

    if (IS_WEB) {
      // Refresh token rides in the httpOnly cookie — send nothing readable.
      // Plain axios (not the intercepted instance) to avoid loops, so set the
      // CSRF header here too (read from the cookie → survives reload).
      const csrf = getCsrfToken();
      ({ data } = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { 'X-Auth-Transport': 'cookie', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        },
      ));
    } else {
      const [refreshToken, userId] = await Promise.all([
        getRefreshToken(),
        getUserId(),
      ]);
      if (!refreshToken || !userId) {
        throw Object.assign(new Error('No refresh token'), { noRefreshToken: true });
      }
      ({ data } = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { userId, refreshToken },
      ));
    }

    await saveTokens({
      accessToken:  data.data.accessToken,
      refreshToken: data.data.refreshToken, // undefined on web (cookie) → not stored
      userId:       IS_WEB ? undefined : await getUserId(),
    });

    const newToken = data.data.accessToken;
    noteRefreshSuccess();
    processQueue(null, newToken);
    return newToken;
  } catch (err) {
    processQueue(err, null);

    // Only a DEFINITIVE rejection may destroy the session.
    //
    // This used to clear tokens on ANY failure. On a village connection that is
    // the normal case, not the exception: one timed-out refresh — no signal, DNS
    // failure, a 502 from the edge, a backend 503 — wiped the refresh token and
    // sent the farmer back to SMS OTP with no way to undo it. The same line
    // turned a brief Postgres stall into a fleet-wide involuntary logout,
    // because every in-flight 401 funnels through here.
    //
    // 401/403 means the server looked at this refresh token and refused it —
    // expired, revoked, reused (family revocation), or the account is gone. That
    // is unrecoverable and the tokens are worthless, so they go. Anything else —
    // no response at all, 5xx, 429 — means we never got an answer, so we keep
    // what we have and let the next attempt succeed.
    // A 5xx means the server RECEIVED this token and got far enough to fail
    // internally. Rotation commits before the reply is written, so the token may
    // already be spent — and re-presenting a spent token is indistinguishable
    // from an attacker replaying a stolen one: the server burns the whole family
    // and files a HIGH-severity ACCOUNT_TAKEOVER incident for a farmer who did
    // nothing wrong. Give up on it here instead. The user signs in again, which
    // is what the old code did for every failure; the difference is that a
    // connection-level failure — no signal, DNS, TLS, the village case this
    // change exists for — no longer costs them their session, because there the
    // request plausibly never arrived and the token is almost certainly intact.
    // Specifically 5xx, not merely "got a response". A 429 is refused by the
    // limiter and a CSRF 403 by the guard, both BEFORE the handler runs, so no
    // rotation happened and those tokens are intact — destroying a session
    // because a village shares one NAT'd IP would be the opposite of the point.
    // Only a 5xx means the handler itself ran and threw.
    const mayBeSpent = (err.response?.status ?? 0) >= 500;
    const definitive = isDefinitiveAuthFailure(err);

    if (definitive || mayBeSpent) await clearTokens();
    else noteTransientRefreshFailure();

    // `sessionExpired` keeps its original meaning — the session is genuinely
    // over — so existing consumers still route to Login only when they should.
    // `refreshFailed` marks the transient case for callers that want to
    // distinguish "signed out" from "couldn't reach the server".
    // `sessionExpired` must match what we actually did to the tokens, or the UI
    // will keep a user on a session that no longer exists. Both branches that
    // called clearTokens() set it, so consumers route to Login in exactly the
    // cases where the credentials are gone.
    throw Object.assign(err, {
      sessionExpired: definitive || mayBeSpent,
      refreshFailed:  true,
    });
  } finally {
    isRefreshing = false;
  }
}

async function refreshAndRetry(instance, original) {
  original._retry = true;
  const token = await performRefresh();
  original.headers.Authorization = `Bearer ${token}`;
  return instance(original);
}

// ── Proactive token validity (for auth outside the axios interceptors) ───────
// Refresh if the access token expires within this skew so callers never hand the
// server a token that's about to die mid-handshake.
const TOKEN_REFRESH_SKEW_MS = 30_000;

// Decode a JWT's `exp` (ms epoch) WITHOUT verifying the signature — we only need
// the expiry locally to decide whether to refresh. Returns null if undecodable.
function getJwtExpMs(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))?.exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Return a usable access token, proactively refreshing it when it's missing,
 * already expired, or about to expire within TOKEN_REFRESH_SKEW_MS. Used by
 * clients that authenticate outside the axios interceptors (e.g. the socket
 * wrapper) and would otherwise replay a dead token until the server rejects it.
 * Resolves to null when there's no recoverable session.
 */
export async function getValidAccessToken() {
  const token = await getAccessToken();

  if (!token) {
    // Web keeps the access token only in memory (lost on reload); recover via the
    // httpOnly refresh cookie. Native with no token means no session.
    if (IS_WEB) {
      try { return await performRefresh(); } catch { return null; }
    }
    return null;
  }

  const expMs = getJwtExpMs(token);
  if (expMs == null) return token;                      // non-JWT/unknown → let server validate
  if (expMs - Date.now() > TOKEN_REFRESH_SKEW_MS) return token; // still comfortably valid

  try { return await performRefresh(); } catch { return null; }
}

/**
 * Mint a NEW access token, whatever the current one looks like.
 *
 * getValidAccessToken above returns the existing token untouched whenever it is
 * more than TOKEN_REFRESH_SKEW_MS from expiry — which is the right answer for
 * "do I have something usable?" and the wrong one for "the server just refused
 * this token". A server can reject a perfectly unexpired token: its jti was
 * denylisted, or the user's tokenVersion moved because their role, KYC status or
 * team scope changed.
 *
 * The socket wrapper used getValidAccessToken on rejection, got the same
 * unexpired token back, read it as "session alive" and reconnected with it —
 * every one to five seconds, for the rest of the token's fifteen-minute life.
 * Hardening the socket handshake without this would have turned each of those
 * attempts into a Redis read plus a database query.
 *
 * Resolves to null when the session genuinely cannot be renewed, which is the
 * only signal a caller needs to stop retrying. Shares performRefresh's in-flight
 * dedupe and jittered cooldown, so a fleet reconnecting at once does not become
 * a refresh storm.
 */
export async function forceRefreshAccessToken() {
  try { return await performRefresh(); } catch { return null; }
}

attachInterceptors(api);
attachInterceptors(aiApi);

export { aiApi };
export default api;
