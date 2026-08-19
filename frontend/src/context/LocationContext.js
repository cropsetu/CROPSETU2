/**
 * LocationContext — the React face of locationService.
 *
 * Every screen that needs "where is the user" reads it from here, so there is
 * one permission prompt and one shared fix rather than one per screen. The
 * resolution ladder, the persisted cache and the in-flight de-duplication all
 * live in services/locationService, because weatherApi.js needs exactly the same
 * logic and is not a React module — see the note at the top of that file.
 *
 * What this adapter adds is the loading policy, and it is stale-while-revalidate
 * rather than block-then-show. A cached fix (kept encrypted across launches)
 * lands synchronously enough that `loading` clears in milliseconds; a fresh read
 * then replaces it in the background. That matters because RentHome gates its
 * first request on `!loading` — under the old block-then-show behaviour the Rent
 * tab waited on a full GPS fix, 1–5s on Android, at every single cold start.
 *
 * `refresh()` forces a fresh read and re-asks for permission, so a user who
 * granted it in Settings after a first denial recovers without restarting.
 *
 * The three "no coordinates" cases stay distinguishable, because they need
 * different UI: still loading, permanently denied, and hardware/timeout error.
 *
 * Usage:
 *   const { coords, permissionGranted, permissionDenied, loading, error, refresh, refreshing } = useLocation();
 *   // coords: { latitude, longitude } | null
 */
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  PERMISSION,
  getPermission,
  hydrate,
  peekLocation,
  resolveLocation,
  subscribe,
} from '../services/locationService';

const LocationContext = createContext(null);

/** Service record → the { latitude, longitude } shape every screen already reads. */
function toCoords(rec) {
  return rec ? { latitude: rec.lat, longitude: rec.lon } : null;
}

export function LocationProvider({ children }) {
  const [coords,     setCoords]     = useState(() => toCoords(peekLocation()));
  const [permission, setPermission] = useState(getPermission);
  const [loading,    setLoading]    = useState(() => peekLocation() == null);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt,  setUpdatedAt]  = useState(() => peekLocation()?.savedAt ?? null);

  // Guards state writes after unmount.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Any resolution — including one weatherApi triggered — flows back here, so
  // opening the Weather tab keeps the Rent tab's distance filter current too.
  useEffect(() => subscribe(({ location, permission: perm }) => {
    if (!aliveRef.current) return;
    setCoords(toCoords(location));
    setUpdatedAt(location?.savedAt ?? null);
    setPermission(perm);
  }), []);

  const read = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true);
    try {
      const rec = await resolveLocation({ force: !!isRefresh });
      if (aliveRef.current) setError(null);
      return toCoords(rec);
    } catch (e) {
      // A denial is not an error the UI should phrase as a failure — permission
      // state already carries it, and the two need different copy.
      if (aliveRef.current && getPermission() !== PERMISSION.DENIED) {
        setError(e?.message || 'Location unavailable');
      }
      return null;
    } finally {
      if (aliveRef.current) {
        setLoading(false);
        if (isRefresh) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Paint from the persisted fix before asking the device for a new one.
    hydrate().then((cached) => {
      if (cancelled || !aliveRef.current) return;
      if (cached) setLoading(false);
      read();
    });
    return () => { cancelled = true; };
  }, [read]);

  /** Re-read the current position. Resolves to the new coords, or null. */
  const refresh = useCallback(() => read({ isRefresh: true }), [read]);

  const permissionGranted = permission === PERMISSION.GRANTED;
  // Distinct from `!permissionGranted`: false while the prompt is still pending,
  // true only once the user has actually said no.
  const permissionDenied  = permission === PERMISSION.DENIED;

  const value = useMemo(
    () => ({ coords, permissionGranted, permissionDenied, loading, error, refresh, refreshing, updatedAt }),
    [coords, permissionGranted, permissionDenied, loading, error, refresh, refreshing, updatedAt],
  );

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}
