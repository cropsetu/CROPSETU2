/**
 * useAnimalListings — the single fetch path for the animal marketplace.
 *
 * What it replaces: AnimalTradeHome ran one `useEffect` whose dependency array
 * included `searchQuery`, so every keystroke fired a full `/animals` request
 * with no debounce, no cancellation, and no ordering guarantee. Typing "buffalo"
 * sent seven requests, and whichever one the network happened to answer last won
 * — so a slow response for "buf" could overwrite the results for "buffalo".
 *
 * Guarantees:
 *   • Typing is debounced (SEARCH_DEBOUNCE_MS); every other filter applies at once.
 *     A farmer tapping "Goat" should not wait 400 ms for it.
 *   • One request per distinct (filters, page). The in-flight request is aborted
 *     when the filters change, and a run counter discards its answer even if the
 *     abort loses the race — that counter, not the abort, is the real guard.
 *   • Pagination appends and never duplicates: rows already on screen are
 *     de-duplicated by id, so a listing created mid-scroll (which shifts every
 *     offset page by one) cannot appear twice.
 *   • The last successful page-1 response is cached on disk per filter
 *     signature. When the network is down the screen shows that instead of an
 *     empty state, flagged `isStale` with the time it was captured.
 *   • Failures are typed (see utils/apiError) so the screen can offer Retry vs
 *     Sign in vs Change location, and a failed background refresh keeps the rows
 *     that are already visible.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '@krushisarva/shared/services/api';
import { classifyError, ERROR_CODES } from '../utils/apiError';

const ANIMALS_PAGE_SIZE = 16;   // ~8 rows of the 2-column grid
const SEARCH_DEBOUNCE_MS = 400;
const MIN_SEARCH_LEN = 2;       // 1 character matches half the marketplace

const CACHE_PREFIX = '@animals:page1:';
/** Older than this and we show it, but tell the user how old it is. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Strip empty values so the signature (and the request) stays minimal. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    out[k] = v;
  }
  return out;
}

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
 * @param {object}  p
 * @param {object}  p.filters  animal, search, sort, radius, price/age bounds, flags
 * @param {object?} p.coords   { latitude, longitude } — omitted when unknown
 * @param {boolean} p.enabled
 */
