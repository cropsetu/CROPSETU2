/**
 * Admin Ops — feature flags, external-API health, queue stats, job inspection,
 * and the server error log.
 *   /api/v1/admin/flags          GET list / PATCH :key (toggle)
 *   /api/v1/admin/health         GET external-API health (APIHealthLog summary)
 *   /api/v1/admin/queues         GET BullMQ job counts
 *   /api/v1/admin/jobs/:queue    GET recent jobs / POST :id/retry (audited)
 *   /api/v1/admin/error-logs     GET keyset list (filter source/severity)
 *
 * ADMIN gate applied by the parent router. Flag toggles + job retries are audited;
 * flag toggles are cache-invalidated (mirrors the existing /admin/features
 * behaviour).
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendError, sendNotFound } from '../../utils/response.js';
import { invalidateCache } from '../../services/featureFlag.service.js';
import { auditAction, AUDIT_ACTIONS, ADMIN_ACTIONS } from '../../services/audit.service.js';
import { apiHealthSummary } from '../../services/adminMetrics.service.js';
import { getQueueStats, getRecentJobs, retryJob, isKnownQueue } from '../../queue/jobQueue.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams, sendList } from './_helpers.js';

const flagsRouter = Router();
const healthRouter = Router();
const queuesRouter = Router();
const jobsRouter = Router();
const errorLogsRouter = Router();

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

// ── BullMQ job inspection + retry ─────────────────────────────────────────────
// GET  /admin/jobs/:queue            recent jobs across states (read-only)
// POST /admin/jobs/:queue/:id/retry  re-enqueue a single failed job (audited)
//
// Unknown queue → 404 (the queue set is fixed by QUEUE_NAMES). When the queue
// layer is disabled / Redis is down the helpers return { available: false } and
// we surface that — same contract as /queues — rather than 500-ing.

jobsRouter.get('/:queue', [param('queue').isString().trim().isLength({ min: 1, max: 60 }), query('limit').optional().isInt({ min: 1, max: 100 })], validate, async (req, res) => {
  try {
    const { queue } = req.params;
    if (!isKnownQueue(queue)) return sendNotFound(res, 'Queue');
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const result = await getRecentJobs(queue, undefined, limit);
    return sendSuccess(res, { queue, available: result.available, jobs: result.jobs });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load jobs');
  }
});

jobsRouter.post('/:queue/:id/retry', [param('queue').isString().trim().isLength({ min: 1, max: 60 }), param('id').isString().trim().isLength({ min: 1, max: 200 })], validate, async (req, res) => {
  try {
    const { queue, id } = req.params;
    if (!isKnownQueue(queue)) return sendNotFound(res, 'Queue');
    const result = await retryJob(queue, id);
    if (result.available === false) return sendError(res, 'Queue layer unavailable — jobs run inline; nothing to retry', 409);
    if (!result.retried) {
      if (result.reason === 'not_found') return sendNotFound(res, 'Job');
      return sendError(res, `Job cannot be retried (state: ${result.state ?? 'unknown'})`, 409);
    }
    await adminAudit(req, ADMIN_ACTIONS.JOB_RETRY, 'Job', `${queue}:${id}`, { metadata: { queue, jobId: id, jobName: result.name } });
    return sendSuccess(res, { queue, jobId: id, retried: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to retry job');
  }
});

// ── Server error log ──────────────────────────────────────────────────────────
// Keyset list of errors captured (best-effort) by the global Express error
// handler. Filter by ?source= (substring) and ?severity= (exact).
errorLogsRouter.get(
  '/',
  [query('source').optional().isString().isLength({ max: 200 }), query('severity').optional().isString().isLength({ max: 30 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.source) where.source = { contains: String(req.query.source), mode: 'insensitive' };
      if (req.query.severity) where.severity = String(req.query.severity);
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.errorLog, { where, cursor, limit });
      return sendList(res, sendSuccess, page);
    } catch (err) {
      return sendServerError(res, err, 'Failed to load error logs');
    }
  },
);

export { flagsRouter, healthRouter, queuesRouter, jobsRouter, errorLogsRouter };
