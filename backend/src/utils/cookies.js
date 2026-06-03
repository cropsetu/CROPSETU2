/**
 * Refresh-token cookie helpers (web clients only).
 *
 * Web clients hold the short-lived access token in memory and keep the refresh
 * token in an httpOnly, Secure, SameSite=Lax cookie that JavaScript cannot read.
 * Mobile (React Native) clients don't send the opt-in header and keep using
 * body tokens + SecureStore + Bearer auth.
 *
 * SameSite=Lax is the CSRF control: the cookie is not attached to cross-site
 * POSTs, so a malicious page can't drive /auth/refresh on the user's behalf —
 * and even a same-site forgery can't read the new token (returned in the body,
 * blocked cross-origin by CORS).
 */
import { ENV } from '../config/env.js';

export const REFRESH_COOKIE = 'rt';
// CSRF double-submit cookie. Intentionally NOT httpOnly: the web client reads it
// and echoes it in the X-CSRF-Token header, and it must survive a reload so the
// silent cookie-refresh can pass the CSRF check. It's not a credential — its
// security comes from being unreadable cross-origin, not from being secret.
export const CSRF_COOKIE = 'csrf';

// Scope the refresh cookie to the auth routes so it's never sent elsewhere.
const COOKIE_PATH = `${ENV.API_PREFIX}/auth`;

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure:   !ENV.IS_DEV, // require HTTPS in prod; allow http://localhost in dev
    sameSite: 'lax',
    path:     COOKIE_PATH,
  };
}

/**
 * True when the client opted into cookie-based refresh transport (web).
 * The web API client sets `X-Auth-Transport: cookie`; mobile omits it.
 */
export function wantsCookieAuth(req) {
  return String(req.headers['x-auth-transport'] || '').toLowerCase() === 'cookie';
}

// Cookie lifetime tracks the idle window — it's re-set on every refresh, so it
// slides forward with activity just like the refresh token's expiry.
const COOKIE_MAX_AGE_MS = ENV.SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, baseCookieOptions());
}

// CSRF cookie: readable by JS (no httpOnly), path '/' so document.cookie can read
// it on the web app, SameSite=Lax so it isn't sent on cross-site mutations.
function csrfCookieOptions() {
  return { httpOnly: false, secure: !ENV.IS_DEV, sameSite: 'lax', path: '/' };
}

export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE, token, {
    ...csrfCookieOptions(),
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
}

/** Read a named cookie from the request's Cookie header (no cookie-parser needed). */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function readRefreshCookie(req) {
  return readCookie(req, REFRESH_COOKIE);
}
