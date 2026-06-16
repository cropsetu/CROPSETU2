import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';
import type { KendraStatus } from './types';

export const KENDRA_ME_KEY = ['kendra', 'me'] as const;

/** The Kendra's onboarding status — the website routes on `stage`. */
export function useKendraStatus() {
  return useQuery({
    queryKey: KENDRA_ME_KEY,
    queryFn: async () => (await apiGet<KendraStatus>('/kendra/me')).data,
    staleTime: 10_000,
  });
}
