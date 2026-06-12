/**
 * Content moderation routes (Admin) — the REV-5 review queue that fake-content
 * signals (FRAUD-5) route suspicious reviews/listings into.
 *
 * GET  /api/v1/admin/moderation              ?status=&entityType=&limit=
 *      List the moderation queue (defaults to PENDING, newest first).
 * POST /api/v1/admin/moderation/:id/resolve  { status: APPROVED|REJECTED, note? }
 *      Clear (APPROVED) or remove (REJECTED) a flagged item.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError, sendNotFound } from '../utils/response.js';
import logger from '../utils/logger.js';
import prisma from '../config/db.js';
import { listFlags, resolveFlag, MODERATION_STATUSES } from '../services/moderation.service.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return sendError(res, 'Admin access required', 403);
  next();
}

router.use(authenticate, requireAdmin);

// ── GET / — the moderation queue ─────────────────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(MODERATION_STATUSES),
    query('entityType').optional().isIn(['Review', 'Product']),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  async (req, res) => {
    try {
      const flags = await listFlags({
        status: req.query.status,
        entityType: req.query.entityType,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      });
      return sendSuccess(res, { flags });
    } catch (err) {
      logger.error({ err }, '[Moderation] GET / error');
      return sendError(res, 'Failed to load moderation queue', 500);
    }
  }
);

// ── GET /:id — flag detail + the underlying flagged content ──────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const flag = await prisma.contentFlag.findUnique({ where: { id: req.params.id } });
    if (!flag) return sendNotFound(res, 'Flag');

    let entity = null;
    if (flag.entityType === 'Review') {
      entity = await prisma.review.findUnique({
        where: { id: flag.entityId },
        include: { user: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } },
      });
    } else if (flag.entityType === 'Product') {
      entity = await prisma.product.findUnique({
        where: { id: flag.entityId },
        include: { seller: { select: { id: true, name: true } } },
      });
    }
    return sendSuccess(res, { flag, entity });
  } catch (err) {
    logger.error({ err }, '[Moderation] GET /:id error');
    return sendError(res, 'Failed to load flag detail', 500);
  }
});

// ── POST /:id/resolve — clear or remove a flagged item ───────────────────────
router.post(
  '/:id/resolve',
  [
    param('id').isUUID(),
    body('status').isIn(['APPROVED', 'REJECTED']),
    body('note').optional().trim().isLength({ max: 2000 }),
  ],
  validate,
  async (req, res) => {
    try {
      const updated = await resolveFlag({
        id: req.params.id,
        status: req.body.status,
        reviewedById: req.user.id,
        note: req.body.note ?? null,
      });
      if (!updated) return sendNotFound(res, 'Flag');
      return sendSuccess(res, updated);
    } catch (err) {
      if (err?.expose) return sendError(res, err.message, err.statusCode || 400);
      logger.error({ err }, '[Moderation] POST /:id/resolve error');
      return sendError(res, 'Failed to resolve flag', 500);
    }
  }
);

export default router;
