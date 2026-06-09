/**
 * Unit tests for the access-token revocation denylist
 * (services/tokenDenylist.service.js).
 *
 * Under the test suite Redis is never connected (lazyConnect, no .connect()), so
 * these exercise the FAIL-OPEN degraded path: with no shared store the denylist
 * must never throw and must never reject tokens (a Redis outage must not become an
 * auth outage). The cross-instance "rejected everywhere" behaviour with Redis up
 * is covered by the api/auth integration suite.
 */
import { denylistAccessToken, isAccessTokenDenylisted } from '../../../src/services/tokenDenylist.service.js';

describe('tokenDenylist — Redis unavailable (fail-open)', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;

  test('denylistAccessToken is a safe no-op (returns false, never throws)', async () => {
    await expect(denylistAccessToken('jti-1', future)).resolves.toBe(false);
  });

  test('isAccessTokenDenylisted fails open (returns false, never throws)', async () => {
    await expect(isAccessTokenDenylisted('jti-1')).resolves.toBe(false);
  });

  test('a missing jti is handled gracefully on both calls', async () => {
    await expect(denylistAccessToken(undefined, future)).resolves.toBe(false);
    await expect(isAccessTokenDenylisted(undefined)).resolves.toBe(false);
  });

  test('an already-expired exp is not recorded', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    await expect(denylistAccessToken('jti-2', past)).resolves.toBe(false);
  });
});