export default function useAnimalListings({ filters = {}, coords = null, enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [cachedAt, setCachedAt] = useState(null); // non-null ⇒ showing disk data

  // ── Debounce only the free-text query ──────────────────────────────────────
  const rawSearch = filters.search ?? '';
  const [debouncedSearch, setDebouncedSearch] = useState(rawSearch);
  useEffect(() => {
    // Clearing the box should feel instant; only typing waits.
    if (rawSearch === '') { setDebouncedSearch(''); return undefined; }
    const id = setTimeout(() => setDebouncedSearch(rawSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawSearch]);

  // A one-character query matches almost everything and costs a full scan; wait
  // for a second character rather than sending it.
  const effectiveSearch = debouncedSearch.trim().length >= MIN_SEARCH_LEN ? debouncedSearch.trim() : '';

  // Request params. Built from primitives only, so the memo is stable across
  // re-renders that change nothing (scroll position, header animation).
  const params = useMemo(() => compact({
    animal: filters.animal && filters.animal !== 'All' ? filters.animal : null,
    breed: filters.breed || null,
    // A hand-typed place ("Baramati", "413102") when GPS is unavailable — the
    // server matches it against the listing's location text.
    district: filters.district || null,
    search: effectiveSearch || null,
    sort: filters.sort || 'latest',
    gender: filters.gender || null,
    minPrice: filters.minPrice ?? null,
    maxPrice: filters.maxPrice ?? null,
    minAgeMonths: filters.minAgeMonths ?? null,
    maxAgeMonths: filters.maxAgeMonths ?? null,
    minMilk: filters.minMilk ?? null,
    verified: filters.verified || null,
    vaccinated: filters.vaccinated || null,
    healthCertificate: filters.healthCertificate || null,
    // Coordinates go up only when they are actually used — for a radius filter
    // or a distance sort. Browsing "All" does not need to tell the server where
    // the farmer is standing.
    ...(coords && (filters.radiusKm || filters.sort === 'nearest')
      ? { lat: coords.latitude, lng: coords.longitude, ...(filters.radiusKm ? { radius: filters.radiusKm } : {}) }
      : {}),
  }), [
    filters.animal, filters.breed, filters.district, effectiveSearch, filters.sort, filters.gender,
    filters.minPrice, filters.maxPrice, filters.minAgeMonths, filters.maxAgeMonths,
    filters.minMilk, filters.verified, filters.vaccinated, filters.healthCertificate,
    filters.radiusKm, coords?.latitude, coords?.longitude,
  ]);

  const paramsKey = JSON.stringify(params);
  // Coordinates are bucketed out of the CACHE key (not the request) so moving a
  // few metres does not orphan the cached page.
  const cacheKey = useMemo(() => {
    const { lat, lng, ...rest } = params;
    return JSON.stringify({ ...rest, geo: lat != null ? `${lat.toFixed(1)},${lng.toFixed(1)}` : null });
  }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const runRef = useRef(0);
  const abortRef = useRef(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; abortRef.current?.abort(); }, []);

  const fetchPage = useCallback(async (pageNo, { append = false, isRefresh = false } = {}) => {
    const run = ++runRef.current;
    // Only page 1 invalidates what is on screen; a "load more" must not abort
    // itself when another page-1 fetch is queued behind it.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) setLoadingMore(true);
    else if (isRefresh) setRefreshing(true);
    else setLoading(true);

    let res = null;
    let failure = null;
    try {
      res = await api.get('/animals', {
        params: { ...JSON.parse(paramsKey), page: pageNo, limit: ANIMALS_PAGE_SIZE },
        signal: controller.signal,
      });
    } catch (e) {
      failure = classifyError(e, 'Could not load animals.');
    }

    // A newer request started (or we unmounted) while this one was in flight —
    // its answer describes filters the user has already moved past.
    if (!aliveRef.current || run !== runRef.current) return;
    if (failure?.code === ERROR_CODES.CANCELED) return;

    if (res) {
      const rows = res.data?.data ?? [];
      const meta = res.data?.meta ?? {};
      setItems((prev) => {
        if (!append) return rows;
        // De-duplicate against what is already rendered. Offset pagination over
        // a live marketplace WILL re-serve a row when a new listing shifts the
        // window, and a duplicate key crashes/blanks a FlatList row.
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setTotal(meta.total ?? rows.length);
      setHasMore(meta.hasMore ?? (pageNo * ANIMALS_PAGE_SIZE < (meta.total ?? 0)));
      setPage(pageNo);
      setError(null);
      setCachedAt(null);
      if (pageNo === 1) writeCache(cacheKey, { rows, total: meta.total ?? rows.length, hasMore: !!meta.hasMore });
    } else if (append) {
      // Keep every page already shown; only the "load more" attempt failed.
      setError(failure);
    } else {
      // Initial/refresh failure. Fall back to the last good page 1 rather than
      // wiping the screen — a farmer in a low-signal field still gets a usable
      // marketplace, clearly labelled as of when.
      const cached = await readCache(cacheKey);
      if (!aliveRef.current || run !== runRef.current) return;
      if (cached?.rows?.length) {
        setItems(cached.rows);
        setTotal(cached.total ?? cached.rows.length);
        setHasMore(false);           // never paginate on top of cached data
        setCachedAt(cached.at);
      } else if (!isRefresh) {
        setItems([]);
        setTotal(0);
        setHasMore(false);
      }
      setError(failure);
    }

    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
  }, [paramsKey, cacheKey]);

  // The one and only trigger. Any param change resets to page 1.
  useEffect(() => {
    if (!enabled) return;
    fetchPage(1, { append: false });
  }, [enabled, fetchPage]);

  const loadMore = useCallback(() => {
    // The three guards are all load-bearing: `loadingMore` stops the duplicate
    // call FlatList fires when onEndReached re-triggers mid-fetch, `hasMore`
    // stops paging past the end, and `cachedAt` stops paging on top of offline
    // data whose page boundaries no longer match the server's.
    if (loading || loadingMore || !hasMore || cachedAt) return;
    fetchPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, cachedAt, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(1, { append: false, isRefresh: true }), [fetchPage]);

  return {
    items, total, page, hasMore,
    loading, loadingMore, refreshing,
    error,
    /** ms epoch of the cached snapshot on screen, or null when live. */
    cachedAt,
    isStale: cachedAt != null,
    /** True once the user has typed enough for the query to be sent. */
    searchPending: rawSearch !== debouncedSearch,
    loadMore, refresh,
  };
}
