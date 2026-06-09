/**
 * Cache observability — hit/miss counters + threshold alerting (feeds OPS-4).
 *
 * Cache effectiveness used to be invisible: nobody could see whether a cache was
 * actually serving reads or just adding latency, nor whether Redis was under
 * memory pressure. Every cache (the Redis listing cache, the in-process market
 * cache) records hits and misses here; getCacheMetrics() exposes them on /readyz
 * for dashboards, and checkCacheAlerts() emits loud [ALERT] log markers when the
 * hit rate sags or Redis memory runs hot, so log-based alerting can hook them.
 *
 * Counters are per-process and cumulative since boot. The alert check uses a
 * WINDOWED delta (since the previous check) so a transient cold-start dip doesn't
 * drag a lifetime average, and a sustained problem actually trips.
 */
import logger from './logger.js';

let _hits = 0;
let _misses = 0;
const _bySource = new Map(); // source -> { hits, misses }

function bump(source, kind) {
  let e = _bySource.get(source);
  if (!e) { e = { hits: 0, misses: 0 }; _bySource.set(source, e); }
  e[kind] += 1;
}

/** Record a cache hit for a labelled source (e.g. 'listing:agristore:products'). */
export function recordCacheHit(source = 'default') { _hits += 1; bump(source, 'hits'); }

/** Record a cache miss for a labelled source. */
export function recordCacheMiss(source = 'default') { _misses += 1; bump(source, 'misses'); }

function rate(hits, total) { return total ? Number((hits / total).toFixed(4)) : null; }

/**
 * Snapshot of cumulative cache metrics since process start.
 * @returns {{hits:number, misses:number, total:number, hitRate:number|null,
 *            bySource:Record<string,{hits:number,misses:number,hitRate:number|null}>}}
 */
export function getCacheMetrics() {
  const total = _hits + _misses;
  const bySource = {};
  for (const [k, v] of _bySource) {
    bySource[k] = { hits: v.hits, misses: v.misses, hitRate: rate(v.hits, v.hits + v.misses) };
  }
  return { hits: _hits, misses: _misses, total, hitRate: rate(_hits, total), bySource };
}

/** Test-only: clear all counters so they don't leak between test files. */
export function resetCacheMetrics() {
  _hits = 0; _misses = 0; _bySource.clear();
  _lastHits = 0; _lastMisses = 0;
}

// ── Threshold alerting ────────────────────────────────────────────────────────
let _lastHits = 0;
let _lastMisses = 0;

/**
 * Evaluate cache health over the window since the last call and emit [ALERT] logs
 * when thresholds are breached. Intended to run on a schedule (see server.js,
 * which injects the live thresholds + Redis memory %).
 *
 * Uses logger.error for the markers so they surface in production (logger.warn is
 * suppressed there) — same OPS-4 contract as the [ALERT][Redis] outage log. Kept
 * dependency-free (memory % and thresholds are passed in) so it stays pure and
 * trivially testable.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.minSamples]   minimum reads in the window before judging hit rate
 * @param {number}  [opts.hitRateFloor] alert when windowed hit rate < this (0..1)
 * @param {number}  [opts.memPctCeil]   alert when memPct >= this
 * @param {number|null} [opts.memPct]   current Redis used-memory % of maxmemory (null = no ceiling)
 * @returns {{hitRateAlert:boolean, memoryAlert:boolean, windowReads:number, windowHitRate:number|null}}
 */
export function checkCacheAlerts({
  minSamples   = 50,
  hitRateFloor = 0.5,
  memPctCeil   = 85,
  memPct       = null,
} = {}) {
  // Windowed hit rate since the previous check.
  const dh = _hits - _lastHits;
  const dm = _misses - _lastMisses;
  _lastHits = _hits;
  _lastMisses = _misses;
  const windowReads = dh + dm;
  const windowHitRate = windowReads ? dh / windowReads : null;

  let hitRateAlert = false;
  // Only judge once there's enough traffic to be meaningful — avoids alerting on a
  // handful of cold-start misses.
  if (windowReads >= minSamples && windowHitRate < hitRateFloor) {
    hitRateAlert = true;
    logger.error(
      '[ALERT][Cache] low hit rate %d%% over last window (%d hits / %d reads; floor %d%%) — cache may be ineffective or thrashing',
      Math.round(windowHitRate * 100), dh, windowReads, Math.round(hitRateFloor * 100),
    );
  }

  // Redis memory pressure (only when maxmemory is configured → a real ceiling).
  let memoryAlert = false;
  if (memPct != null && memPct >= memPctCeil) {
    memoryAlert = true;
    logger.error(
      '[ALERT][Redis][Memory] used memory at %d%% of maxmemory (ceil %d%%) — risk of eviction/OOM',
      Math.round(memPct), memPctCeil,
    );
  }

  return { hitRateAlert, memoryAlert, windowReads, windowHitRate };
}
