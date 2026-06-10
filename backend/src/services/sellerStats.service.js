/**
 * Seller dashboard stats — precomputed cached rollup (CACHE-6).
 *
 * The seller dashboard (`GET /agristore/seller/stats`) shows totals that get
 * heavier every day: the revenue/units figure SUMs every order item the seller
 * has EVER sold. Recomputing that on each dashboard load means a full aggregate
 * scan of an ever-growing table on a hot, interactive path.
 *
 * Instead we keep a rollup in Redis:
 *   - reads are cache-aside (precomputed value served on a hit; computed +
 *     cached on a miss), so after the first load a dashboard never re-runs the
 *     aggregate within the TTL window;
 *   - a periodic leader-locked cron (see server.js) re-warms the rollups of
 *     sellers who actually use the dashboard, so reads keep hitting precomputed
 *     values and the figures stay fresh within the refresh interval;
 *   - the TTL is the safety net: if the refresh cron or Redis leader is down,
 *     entries lapse and the next read recomputes rather than serving forever-
 *     stale data.
 *
 * Fail-open: when Redis is unavailable we compute directly (no caching, no
 * errors), exactly like the rest of the cache layer — the dashboard always works.
 *
 * Eventually consistent by design: a freshly created product or completed sale
 * shows up within one refresh interval (~minutes), which is fine for a stats
 * dashboard. Paths needing exact live numbers should query the DB directly.
 */
import prisma from '../config/db.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { recordCacheHit, recordCacheMiss } from '../utils/cacheMetrics.js';

const isReady = () => redis?.status === 'ready';

const CACHE_SOURCE   = 'seller:stats';
const STATS_TTL_SEC  = 10 * 60;          // 10 min — safety net if the refresh cron is down
const STATS_KEY      = (id) => `seller:stats:${id}`;

// Sellers whose dashboards were read recently — the working set the periodic
// refresh re-warms. A rolling TTL drops sellers who stop using the dashboard so
// the set (and the refresh work) stays bounded to active users.
const ACTIVE_SET_KEY = 'seller:stats:active';
const ACTIVE_SET_TTL = 24 * 60 * 60;     // forget sellers idle for a day
const REFRESH_CAP    = 1000;             // max sellers refreshed per cron tick
const REFRESH_CONCURRENCY = 5;           // DB-friendly fan-out per batch

/**
 * The heavy aggregate itself — the source of truth for both the cached read and
 * the refresh cron. Returns plain JSON-serialisable values; totalRevenue stays a
 * Prisma.Decimal exactly as the route returned before (Express serialises it the
 * same whether served fresh or from cache).
 */
export async function computeSellerStats(sellerId) {
  const [totalProducts, activeProducts, revenueAgg] = await Promise.all([
    prisma.product.count({ where: { sellerId } }),
    prisma.product.count({ where: { sellerId, isActive: true } }),
    // Uses the denormalised orderItem.sellerId index — no join through products.
    prisma.orderItem.aggregate({
      where: { sellerId },
      _sum: { totalPrice: true, quantity: true },
    }),
  ]);
  return {
    totalProducts,
    activeProducts,
    totalRevenue: revenueAgg._sum.totalPrice || 0,
    totalSold:    revenueAgg._sum.quantity   || 0,
  };
}

// Recompute and store the rollup. Round-trips through JSON so the returned value
// is byte-identical to what a cache hit would yield (and to what the route
// emitted before this cache existed). Cache writes never throw.
async function writeStats(sellerId) {
  const fresh = await computeSellerStats(sellerId);
  const serialized = JSON.stringify(fresh);
  if (isReady()) {
    try { await redis.set(STATS_KEY(sellerId), serialized, 'EX', STATS_TTL_SEC); }
    catch (err) { logger.warn('[SellerStats] cache set failed for %s: %s', sellerId, err.message); }
  }
  return JSON.parse(serialized);
}

/**
 * Read a seller's dashboard stats, hitting the precomputed rollup when present.
 * Tracks the seller in the active set so the refresh cron keeps them warm.
 */
export async function getSellerStats(sellerId) {
  if (!isReady()) return computeSellerStats(sellerId);   // fail-open: no cache

  // Mark active (fire-and-forget); rolling TTL bounds the working set.
  redis.sadd(ACTIVE_SET_KEY, sellerId).catch(() => {});
  redis.expire(ACTIVE_SET_KEY, ACTIVE_SET_TTL).catch(() => {});

  try {
    const hit = await redis.get(STATS_KEY(sellerId));
    if (hit) {
      recordCacheHit(CACHE_SOURCE);
      return JSON.parse(hit);
    }
  } catch { /* treat any read error as a miss and recompute */ }

  recordCacheMiss(CACHE_SOURCE);
  return writeStats(sellerId);
}

/**
 * Periodically refresh the rollups of active sellers so dashboard reads keep
 * hitting precomputed values. Leader-locked by the caller (server.js cron).
 * Bounded by REFRESH_CAP per tick and fan-out by REFRESH_CONCURRENCY.
 */
export async function refreshActiveSellerStats() {
  if (!isReady()) return { refreshed: 0, skipped: 'redis-down' };

  let sellerIds;
  try { sellerIds = await redis.smembers(ACTIVE_SET_KEY); }
  catch (err) {
    logger.warn('[SellerStats] could not read active set: %s', err.message);
    return { refreshed: 0, skipped: 'active-set-unreadable' };
  }

  const batch = sellerIds.slice(0, REFRESH_CAP);
  if (sellerIds.length > REFRESH_CAP) {
    logger.warn('[SellerStats] %d active sellers exceed cap %d — refreshing first %d this tick',
      sellerIds.length, REFRESH_CAP, REFRESH_CAP);
  }

  let refreshed = 0;
  for (let i = 0; i < batch.length; i += REFRESH_CONCURRENCY) {
    const slice = batch.slice(i, i + REFRESH_CONCURRENCY);
    const results = await Promise.allSettled(slice.map((id) => writeStats(id)));
    refreshed += results.filter(r => r.status === 'fulfilled').length;
  }
  return { refreshed, active: sellerIds.length };
}
