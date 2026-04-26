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

const DEFAULT_FLAGS = [
  'mandi_bhav', 'msp_tracker', 'soil_health', 'pest_alerts',
  'scheme_finder', 'loan_calculator', 'crop_calendar', 'irrigation',
  'input_calculator', 'crop_master',
];

// ── In-memory cache (refreshed every 5 min) ───────────────────────────────────
let _cache = null;
let _lastFetched = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function loadFlags() {
  const now = Date.now();
  if (_cache && (now - _lastFetched) < CACHE_TTL) return _cache;

  const rows = await prisma.featureFlag.findMany();
  _cache = Object.fromEntries(rows.map(r => [r.featureKey, r.isEnabled]));
  _lastFetched = now;
  return _cache;
}

/** Returns true if the feature is enabled (or flag doesn't exist yet). */
export async function isEnabled(featureKey) {
  try {
    const flags = await loadFlags();
    // If the flag doesn't exist yet, default to enabled
    return flags[featureKey] !== false;
  } catch {
    return true; // fail-open: don't block the service if DB is down
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

/** Force cache invalidation (called after admin update). */
export function invalidateCache() {
  _cache = null;
  _lastFetched = 0;
}
