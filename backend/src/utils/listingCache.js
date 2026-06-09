/**
 * Redis-backed cache-aside for public listing endpoints (catalogues that are
 * re-queried identically by many users — categories, product lists).
 *
 * Three problems a naive cache hits: (1) listings vary by query params, so there
 * are many keys per namespace; (2) a write must invalidate ALL of them at once;
 * (3) a deploy that changes the cached payload's SHAPE must not read old payloads.
 * Every key carries both versions — `cache:<ns>:s<SCHEMA>:v<runtime>:<hash>`:
 *   - the per-namespace RUNTIME counter (v<runtime>) — a single INCR atomically
 *     orphans every entry on a DATA write (the stale keys just TTL-expire); and
 *   - the SCHEMA version (s<SCHEMA>, CACHE_SCHEMA_VERSION) — bumped at deploy time
 *     when the payload SHAPE changes, so new code misses every old key cleanly.
 * No SCAN, no pattern delete — O(1) invalidation safe on a shared/clustered Redis.
 *
 * Everything degrades gracefully: when Redis is unavailable the loader runs
 * directly (no caching, no errors), so listings always work.
 */
import crypto from 'crypto';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { recordCacheHit, recordCacheMiss } from './cacheMetrics.js';
import { CACHE_SCHEMA_VERSION } from '../constants/cacheVersion.js';

const isReady = () => redis?.status === 'ready';

// Key builders embed the schema version so a CACHE_SCHEMA_VERSION bump produces a
// disjoint key space (old keys are missed, then TTL-expire). Pure + exported so
// tests can prove a bump cleanly misses every old key. `schema` defaults to the
// constant; passing it explicitly is only for tests.
export const VER_KEY  = (ns, schema = CACHE_SCHEMA_VERSION) => `cache:${ns}:s${schema}:ver`;
export const DATA_KEY = (ns, ver, hash, schema = CACHE_SCHEMA_VERSION) => `cache:${ns}:s${schema}:v${ver}:${hash}`;

async function currentVersion(ns) {
  if (!isReady()) return 0;
  try { return Number(await redis.get(VER_KEY(ns))) || 0; }
  catch { return 0; }
}

/**
 * Invalidate every cached entry in a namespace by bumping its version. Call after
 * any write that changes what a listing would return. No-op (and never throws)
 * when Redis is down.
 * @param {string} ns  e.g. 'agristore:products'
 */
export async function bumpListingVersion(ns) {
  if (!isReady()) return;
  try { await redis.incr(VER_KEY(ns)); }
  catch (err) { logger.warn('[ListingCache] version bump failed for %s: %s', ns, err.message); }
}

/**
 * Cache-aside for one listing response.
 * @param {string} ns        namespace (drives invalidation), e.g. 'agristore:products'
 * @param {string} identity  canonical signature of the query params for this listing
 * @param {number} ttlSec    short TTL bounding staleness between writes
 * @param {() => Promise<{data:any, meta?:any}>} loader  runs the DB query on a miss
 * @returns {Promise<{data:any, meta?:any, cached:boolean}>}
 */
export async function cachedListing(ns, identity, ttlSec, loader) {
  if (!isReady()) {
    const fresh = await loader();
    return { ...fresh, cached: false };
  }

  const ver  = await currentVersion(ns);
  const hash = crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16);
  const key  = DATA_KEY(ns, ver, hash);
  const source = `listing:${ns}`;

  try {
    const hit = await redis.get(key);
    if (hit) {
      recordCacheHit(source);
      return { ...JSON.parse(hit), cached: true };
    }
  } catch { /* treat any read error as a miss and recompute */ }

  recordCacheMiss(source);
  const fresh = await loader();
  try {
    await redis.set(key, JSON.stringify(fresh), 'EX', ttlSec);
  } catch (err) {
    logger.warn('[ListingCache] set failed for %s: %s', ns, err.message);
  }
  return { ...fresh, cached: false };
}
