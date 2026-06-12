/**
 * Admin Users — /api/v1/admin/users
 *
 * GET    /users                 list (search phone/name/district; filter role/kyc/isActive/isMinor)
 * GET    /users/:id             full profile + counts + recent activity (PII masked; ?reveal=true&reason= audited)
 * PATCH  /users/:id             change role / isActive (audited; role change bumps tokenVersion)
 * POST   /users/:id/force-logout  bump tokenVersion + revoke refresh tokens (audited)
 * GET    /users/:id/consents    effective consents + history (DPDP)
 * GET    /users/:id/audit       audit trail for this user
 *
 * ADMIN gate + authenticate applied by the parent admin router. Every mutation is
 * audited; PII is masked by default and only revealed with a logged reason.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { sanitizeSearch } from '../../utils/sanitizeSearch.js';
import { keysetList } from '../../utils/adminList.js';
import { shapeUser, auditReveal } from '../../utils/adminPii.js';
import { adminAudit, listParams, revealValidators } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { getEffectiveConsents, getConsentHistory } from '../../services/consent.service.js';

const router = Router();

const ROLES = ['FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER', 'ADMIN', 'SELLER'];
const KYC_STATUSES = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

// Fields safe to project for the list (no encrypted blobs — list never reveals).
const LIST_SELECT = {
  id: true, phone: true, name: true, avatar: true, role: true, kycStatus: true,
  isActive: true, isMinor: true, district: true, state: true, language: true,
  lastActiveAt: true, createdAt: true,
};

// ── GET /users ────────────────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('role').optional().isIn(ROLES),
    query('kyc').optional().isIn(KYC_STATUSES),
    query('isActive').optional().isBoolean(),
    query('isMinor').optional().isBoolean(),
    query('search').optional().isString().isLength({ max: 100 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.role) where.role = req.query.role;
      if (req.query.kyc) where.kycStatus = req.query.kyc;
      if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
      if (req.query.isMinor !== undefined) where.isMinor = req.query.isMinor === 'true';

      const search = sanitizeSearch(req.query.search);
      if (search) {
        where.OR = [
          { phone: { contains: search } },
          { name: { contains: search, mode: 'insensitive' } },
          { district: { contains: search, mode: 'insensitive' } },
        ];
      }

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.user, { where, cursor, limit, select: LIST_SELECT });
      const items = page.items.map((u) => shapeUser(u, { reveal: false }));
      return sendSuccess(res, { items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load users');
    }
  },
);

// ── GET /users/:id ──────────────────────────────────────────────────────────────
router.get(
  '/:id',
  [param('id').isUUID(), ...revealValidators()],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          sellerProfile: { select: { id: true, kycVerifiedAt: true, kycRejectedReason: true, kycDocumentUrls: true, createdAt: true } },
          aiCredits: { select: { balance: true, tier: true, lifetimeSpent: true, lifetimeEarned: true } },
        },
      });
      if (!user) return sendNotFound(res, 'User');

      const reveal = String(req.query.reveal) === 'true';
      if (reveal) {
        await auditReveal(req, {
          entity: 'User', entityId: id,
          fields: ['phone', 'lat', 'lng', 'annualHouseholdIncome'],
          reason: req.query.reason,
        });
      }

      // Counts + recent activity in parallel.
      const [orders, animals, machinery, labour, posts, reviews, reports, bookings, conversations,
        recentOrders, recentConversations, recentAudit] = await Promise.all([
        prisma.order.count({ where: { userId: id } }),
        prisma.animalListing.count({ where: { sellerId: id } }),
        prisma.machineryListing.count({ where: { ownerId: id } }),
        prisma.labourListing.count({ where: { providerId: id } }),
        prisma.post.count({ where: { authorId: id, deletedAt: null } }),
        prisma.review.count({ where: { userId: id } }),
        prisma.cropDiseaseReport.count({ where: { userId: id } }),
        prisma.booking.count({ where: { userId: id } }),
        prisma.aIConversation.count({ where: { userId: id } }),
        prisma.order.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true } }),
        prisma.aIConversation.findMany({ where: { userId: id }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, title: true, messageCount: true, updatedAt: true } }),
        prisma.auditLog.findMany({ where: { OR: [{ userId: id }, { entityId: id }] }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, action: true, entity: true, entityId: true, ip: true, createdAt: true } }),
      ]);

      // Strip the raw KYC public_ids out of the seller profile summary (served only
      // via the audited KYC docs endpoint), surface just the count.
      const sp = user.sellerProfile
        ? { ...user.sellerProfile, kycDocumentCount: user.sellerProfile.kycDocumentUrls?.length || 0, kycDocumentUrls: undefined }
        : null;

      const shaped = shapeUser(user, { reveal });
      return sendSuccess(res, {
        user: { ...shaped, sellerProfile: sp },
        counts: { orders, animals, machinery, labour, posts, reviews, reports, bookings, conversations },
        recent: { orders: recentOrders, conversations: recentConversations, audit: recentAudit },
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load user');
    }
  },
);

// ── PATCH /users/:id ──────────────────────────────────────────────────────────
router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('role').optional().isIn(ROLES),
    body('isActive').optional().isBoolean(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (req.body.role === undefined && req.body.isActive === undefined) {
        return sendServerError(res, Object.assign(new Error('Provide role or isActive'), { expose: true, statusCode: 400 }), 'Provide role or isActive', 400);
      }
      const current = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } });
      if (!current) return sendNotFound(res, 'User');

      const data = {};
      const roleChanged = req.body.role !== undefined && req.body.role !== current.role;
      if (roleChanged) {
        data.role = req.body.role;
        // Bump tokenVersion so the new role takes effect on the user's next request
        // (their client silently refreshes → new access token carries the new role).
        // Refresh tokens are left intact, so this is NOT a logout.
        data.tokenVersion = { increment: 1 };
      }
      if (req.body.isActive !== undefined) data.isActive = req.body.isActive === true || req.body.isActive === 'true';

      const updated = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, role: true, isActive: true, tokenVersion: true },
      });

      await adminAudit(req, ADMIN_ACTIONS.USER_UPDATE, 'User', id, {
        before: { role: current.role, isActive: current.isActive },
        after: { role: updated.role, isActive: updated.isActive },
        metadata: { reason: req.body.reason ?? null, roleChanged },
      });

      return sendSuccess(res, { id: updated.id, role: updated.role, isActive: updated.isActive });
    } catch (err) {
      return sendServerError(res, err, 'Failed to update user');
    }
  },
);

// ── POST /users/:id/force-logout ──────────────────────────────────────────────
router.post(
  '/:id/force-logout',
  [param('id').isUUID(), body('reason').optional().isString().trim().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const current = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!current) return sendNotFound(res, 'User');

      // Bump tokenVersion (invalidates outstanding access tokens at next auth) AND
      // delete refresh tokens (no silent re-auth) → a true full logout everywhere.
      const [, revoked] = await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } }),
        prisma.refreshToken.deleteMany({ where: { userId: id } }),
      ]);

      await adminAudit(req, ADMIN_ACTIONS.USER_FORCE_LOGOUT, 'User', id, {
        metadata: { reason: req.body.reason ?? null, refreshTokensRevoked: revoked.count },
      });

      return sendSuccess(res, { id, refreshTokensRevoked: revoked.count });
    } catch (err) {
      return sendServerError(res, err, 'Failed to force logout');
    }
  },
);

// ── GET /users/:id/consents ───────────────────────────────────────────────────
router.get('/:id/consents', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const [effective, history] = await Promise.all([
      getEffectiveConsents(req.params.id),
      getConsentHistory(req.params.id),
    ]);
    return sendSuccess(res, { effective, history });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load consents');
  }
});

// ── GET /users/:id/audit ──────────────────────────────────────────────────────
router.get(
  '/:id/audit',
  [param('id').isUUID(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.auditLog, {
        where: { OR: [{ userId: id }, { entityId: id }] },
        cursor, limit,
        select: { id: true, userId: true, action: true, entity: true, entityId: true, ip: true, createdAt: true, metadata: true },
      });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load user audit trail');
    }
  },
);

export default router;
