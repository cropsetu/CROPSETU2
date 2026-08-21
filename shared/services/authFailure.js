/**
 * Is this error a DEFINITIVE rejection of the session, or just a bad moment?
 *
 * The distinction decides whether a farmer keeps their session or is sent back
 * to SMS OTP, so it lives in one place and both callers use it: the refresh
 * path in `api.js` and the cold-start restore in `AuthContext.js`.
 *
 * Getting this wrong in the permissive direction leaves a revoked token usable;
 * getting it wrong in the strict direction — which is what the code did before —
 * logs people out for having bad signal. On a village connection the second
 * mistake fires constantly and cannot be undone by the user.
 *
 * DEFINITIVE (destroy the session):
 *   401      — the server looked at this refresh token and refused it. Every
 *              dead-token verdict on POST /auth/refresh is a 401 and nothing
 *              else: no token presented, reuse detected (family revocation),
 *              invalid/expired, account gone (auth.routes.js:298,326,332,345).
 *   no token — there is nothing to refresh with, so there is nothing to keep.
 *
 * NOT definitive (keep the session):
 *   no response at all — airplane mode, dead cell, DNS failure, TLS failure
 *   5xx               — including the 503 the auth middleware now returns when
 *                       the database, not the token, is what failed
 *   429               — rate limited; the token is fine
 *   timeouts / aborts — ECONNABORTED, ETIMEDOUT
 *   403               — deliberately NOT definitive. On this route 403 comes
 *                       only from the CSRF guard (csrf.js:65-66), which fires on
 *                       a cookie/header mismatch — wedged browser state, not a
 *                       dead token. It cannot fire on native at all: the guard
 *                       returns early unless the `rt` cookie is present, and
 *                       native sends the refresh token in the body. Elsewhere in
 *                       the API 403 means "forbidden action" (blockMinors,
 *                       requireScope) — never "your session is over".
 *
 * Note the default: anything unrecognised is treated as NOT definitive. An
 * unknown failure is a reason to retry, not a reason to destroy credentials.
 */
export function isDefinitiveAuthFailure(err) {
  if (!err) return false;
  if (err.noRefreshToken === true) return true;

  return err.response?.status === 401;
}

export default isDefinitiveAuthFailure;
