/**
 * Connectivity awareness without adding a native dependency.
 *
 * `@react-native-community/netinfo` would be the obvious choice, but it is a
 * native module — adding it forces every developer and CI lane to re-run
 * `expo prebuild` + rebuild the dev client. This app can get the same signal
 * from what it already does:
 *
 *   web    → `navigator.onLine` plus the online/offline events (accurate, free).
 *   native → observe the API client. Axios surfaces a lost connection as
 *            `Network Error` / ECONNABORTED; once we see one we flip to offline
 *            and poll a cheap endpoint until it answers again.
 *
 * The result is deliberately conservative: we only claim "offline" after a real
 * request failed, so we never show an offline banner to someone who is online.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import axios from 'axios';
import api from '@krushisarva/shared/services/api';
import { API_BASE_URL } from '@krushisarva/shared/constants/config';

const IS_WEB = Platform.OS === 'web';

// How often to re-probe while we believe we are offline. Backs off so a long
// outage doesn't burn battery.
const PROBE_STEPS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const PROBE_TIMEOUT_MS = 6_000;

const NetworkContext = createContext(null);

/** True when this axios error means "the request never reached the server". */
export function isConnectivityError(error) {
  if (!error) return false;
  if (error.response) return false;                       // server answered → not a connectivity issue
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return false;
  return (
    error.message === 'Network Error' ||
    error.code === 'ERR_NETWORK' ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT'
  );
}

export function NetworkProvider({ children }) {
  const [isOnline, setIsOnline] = useState(() => (IS_WEB ? navigator?.onLine !== false : true));
  // Bumped whenever we transition offline → online, so data hooks can refetch.
  const [reconnectedAt, setReconnectedAt] = useState(0);

  const probeTimer = useRef(null);
  const probeStep = useRef(0);
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;

  const clearProbe = useCallback(() => {
    if (probeTimer.current) {
      clearTimeout(probeTimer.current);
      probeTimer.current = null;
    }
  }, []);

  const goOnline = useCallback(() => {
    clearProbe();
    probeStep.current = 0;
    if (!onlineRef.current) {
      onlineRef.current = true;
      setIsOnline(true);
      setReconnectedAt(Date.now());
    }
  }, [clearProbe]);

  // A bare GET against the API root. Uses plain axios (not the shared instance)
  // so it never triggers the 401-refresh interceptor or a logout cascade, and
  // `validateStatus: () => true` means ANY HTTP answer — even 404 — proves the
  // network is back.
  const probe = useCallback(async () => {
    probeTimer.current = null;
    try {
      await axios.get(API_BASE_URL, { timeout: PROBE_TIMEOUT_MS, validateStatus: () => true });
      goOnline();
    } catch {
      const delay = PROBE_STEPS_MS[Math.min(probeStep.current, PROBE_STEPS_MS.length - 1)];
      probeStep.current += 1;
      probeTimer.current = setTimeout(probe, delay);
    }
  }, [goOnline]);

  const goOffline = useCallback(() => {
    if (onlineRef.current) {
      onlineRef.current = false;
      setIsOnline(false);
    }
    if (!probeTimer.current) {
      probeTimer.current = setTimeout(probe, PROBE_STEPS_MS[0]);
    }
  }, [probe]);

  // ── Web: the browser tells us directly ─────────────────────────────────────
  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return undefined;
    const on = () => goOnline();
    const off = () => {
      onlineRef.current = false;
      setIsOnline(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [goOnline]);

  // ── Native + web: learn from the API client itself ────────────────────────
  // Registered here (not inside shared/services/api.js) so the buyer app's
  // behaviour is untouched — this interceptor only exists in the seller process.
  useEffect(() => {
    const id = api.interceptors.response.use(
      (response) => { goOnline(); return response; },
      (error) => {
        if (isConnectivityError(error)) goOffline();
        else if (error?.response) goOnline();   // server answered → we have a link
        return Promise.reject(error);
      },
    );
    return () => api.interceptors.response.eject(id);
  }, [goOnline, goOffline]);

  // Coming back to the foreground after a long sleep: re-probe immediately
  // rather than waiting out the backoff.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        clearProbe();
        return;
      }
      if (IS_WEB && navigator?.onLine === false) return;
      if (!onlineRef.current) {
        probeStep.current = 0;
        clearProbe();
        probe();
      }
    });
    return () => sub.remove();
  }, [probe, clearProbe]);

  useEffect(() => clearProbe, [clearProbe]);

  const value = useMemo(
    () => ({ isOnline, isOffline: !isOnline, reconnectedAt, notifyOffline: goOffline, notifyOnline: goOnline }),
    [isOnline, reconnectedAt, goOffline, goOnline],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/**
 * Safe to call outside the provider (returns an optimistic "online" shape), so
 * a component can be rendered in isolation — e.g. in a test — without wiring up
 * the whole provider tree.
 */
export function useNetwork() {
  return (
    useContext(NetworkContext) || {
      isOnline: true,
      isOffline: false,
      reconnectedAt: 0,
      notifyOffline: () => {},
      notifyOnline: () => {},
    }
  );
}

export default useNetwork;
