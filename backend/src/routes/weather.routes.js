/**
 * Weather Routes  —  GET /api/v1/weather?lat=&lon=&lang=&city=
 *
 * Cache layers (fastest → slowest):
 *  L1  Process memory Map  — 0ms,   survives until server restart
 *  L2  Prisma (PostgreSQL) — ~10ms, survives restarts
 *  L3  Open-Meteo API      — ~400ms, external
 *
 * IMD is FULLY NON-BLOCKING:
 *  • Open-Meteo response is returned to the client immediately.
 *  • IMD scraper runs in the background after the response is sent.
 *  • On the NEXT request for the same area, the cached entry already
 *    includes IMD alerts with zero added latency.
 *
 * For 1000 users in the same ~1km area:
 *  • First request  → L3 fetch + cache write  (~500ms)
 *  • All others     → L1 hit                  (~0ms)
 */
import { Router } from 'express';
import { fetchOpenMeteo, reverseGeocode } from '../services/openMeteo.service.js';
import { scrapeIMD }            from '../services/imd.scraper.service.js';
import { generateAdvisories }   from '../services/weather.advisory.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import prisma from '../config/db.js';

const router = Router();

// ── Per-segment cache windows ─────────────────────────────────────────────────
// The response is composed from TWO independently-sourced, independently-refreshing
// segments, each cached under its OWN location-scoped key (see makeCacheKey):
//   • 'forecast' — the Open-Meteo bundle (current + hourly + daily horizons arrive
//                  in a SINGLE upstream call, so they share one segment/TTL).
//   • 'alerts'   — IMD warnings, a SEPARATE scraper on a slower, best-effort cadence.
// Splitting them means a forecast refresh never wipes the alerts (the old bug: the
// OM rebuild reset `alerts: []`), an IMD update never clobbers the forecast, and the
// two refresh on their own schedules instead of as one coarse unit.
const FORECAST_TTL_MS   = 60 * 60 * 1000;  // 1 hour
const FORECAST_STALE_MS = 30 * 60 * 1000;  // 30 min — trigger background refresh
const ALERTS_TTL_MS     = 60 * 60 * 1000;  // 1 hour
const ALERTS_STALE_MS   = 30 * 60 * 1000;  // 30 min — re-scrape IMD in background

// ── L1: In-process memory cache ───────────────────────────────────────────────
// Key: segmented cacheKey → { data, cachedAt (ms), expiresAt (ms) }. Two segments
// per location now, so the cap is doubled; forecast ~4KB + alerts ~1KB per location.
const MAX_MEM_ENTRIES = 1000;
const _mem = new Map();

function memGet(key) {
  const e = _mem.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _mem.delete(key); return null; }
  return e;
}

// Set with an explicit cachedAt so a promotion from L2 preserves the original age
// (and therefore staleness), and an explicit TTL since segments differ.
function memSetAt(key, data, cachedAtMs, ttlMs) {
  if (_mem.size >= MAX_MEM_ENTRIES) {
    const firstKey = _mem.keys().next().value; // simple FIFO eviction
    _mem.delete(firstKey);
  }
  _mem.set(key, { data, cachedAt: cachedAtMs, expiresAt: cachedAtMs + ttlMs });
}
function memSet(key, data, ttlMs) { memSetAt(key, data, Date.now(), ttlMs); }

/** Test-only: clear the in-process weather cache so entries don't leak between tests. */
export function _resetWeatherCacheForTest() { _mem.clear(); lastPurge = 0; }

// ── Cache key (location + segment) ────────────────────────────────────────────
// Restructured so each independently-refreshable part has its own key. Updating
// one location's forecast (or one segment) can't invalidate any other location or
// the other segment.
export function makeCacheKey(lat, lon, segment) {
  return `${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}:${segment}`;
}

// ── L2: Prisma cache helpers ──────────────────────────────────────────────────
async function dbGet(key) {
  try {
    return await prisma.weatherCache.findUnique({ where: { cacheKey: key } });
  } catch { return null; }
}

async function dbSet(key, data, ttlMs) {
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.weatherCache.upsert({
      where:  { cacheKey: key },
      create: { cacheKey: key, data, cachedAt: now, expiresAt },
      update: { data, cachedAt: now, expiresAt },
    });
  } catch (e) {
    console.warn('[Weather] DB write failed (non-fatal):', e.message?.slice(0, 80));
  }
}

