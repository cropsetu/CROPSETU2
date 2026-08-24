/**
 * Weather API Service — Frontend
 *
 * Speed strategy (ordered by impact):
 *
 * 1. READ AsyncStorage weather cache FIRST (before getting location).
 *    → UI renders in ~100ms on every repeat open.
 *
 * 2. LOCATION comes from services/locationService — the app's one fix.
 *    → That module owns the TTL'd cache, the OS last-known fast path and the
 *      permission request. This file used to own a second, private copy of all
 *      three, which meant two permission prompts and two caches that could
 *      disagree with each other. Resolving here now also updates the Rent and
 *      Animals tabs, because they read the same service through LocationContext.
 *
 * 3. City name is cached alongside the coords by that service.
 *    → Skips reverseGeocodeAsync (saves 500ms–1.5s).
 *
 * 4. Background refresh after rendering cached UI.
 *    → User sees data immediately; fresh data replaces it silently.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { peekLocationAsync, resolveLocation } from './locationService';
import { API_BASE_URL } from '@krushisarva/shared/constants/config';

// ── TTLs ──────────────────────────────────────────────────────────────────────
const WEATHER_CACHE_TTL_MS  = 60 * 60 * 1000;   // 1 hour  — weather data
const TIMEOUT_MS            = 8_000;             // reduced from 10s → 8s

// ── Storage keys ──────────────────────────────────────────────────────────────
// Weather payloads are public data → plain AsyncStorage. The precise GPS
// coordinates they are keyed by are PII and live in encrypted secure storage,
// owned by locationService — this file never touches them at rest.
const WEATHER_KEY_PREFIX = 'fe_wx_';            // fe_wx_{lat}_{lon}

// ── In-memory L0 cache (process lifetime) ─────────────────────────────────────
// Prevents redundant AsyncStorage reads when user switches tabs quickly.
const _memCache = new Map(); // key → { data, savedAt }

function memGet(key) {
  const e = _memCache.get(key);
  if (!e) return null;
  if (Date.now() - e.savedAt > WEATHER_CACHE_TTL_MS) { _memCache.delete(key); return null; }
  return e.data;
}
function memSet(key, data) {
  _memCache.set(key, { data, savedAt: Date.now() });
}

// ── Cache key ─────────────────────────────────────────────────────────────────
function wxKey(lat, lon) {
  return `${WEATHER_KEY_PREFIX}${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}`;
}

// ── AsyncStorage weather cache ────────────────────────────────────────────────
async function readWxCache(key) {
  // L0: memory first
  const mem = memGet(key);
  if (mem) return { data: mem, stale: false };

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw);
    const stale = Date.now() - savedAt > WEATHER_CACHE_TTL_MS;
    if (data) memSet(key, data); // promote to L0
    return { data, stale };
  } catch { return null; }
}

async function writeWxCache(key, data) {
  memSet(key, data); // L0
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch { /* non-fatal */ }
}

// ── HTTP fetch with timeout ───────────────────────────────────────────────────
async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────
async function fetchFromBackend(lat, lon, city, lang) {
  const url = `${API_BASE_URL}/weather?lat=${lat}&lon=${lon}&lang=${lang}&city=${encodeURIComponent(city)}`;
  const json = await fetchWithTimeout(url);
  return json?.data ?? json; // unwrap { success, data } envelope
}

/**
 * Fetch weather with offline-first, instant-cache-display pattern.
 *
 * Flow:
 *  1. Read AsyncStorage cache immediately → call onCacheHit (UI renders now)
 *  2. Resolve location (cached coords → lastKnown → GPS)
 *  3. Fetch fresh data from backend
 *  4. Write to cache and return fresh data
 *
 * @param {{ lang?: string, onCacheHit?: (result) => void }} opts
 * @returns {{ loc, data, stale, cachedAt, error }}
 */
export async function fetchWeatherForCurrentLocation(opts = {}) {
  const SUPPORTED = new Set(['en','hi','mr','ta','kn','ml','te','bn','gu','pa']);
  const lang = SUPPORTED.has(opts.lang) ? opts.lang : 'en';

  // ── Step 1: Fire cached data to UI before anything else ───────────────────
  // We read the last known fix to know which weather key to look up. Age is
  // deliberately ignored here: a fix from an hour ago is still the right cache
  // key, and gating the instant paint on a 15-min location TTL used to blank the
  // screen on repeat opens even when the weather cache itself was perfectly
  // valid. Freshness is Step 2's job.
  const cachedLoc  = await peekLocationAsync();
  let   servedCache = false;

  if (cachedLoc) {
    const key    = wxKey(cachedLoc.lat, cachedLoc.lon);
    const cached = await readWxCache(key);
    if (cached?.data && opts.onCacheHit) {
      opts.onCacheHit({
        data:     cached.data,
        stale:    cached.stale,
        cachedAt: cached.data?.meta?.cachedAt ?? null,
        loc:      cachedLoc,
      });
      servedCache = true;
    }
  }

  // ── Step 2: Resolve location (fast path: usually <100ms) ─────────────────
  let loc;
  try {
    loc = await resolveLocation();   // shared ladder: cache → last-known → GPS
  } catch (err) {
    // No GPS and no cached location — return whatever the cache had
    if (servedCache && cachedLoc) {
      const key    = wxKey(cachedLoc.lat, cachedLoc.lon);
      const cached = await readWxCache(key);
      return { loc: cachedLoc, data: cached?.data ?? null, stale: true, cachedAt: null, error: null };
    }
    return { loc: null, data: null, stale: false, cachedAt: null, error: err.message };
  }

  // ── Step 3: Fetch fresh weather from backend ──────────────────────────────
  const key = wxKey(loc.lat, loc.lon);
  try {
    const data = await fetchFromBackend(loc.lat, loc.lon, loc.city, lang);
    await writeWxCache(key, data);
    return {
      loc,
      data,
      stale:    false,
      cachedAt: data?.meta?.cachedAt ?? new Date().toISOString(),
      error:    null,
    };
  } catch (err) {
    // Network error — serve whatever we have
    const cached = await readWxCache(key);
    return {
      loc,
      data:     cached?.data ?? null,
      stale:    true,
      cachedAt: cached?.data?.meta?.cachedAt ?? null,
      error:    cached?.data ? null : err.message, // hide error if we have cache
    };
  }
}

/**
 * Format "last updated X min ago" label.
 * @param {string|null} cachedAt
 */
export function formatLastUpdated(cachedAt) {
  if (!cachedAt) return '';
  const diff = Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60_000);
  if (diff < 1)  return 'Just now';
  if (diff < 60) return `${diff} min ago`;
  return `${Math.floor(diff / 60)}h ago`;
}
