/**
 * Cache warming / preloading for high-traffic data.
 *
 * The hottest user-facing dataset — mandi (market) prices — is served from an
 * in-process cache backed by slow, rate-limited Groq LLM calls. After a deploy or
 * a TTL expiry that cache is COLD, so the first user to ask for a popular
 * commodity/state pays the full recompute latency (a multi-second LLM round-trip).
 *
 * This module preloads the hottest keys so that first request hits a warm cache
 * instead. Run it on startup (per instance — the cache is in-process, so every
 * instance must warm its own) and on a scheduled refresh just under the cache TTL
 * so hot keys never lapse to cold during quiet periods.
 *
 * It's deliberately small and gentle: a curated set of top combos, warmed in
 * small concurrent batches, well under the Groq free-tier rate limit. Warming
 * reuses getMarketPrices(), so it shares the single-flight guard — a real user
 * racing in during warming still triggers only ONE recompute, not two.
 *
 * SCALE-2: because the market cache is in-process, warming runs on each instance.
 * If/when the hot dataset moves to a shared Redis cache, this becomes a
 * single-instance job (one warmer fills Redis for the whole fleet).
 */
import logger from '../utils/logger.js';
import { ENV } from '../config/env.js';
import { getMarketPrices } from './market.data.service.js';
import { isEnabled } from './featureFlag.service.js';

// Curated hottest commodity/state combos (highest mandi-bhav traffic). Kept small
// so a full warm stays well under the Groq rate limit and finishes within seconds.
const HOT_MARKET_COMBOS = [
  ['Tomato', 'Maharashtra'],     ['Onion', 'Maharashtra'],
  ['Potato', 'Uttar Pradesh'],   ['Wheat', 'Punjab'],
  ['Onion', 'Karnataka'],        ['Tomato', 'Karnataka'],
  ['Soybean', 'Madhya Pradesh'], ['Cotton', 'Gujarat'],
  ['Rice', 'West Bengal'],       ['Potato', 'Punjab'],
  ['Tomato', 'Andhra Pradesh'],  ['Wheat', 'Uttar Pradesh'],
];

const WARM_BATCH = 4; // concurrent warm calls per batch — gentle on the LLM provider

/**
 * Preload the hot mandi-price keys into the in-process cache.
 * @returns {Promise<{ok:number, fail:number, total:number, skipped?:boolean}>}
 */
export async function warmMarketCache() {
  const total = HOT_MARKET_COMBOS.length;
  // Nothing to warm without an LLM key — getMarketPrices would only return
  // (uncached) fallbacks, so skip the pointless calls.
  if (!ENV.GEMINI_API_KEY) {
    logger.info('[CacheWarm] GEMINI_API_KEY not set — skipping market cache warm');
    return { ok: 0, fail: 0, total, skipped: true };
  }

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