// Read a segment from L1, falling back to a non-expired L2 row (which it promotes
// into L1, preserving the original cachedAt). Returns { data, cachedAt } or null.
async function readSegment(key, ttlMs) {
  const m = memGet(key);
  if (m) return { data: m.data, cachedAt: m.cachedAt };
  const d = await dbGet(key);
  if (d) {
    const cachedAtMs = new Date(d.cachedAt).getTime();
    if (Date.now() - cachedAtMs < ttlMs) {
      memSetAt(key, d.data, cachedAtMs, ttlMs); // promote to L1
      return { data: d.data, cachedAt: cachedAtMs };
    }
  }
  return null;
}

// ── Opportunistic expired-entry purge (once per 10 min, non-blocking) ─────────
let lastPurge = 0;
function purgeExpiredAsync() {
  const now = Date.now();
  if (now - lastPurge < 10 * 60 * 1000) return;
  lastPurge = now;
  prisma.weatherCache.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

// ── Build the Open-Meteo forecast segment (no IMD — alerts are their own segment)
async function buildForecast(lat, lon, lang, cityName) {
  const [omData, resolvedName] = await Promise.all([
    fetchOpenMeteo(lat, lon, lang),
    cityName ? Promise.resolve(cityName) : reverseGeocode(lat, lon),
  ]);

  const advisories = generateAdvisories(omData.current, omData.daily, omData.agriculture, lang);

  return {
    current:     omData.current,
    hourly:      omData.hourly,
    daily:       omData.daily,
    agriculture: omData.agriculture,
    advisories,
    meta: {
      primarySource: 'Open-Meteo',
      cachedAt:      new Date().toISOString(),
      location:      { lat, lon, name: resolvedName || '' },
    },
  };
}

// Compose the client response from the two segments. IMD availability is derived
// from the alerts segment, so it's correct regardless of which segment refreshed last.
function compose(forecastData, alerts, extraMeta = {}) {
  return {
    ...forecastData,
    alerts,
    meta: { ...forecastData.meta, imdAvailable: alerts.length > 0, ...extraMeta },
  };
}

// ── Background segment refreshers (each writes ONLY its own segment) ───────────
function refreshForecastAsync(key, lat, lon, lang, city) {
  buildForecast(lat, lon, lang, city)
    .then(fresh => { memSet(key, fresh, FORECAST_TTL_MS); dbSet(key, fresh, FORECAST_TTL_MS).catch(() => {}); })
    .catch(() => {}); // best-effort; the served (stale) forecast remains valid
}

function refreshAlertsAsync(key, cityName) {
  scrapeIMD(cityName || '')
    .then(imd => {
      if (!imd.imdAvailable || !imd.alerts.length) return; // keep prior alerts, don't overwrite with empty
      const seg = { alerts: imd.alerts, imdAvailable: true };
      memSet(key, seg, ALERTS_TTL_MS);
      dbSet(key, seg, ALERTS_TTL_MS).catch(() => {});
    })
    .catch(() => {}); // fully swallow — IMD is best-effort
}

// ── GET /api/v1/weather ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { lat, lon, lang = 'en', city = '' } = req.query;

  if (!lat || !lon) return sendError(res, 'lat and lon are required', 400);

  const parsedLat = parseFloat(lat);
  const parsedLon = parseFloat(lon);
  if (isNaN(parsedLat) || isNaN(parsedLon)) return sendError(res, 'lat/lon must be numbers', 400);
  if (parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
    return sendError(res, 'lat/lon out of valid range', 400);
  }

  const safeLang     = lang === 'hi' ? 'hi' : 'en';
  const forecastKey  = makeCacheKey(parsedLat, parsedLon, 'forecast');
  const alertsKey    = makeCacheKey(parsedLat, parsedLon, 'alerts');

  // ── Alerts segment (independent): compose into every response, refresh on its
  //    own cadence. Missing/stale alerts never block or invalidate the forecast.
  const alertsSeg = await readSegment(alertsKey, ALERTS_TTL_MS);
  const alerts    = Array.isArray(alertsSeg?.data?.alerts) ? alertsSeg.data.alerts : [];
  if (!alertsSeg || Date.now() - alertsSeg.cachedAt > ALERTS_STALE_MS) {
    setImmediate(() => refreshAlertsAsync(alertsKey, city));
  }

  // ── Forecast segment (L1 → L2) ────────────────────────────────────────────
  const forecastSeg = await readSegment(forecastKey, FORECAST_TTL_MS);
  if (forecastSeg) {
    // Stale-while-revalidate: refresh ONLY the forecast segment — alerts untouched.
    if (Date.now() - forecastSeg.cachedAt > FORECAST_STALE_MS) {
      setImmediate(() => refreshForecastAsync(forecastKey, parsedLat, parsedLon, safeLang, city));
    }
    purgeExpiredAsync();
    return sendSuccess(res, compose(forecastSeg.data, alerts));
  }

  // ── No fresh forecast → fetch Open-Meteo, return immediately ──────────────
  try {
    const fresh = await buildForecast(parsedLat, parsedLon, safeLang, city);
    memSet(forecastKey, fresh, FORECAST_TTL_MS);
    dbSet(forecastKey, fresh, FORECAST_TTL_MS).catch(() => {});
    purgeExpiredAsync();
    return sendSuccess(res, compose(fresh, alerts));
  } catch (err) {
    console.error('[Weather] Open-Meteo fetch failed:', err.message);

    // Last resort: serve an expired forecast segment from L2 with a stale flag.
    const stale = await dbGet(forecastKey);
    if (stale?.data) {
      return sendSuccess(res, compose(stale.data, alerts, { stale: true }));
    }
    return sendError(res, 'Weather data unavailable. Please try again.', 503);
  }
});

