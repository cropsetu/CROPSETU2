/**
 * Authentication & authorization middleware.
 *
 * authenticate  — required JWT, sets req.user = { id, role }
 * optionalAuth  — if token present, decode it; otherwise continue anonymously
 * requireRole   — factory that returns middleware checking req.user.role
 */
import { verifyAccessToken } from '../utils/jwt.js';
import { sendUnauthorized, sendForbidden } from '../utils/response.js';
import { isAccessTokenDenylisted } from '../services/tokenDenylist.service.js';
import prisma from '../config/db.js';

// Exactly: scheme "Bearer", one space, then a single non-whitespace token.
// Rejects missing/empty tokens, wrong schemes, extra spaces, and extra parts.
const BEARER_RE = /^Bearer (\S+)$/;

/**
 * Strictly extract a Bearer token from an Authorization header value.
 * Returns the token string, or null if the header is absent or malformed.
 * Pure string work — never throws — so callers can't 500 on garbage input.
 */
export function parseBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = BEARER_RE.exec(headerValue.trim());
  return match ? match[1] : null;
}

export async function authenticate(req, res, next) {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return sendUnauthorized(res, 'Access token required');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return sendUnauthorized(res, 'Invalid or expired token');
  }

  // A well-formed token must carry a string subject; anything else is invalid
  // (and would otherwise turn into a DB error below).
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
    return sendUnauthorized(res, 'Invalid or expired token');
  }

  // Cross-instance revocation: a single-device logout denylists this token's jti
  // in Redis (shared by every instance), so a logged-out token is rejected
  // everywhere immediately. Checked before the DB lookup so a revoked token
  // short-circuits. Fails open if Redis is down (see tokenDenylist.service.js).
  if (await isAccessTokenDenylisted(payload.jti)) {
    return sendUnauthorized(res, 'Session expired. Please sign in again.');
  }

  // Validate against the live account: reject tokens for missing/disabled users
  // and tokens whose embedded version is behind the user's current
  // tokenVersion (bumped on security-sensitive changes like a phone change).
  try {
    const user = await prisma.user.findUnique({
      where:  { id: payload.sub },
      select: { tokenVersion: true, isActive: true },
    });
    if (!user || user.isActive === false) {
      return sendUnauthorized(res, 'Account not found or inactive');
    }
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return sendUnauthorized(res, 'Session expired. Please sign in again.');
    }
  } catch {
    // Fail closed — never admit a request we couldn't validate.
    return sendUnauthorized(res, 'Authentication unavailable');
  }

  req.user = { id: payload.sub, role: payload.role };
  // Expose the token identity so the logout handler can denylist exactly this
  // access token (jti) for its remaining lifetime (exp).
  req.auth = { jti: payload.jti, exp: payload.exp };
  next();
}

export async function optionalAuth(req, _res, next) {
  const token = parseBearerToken(req.headers.authorization);
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      // Honour the denylist here too: a logged-out token must not keep granting
      // the user's identity on anonymous-friendly routes.
      if (payload && typeof payload.sub === 'string' && payload.sub
          && !(await isAccessTokenDenylisted(payload.jti))) {
        req.user = { id: payload.sub, role: payload.role };
      }
    } catch {
      // token invalid — continue as anonymous
    }
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return sendUnauthorized(res);
    if (!roles.includes(req.user.role)) {
      return sendForbidden(res, 'Insufficient permissions');
    }
    next();
  };
}

/**
 * [DPDP §9] Block users flagged as minors from age-inappropriate flows —
 * financial onboarding, KYC, selling, and other commerce that a child should
 * not perform. Place AFTER `authenticate`. Minors are blocked outright here
 * (these actions are unsuitable for children even with guardian consent);
 * general data processing remains gated by guardian consent elsewhere.
 */
export async function blockMinors(req, res, next) {
  try {
    if (!req.user) return sendUnauthorized(res);
    const u = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { isMinor: true },
    });
    if (u?.isMinor) {
      return sendForbidden(
        res,
        'This action is restricted for users under 18 (DPDP Act §9). Please contact support if you believe this is an error.',
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}
