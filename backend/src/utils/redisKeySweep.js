/**
 * SCAN-and-delete a Redis key namespace.
 *
 * Exists for the test-only reset helpers (rate limiting, OTP lockout), which
 * used to clear their in-memory fallback and nothing else. That was a no-op
 * wherever Redis is actually up — which is CI, and only CI — so limiter state
 * accumulated across a whole serial run there while every laptop stayed green.
 *
 * SCAN + UNLINK rather than KEYS + DEL: KEYS walks the entire keyspace in one
 * blocking call, and a shared dev Redis is not ours to stall. UNLINK frees the
 * keys on a background thread, which matters when a suite leaves thousands.
 *
 * Never throws — a reset failing is not a reason to fail the test that follows
 * it; the caller has already cleared the in-memory half either way.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} pattern  glob, e.g. 'rl:*'
 * @returns {Promise<number>} keys removed
 */
export async function sweepKeys(redis, pattern) {
  if (redis?.status !== 'ready') return 0;

  let removed = 0;
  let cursor = '0';
  try {
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length) {
        await redis.unlink(...keys);
        removed += keys.length;
      }
    } while (cursor !== '0');
  } catch {
    // Best effort. Swallowed deliberately: see above.
  }
  return removed;
}
