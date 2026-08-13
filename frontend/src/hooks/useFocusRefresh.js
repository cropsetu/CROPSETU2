/**
 * useFocusRefresh — refetch on focus, but only when the data is actually stale.
 *
 * The problem it replaces: every tab home ran `useFocusEffect(() => load())`, so
 * simply walking the tab bar refired every screen's whole load. Six tabs is a
 * dozen-odd requests, and going back to a tab you left four seconds ago repeated
 * them. The server saw a burst of identical reads per navigation, not per change.
 *
 * The naive fix — a plain time gate — would break the flows that DEPEND on the
 * focus refetch: CropCycleCreate/Detail and FarmAddEdit just call goBack() and
 * trust the screen behind them to reload. So staleness is only one of three
 * reasons to run:
 *
 *   1. first focus for this `key`, or the key changed (e.g. the active farm)
 *   2. someone called invalidateFocusData() for this key since the last run
 *   3. more than `staleMs` has elapsed
 *
 * Mutating screens call invalidateFocusData('farm') instead of relying on the
 * refetch-always behaviour, which keeps them correct AND cheap. Pull-to-refresh
 * is untouched — it calls the loader directly and always hits the network.
 */
import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/** prefix → last invalidation time (ms). Module-level: shared by every screen. */
const invalidations = new Map();

/**
 * Mark a domain's data dirty, so the next focus of any screen keyed under it
 * refetches regardless of how recently it ran.
 *
 * Prefix-matched: invalidateFocusData('farm') dirties 'farm', 'farm:<id>' and
 * 'farm:<id>:cycles' alike, so a caller never has to know the exact key a screen
 * chose.
 */
export function invalidateFocusData(prefix) {
  invalidations.set(prefix, Date.now());
}

/** Most recent invalidation time affecting `key`, or 0 if never invalidated. */
function invalidatedAt(key) {
  let latest = 0;
  for (const [prefix, ts] of invalidations) {
    if (key === prefix || key.startsWith(prefix)) latest = Math.max(latest, ts);
  }
  return latest;
}

/**
 * @param {Function} load     the loader. May be async; may return a cleanup fn.
 * @param {object}   options
 * @param {string}   options.key      identity of the data (include the id it
 *                                    depends on — a changed key always reloads).
 * @param {number}   options.staleMs  how long a load stays fresh. Default 60 s.
 * @param {boolean}  options.runOnFirstFocus
 *        Set false when the screen ALREADY loads from a mount-time useEffect.
 *        The first focus then only starts the freshness clock instead of firing
 *        a second, identical request alongside it — which is exactly the
 *        duplicate the old `useEffect` + `useFocusEffect` pairs were causing.
 */
export default function useFocusRefresh(
  load,
  { key, staleMs = 60_000, runOnFirstFocus = true } = {},
) {
  // Held in a ref so a re-created loader closure does not itself re-trigger the
  // focus effect — that re-render loop is what made the old code fire twice.
  const loadRef = useRef(load);
  loadRef.current = load;

  const lastRunRef = useRef(0);
  const lastKeyRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const keyChanged = lastKeyRef.current !== key;
      const stale      = now - lastRunRef.current > staleMs;
      const dirty      = invalidatedAt(key) > lastRunRef.current;

      if (!keyChanged && !stale && !dirty) return undefined; // fresh — no request

      const firstFocus = lastKeyRef.current === null;
      lastKeyRef.current = key;
      lastRunRef.current = now;

      // The screen's own mount effect is already fetching this; just start the
      // clock so the NEXT focus is gated like any other.
      if (firstFocus && !runOnFirstFocus) return undefined;

      // An async loader returns a promise; useFocusEffect only accepts a cleanup
      // function (it warns otherwise), so forward one only when that's what it is.
      const result = loadRef.current();
      return typeof result === 'function' ? result : undefined;
    }, [key, staleMs, runOnFirstFocus]),
  );
}
