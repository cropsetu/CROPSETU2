/**
 * LocationContext — requests GPS permission once on app start and stores
 * the device coordinates globally so every screen can use them without
 * triggering a second permission prompt.
 *
 * `refresh()` re-reads the current position on demand. The one-shot fix taken at
 * app start goes stale the moment the user travels, and a farmer who drives to
 * the next taluka should not keep filtering against where they woke up. It also
 * re-asks for permission, so a user who granted it in Settings after the first
 * denial can recover without restarting the app.
 *
 * The three "no coordinates" cases are distinguishable, because they need
 * different UI: still loading, permanently denied, and hardware/timeout error.
 *
 * Usage:
 *   const { coords, permissionGranted, permissionDenied, loading, error, refresh, refreshing } = useLocation();
 *   // coords: { latitude, longitude } | null
 */
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as ExpoLocation from 'expo-location';

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const [coords,            setCoords]            = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  // Distinct from `!permissionGranted`: false while the prompt is still pending,
  // true only once the user has actually said no.
  const [permissionDenied,  setPermissionDenied]  = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);
  const [refreshing,        setRefreshing]        = useState(false);
  const [updatedAt,         setUpdatedAt]         = useState(null);

  // Guards state writes after unmount and lets refresh() bail out cleanly.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Single implementation for the initial read and every later refresh.
  const read = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (!aliveRef.current) return null;

      if (status !== 'granted') {
        setPermissionGranted(false);
        setPermissionDenied(true);
        return null;
      }

      setPermissionGranted(true);
      setPermissionDenied(false);
      setError(null);

      const loc = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      if (!aliveRef.current) return null;

      const next = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setCoords(next);
      setUpdatedAt(Date.now());
      return next;
    } catch (e) {
      // Permission is granted but the fix failed (no signal, timeout, airplane
      // mode). Callers show a different message for this than for a denial.
      if (aliveRef.current) setError(e?.message || 'Location unavailable');
      return null;
    } finally {
      if (aliveRef.current) {
        setLoading(false);
        if (isRefresh) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { read(); }, [read]);

  /** Re-read the current position. Resolves to the new coords, or null. */
  const refresh = useCallback(() => read({ isRefresh: true }), [read]);

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
