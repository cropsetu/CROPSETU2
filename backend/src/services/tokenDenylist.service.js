/**
 * Access-token revocation denylist (AUTH — cross-instance logout).
 *
 * Access tokens are stateless JWTs, so a single-device logout can't invalidate the
 * already-issued access token on its own — it stays valid on every instance until
 * it expires (up to JWT_EXPIRES_IN). Per-user tokenVersion can't help here either:
 * bumping it would log the user out of ALL devices, not just this one.
 *
 * This denylist closes that window. Logout records the token's `jti` in Redis
 * (shared by all instances) with a TTL equal to the token's remaining lifetime,
 * and authenticate() rejects any token whose jti is listed. So a single-device
 * logout is atomic across the fleet — the token is rejected everywhere immediately.
 *
 * TTL = remaining token life, so entries self-expire exactly when the token would
 * have anyway: no unbounded growth, no manual cleanup.
 *
 * FAIL-OPEN: if Redis is unavailable the check returns "not denylisted" rather
 * than locking out every authenticated user — a Redis outage must not become an
 * auth outage. This degrades to the pre-denylist behaviour; the durable backstops
 * remain in force — short access-token TTL, per-user tokenVersion bumps
 * (logout-all / phone change), and refresh-token revocation. The Redis client
 * wrapper already raises a loud [ALERT][Redis] log when the connection drops (see
 * config/redis.js), so the degraded mode is visible.
 */
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

const KEY = (jti) => `denylist:at:${jti}`;

/**
 * Revoke a single access token by its jti until it would have expired.
 * @param {string} jti        the token's unique id (JWT `jti` claim)
 * @param {number} expEpochS  the token's `exp` claim (seconds since epoch)
 * @returns {Promise<boolean>} true if the token was recorded as revoked
 */
export async function denylistAccessToken(jti, expEpochS) {
  if (!jti || redis?.status !== 'ready') return false;
  // Bound the entry to the token's remaining life so Redis cleans it up for us.
  const ttl = Math.ceil(Number(expEpochS) - Date.now() / 1000);
  if (!Number.isFinite(ttl) || ttl <= 0) return false; // already expired → nothing to revoke
  try {
    await redis.set(KEY(jti), '1', 'EX', ttl);
    return true;
  } catch (err) {
    logger.warn('[Denylist] failed to revoke token: %s', err.message);
    return false;
  }
}

/**
 * @param {string} jti  the token's `jti` claim
 * @returns {Promise<boolean>} true if this token has been revoked. Fail-open
 * (false) when no jti is present or Redis is unavailable.
 */
export async function isAccessTokenDenylisted(jti) {
  if (!jti || redis?.status !== 'ready') return false;
  try {
    return (await redis.get(KEY(jti))) !== null;
  } catch (err) {
    logger.warn('[Denylist] check failed, allowing (fail-open): %s', err.message);
    return false;
  }
}
