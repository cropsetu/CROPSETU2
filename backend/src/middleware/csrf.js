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
import {
  readCookie, REFRESH_COOKIE, CSRF_COOKIE, clearRefreshCookie, clearCsrfCookie,
} from '../utils/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Pre-auth endpoints: they establish a session rather than acting on one, so the
// refresh cookie riding along is irrelevant to them. Exempting them is what stops
// a stale/orphaned `rt` cookie from bricking the browser — without this, a leftover
// cookie with no matching `csrf` cookie 403s /auth/send-otp too, and the user can
// never log back in to get fresh cookies. /auth/refresh stays protected: acting on
// the ambient cookie credential is exactly what CSRF defends.
const PRE_AUTH_PATHS = new Set(['/auth/send-otp', '/auth/verify-otp']);

function isPreAuthPath(path) {
  for (const suffix of PRE_AUTH_PATHS) {
    if (path === suffix || path.endsWith(suffix)) return true;
  }
  return false;
}

// The one protected route whose CSRF failure can wedge the browser permanently,
// because it is the route that would otherwise repair the session.
function isRefreshPath(path) {
  return path === '/auth/refresh' || path.endsWith('/auth/refresh');
}

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
  if (isPreAuthPath(req.path)) return next();

  // Only cookie-authenticated requests are CSRF-attackable.
  if (!readCookie(req, REFRESH_COOKIE)) return next();

  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !timingSafeEqual(cookieToken, headerToken)) {
    // Repair ONE specific state: an `rt` cookie whose `csrf` partner is gone.
    // The two have different paths and lifetimes, so they can desync (cleared
    // site data, partitioned storage, an expired partner), and that state is
    // self-perpetuating — every refresh 403s, and a 403 is deliberately NOT a
    // session verdict client-side (shared/services/authFailure.js), so nothing
    // routes the user to Login and nothing repairs the cookies. Clearing both
    // halves breaks the loop, exactly as the refresh handler already does on its
    // own failure paths: the next attempt arrives with no `rt` at all, which is
    // an honest 401 — definitive, so the client logs out cleanly and signs in
    // again. /auth/send-otp is CSRF-exempt, so the route back in always works.
    //
    // Gated on `!cookieToken` — the cookie PAIR being incoherent — and not on a
    // mismatching header. A wrong or missing header is a client bug or an actual
    // CSRF attempt; the pair is still intact and the next correctly-signed
    // request must succeed. Clearing there would let one bad header destroy a
    // recoverable session, which is the opposite of the point.
    if (isRefreshPath(req.path) && !cookieToken) {
      clearRefreshCookie(res);
      clearCsrfCookie(res);
    }
    return sendForbidden(res, 'Invalid or missing CSRF token');
  }
  next();
}
