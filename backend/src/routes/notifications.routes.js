/**
 * Notification Routes
 *
 * GET   /api/v1/notifications            — the farmer's notifications, newest first
 * GET   /api/v1/notifications/unread     — unread count, for a tab badge
 * PATCH /api/v1/notifications/:id/read   — mark one read
 * PATCH /api/v1/notifications/read-all   — mark every unread one read
 *
 * Notifications were already being WRITTEN by rent, animaltrade, agristore and
 * cropReportShare, and delivered as push — but the farmer app had no way to read
 * them back. This is the missing half.
 *
 * Keyset pagination, not offset: `@@index([userId, createdAt])` already exists on
 * the model, and offset would make deep pages walk-and-discard (see utils/keyset.js).
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { keysetPage } from '../utils/keyset.js';
import prisma from '../config/db.js';

const router = Router();
router.param('id', uuidParamGuard);

const MAX_LIMIT = 50;

// ── GET /api/v1/notifications ────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, MAX_LIMIT);
    const page = await keysetPage(prisma, {
      table: 'notifications',
      filterColumn: 'userId',
      filterValue: req.user.id,
      cursor: req.query.cursor,
      limit,
    });
    return sendSuccess(res, page);
  } catch (err) {
    req.log?.error({ err }, '[notifications] list failed');
    return sendError(res, 'SERVER_ERROR', 'Could not load notifications', 500);
  }
});

// ── GET /api/v1/notifications/unread ─────────────────────────────────────────
router.get('/unread', authenticate, async (req, res) => {
  try {
    // Served by @@index([userId, readAt]).
    const count = await prisma.notification.count({
      where: { userId: req.user.id, readAt: null },
    });
    return sendSuccess(res, { count });
  } catch (err) {
    req.log?.error({ err }, '[notifications] unread count failed');
    return sendError(res, 'SERVER_ERROR', 'Could not load unread count', 500);
  }
});

// ── PATCH /api/v1/notifications/:id/read ─────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    // updateMany with userId in the WHERE is the object-level authorisation:
    // a notification belonging to someone else matches zero rows rather than
    // throwing, so this cannot be used to probe for other users' ids.
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (!count) return sendError(res, 'NOT_FOUND', 'Notification not found', 404);
    return sendSuccess(res, { id: req.params.id, read: true });
  } catch (err) {
    req.log?.error({ err }, '[notifications] mark read failed');
    return sendError(res, 'SERVER_ERROR', 'Could not update notification', 500);
  }
});

// ── PATCH /api/v1/notifications/read-all ─────────────────────────────────────
router.patch('/read-all', authenticate, async (req, res) => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return sendSuccess(res, { updated: count });
  } catch (err) {
    req.log?.error({ err }, '[notifications] read-all failed');
    return sendError(res, 'SERVER_ERROR', 'Could not update notifications', 500);
  }
});

export default router;
