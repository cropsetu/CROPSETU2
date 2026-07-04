/**
 * Cache warming / preloading for high-traffic data.
 *
 * NOTE: mandi (market) prices are now served as instant, deterministic estimates
 * (no LLM — see market.data.service.js), so there's no cold-start latency left to
 * hide. Warming is therefore near-pointless today and is OFF unless
 * CACHE_WARMING_ENABLED=true (see server.js). It's kept only so that if/when a
 * real, slow mandi-price API is wired in, preloading the hot keys becomes useful
 * again with no code change. Warming reuses getMarketPrices() and its single-flight
 * guard, so a user racing in still triggers only one compute.
 */
import logger from '../utils/logger.js';
import { getMarketPrices } from './market.data.service.js';
import { isEnabled } from './featureFlag.service.js';

// Curated hottest commodity/state combos (highest mandi-bhav traffic). Kept small.
const HOT_MARKET_COMBOS = [
  ['Tomato', 'Maharashtra'],     ['Onion', 'Maharashtra'],
  ['Potato', 'Uttar Pradesh'],   ['Wheat', 'Punjab'],
  ['Onion', 'Karnataka'],        ['Tomato', 'Karnataka'],
  ['Soybean', 'Madhya Pradesh'], ['Cotton', 'Gujarat'],
  ['Rice', 'West Bengal'],       ['Potato', 'Punjab'],
  ['Tomato', 'Andhra Pradesh'],  ['Wheat', 'Uttar Pradesh'],
];

const WARM_BATCH = 4; // combos preloaded per batch

/**
 * Preload the hot mandi-price keys into the in-process cache.
 * @returns {Promise<{ok:number, fail:number, total:number, skipped?:boolean}>}
 */
export async function warmMarketCache() {
  const total = HOT_MARKET_COMBOS.length;

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < total; i += WARM_BATCH) {
    const batch = HOT_MARKET_COMBOS.slice(i, i + WARM_BATCH);
    const results = await Promise.allSettled(
      batch.map(([commodity, state]) => getMarketPrices(commodity, state)),
    );
    for (const r of results) {
      // A fulfilled-but-fallback result means the LLM call failed and nothing was
      // cached — count it as a miss so the log reflects real warmth.
      if (r.status === 'fulfilled' && r.value && !r.value.isFallback) ok++;
      else fail++;
    }
  }
  logger.info('[CacheWarm] Market cache warmed: %d/%d hot keys (%d fallback/fail)', ok, total, fail);
  return { ok, fail, total };
}

/** Preload the feature-flag cache (one DB read loads them all). Cheap. */
export async function warmFeatureFlags() {
  try {
    await isEnabled('mandi_bhav'); // any key triggers a full flag load into cache
  } catch (err) {
    logger.warn('[CacheWarm] feature-flag warm failed: %s', err.message);
  }
}

/**
 * Warm every hot dataset. Never throws — warming is best-effort and must not take
 * down startup or a scheduled tick.
 */
export async function warmAllCaches() {
  try {
    await warmFeatureFlags();
    await warmMarketCache();
  } catch (err) {
    logger.warn('[CacheWarm] warming failed: %s', err.message);
  }
}
