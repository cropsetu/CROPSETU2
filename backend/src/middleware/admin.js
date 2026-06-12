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
import { sendError } from '../utils/response.js';

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return sendError(res, 'Admin access required', 403);
  next();
}

export default requireAdmin;
