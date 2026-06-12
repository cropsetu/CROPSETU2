import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Debounce a fast-changing value (e.g. a search box) by `ms`. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Invalidate every page of a keyset list (by its base url) after a mutation. */
export function useInvalidateList() {
  const qc = useQueryClient();
  return (url: string) => qc.invalidateQueries({ queryKey: ['keyset', url] });
}
