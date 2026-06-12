/**
 * Keyset list hook — server-side cursor pagination over an admin list endpoint.
 *
 * Maintains a stack of cursors so the table can page forward AND back. Resets to
 * the first page whenever the filter/search params change. Each page is its own
 * cached query keyed by (url, params, cursor).
 */
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet, type ApiMeta } from './api';

export interface KeysetResult<T> {
  items: T[];
  meta?: ApiMeta;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
  next: () => void;
  prev: () => void;
  canPrev: boolean;
  canNext: boolean;
  page: number;
}

export function useKeyset<T>(url: string, params: Record<string, unknown> = {}): KeysetResult<T> {
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const cursor = stack[stack.length - 1];

  // Reset to first page when filters change.
  useEffect(() => { setStack([undefined]); }, [paramsKey, url]);

  const query = useQuery({
    queryKey: ['keyset', url, paramsKey, cursor ?? null],
    queryFn: () => apiGet<{ items: T[] }>(url, { ...params, cursor }),
    placeholderData: keepPreviousData,
  });

  const meta = query.data?.meta;
  return {
    items: query.data?.data.items ?? [],
    meta,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
    next: () => { if (meta?.nextCursor) setStack((s) => [...s, meta.nextCursor as string]); },
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    canPrev: stack.length > 1,
    canNext: !!meta?.hasMore,
    page: stack.length,
  };
}
