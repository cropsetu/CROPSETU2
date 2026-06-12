/**
 * Admin Compliance (DPDP) — consents, erasure, audit log viewer.
 *   /api/v1/admin/consents               GET consent records (filter purpose/user/granted)
 *   /api/v1/admin/erasure-requests       GET processed-erasure history
 *   /api/v1/admin/erasure-requests/:userId/process  POST run DPDP §8 erasure (reason required)
 *   /api/v1/admin/audit                  GET read-only AuditLog viewer (filter entity/action/user/date)
 *
 * NOTE: the schema has no dedicated ErasureRequest model, so "erasure-requests"
 * surfaces the audited history of erasures (AuditLog action=ACCOUNT_ERASURE) and
 * lets an admin process an erasure for a given userId via erasure.service.
 *
 * ADMIN gate applied by the parent router. Erasure is irreversible + audited.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { listParams, dateRange } from './_helpers.js';
import { auditLog, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { eraseUserAccount } from '../../services/erasure.service.js';

const consentsRouter = Router();
const erasureRouter = Router();
const auditRouter = Router();

const CONSENT_PURPOSES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'DATA_PROCESSING', 'AI_PROCESSING', 'LOCATION', 'MARKETING', 'GUARDIAN_CONSENT', 'SELLER_ONBOARDING'];

// ── GET /consents ─────────────────────────────────────────────────────────────
consentsRouter.get(
  '/',
  [query('purpose').optional().isIn(CONSENT_PURPOSES), query('userId').optional().isUUID(), query('granted').optional().isBoolean(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.purpose) where.purpose = req.query.purpose;
      if (req.query.userId) where.userId = req.query.userId;
      if (req.query.granted !== undefined) where.granted = req.query.granted === 'true';
      const { cursor, limit } = listParams(req);
      // Consent proof carries IP/user-agent — surface for compliance, but it's not
      // farmer PII like phone/bank, so no reveal gate is needed here.
      const page = await keysetList(prisma.consentRecord, {
        where, cursor, limit,
        select: { id: true, userId: true, purpose: true, granted: true, policyVersion: true, method: true, ip: true, createdAt: true },
      });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load consents');
    }
  },
);

// ── GET /erasure-requests — processed-erasure history ────────────────────────
erasureRouter.get('/', [query('limit').optional().isInt({ min: 1, max: 100 })], validate, async (req, res) => {
  try {
    const { cursor, limit } = listParams(req);
    const page = await keysetList(prisma.auditLog, {
      where: { action: AUDIT_ACTIONS.ACCOUNT_ERASURE },
      cursor, limit,
      select: { id: true, userId: true, entity: true, entityId: true, ip: true, metadata: true, createdAt: true },
    });
    return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load erasure history');
  }
});

// ── POST /erasure-requests/:userId/process — run the DPDP §8 erasure ─────────
erasureRouter.post('/:userId/process', [param('userId').isUUID(), body('reason').isString().trim().isLength({ min: 3, max: 500 })], validate, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return sendNotFound(res, 'User');

    const result = await eraseUserAccount(userId);
    if (!result.erased) return sendNotFound(res, 'User');

    // Canonical erasure audit event (also appears in the erasure history list).
    await auditLog({
      userId: req.user?.id,
      action: AUDIT_ACTIONS.ACCOUNT_ERASURE,
      entity: 'User',
      entityId: userId,
      metadata: { adminInitiated: true, reason: req.body.reason, mediaRefs: result.mediaRefs, mediaDeleted: result.mediaDeleted },
      ip: req.ip,
      requestId: req.id,
    }).catch(() => {});

    return sendSuccess(res, { userId, erased: true, mediaDeleted: result.mediaDeleted, mediaRefs: result.mediaRefs });
  } catch (err) {
    return sendServerError(res, err, 'Failed to process erasure');
  }
});

// ── GET /audit — read-only audit-log viewer ──────────────────────────────────
auditRouter.get(
  '/',
  [
    query('action').optional().isString().isLength({ max: 60 }),
    query('entity').optional().isString().isLength({ max: 60 }),
    query('entityId').optional().isString().isLength({ max: 64 }),
    query('userId').optional().isString().isLength({ max: 64 }),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.action) where.action = req.query.action;
      if (req.query.entity) where.entity = req.query.entity;
      if (req.query.entityId) where.entityId = req.query.entityId;
      if (req.query.userId) where.userId = req.query.userId;
      const range = dateRange(req.query.from, req.query.to);
      if (range) where.createdAt = range;
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.auditLog, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load audit log');
    }
  },
);

export { consentsRouter, erasureRouter, auditRouter };
