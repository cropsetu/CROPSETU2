/**
 * useAsyncData — one hook for every "fetch, show, refresh, retry" screen.
 *
 * Replaces the pattern the seller screens all shared:
 *
 *     try { ...setState... } catch (e) { console.warn(e.message) }
 *
 * which swallowed every failure, so an API outage rendered as a permanently
 * empty list with a cheerful "No orders yet" — indistinguishable from success.
 *
 * What it guarantees:
 *   - distinct loading / refreshing / error / empty / success states
 *   - no setState after unmount, and stale responses can never overwrite fresh
 *     ones (each run carries a sequence number, and in-flight requests are
 *     aborted via AbortSignal)
 *   - previous data stays on screen while refreshing (no content flash)
 *   - automatic retry when connectivity comes back
 *   - optional refetch when the screen regains focus
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { safeErrorMessage } from '@cropsetu/shared/services/api';
import { useNetwork, isConnectivityError } from './useNetwork';

export default function useAsyncData(fetcher, deps = [], options = {}) {
  const {
    /** Refetch every time the screen comes back into focus. */
    refetchOnFocus = false,
    /** Skip the very first automatic load (for lazily-triggered fetches). */
    enabled = true,
    /** Value used before the first successful load. */
    initialData = null,
    /** Called with the parsed result on every successful load. */
    onSuccess,
    /** Human-readable fallback when the error can't be mapped. */
    errorFallback,
  } = options;

  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);

  const { isOnline, reconnectedAt } = useNetwork();

  const mounted = useRef(true);
  const runId = useRef(0);
  const abortRef = useRef(null);
  const hasLoaded = useRef(false);

  // Keep the newest fetcher/onSuccess in refs so `run` stays referentially
  // stable — otherwise every parent render restarts the request.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(async ({ mode = 'load' } = {}) => {
    const id = ++runId.current;

    // Cancel whatever is in flight — a fast refresh must not be overtaken by
    // the slow response it replaced.
    abortRef.current?.abort();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;

    if (mode === 'refresh') setRefreshing(true);
    else if (!hasLoaded.current) setLoading(true);

    // A retry after a failure should clear the old error immediately so the
    // user sees the spinner, not the stale message.
    if (mode === 'retry') { setError(null); setLoading(true); }

    try {
      const result = await fetcherRef.current({ signal: controller?.signal });
      if (!mounted.current || id !== runId.current) return undefined;
      hasLoaded.current = true;
      setData(result);
      setError(null);
      onSuccessRef.current?.(result);
      return result;
    } catch (e) {
      if (!mounted.current || id !== runId.current) return undefined;
      // An aborted request is not a failure — it was replaced on purpose.
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return undefined;
      setError({
        message: safeErrorMessage(e, errorFallback) || errorFallback || 'Something went wrong.',
        isOffline: isConnectivityError(e),
        status: e?.response?.status ?? null,
        raw: e,
      });
      return undefined;
    } finally {
      if (mounted.current && id === runId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [errorFallback]);

  // Initial load + reload whenever the caller's deps change.
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    hasLoaded.current = false;
    setLoading(true);
    run({ mode: 'load' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  // Connectivity restored while showing an offline error → retry silently.
  const lastReconnect = useRef(reconnectedAt);
  useEffect(() => {
    if (reconnectedAt && reconnectedAt !== lastReconnect.current) {
      lastReconnect.current = reconnectedAt;
      if (error?.isOffline || !hasLoaded.current) run({ mode: 'retry' });
    }
  }, [reconnectedAt, error, run]);

  const focusRun = useCallback(() => {
    // Only after the first load — otherwise focus and mount both fire a request.
    if (refetchOnFocus && hasLoaded.current) run({ mode: 'refresh' });
  }, [refetchOnFocus, run]);
  useFocusEffect(focusRun);

  const refresh = useCallback(() => run({ mode: 'refresh' }), [run]);
  const retry = useCallback(() => run({ mode: 'retry' }), [run]);

  return {
    data,
    setData,
    error,
    loading,
    refreshing,
    isOffline: !isOnline,
    /** True on the very first load, when there is nothing to show yet. */
    isInitialLoading: loading && !hasLoaded.current,
    hasLoaded: hasLoaded.current,
    refresh,
    retry,
    run,
  };
}
