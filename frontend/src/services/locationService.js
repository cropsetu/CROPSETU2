/**
 * locationService — the app's single source of truth for "where is the user".
 *
 * This exists because there used to be two. LocationContext requested
 * permission and took a fresh GPS fix at app start; weatherApi.js independently
 * requested permission again and kept its own persisted, TTL'd cache. Two
 * permission paths, two caches that could disagree, and — the part that actually
 * cost users time — the sophisticated implementation was the one nine screens
 * did NOT use. Every cold start paid a full `getCurrentPositionAsync` (1–5s on
 * Android) before the Rent tab could fire its first request.
 *
 * Why a plain module rather than a hook: weatherApi.js is not a React module, so
 * it cannot read a context. That is the whole reason it forked. Keeping the
 * resolution logic framework-agnostic is what lets both a provider and a plain
 * service share one cache, one permission request and one in-flight fix.
 * LocationContext is now a thin adapter over this.
 *
 * Resolution ladder, cheapest first — the GPS hardware is the last resort:
 *   1. in-memory snapshot        (~0ms, process lifetime)
 *   2. persisted cache, if fresh (~5ms, survives cold start)
 *   3. OS last-known position    (<50ms, no hardware wake-up)
 *   4. Balanced fix, 4s cap      (the honest read)
 *   5. Lowest-accuracy fix       (so a cold device never hangs)
 *
 * Concurrent callers share one in-flight promise, so the ten screens that mount
 * at once cannot stampede the GPS.
 *
 * Coordinates are PII, so the persisted copy goes through secureCache
 * (Keychain/Keystore on native) — never plain AsyncStorage.
 */
import * as ExpoLocation from 'expo-location';
import { getSecureJSON, setSecureJSON } from '../utils/secureCache';

// Same key and record shape weatherApi already wrote, so an existing user's
// cached fix carries across the upgrade instead of forcing one more cold GPS read.
const LOCATION_KEY = 'fe_loc';   // { lat, lon, city, savedAt }

/** How long a fix is considered current. Matches weatherApi's original TTL. */
export const LOCATION_TTL_MS = 15 * 60 * 1000;

/** How stale an OS last-known fix may be before we'd rather ask the hardware. */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/** Cap on the balanced fix before dropping to a coarse one. */
const FIX_TIMEOUT_MS = 4_000;

export const PERMISSION = { UNKNOWN: 'unknown', GRANTED: 'granted', DENIED: 'denied' };

// ── Module state ─────────────────────────────────────────────────────────────
let _mem        = null;                  // { lat, lon, city, savedAt, source }
let _permission = PERMISSION.UNKNOWN;
let _inFlight   = null;                  // shared promise while a fix is resolving
let _hydrated   = null;                  // shared promise for the one disk read
const _subs     = new Set();

function snapshot() {
  return { location: _mem, permission: _permission };
}

/** Subscribe to location/permission changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function notify() {
  const snap = snapshot();
  // Copy first: a subscriber that unsubscribes in its own callback would
  // otherwise mutate the set mid-iteration.
  for (const fn of [..._subs]) {
    try { fn(snap); } catch { /* a bad subscriber must not break the others */ }
  }
}

export function getPermission() { return _permission; }

