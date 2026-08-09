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
import api from '@cropsetu/shared/services/api';

export const RENT_PAGE_SIZE = 20;

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
  const [error,       setError]       = useState(false);

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

      let res = null;
      try {
        res = await api.get(path, {
          params: { ...JSON.parse(paramsKey), page: pageNo, limit: pageSize },
          signal: controller.signal,
        });
      } catch {
        res = null; // per-request isolation — never let one list take the screen down
      }

      // A newer request started (or we unmounted) while this one was in flight.
      // Its answer describes a filter the user has already moved on from.
      if (!aliveRef.current || run !== runRef.current) return;

      if (res) {
        const rows = res.data?.data ?? [];
        setItems((prev) => (append ? [...prev, ...rows] : rows));
        setTotal(res.data?.meta?.total ?? rows.length);
        setPage(pageNo);
        setError(false);
      } else if (append) {
        // Keep the pages already shown; only the "load more" attempt failed.
        setError(true);
      } else {
        const fallback = __DEV__ && devFallback ? devFallback() : null;
        setItems(fallback ?? []);
        setTotal(fallback?.length ?? 0);
        setPage(1);
        setError(true);
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
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(1, { append: false }), [fetchPage]);

  return { items, total, page, hasMore, loading, loadingMore, error, loadMore, refresh };
}
