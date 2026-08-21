/**
 * Which failures are allowed to end a farmer's session.
 *
 * This predicate sits between "bad signal" and "back to SMS OTP". Before it
 * existed, both the refresh path and the cold-start restore destroyed the
 * refresh token on ANY error, so a timed-out request on a village connection —
 * the normal case in a field, not an exception — logged the user out with no way
 * to undo it. A brief backend outage did the same thing to everyone at once.
 *
 * The tests below pin both directions: a real rejection must still end the
 * session immediately (revocation must not become advisory), and a transport
 * failure must not.
 */
import { isDefinitiveAuthFailure } from '@cropsetu/shared/services/authFailure';

/** Shape of an axios error that got a response. */
const withStatus = (status) => ({ response: { status }, config: {}, isAxiosError: true });
/** Shape of an axios error that never got one — no `response` key at all. */
const noResponse = (code) => ({ code, message: 'Network Error', config: {}, isAxiosError: true });

describe('definitive — the session is genuinely over', () => {
  test('401: the server refused this refresh token', () => {
    expect(isDefinitiveAuthFailure(withStatus(401))).toBe(true);
  });

  test('no refresh token to begin with', () => {
    expect(isDefinitiveAuthFailure({ noRefreshToken: true })).toBe(true);
  });
});

describe('not definitive — keep the session', () => {
  test.each([
    ['no response at all (airplane mode, dead cell)', noResponse('ERR_NETWORK')],
    ['request timeout', noResponse('ECONNABORTED')],
    ['socket timeout', noResponse('ETIMEDOUT')],
  ])('%s', (_label, err) => {
    expect(isDefinitiveAuthFailure(err)).toBe(false);
  });

  test.each([500, 502, 503, 504])('%i from the server', (status) => {
    expect(isDefinitiveAuthFailure(withStatus(status))).toBe(false);
  });

  test('503 specifically — what the auth middleware now returns when the DB is down', () => {
    // This is the whole point of the backend change: the token is fine, the
    // database is not, and the client must not react by deleting credentials.
    expect(isDefinitiveAuthFailure(withStatus(503))).toBe(false);
  });

  test('429 — rate limited, but the token is perfectly good', () => {
    expect(isDefinitiveAuthFailure(withStatus(429))).toBe(false);
  });

  test('400 and 404 are not auth verdicts', () => {
    expect(isDefinitiveAuthFailure(withStatus(400))).toBe(false);
    expect(isDefinitiveAuthFailure(withStatus(404))).toBe(false);
  });

  test('403 — on /auth/refresh this is only ever the CSRF guard', () => {
    // csrf.js:65-66 is the sole 403 producer on that route, and it fires on a
    // cookie/header mismatch: wedged browser state, recoverable, not a dead
    // token. Every genuine dead-token verdict is a 401. Treating 403 as
    // definitive would also mean any "forbidden action" 403 elsewhere in the
    // API (blockMinors, requireScope) could end a session on the restore path.
    expect(isDefinitiveAuthFailure(withStatus(403))).toBe(false);
  });
});

describe('defaults are safe', () => {
  test('null / undefined do not end a session', () => {
    expect(isDefinitiveAuthFailure(null)).toBe(false);
    expect(isDefinitiveAuthFailure(undefined)).toBe(false);
  });

  test('an unrecognised error is a reason to retry, not to log out', () => {
    expect(isDefinitiveAuthFailure(new Error('something odd'))).toBe(false);
  });

  test('a falsy noRefreshToken flag is not a rejection', () => {
    expect(isDefinitiveAuthFailure({ noRefreshToken: false })).toBe(false);
  });
});
