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

const CACHE_TTL_MS       = 60 * 60 * 1000;  // 1 hour
const STALE_THRESHOLD_MS = 30 * 60 * 1000;  // 30 min — trigger background refresh

// ── L1: In-process memory cache ───────────────────────────────────────────────
// Key: cacheKey string → { data, cachedAt (ms), imdEnriched }
// Capped at 500 entries — each entry ~4KB JSON → max ~2MB RAM
const MAX_MEM_ENTRIES = 500;
const _mem = new Map();

function memGet(key) {
  const e = _mem.get(key);
  if (!e) return null;
  if (Date.now() - e.cachedAt > CACHE_TTL_MS) { _mem.delete(key); return null; }
  return e;
}

function memSet(key, data, imdEnriched = false) {
  // Evict oldest entry when cap reached (simple FIFO)
  if (_mem.size >= MAX_MEM_ENTRIES) {
    const firstKey = _mem.keys().next().value;
    _mem.delete(firstKey);
  }
  _mem.set(key, { data, cachedAt: Date.now(), imdEnriched });
}

// ── Cache key ──────────────────────────────────────────────────────────────────
function makeCacheKey(lat, lon) {
  return `${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}`;
}

// ── L2: Prisma cache helpers ──────────────────────────────────────────────────
async function dbGet(key) {
  try {
    return await prisma.weatherCache.findUnique({ where: { cacheKey: key } });
  } catch { return null; }
}

async function dbSet(key, data) {
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
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

// ── Opportunistic expired-entry purge (once per 10 min, non-blocking) ─────────
let lastPurge = 0;
function purgeExpiredAsync() {
  const now = Date.now();
  if (now - lastPurge < 10 * 60 * 1000) return;
  lastPurge = now;
  prisma.weatherCache.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

// ── Build Open-Meteo-only response (fast, no IMD wait) ────────────────────────
async function buildOMResponse(lat, lon, lang, cityName) {
  // Resolve location name: use client-supplied city if present,
  // otherwise reverse-geocode from lat/lon (runs in parallel with weather fetch)
  const [omData, resolvedName] = await Promise.all([
    fetchOpenMeteo(lat, lon, lang),
    cityName ? Promise.resolve(cityName) : reverseGeocode(lat, lon),
  ]);

  const advisories = generateAdvisories(
    omData.current,
    omData.daily,
    omData.agriculture,
    lang,
  );

  return {
    current:     omData.current,
    hourly:      omData.hourly,
    daily:       omData.daily,
    agriculture: omData.agriculture,
    advisories,
    alerts:      [],          // IMD alerts added later by background enrichment
    meta: {
      primarySource: 'Open-Meteo',
      imdAvailable:  false,  // updated to true once IMD enrichment completes
      cachedAt:      new Date().toISOString(),
      location:      { lat, lon, name: resolvedName || '' },
    },
  };
}

// ── Background IMD enrichment ─────────────────────────────────────────────────
// Called AFTER the response is already sent. Updates both cache layers.
function enrichWithIMDAsync(key, currentData, cityName) {
  scrapeIMD(cityName || '')
    .then(imdData => {
      if (!imdData.imdAvailable || !imdData.alerts.length) return;

      const enriched = {
        ...currentData,
        alerts: imdData.alerts,
        meta:   { ...currentData.meta, imdAvailable: true },
      };

      // Update both cache layers so next request gets alerts immediately
      memSet(key, enriched, true);
      dbSet(key, enriched).catch(() => {});
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

  const safeLang = lang === 'hi' ? 'hi' : 'en';
  const key      = makeCacheKey(parsedLat, parsedLon);

  // ── L1: Memory cache hit (0ms) ────────────────────────────────────────────
  const memEntry = memGet(key);
  if (memEntry) {
    const ageMs = Date.now() - memEntry.cachedAt;

    // Stale-while-revalidate: refresh in background if cache is 30–60 min old
    if (ageMs > STALE_THRESHOLD_MS) {
      buildOMResponse(parsedLat, parsedLon, safeLang, city)
        .then(fresh => {
          memSet(key, fresh);
          dbSet(key, fresh).catch(() => {});
          if (!memEntry.imdEnriched) enrichWithIMDAsync(key, fresh, city);
        })
        .catch(() => {});
    } else if (!memEntry.imdEnriched) {
      // IMD wasn't enriched yet for this entry — try now in background
      enrichWithIMDAsync(key, memEntry.data, city);
    }

    purgeExpiredAsync();
    return sendSuccess(res, memEntry.data);
  }

  // ── L2: Prisma DB cache (~10ms) ───────────────────────────────────────────
  const dbEntry = await dbGet(key);
  if (dbEntry) {
    const ageMs = Date.now() - new Date(dbEntry.cachedAt).getTime();

    if (ageMs < CACHE_TTL_MS) {
      // Promote to L1 so next request is instant
      memSet(key, dbEntry.data, dbEntry.data?.meta?.imdAvailable ?? false);

      if (ageMs > STALE_THRESHOLD_MS) {
        buildOMResponse(parsedLat, parsedLon, safeLang, city)
          .then(fresh => {
            memSet(key, fresh);
            dbSet(key, fresh).catch(() => {});
            enrichWithIMDAsync(key, fresh, city);
          })
          .catch(() => {});
      } else if (!dbEntry.data?.meta?.imdAvailable) {
        enrichWithIMDAsync(key, dbEntry.data, city);
      }

      purgeExpiredAsync();
      return sendSuccess(res, dbEntry.data);
    }
    // DB entry expired — fall through to fresh fetch
  }

  // ── L3: Fresh fetch from Open-Meteo ──────────────────────────────────────
  // Return immediately without waiting for IMD.
  try {
    const data = await buildOMResponse(parsedLat, parsedLon, safeLang, city);

    // Write to both cache layers (non-blocking)
    memSet(key, data);
    dbSet(key, data).catch(() => {});

    // IMD enrichment happens AFTER response is sent
    // It updates the cache so the NEXT request already has IMD alerts
    setImmediate(() => enrichWithIMDAsync(key, data, city));

    purgeExpiredAsync();
    return sendSuccess(res, data);

  } catch (err) {
    console.error('[Weather] Open-Meteo fetch failed:', err.message);

    // Last resort: serve expired DB cache with stale flag
    if (dbEntry?.data) {
      return sendSuccess(res, {
        ...dbEntry.data,
        meta: { ...dbEntry.data.meta, stale: true },
      });
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
