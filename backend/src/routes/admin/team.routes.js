/**
 * Admin team & access management — /api/v1/admin/team (+ /api/v1/admin/me)
 *
 * GET   /me               acting admin's identity + RBAC scopes (drives SPA nav gating)
 * GET   /team             list admins (phones masked)
 * POST  /team/invite      promote an existing user (by phone) to ADMIN + assign scopes
 * PATCH /team/:id/scopes  update an admin's scopes
 * POST  /team/:id/revoke  demote to FARMER, clear scopes, force-logout everywhere
 *
 * /team is SUPER_ADMIN-gated at the parent router; /me is open to any admin.
 * Every mutation bumps tokenVersion so the role/scope change takes effect on the
 * target's next request, and writes an audit row. PII (phone) is masked.
 */
import { Router } from 'express';
import { body, param } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS, maskPhone } from '../../services/audit.service.js';
import { ALL_ADMIN_SCOPES } from '../../middleware/admin.js';

const meRouter = Router();
const teamRouter = Router();

// ── GET /me — the acting admin's own identity + scopes ─────────────────────────
meRouter.get('/', (req, res) => {
  return sendSuccess(res, {
    id: req.user.id,
    role: req.user.role,
    scopes: req.admin?.scopes ?? [],
    isSuperAdmin: Boolean(req.admin?.isSuperAdmin),
    allScopes: ALL_ADMIN_SCOPES,
  });
});

const TEAM_SELECT = {
  id: true, name: true, phone: true, adminScopes: true, isActive: true,
  lastActiveAt: true, createdAt: true,
};

const shapeAdmin = (u) => ({ ...u, phone: maskPhone(u.phone) });

const scopesValidator = body('scopes')
  .isArray().withMessage('scopes must be an array')
  .bail()
  .custom((arr) => arr.every((s) => ALL_ADMIN_SCOPES.includes(s)))
  .withMessage(`scopes must be a subset of: ${ALL_ADMIN_SCOPES.join(', ')}`);

// ── GET /team ──────────────────────────────────────────────────────────────────
teamRouter.get('/', async (req, res) => {
  try {
    const { cursor, limit } = listParams(req);
    const page = await keysetList(prisma.user, { where: { role: 'ADMIN' }, cursor, limit, select: TEAM_SELECT });
    const items = page.items.map(shapeAdmin);
    return sendSuccess(res, { items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: items.length });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load admin team');
  }
});

// ── POST /team/invite — promote an existing user to ADMIN with scopes ──────────
teamRouter.post(
  '/invite',
  [
    body('phone').isString().trim().isLength({ min: 6, max: 20 }),
    scopesValidator,
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const phone = req.body.phone.trim();
      const scopes = req.body.scopes;
      const user = await prisma.user.findUnique({
        where: { phone },
        select: { id: true, role: true, name: true, adminScopes: true },
      });
      if (!user) {
        return sendServerError(
          res,
          Object.assign(new Error('No user with that phone — they must sign up in the app first'), { expose: true, statusCode: 404 }),
          'User not found', 404,
        );
      }
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN', adminScopes: scopes, tokenVersion: { increment: 1 } },
        select: { id: true, role: true, adminScopes: true },
      });
      await adminAudit(req, ADMIN_ACTIONS.TEAM_INVITE, 'User', user.id, {
        before: { role: user.role, adminScopes: user.adminScopes },
        after: { role: updated.role, adminScopes: updated.adminScopes },
        metadata: { reason: req.body.reason ?? null },
      });
      return sendSuccess(res, { id: updated.id, role: updated.role, adminScopes: updated.adminScopes });
    } catch (err) {
      return sendServerError(res, err, 'Failed to invite admin');
    }
  },
);

// ── PATCH /team/:id/scopes ─────────────────────────────────────────────────────
teamRouter.patch(
  '/:id/scopes',
  [param('id').isUUID(), scopesValidator, body('reason').optional().isString().trim().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const current = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, adminScopes: true } });
      if (!current || current.role !== 'ADMIN') return sendNotFound(res, 'Admin');
      const updated = await prisma.user.update({
        where: { id },
        data: { adminScopes: req.body.scopes, tokenVersion: { increment: 1 } },
        select: { id: true, adminScopes: true },
      });
      await adminAudit(req, ADMIN_ACTIONS.TEAM_SCOPES_UPDATE, 'User', id, {
        before: { adminScopes: current.adminScopes },
        after: { adminScopes: updated.adminScopes },
        metadata: { reason: req.body.reason ?? null },
      });
      return sendSuccess(res, { id: updated.id, adminScopes: updated.adminScopes });
    } catch (err) {
      return sendServerError(res, err, 'Failed to update scopes');
    }
  },
);

// ── POST /team/:id/revoke — demote + force-logout everywhere ───────────────────
teamRouter.post(
  '/:id/revoke',
  [param('id').isUUID(), body('reason').isString().trim().isLength({ min: 3, max: 500 })],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (id === req.user.id) {
        return sendServerError(
          res,
          Object.assign(new Error('You cannot revoke your own admin access'), { expose: true, statusCode: 400 }),
          'Cannot revoke self', 400,
        );
      }
      const current = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, adminScopes: true } });
      if (!current || current.role !== 'ADMIN') return sendNotFound(res, 'Admin');

      // Demote to a regular user, clear scopes, bump tokenVersion AND delete refresh
      // tokens → a true logout everywhere (mirrors users.routes force-logout). We
      // demote to FARMER since the prior non-admin role isn't tracked.
      const [updated, revoked] = await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { role: 'FARMER', adminScopes: [], tokenVersion: { increment: 1 } }, select: { id: true, role: true } }),
        prisma.refreshToken.deleteMany({ where: { userId: id } }),
      ]);

      await adminAudit(req, ADMIN_ACTIONS.TEAM_REVOKE, 'User', id, {
        before: { role: current.role, adminScopes: current.adminScopes },
        after: { role: updated.role, adminScopes: [] },
        metadata: { reason: req.body.reason, refreshTokensRevoked: revoked.count },
      });
      return sendSuccess(res, { id: updated.id, role: updated.role, refreshTokensRevoked: revoked.count });
    } catch (err) {
      return sendServerError(res, err, 'Failed to revoke admin');
    }
  },
);

export { teamRouter, meRouter };
