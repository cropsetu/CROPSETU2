/**
 * Short-TTL cache for the per-request account check (claude.md §9 / P0-002).
 *
 * Every authenticated request ran, serially: HS256 verify → Redis GET on the jti
 * denylist → `SELECT tokenVersion, isActive FROM users WHERE id = $1`. That last
 * statement is a primary-key probe, so this is not primarily a throughput fix —
 * at the stated peak it is a couple of percent of the pool. What it removes is
 * 1–2.5 ms of serial latency from one hundred percent of traffic, and a hard
 * dependency of AUTHENTICATION on Postgres being reachable.
 *
 * The denylist GET is deliberately NOT cached. Single-device logout has to take
 * effect immediately, and that is the only mechanism that delivers it.
 *
 * ── Why invalidation is a Prisma hook and not a call at each write site ──────
 *
 * There are nine places that write `users.tokenVersion` and only two of them go
 * through bumpTokenVersion(); the other seven increment it inline, and the admin
 * ban writes `isActive` without touching tokenVersion at all. Asking each of
 * those to remember to call an invalidator is asking to be wrong later — the
 * tenth site will be written by someone who has never read this file, and the
 * failure mode is a banned account that keeps working.
 *
 * So the hook watches the DATABASE instead (see attachAuthCacheInvalidation).
 * A write cannot avoid it by being new.
 *
 * ── Staleness ───────────────────────────────────────────────────────────────
 *
 * With Redis healthy: milliseconds — the local entry is dropped on the write and
 * every other replica is told over pub/sub.
 * With Redis down: bounded by the TTL below, against an access-token lifetime of
 * 900 s that already exists by design.
 */
import { BoundedMap } from '../utils/boundedMap.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { ENV } from '../config/env.js';

// 15 s. Short enough that a revocation missed by both the hook and pub/sub still
// lands inside 1.7% of the access token's own 900 s window; long enough that a
// farmer scrolling a feed makes one user read rather than thirty.
const TTL_MS = Number(ENV.AUTH_CACHE_TTL_MS) || 15_000;

// ~256 bytes an entry, so the ceiling is ~13 MB fully saturated — and it only
// saturates if 50,000 DISTINCT users are active inside one 15 s window on one
// replica, which is well past the peak this system is being built for.
const MAX_ENTRIES = Number(ENV.AUTH_CACHE_MAX) || 50_000;

const CHANNEL = 'auth:invalidate';

const _cache = new BoundedMap({ maxSize: MAX_ENTRIES, ttlMs: TTL_MS });
let _subscriber = null;
let _hits = 0;
let _misses = 0;

/** Cached `{ tokenVersion, isActive }`, or null on a miss/expiry. */
export function getCachedAuth(userId) {
  const hit = _cache.get(userId);
  if (hit) { _hits += 1; return hit; }
  _misses += 1;
  return null;
}

/** Remember one account's auth-relevant state. */
export function setCachedAuth(userId, value) {
  _cache.set(userId, value);
}

/**
 * Drop one account everywhere.
 *
 * Local first, then broadcast — so the replica that performed the write is
 * correct even if the publish fails. Fire-and-forget: a Redis outage must never
 * fail the admin action that triggered it.
 */
export function invalidateAuth(userId) {
  if (!userId) return;
  _cache.delete(userId);
  if (redis?.status === 'ready') {
    redis.publish(CHANNEL, String(userId))
      .catch((err) => logger.warn('[AuthCache] invalidation broadcast failed: %s', err.message));
  }
}

/**
 * Subscribe to cross-instance invalidations. Call ONCE at startup, on its own
 * connection — a connection in subscribe mode cannot run normal commands.
 * Degrades to TTL-only when Redis is unavailable. Idempotent.
 */
export async function initAuthCacheSubscriber() {
  if (_subscriber) return;
  try {
    const sub = redis.duplicate();
    sub.on('error', (err) => logger.warn('[AuthCache] subscriber error: %s', err.message));
    sub.on('message', (channel, message) => {
      if (channel !== CHANNEL) return;
      _cache.delete(message);
    });
    await sub.connect();
    await sub.subscribe(CHANNEL);
    _subscriber = sub;
    logger.info('[AuthCache] subscribed to %s (ttl %dms, max %d)', CHANNEL, TTL_MS, MAX_ENTRIES);
  } catch (err) {
    logger.warn('[AuthCache] pub/sub unavailable — revocations converge via the %dms TTL only: %s',
      TTL_MS, err.message);
  }
}

/** Stop the subscriber (graceful shutdown / tests). */
export async function stopAuthCacheSubscriber() {
  if (!_subscriber) return;
  try { await _subscriber.quit(); } catch { /* shutting down anyway */ }
  _subscriber = null;
}

/**
 * Invalidate on ANY write to a user's auth-relevant columns, whoever made it.
 *
 * Registered once against the shared Prisma client. This is the part that makes
 * the cache safe to add at all: nine existing write sites, seven of which do not
 * go through the helper, plus every site not yet written.
 *
 * `updateMany` cannot report which rows it touched, so a bulk write to either
 * column clears the WHOLE cache rather than guessing. Bulk auth writes are
 * admin-scale and rare; being wrong about one is not.
 */
export function attachAuthCacheInvalidation(prisma) {
  prisma.$use(async (params, next) => {
    const result = await next(params);
    try {
      if (params.model !== 'User') return result;
      if (params.action === 'delete' || params.action === 'deleteMany') {
        // An erased account must not keep a usable entry.
        if (params.action === 'delete') invalidateAuth(params.args?.where?.id);
        else _cache.clear();
        return result;
      }
      if (params.action !== 'update' && params.action !== 'updateMany'
          && params.action !== 'upsert') return result;

      const data = params.args?.data ?? params.args?.update ?? {};
      if (!('tokenVersion' in data) && !('isActive' in data)) return result;

      const id = params.args?.where?.id;
      if (id) invalidateAuth(id);
      else _cache.clear();
    } catch (err) {
      // Never let cache bookkeeping fail the write it is observing.
      logger.warn('[AuthCache] invalidation hook failed: %s', err.message);
    }
    return result;
  });
}

/** Hit-rate counters for the ops surface (claude.md §9 asks for metrics). */
export function authCacheStats() {
  const total = _hits + _misses;
  return {
    size: _cache.size,
    max: MAX_ENTRIES,
    ttlMs: TTL_MS,
    hits: _hits,
    misses: _misses,
    hitRate: total ? Number((_hits / total).toFixed(4)) : null,
  };
}

/** Test helper: forget everything, including the counters. */
export function resetAuthCache() {
  _cache.clear();
  _hits = 0;
  _misses = 0;
}