function isFresh(rec, maxAgeMs) {
  return !!rec && Date.now() - rec.savedAt <= maxAgeMs;
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Loads the persisted fix into memory. Idempotent — the disk read happens once. */
export function hydrate() {
  if (_hydrated) return _hydrated;
  _hydrated = (async () => {
    try {
      const rec = await getSecureJSON(LOCATION_KEY);
      // Kept regardless of age: a stale fix is still the right weather cache key
      // and still a better first paint than a blank screen. Callers that need
      // freshness ask for it via maxAgeMs.
      if (rec && rec.lat != null && rec.lon != null) {
        _mem = { ...rec, source: 'cache' };
        notify();
      }
    } catch { /* non-fatal — we just resolve fresh */ }
    return _mem;
  })();
  return _hydrated;
}

async function persist(rec) {
  try {
    await setSecureJSON(LOCATION_KEY, {
      lat: rec.lat, lon: rec.lon, city: rec.city ?? '', savedAt: rec.savedAt,
    });
  } catch { /* non-fatal */ }
}

/**
 * The last fix we hold, at any age, without touching the GPS. Use for instant
 * paint; use resolveLocation when the answer has to be current.
 *
 * @returns {{lat, lon, city, savedAt, source}|null}
 */
export function peekLocation() { return _mem; }

/** Same, but waits for the one-time disk hydration first. */
export async function peekLocationAsync() {
  await hydrate();
  return _mem;
}

// ── Permission ───────────────────────────────────────────────────────────────
// Always routed through here so the denial state is recorded once and shared.
// Re-asking is deliberate: a user who granted permission in Settings after a
// first denial recovers without restarting the app.
async function ensurePermission() {
  const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
  const granted = status === 'granted';
  const next = granted ? PERMISSION.GRANTED : PERMISSION.DENIED;
  if (next !== _permission) { _permission = next; notify(); }
  return granted;
}

// ── Reverse geocode (off the critical path) ──────────────────────────────────
// The backend tolerates an empty city and resolves the name itself, so blocking
// a fix on a 500ms–1.5s client geocode was pure waste. Fire and forget; the
// resolved name lands in the cache for the next call.
function fillCity(rec) {
  if (rec.city) return;
  ExpoLocation.reverseGeocodeAsync({ latitude: rec.lat, longitude: rec.lon })
    .then(([place]) => {
      const city = place?.city || place?.district || place?.subregion || '';
      if (!city) return;
      if (_mem && _mem.lat === rec.lat && _mem.lon === rec.lon) {
        _mem = { ..._mem, city };
        notify();
      }
      persist({ ...rec, city });
    })
    .catch(() => {});
}

// ── Resolution ───────────────────────────────────────────────────────────────
async function readDevice() {
  // OS last-known first: returns almost immediately and does not wake the radio.
  let fix = null;
  try {
    fix = await ExpoLocation.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
  } catch { /* fall through to a live fix */ }

  if (!fix) {
    let timer;
    try {
      fix = await Promise.race([
        ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('gps-timeout')), FIX_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // A coarse fix is plenty for weather and for a distance filter measured in
      // kilometres, and it is what stops a cold device hanging on a precise lock.
      fix = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Lowest });
    } finally {
      // Losing the race does not cancel the timer, and an uncleared 4s handle
      // per resolve keeps the JS runtime awake for no reason.
      clearTimeout(timer);
    }
  }

  return {
    lat: fix.coords.latitude,
    lon: fix.coords.longitude,
    city: '',
    savedAt: Date.now(),
    source: 'device',
  };
}

/**
 * Resolve the user's position, taking the cheapest rung of the ladder that
 * satisfies `maxAgeMs`.
 *
 * @param {{maxAgeMs?: number, force?: boolean}} [opts]
 *        force skips the cache entirely (the explicit "refresh" gesture).
 * @returns {Promise<{lat, lon, city, savedAt, source}>}
 * @throws  if permission is denied or no fix can be obtained.
 */
export async function resolveLocation({ maxAgeMs = LOCATION_TTL_MS, force = false } = {}) {
  await hydrate();

  if (!force && isFresh(_mem, maxAgeMs)) return _mem;

  // One fix at a time. Without this, the screens that mount together at launch
  // each start their own GPS read.
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    const granted = await ensurePermission();
    if (!granted) throw new Error('Location permission denied');

    const rec = await readDevice();
    // Carry a previously resolved city across if we are still in the same place;
    // re-geocoding an unchanged position is a request for nothing.
    if (_mem?.city && Math.abs(_mem.lat - rec.lat) < 0.01 && Math.abs(_mem.lon - rec.lon) < 0.01) {
      rec.city = _mem.city;
    }

    _mem = rec;
    notify();
    persist(rec);
    fillCity(rec);
    return rec;
  })();

  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}
