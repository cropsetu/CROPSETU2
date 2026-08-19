/**
 * Feature Flag Service
 *
 * In-memory cache with DB backing.
 * Every service checks its flag before handling requests.
 * Admin can disable a feature instantly via PATCH /api/v1/admin/features/:key
 *
 * Supported feature keys:
 *   mandi_bhav | msp_tracker | soil_health | pest_alerts
 *   scheme_finder | loan_calculator | crop_calendar | irrigation
 *   input_calculator | crop_master
 */
import prisma from '../config/db.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

// ── AI kill switches ──────────────────────────────────────────────────────────
// Every LLM-backed route is gated by one of these. They exist so a spend spike,
// a provider outage or a bad model choice can be contained in seconds from the
// admin Ops → Feature Flags page, instead of requiring an env edit + redeploy.
// Disabling returns 503 with the admin's `disabledReason` so the mobile app can
// tell the farmer why. Flags propagate across instances in milliseconds via the
// Redis pub/sub below, and fail OPEN (isEnabled returns true when the DB is
// unreachable) so a database blip never silently disables the product.
const AI_FEATURE_FLAGS = [
  'ai_chat', 'ai_scan', 'ai_voice', 'ai_soil_ocr', 'ai_alerts', 'ai_planner', 'ai_schemes',
];

const DEFAULT_FLAGS = [
  'mandi_bhav', 'msp_tracker', 'soil_health', 'pest_alerts',
  'scheme_finder', 'loan_calculator', 'crop_calendar', 'irrigation',
  'input_calculator', 'crop_master',
  ...AI_FEATURE_FLAGS,
];

// ── In-memory cache (refreshed every 5 min) ───────────────────────────────────
let _cache = null;
let _lastFetched = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ── Cross-instance invalidation via Redis pub/sub ─────────────────────────────
// Each instance caches flags in-process, so an admin toggle on one instance is
// invisible to the others until their TTL lapses (up to 5 min of inconsistency).
// We broadcast every change on a Redis channel that all instances subscribe to,
// so they drop their cache and reload within milliseconds. If Redis is down the
// system degrades to the TTL-only behaviour — flags still converge, just slower.
const FLAG_CHANNEL = 'featureflags:invalidate';
let _subscriber = null;

function clearLocalCache() {
  _cache = null;
  _lastFetched = 0;
}

async function loadFlags() {
  const now = Date.now();
  if (_cache && (now - _lastFetched) < CACHE_TTL) return _cache;

  const rows = await prisma.featureFlag.findMany();
  // Cache the DISABLED REASON alongside the boolean: a kill switch that cannot
  // tell the user why it fired just looks like an outage. Callers that only need
  // the boolean keep using isEnabled().
  _cache = Object.fromEntries(rows.map(r => [r.featureKey, { enabled: r.isEnabled, reason: r.disabledReason || null }]));
  _lastFetched = now;
  return _cache;
}

/** Returns true if the feature is enabled (or flag doesn't exist yet). */
export async function isEnabled(featureKey) {
  try {
    const flags = await loadFlags();
    // If the flag doesn't exist yet, default to enabled
    return flags[featureKey]?.enabled !== false;
  } catch {
    return true; // fail-open: don't block the service if DB is down
  }
}

/**
 * Flag state + the admin's reason for disabling it.
 * Fails OPEN (enabled) exactly like isEnabled — a DB blip must never take a
 * feature down on its own.
 */
export async function getFlag(featureKey) {
  try {
    const flags = await loadFlags();
    const f = flags[featureKey];
    if (!f) return { enabled: true, reason: null };
    return { enabled: f.enabled !== false, reason: f.reason };
  } catch {
    return { enabled: true, reason: null };
  }
}

/** Seed default feature flags (run once on startup). */
export async function seedDefaultFlags() {
  for (const key of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { featureKey: key },
      create: { featureKey: key, isEnabled: true },
      update: {},  // don't overwrite existing flags
    }).catch(e => console.warn('[FeatureFlags] Seed failed for %s: %s', key, e.message));
  }
}

/**
 * Force cache invalidation after an admin update.
 *
 * Clears THIS process's cache immediately and broadcasts the change to every
 * other instance over Redis pub/sub (fire-and-forget — a publish failure must
 * never break the admin write). The local subscriber will also receive this
 * broadcast and re-clear, which is harmless.
 *
 * @param {string} [featureKey='*'] — the key that changed (for broadcast logging)
 */
export function invalidateCache(featureKey = '*') {
  clearLocalCache();
  if (redis?.status === 'ready') {
    redis.publish(FLAG_CHANNEL, String(featureKey))
      .catch((err) => logger.warn('[FeatureFlags] invalidation broadcast failed: %s', err.message));
  }
}

/**
 * Subscribe to cross-instance flag invalidations. Call ONCE at startup, after the
 * primary Redis connection is up. Uses a dedicated connection because a Redis
 * connection in subscribe mode cannot run normal commands (the main client must
 * stay free for publishes and every other Redis user). ioredis auto-resubscribes
 * after a reconnect, so the subscription survives Redis blips.
 *
 * Degrades gracefully: if Redis is unavailable this logs and returns; flags then
 * converge within CACHE_TTL via the periodic refresh. Idempotent.
 */
export async function initFlagInvalidationSubscriber() {
  if (_subscriber) return;
  try {
    const sub = redis.duplicate();
    sub.on('error', (err) => logger.warn('[FeatureFlags] subscriber error: %s', err.message));
    sub.on('message', (channel, message) => {
      if (channel !== FLAG_CHANNEL) return;
      clearLocalCache();
      logger.info('[FeatureFlags] cache invalidated by broadcast (key=%s)', message);
    });
    await sub.connect();
    await sub.subscribe(FLAG_CHANNEL);
    _subscriber = sub;
    logger.info('[FeatureFlags] subscribed to %s for cross-instance invalidation', FLAG_CHANNEL);
  } catch (err) {
    logger.warn(
      '[FeatureFlags] pub/sub unavailable — flags converge via %d-min TTL only: %s',
      CACHE_TTL / 60000, err.message,
    );
  }
}

/** Stop the invalidation subscriber (graceful shutdown / tests). */
export async function stopFlagInvalidationSubscriber() {
  if (!_subscriber) return;
  try { await _subscriber.quit(); } catch { /* already closing — ignore */ }
  _subscriber = null;
}
