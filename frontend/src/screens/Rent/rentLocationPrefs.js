/**
 * Rent location preferences — the source and the radius, persisted.
 *
 * The radius used to reset to 10 km on every app start; a farmer who works at
 * 25 km had to re-pick it every single launch. AsyncStorage (not the SecureStore
 * wrapper in shared/utils/storage) because these are plain preferences, not
 * secrets, and SecureStore's web path is in-memory — it would not survive a
 * reload on web.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFS_KEY = 'cropsetu.rent.locationPrefs.v1';

/** Where "near me" is measured from. GPS ▸ district ▸ everywhere. */
export const SOURCE = { GPS: 'gps', DISTRICT: 'district', ALL: 'all' };

/** `null` km = "Any" — no ceiling, but still distance-sorted and badged. */
export const RADIUS_OPTIONS = [5, 10, 25, 50, null];

export const DEFAULT_PREFS = {
  source: SOURCE.GPS,
  radiusKm: 10,
  district: null,
  taluka: null,
  // Strict by default: "Within 5 km" should mean every card is provably within
  // 5 km. Turning it off surfaces coordinate-less listings, which the UI then
  // labels "Location not shared" rather than letting them fake a distance.
  strictCoords: true,
};

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const source = Object.values(SOURCE).includes(raw.source) ? raw.source : DEFAULT_PREFS.source;
  const radiusKm = raw.radiusKm === null || RADIUS_OPTIONS.includes(raw.radiusKm)
    ? raw.radiusKm
    : DEFAULT_PREFS.radiusKm;
  return {
    source,
    radiusKm,
    district: typeof raw.district === 'string' && raw.district ? raw.district : null,
    taluka:   typeof raw.taluka   === 'string' && raw.taluka   ? raw.taluka   : null,
    strictCoords: raw.strictCoords !== false,
  };
}

/**
 * @returns {[prefs, setPrefs, hydrated]} — `hydrated` is false until the stored
 * value has been read, so callers can hold off the first request rather than
 * firing it against the defaults and again against the restored prefs.
 */
export function useRentLocationPrefs() {
  const [prefs, setPrefsState] = useState(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PREFS_KEY);
        if (aliveRef.current && raw) setPrefsState(sanitize(JSON.parse(raw)));
      } catch {
        // Corrupt or unavailable storage — the defaults are a fine answer.
      } finally {
        if (aliveRef.current) setHydrated(true);
      }
    })();
    return () => { aliveRef.current = false; };
  }, []);

  // Accepts a partial patch. Writes through immediately so a crash or a fast
  // app-switch cannot lose the choice the user just made.
  const setPrefs = useCallback((patch) => {
    setPrefsState((prev) => {
      const next = sanitize({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) });
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return [prefs, setPrefs, hydrated];
}

/**
 * Which source is actually in effect right now. The stored preference can be
 * unsatisfiable — "GPS" with permission denied, "district" before one has been
 * chosen — and the whole UI hangs off telling the truth about that.
 *
 * @returns {'gps'|'district'|'all'}
 */
export function effectiveSource(prefs, coords) {
  if (prefs.source === SOURCE.GPS && coords) return SOURCE.GPS;
  if (prefs.source === SOURCE.DISTRICT && prefs.district) return SOURCE.DISTRICT;
  return SOURCE.ALL;
}

/**
 * Build the query params for a rent list request from the effective source.
 *
 * "Any" (radiusKm === null) still sends lat/lng and only drops the ceiling via
 * `radius=all` — the old behaviour dropped the coordinates too, which silently
 * switched the API to its rating-sorted branch and wiped every distance badge.
 */
export function buildListParams(prefs, coords, { search, category, talukaEnabled } = {}) {
  const params = {};
  const source = effectiveSource(prefs, coords);

  if (source === SOURCE.GPS) {
    params.lat = coords.latitude;
    params.lng = coords.longitude;
    params.radius = prefs.radiusKm == null ? 'all' : prefs.radiusKm;
    if (prefs.strictCoords) params.strict = 'true';
  } else if (source === SOURCE.DISTRICT) {
    params.district = prefs.district;
  }

  // Ordering is not user-facing (the sort chips were removed): nearest when we
  // have an origin to measure from, rating otherwise. Distance ordering needs an
  // origin; without one the API falls back to rating anyway, so don't ask for
  // something we cannot get.
  params.sort = source === SOURCE.GPS ? 'distance' : 'rating';

  // The taluka narrows within a district using the same free-text match the
  // search box uses, so the two cannot both be in flight — the user's own query
  // wins and the picker disables the taluka while it is non-empty.
  const query = search?.trim();
  if (query) params.search = query;
  else if (talukaEnabled && source === SOURCE.DISTRICT && prefs.taluka) params.search = prefs.taluka;

  if (category && category !== 'all') params.category = category;

  return params;
}
