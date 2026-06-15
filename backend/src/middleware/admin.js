/**
 * Admin authorization guard — the single, server-enforced ADMIN gate.
 *
 * Every /api/v1/admin/* route mounts `authenticate` (JWT → req.user) followed by
 * this guard. The frontend's role check is cosmetic; THIS is the security
 * boundary — a non-ADMIN token is rejected with 403 before any handler runs.
 *
 * Extracted from the inline `requireAdmin` duplicated across the existing admin
 * route files (incident/fraud/moderation/features) so the new admin router shares
 * one definition. Behaviour is identical: req.user.role must equal 'ADMIN'.
 */
import prisma from '../config/db.js';
import { sendError, sendForbidden, sendServerError } from '../utils/response.js';

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return sendError(res, 'Admin access required', 403);
  next();
}

// ── Admin sub-roles (RBAC scopes) ─────────────────────────────────────────────
// A single ADMIN role still gates the whole surface (requireAdmin). Within it,
// fine-grained scopes restrict which domains an admin may touch. An ADMIN with NO
// scopes is treated as SUPER_ADMIN, so EXISTING admins keep full access until
// scopes are deliberately assigned (zero-migration backward compatibility).
export const ADMIN_SCOPES = {
  SUPER_ADMIN:       'SUPER_ADMIN',
  KYC_REVIEWER:      'KYC_REVIEWER',
  CONTENT_MODERATOR: 'CONTENT_MODERATOR',
  FINANCE:           'FINANCE',
  SUPPORT:           'SUPPORT',
  CMS_EDITOR:        'CMS_EDITOR',
  OPS:               'OPS',
};
export const ALL_ADMIN_SCOPES = Object.values(ADMIN_SCOPES);

/**
 * Resolve the acting admin's scopes once per request (the JWT carries only id +
 * role, not scopes). Mount AFTER authenticate + requireAdmin. Populates
 * req.admin = { scopes: string[], isSuperAdmin: boolean }.
 */
export async function loadAdminContext(req, res, next) {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { adminScopes: true },
    });
    const scopes = Array.isArray(u?.adminScopes) ? u.adminScopes : [];
    const isSuperAdmin = scopes.length === 0 || scopes.includes(ADMIN_SCOPES.SUPER_ADMIN);
    req.admin = { scopes, isSuperAdmin };
    next();
  } catch (err) {
    return sendServerError(res, err, 'Failed to resolve admin permissions');
  }
}

/**
 * Require a specific scope for a sub-router. SUPER_ADMIN (and legacy no-scope
 * admins) bypass every check. Mount AFTER loadAdminContext.
 */
export function requireScope(scope) {
  return (req, res, next) => {
    if (req.admin?.isSuperAdmin) return next();
    if (req.admin?.scopes?.includes(scope)) return next();
    return sendForbidden(res, `Missing required permission: ${scope}`);
  };
}

export default requireAdmin;