// ── GET /weather/crops ────────────────────────────────────────────────────────
// Crop calendar list consumed by Weather/CropCalendar screen. Frontend has a
// hard-coded fallback, so this is a convenience endpoint to keep data in one place.
const CROP_CALENDAR = [
  { id: 1,  name: 'Tomato',    nameHi: 'टमाटर',   icon: '🍅', season: 'Kharif / Rabi', sowingMonth: 'Jun–Jul / Oct–Nov', harvestMonth: 'Sep–Oct / Jan–Feb', duration: '90–120 days'  },
  { id: 2,  name: 'Wheat',     nameHi: 'गेहूं',    icon: '🌾', season: 'Rabi',          sowingMonth: 'Oct–Nov',           harvestMonth: 'Mar–Apr',           duration: '120–150 days' },
  { id: 3,  name: 'Rice',      nameHi: 'धान',     icon: '🌾', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Oct–Nov',           duration: '100–150 days' },
  { id: 4,  name: 'Cotton',    nameHi: 'कपास',    icon: '🪴', season: 'Kharif',        sowingMonth: 'Apr–Jun',           harvestMonth: 'Oct–Jan',           duration: '160–200 days' },
  { id: 5,  name: 'Onion',     nameHi: 'प्याज',    icon: '🧅', season: 'Rabi',          sowingMonth: 'Oct–Dec',           harvestMonth: 'Mar–May',           duration: '90–120 days'  },
  { id: 6,  name: 'Soybean',   nameHi: 'सोयाबीन',  icon: '🫘', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Oct–Nov',           duration: '90–120 days'  },
  { id: 7,  name: 'Potato',    nameHi: 'आलू',     icon: '🥔', season: 'Rabi',          sowingMonth: 'Oct–Nov',           harvestMonth: 'Jan–Mar',           duration: '90–120 days'  },
  { id: 8,  name: 'Sugarcane', nameHi: 'गन्ना',    icon: '🎍', season: 'Spring',        sowingMonth: 'Feb–Mar',           harvestMonth: 'Dec–Mar',           duration: '12–18 months' },
  { id: 9,  name: 'Maize',     nameHi: 'मक्का',    icon: '🌽', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Sep–Oct',           duration: '80–100 days'  },
  { id: 10, name: 'Groundnut', nameHi: 'मूंगफली',  icon: '🥜', season: 'Kharif',        sowingMonth: 'Jun–Jul',           harvestMonth: 'Oct–Nov',           duration: '90–120 days'  },
];

router.get('/crops', (_req, res) => sendSuccess(res, CROP_CALENDAR));

export default router;
