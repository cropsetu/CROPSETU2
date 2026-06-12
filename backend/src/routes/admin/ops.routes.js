/**
 * Admin Ops — feature flags, external-API health, queue stats.
 *   /api/v1/admin/flags        GET list / PATCH :key (toggle)
 *   /api/v1/admin/health       GET external-API health (APIHealthLog summary)
 *   /api/v1/admin/queues       GET BullMQ job counts
 *
 * ADMIN gate applied by the parent router. Flag toggles audited + cache-invalidated
 * (mirrors the existing /admin/features behaviour).
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError } from '../../utils/response.js';
import { invalidateCache } from '../../services/featureFlag.service.js';
import { auditAction, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { apiHealthSummary } from '../../services/adminMetrics.service.js';
import { getQueueStats } from '../../queue/jobQueue.js';

const flagsRouter = Router();
const healthRouter = Router();
const queuesRouter = Router();

// ── Feature flags ─────────────────────────────────────────────────────────────
flagsRouter.get('/', async (_req, res) => {
  try {
    const flags = await prisma.featureFlag.findMany({ orderBy: { featureKey: 'asc' } });
    return sendSuccess(res, { items: flags });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load feature flags');
  }
});

flagsRouter.patch(
  '/:key',
  [param('key').isString().trim().isLength({ min: 1, max: 100 }), body('isEnabled').isBoolean(), body('disabledReason').optional({ nullable: true }).isString().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const { key } = req.params;
      const { isEnabled } = req.body;
      const flag = await prisma.featureFlag.upsert({
        where: { featureKey: key },
        create: { featureKey: key, isEnabled, disabledReason: isEnabled ? null : (req.body.disabledReason || null), disabledAt: isEnabled ? null : new Date(), enabledAt: isEnabled ? new Date() : null, updatedBy: req.user.id },
        update: { isEnabled, disabledReason: isEnabled ? null : (req.body.disabledReason || null), disabledAt: isEnabled ? null : new Date(), enabledAt: isEnabled ? new Date() : null, updatedBy: req.user.id },
      });
      invalidateCache(key);
      auditAction(req, { action: AUDIT_ACTIONS.FEATURE_FLAG_CHANGE, entity: 'FeatureFlag', entityId: key, after: { isEnabled: flag.isEnabled, disabledReason: flag.disabledReason }, metadata: { updatedBy: req.user.id } }).catch(() => {});
      return sendSuccess(res, flag);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update feature flag');
    }
  },
);

// ── External-API health ───────────────────────────────────────────────────────
healthRouter.get('/', [query('hours').optional().isInt({ min: 1, max: 168 })], validate, async (req, res) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const [summary, recentLogs] = await Promise.all([
      apiHealthSummary(hours),
      prisma.aPIHealthLog.findMany({ where: { timestamp: { gte: since } }, orderBy: { timestamp: 'desc' }, take: 50 }),
    ]);
    return sendSuccess(res, { hours, summary, recentLogs });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load API health');
  }
});

// ── Queue stats ───────────────────────────────────────────────────────────────
queuesRouter.get('/', async (_req, res) => {
  try {
    const queues = await getQueueStats();
    return sendSuccess(res, { queues });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load queue stats');
  }
});

export { flagsRouter, healthRouter, queuesRouter };
