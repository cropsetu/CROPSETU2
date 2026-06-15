/**
 * Admin RBAC scopes (client side). The server is the real gate — these helpers
 * only drive COSMETIC nav-hiding so an admin isn't shown sections they can't use.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

export interface AdminMe {
  id: string;
  role: string;
  scopes: string[];
  isSuperAdmin: boolean;
  allScopes: string[];
}

/** Current admin's identity + scopes (cached 5 min). */
export function useAdminMe() {
  return useQuery({
    queryKey: ['admin-me'],
    queryFn: () => apiGet<AdminMe>('/admin/me').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Whether the current admin may see a nav entry requiring `scope`.
 * Unknown scope → visible. While `me` is still loading → visible (no flicker;
 * the server still enforces). SUPER_ADMIN (incl. legacy no-scope admins) → all.
 */
export function allowedByScope(me: AdminMe | undefined, scope?: string): boolean {
  if (!scope) return true;
  if (!me) return true;
  if (me.isSuperAdmin) return true;
  return me.scopes.includes(scope);
}
