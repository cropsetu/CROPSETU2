/**
 * Weather API Service — Frontend
 *
 * Speed strategy (ordered by impact):
 *
 * 1. READ AsyncStorage weather cache FIRST (before getting location).
 *    → UI renders in ~100ms on every repeat open.
 *
 * 2. CACHE GPS coordinates with 15-min TTL.
 *    → Skips Location.getCurrentPositionAsync (saves 1–5 seconds on Android).
 *    → Uses getLastKnownPositionAsync as fallback (returns in <50ms if OS has a fix).
 *    → Only calls getCurrentPositionAsync on very first ever open.
 *
 * 3. CACHE city name alongside coords.
 *    → Skips reverseGeocodeAsync (saves 500ms–1.5s).
 *
 * 4. Background refresh after rendering cached UI.
 *    → User sees data immediately; fresh data replaces it silently.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { API_BASE_URL } from '../constants/config';

// ── TTLs ──────────────────────────────────────────────────────────────────────
const WEATHER_CACHE_TTL_MS  = 60 * 60 * 1000;   // 1 hour  — weather data
const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000;   // 15 min  — GPS coords + city
const TIMEOUT_MS            = 8_000;             // reduced from 10s → 8s

// ── Storage keys ──────────────────────────────────────────────────────────────
const WEATHER_KEY_PREFIX = 'fe_wx_';            // fe_wx_{lat}_{lon}
const LOCATION_KEY       = 'fe_loc';            // { lat, lon, city, savedAt }

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

// ── Location cache ────────────────────────────────────────────────────────────
async function readLocationCache() {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const loc = JSON.parse(raw);
    if (Date.now() - loc.savedAt > LOCATION_CACHE_TTL_MS) return null;
    return { lat: loc.lat, lon: loc.lon, city: loc.city };
  } catch { return null; }
}

async function writeLocationCache(lat, lon, city) {
  try {
    await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify({ lat, lon, city, savedAt: Date.now() }));
  } catch { /* non-fatal */ }
}

// ── Location resolver ─────────────────────────────────────────────────────────
// Priority: cached coords → lastKnown (OS) → getCurrentPosition (GPS hardware)
// Each step is faster than the next. We almost never need the GPS hardware.
async function resolveLocation() {
  // 1. Use cached coords if fresh (< 15 min)
  const cached = await readLocationCache();
  if (cached) return cached;

  // 2. Request permission (fast if already granted — no UI shown)
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission denied');

  // 3. OS last-known position (returns in <50ms, no GPS hardware wake-up)
  let coords = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }); // accept up to 10min old

  // 4. Full GPS fix only if OS has nothing (first ever open or very cold device)
  if (!coords) {
    coords = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  }

  const { latitude: lat, longitude: lon } = coords.coords;

  // 5. Reverse geocode city name (async, non-blocking for the main flow)
  let city = '';
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    city = place.city || place.district || place.subregion || '';
  } catch { /* keep empty */ }

  // Cache for next 15 min
  writeLocationCache(lat, lon, city).catch(() => {});

  return { lat, lon, city };
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
  // We read the location cache to know which weather key to look up.
  // If location cache is empty we'll still attempt a weather read after GPS.
  const cachedLoc  = await readLocationCache();
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
    loc = await resolveLocation();
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
