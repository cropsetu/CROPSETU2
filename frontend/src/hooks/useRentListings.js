/**
 * useRentListings — the single fetch path for a Rent list endpoint.
 *
 * Replaces the old "useEffect + useFocusEffect both call fetchAll" pair, which
 * fired the same pair of requests twice whenever the radius changed (fetchAll's
 * identity changed with radiusKm, so the focus effect re-ran too).
 *
 * What it guarantees:
 *   • ONE request per distinct (path, params) — changing the radius or source
 *     re-runs page 1, nothing else does.
 *   • In-flight requests are aborted AND their responses ignored when the params
 *     change, so a slow "50 km" response can never overwrite a fast "5 km" one.
 *     The run counter is the real guard; the abort is the courtesy that stops
 *     the socket early.
 *   • `total` comes from the response meta, so the UI can say "20 of 63" instead
 *     of silently truncating at the page size.
 *   • Failures are isolated: the list keeps whatever it had, `error` flips, and
 *     nothing throws.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '@cropsetu/shared/services/api';
import { classifyError, ERROR_CODES } from '../utils/apiError';

const RENT_PAGE_SIZE = 20;

const CACHE_PREFIX = '@rent:page1:';
/** Older than this and it is not worth showing even as a fallback. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function readCache(key) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key, payload) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), ...payload }));
  } catch {
    /* a full disk must not break browsing */
  }
}

/**
 * Cheap "how many are there?" probe — asks for a single row and reads meta.total.
 * Used by the empty state to offer "42 within 25 km" instead of a blind guess.
 * Resolves to null rather than throwing when the probe fails.
 */
export async function probeTotal(path, params) {
  try {
    const res = await api.get(path, { params: { ...params, page: 1, limit: 1 } });
    const n = res?.data?.meta?.total;
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

export default function useRentListings({
  path,
  params,
  enabled = true,
  pageSize = RENT_PAGE_SIZE,
  devFallback = null,
}) {
  const [items,       setItems]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // `error` stays a boolean for the screens that already branch on it; `failure`
  // carries the typed classification (offline vs session expired vs rate limit)
  // so a caller can offer the action that actually resolves it.
  const [error,       setError]       = useState(false);
  const [failure,     setFailure]     = useState(null);
  /** ms epoch of the on-disk snapshot currently on screen, or null when live. */
  const [cachedAt,    setCachedAt]    = useState(null);

  // Params are a fresh object every render; compare by value, not identity, so
  // an unrelated re-render (scroll header, booking map) cannot trigger a fetch.
  const paramsKey = JSON.stringify(params);

  const runRef     = useRef(0);
  const abortRef   = useRef(null);
  const aliveRef   = useRef(true);
  useEffect(() => () => { aliveRef.current = false; abortRef.current?.abort(); }, []);

  const fetchPage = useCallback(
    async (pageNo, { append }) => {
      const run = ++runRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) setLoadingMore(true);
      else setLoading(true);

      const cacheKey = `${path}|${paramsKey}`;
      let res = null;
      let classified = null;
      try {
        res = await api.get(path, {
          params: { ...JSON.parse(paramsKey), page: pageNo, limit: pageSize },
          signal: controller.signal,
        });
      } catch (e) {
        // Per-request isolation — never let one list take the screen down.
        res = null;
        classified = classifyError(e, 'Could not load listings.');
      }

      // A newer request started (or we unmounted) while this one was in flight.
      // Its answer describes a filter the user has already moved on from.
      if (!aliveRef.current || run !== runRef.current) return;
      if (classified?.code === ERROR_CODES.CANCELED) return;

      if (res) {
        const rows = res.data?.data ?? [];
        setItems((prev) => {
          if (!append) return rows;
          // De-duplicate against what is already rendered: offset pagination
          // over a live marketplace re-serves a row whenever a new listing
          // shifts the window, and a duplicate key blanks a FlatList row.
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...rows.filter((r) => !seen.has(r.id))];
        });
        setTotal(res.data?.meta?.total ?? rows.length);
        setPage(pageNo);
        setError(false);
        setFailure(null);
        setCachedAt(null);
        if (pageNo === 1) writeCache(cacheKey, { rows, total: res.data?.meta?.total ?? rows.length });
      } else if (append) {
        // Keep the pages already shown; only the "load more" attempt failed.
        setError(true);
        setFailure(classified);
      } else {
        // Initial load failed. Show the last good page rather than an empty
        // screen — a farmer standing in a field with one bar still gets a
        // usable list, clearly labelled with how old it is.
        const cached = await readCache(cacheKey);
        if (!aliveRef.current || run !== runRef.current) return;
        if (cached?.rows?.length) {
          setItems(cached.rows);
          setTotal(cached.total ?? cached.rows.length);
          setCachedAt(cached.at);
        } else {
          const fallback = __DEV__ && devFallback ? devFallback() : null;
          setItems(fallback ?? []);
          setTotal(fallback?.length ?? 0);
        }
        setPage(1);
        setError(true);
        setFailure(classified);
      }

      setLoading(false);
      setLoadingMore(false);
    },
    [path, paramsKey, pageSize, devFallback],
  );

  // The one and only trigger. Any param change resets to page 1.
  useEffect(() => {
    if (!enabled) return;
    fetchPage(1, { append: false });
  }, [enabled, fetchPage]);

  const hasMore = items.length < total;

  const loadMore = useCallback(() => {
    // `cachedAt` blocks paging on top of offline data — the server's page
    // boundaries no longer match what is on screen, so page 2 would interleave
    // wrongly with a snapshot from an hour ago.
    if (loading || loadingMore || !hasMore || cachedAt) return;
    fetchPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, cachedAt, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(1, { append: false }), [fetchPage]);

  return {
    items, total, page, hasMore, loading, loadingMore,
    error,       // boolean, for the screens that already branch on it
    failure,     // typed classification: code, message, action, retryable
    cachedAt,    // ms epoch when showing a disk snapshot, else null
    isStale: cachedAt != null,
    loadMore, refresh,
  };
}
