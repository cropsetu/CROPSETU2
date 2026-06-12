/**
 * Admin AI operations — /api/v1/admin/ai
 *
 * GET   /ai/usage                  per-user token/cost roll-up over a window (top spenders)
 * GET   /ai/credits/:userId        a user's credit ledger summary
 * POST  /ai/credits/:userId/adjust manual grant/deduct { amount, reason } (audited)
 * GET   /ai/feedback               disease-feedback retrain queue (?usedForRetrain=)
 * PATCH /ai/feedback/:id           mark/unmark usedForRetrain (audited)
 * GET   /ai/reports                crop-disease report analytics
 *
 * ADMIN gate applied by the parent router.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList, boundedLimit } from '../../utils/adminList.js';
import { maskPhone } from '../../utils/adminPii.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { getCreditSummary, adminAdjustCredits } from '../../services/aiCredit.service.js';

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

// ── GET /ai/usage — top token/cost spenders over a window ─────────────────────
router.get(
  '/usage',
  [query('days').optional().isInt({ min: 1, max: 365 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days, 10) : 30;
      const limit = boundedLimit(req.query.limit, 25, 100);
      const since = new Date(Date.now() - days * DAY_MS);

      const grouped = await prisma.aIUsage.groupBy({
        by: ['userId'],
        where: { date: { gte: since } },
        _sum: { totalTokens: true, totalCostUsd: true, scanCount: true, chatCount: true },
        orderBy: { _sum: { totalTokens: 'desc' } },
        take: limit,
      });
      const users = grouped.length
        ? await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.userId) } }, select: { id: true, name: true, phone: true } })
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));

      const items = grouped.map((g) => ({
        userId: g.userId,
        name: byId.get(g.userId)?.name ?? null,
        phone: byId.get(g.userId) ? maskPhone(byId.get(g.userId).phone) : null,
        tokens: g._sum.totalTokens ?? 0,
        costUsd: g._sum.totalCostUsd ?? 0,
        scans: g._sum.scanCount ?? 0,
        chats: g._sum.chatCount ?? 0,
      }));
      return sendSuccess(res, { windowDays: days, items });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load AI usage');
    }
  },
);

// ── GET /ai/credits/:userId ──────────────────────────────────────────────────
router.get('/credits/:userId', [param('userId').isUUID()], validate, async (req, res) => {
  try {
    const exists = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } });
    if (!exists) return sendNotFound(res, 'User');
    const summary = await getCreditSummary(req.params.userId);
    return sendSuccess(res, summary);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load credit ledger');
  }
});

// ── POST /ai/credits/:userId/adjust ──────────────────────────────────────────
router.post(
  '/credits/:userId/adjust',
  [param('userId').isUUID(), body('amount').isInt({ min: -100000, max: 100000 }).custom((v) => v !== 0).withMessage('amount must be a non-zero integer'), body('reason').isString().trim().isLength({ min: 3, max: 500 })],
  validate,
  async (req, res) => {
    try {
      const exists = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } });
      if (!exists) return sendNotFound(res, 'User');
      const amount = parseInt(req.body.amount, 10);
      const result = await adminAdjustCredits(req.params.userId, amount, req.body.reason, req.user.id);
      await adminAudit(req, ADMIN_ACTIONS.AI_CREDIT_ADJUST, 'AICredit', req.params.userId, {
        after: { amount, balance: result.balance },
        metadata: { reason: req.body.reason },
      });
      return sendSuccess(res, { userId: req.params.userId, amount, balance: result.balance, transactionId: result.transaction.id });
    } catch (err) {
      return sendServerError(res, err, 'Failed to adjust credits');
    }
  },
);

// ── GET /ai/feedback — retrain queue ─────────────────────────────────────────
router.get(
  '/feedback',
  [query('usedForRetrain').optional().isBoolean(), query('farmerAgreed').optional().isBoolean(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.usedForRetrain !== undefined) where.usedForRetrain = req.query.usedForRetrain === 'true';
      if (req.query.farmerAgreed !== undefined) where.farmerAgreed = req.query.farmerAgreed === 'true';
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.diseaseFeedback, {
        where, cursor, limit,
        include: {
          user: { select: { id: true, name: true } },
          report: { select: { id: true, cropType: true, primaryDisease: true, riskLevel: true } },
        },
      });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load feedback queue');
    }
  },
);

router.patch('/feedback/:id', [param('id').isUUID(), body('usedForRetrain').isBoolean()], validate, async (req, res) => {
  try {
    const before = await prisma.diseaseFeedback.findUnique({ where: { id: req.params.id }, select: { id: true, usedForRetrain: true } });
    if (!before) return sendNotFound(res, 'Feedback');
    const updated = await prisma.diseaseFeedback.update({ where: { id: req.params.id }, data: { usedForRetrain: req.body.usedForRetrain }, select: { id: true, usedForRetrain: true } });
    await adminAudit(req, ADMIN_ACTIONS.AI_FEEDBACK_UPDATE, 'DiseaseFeedback', updated.id, { before, after: updated });
    return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update feedback');
  }
});

// ── GET /ai/reports — crop-disease analytics ─────────────────────────────────
router.get('/reports', [query('days').optional().isInt({ min: 1, max: 365 })], validate, async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    const since = new Date(Date.now() - days * DAY_MS);
    const [total, byRisk, byCrop, recent] = await Promise.all([
      prisma.cropDiseaseReport.count({ where: { createdAt: { gte: since } } }),
      prisma.cropDiseaseReport.groupBy({ by: ['riskLevel'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.cropDiseaseReport.groupBy({ by: ['cropType'], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { cropType: 'desc' } }, take: 15 }),
      prisma.cropDiseaseReport.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, cropType: true, primaryDisease: true, riskLevel: true, confidenceScore: true, createdAt: true } }),
    ]);
    return sendSuccess(res, {
      windowDays: days,
      total,
      byRisk: byRisk.map((r) => ({ riskLevel: r.riskLevel, count: r._count._all })),
      byCrop: byCrop.map((r) => ({ cropType: r.cropType, count: r._count._all })),
      recent,
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load report analytics');
  }
});

export default router;
