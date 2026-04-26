/**
 * LocationContext — requests GPS permission once on app start and stores
 * the device coordinates globally so every screen can use them without
 * triggering a second permission prompt.
 *
 * Usage:
 *   const { coords, permissionGranted, loading } = useLocation();
 *   // coords: { latitude, longitude } | null
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import * as ExpoLocation from 'expo-location';

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const [coords,           setCoords]           = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== 'granted') {
          setPermissionGranted(false);
          setLoading(false);
          return;
        }

        setPermissionGranted(true);

        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });

        if (!cancelled) {
          setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Location unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <LocationContext.Provider value={{ coords, permissionGranted, loading, error }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}
