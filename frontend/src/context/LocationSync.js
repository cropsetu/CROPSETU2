/**
 * LocationSync — invisible bridge that pushes the device GPS captured by
 * LocationContext into the user's row on the backend.
 *
 * Why: the "nearby Krushi Kendra" search uses Haversine distance against the
 * user's stored lat/lng. Without this sync the only signal is district/taluka
 * string matching, which is much coarser.
 *
 * Behaviour: fires once whenever (auth becomes ready) AND (coords become
 * available), and re-fires only if the user moves more than ~500 m so we don't
 * hammer the API.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useLocation } from './LocationContext';
import api from '../services/api';

// ~0.0045 deg ≈ 500 m at the equator. Good enough as a "did the user move"
// heuristic — exact distance doesn't matter, we just want to skip no-ops.
const MOVE_THRESHOLD = 0.0045;

export default function LocationSync() {
  const { user, updateUser } = useAuth();
  const { coords } = useLocation();
  const lastSentRef = useRef(null); // { lat, lng }

  useEffect(() => {
    if (!user?.id || !coords) return;

    const last = lastSentRef.current;
    const moved =
      !last ||
      Math.abs(last.lat - coords.latitude)  > MOVE_THRESHOLD ||
      Math.abs(last.lng - coords.longitude) > MOVE_THRESHOLD;

    // Skip if the user already has these coords (within threshold) on their row.
    const stored = (user.lat != null && user.lng != null)
      ? { lat: user.lat, lng: user.lng }
      : null;
    const matchesStored =
      stored &&
      Math.abs(stored.lat - coords.latitude)  < MOVE_THRESHOLD &&
      Math.abs(stored.lng - coords.longitude) < MOVE_THRESHOLD;

    if (!moved && matchesStored) return;
    if (!moved && lastSentRef.current) return;

    lastSentRef.current = { lat: coords.latitude, lng: coords.longitude };

    api.put('/users/me', { lat: coords.latitude, lng: coords.longitude })
      .then((res) => updateUser?.(res.data.data))
      .catch((err) => {
        // Non-fatal. Reset the ref so we retry on next coord update.
        lastSentRef.current = null;
        if (__DEV__) console.warn('[LocationSync] PUT /users/me failed:', err?.message);
      });
  }, [user?.id, user?.lat, user?.lng, coords?.latitude, coords?.longitude]);

  return null;
}
