/**
 * CSRF protection — double-submit cookie pattern.
 *
 * Required once cookie auth was adopted (AUTH-9): a state-changing request that
 * authenticates via the httpOnly refresh cookie could otherwise be forged from
 * a cross-site page. We defend in depth on top of SameSite=Lax:
 *
 *   - The server sets a random `csrf` token in a (JS-readable) cookie.
 *   - The web client echoes it in the `X-CSRF-Token` header on mutations.
 *   - This middleware requires header === cookie.
 *
 * A cross-origin attacker can neither read the victim's csrf cookie nor set the
 * header, so the check fails for forged requests.
 *
 * Scope: only state-changing requests that CARRY the auth refresh cookie are
 * checked. Bearer-authenticated (mobile/native) and pre-auth requests have no
 * ambient cookie credential to abuse and are inherently CSRF-safe, so they're
 * exempt — this is what keeps the mobile clients and the bearer-token test
 * suite working unchanged.
 */

import crypto from 'crypto';
import { sendForbidden } from '../utils/response.js';
import { readCookie, REFRESH_COOKIE, CSRF_COOKIE } from '../utils/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Only cookie-authenticated requests are CSRF-attackable.
  if (!readCookie(req, REFRESH_COOKIE)) return next();

  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !timingSafeEqual(cookieToken, headerToken)) {
    return sendForbidden(res, 'Invalid or missing CSRF token');
  }
  next();
}
