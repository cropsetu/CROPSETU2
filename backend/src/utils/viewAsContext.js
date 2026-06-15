/**
 * View-as ("impersonation") context — a short-lived, signed, READ-ONLY descriptor.
 *
 * SECURITY DESIGN — read carefully.
 * Impersonation is READ-ONLY by construction. We deliberately do NOT mint a
 * user-scoped access token: no token carrying the target user's `sub` is ever
 * issued, so the SPA can never authenticate AS the user, and writes as the user
 * are impossible. The admin's OWN admin token continues to authorize every read.
 *
 * What this descriptor IS: a tamper-evident note saying "admin <adminId> is
 * viewing user <actAs> read-only until <expiresAt>". It is signed with the
 * existing JWT secret (HMAC-SHA256 over the canonical JSON), so the SPA can
 * verify it is genuine and unexpired, but the descriptor confers NO authority on
 * its own — the backend never trusts it to authorize anything. It exists only so
 * the UI can render a verified read-only "view-as" banner. Every issuance is
 * additionally written to the audit log (ADMIN_IMPERSONATE) by the route.
 */
import crypto from 'crypto';
import { ENV } from '../config/env.js';

// How long a view-as context stays valid. Short by design — it is a UI banner
// token, not a session.
export const VIEW_AS_TTL_MS = 10 * 60 * 1000; // ~10 minutes

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(payloadB64) {
  return crypto.createHmac('sha256', ENV.JWT_SECRET).update(payloadB64).digest();
}

/**
 * Sign a READ-ONLY view-as context. Returns `{ context, token }`:
 *   - context: the plain descriptor { actAs, adminId, readOnly:true, issuedAt, expiresAt }
 *   - token:   `<payloadB64>.<sigB64>` — the SPA stores this and the descriptor
 *
 * @param {object}  p
 * @param {string}  p.actAs    target userId being viewed
 * @param {string}  p.adminId  the acting admin's userId
 * @param {number} [p.ttlMs]   override TTL (default VIEW_AS_TTL_MS)
 */
export function signViewAsContext({ actAs, adminId, ttlMs = VIEW_AS_TTL_MS }) {
  const now = Date.now();
  const context = {
    actAs,
    adminId,
    // READ-ONLY is a structural invariant, not a permission toggle — there is no
    // "writable" variant of this descriptor and no user token behind it.
    readOnly: true,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const payloadB64 = b64url(JSON.stringify(context));
  const sigB64 = b64url(hmac(payloadB64));
  return { context, token: `${payloadB64}.${sigB64}` };
}

/**
 * Verify a view-as token: checks the HMAC (constant-time) and the expiry.
 * Returns the decoded context on success, or null if the token is malformed,
 * forged, or expired. The descriptor confers no authority — verification only
 * tells the caller the banner is genuine.
 */
export function verifyViewAsContext(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;

  const expected = hmac(payloadB64);
  let provided;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  let context;
  try {
    context = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (!context || context.readOnly !== true) return null;
  if (typeof context.expiresAt !== 'number' || context.expiresAt <= Date.now()) return null;
  return context;
}
