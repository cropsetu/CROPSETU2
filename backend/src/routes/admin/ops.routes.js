/**
 * Admin Ops — feature flags, external-API health, queue stats, job inspection,
 * circuit-breaker state, and the server error log.
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
import redis from '../../config/redis.js';
import { getSigned } from '../../utils/fastapi-signed.js';
import { getBudgetSummary } from '../../services/settings.service.js';
import { breakerStates, CIRCUIT_STATES } from '../../resilience/circuitBreaker.js';
import { reauthStats } from '../../socket/socketReauth.js';
import { inlineStats } from '../../queue/jobQueue.js';
import { authCacheStats } from '../../services/authCache.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams, sendList } from './_helpers.js';

const flagsRouter = Router();
const healthRouter = Router();
const queuesRouter = Router();
const jobsRouter = Router();
const errorLogsRouter = Router();
const statusRouter = Router();

// ── GET /admin/ops/status — live "is the system healthy RIGHT NOW" ────────────
// Every other admin surface is historical (30-day dashboard, 24h health table,
// 7/30/90-day usage). Nothing answered "is it up right now", and in particular
// nothing in this repo called FastAPI's /health/details — which already returns
// exactly the right payload (DB connectivity, prompt versions, model chains,
// invariant count) behind the signed-request guard.
//
// Every probe is independently wrapped: one dead dependency must render as a red
// light, never as a 500 that blanks the whole page. Each returns { ok, ...detail }
// plus the latency we measured, so a slow-but-alive dependency is visible too.
async function probe(name, fn, timeoutMs = 4000) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} probe timed out`)), timeoutMs)),
    ]);
    return { name, ok: true, latencyMs: Date.now() - started, ...value };
  } catch (err) {
    return { name, ok: false, latencyMs: Date.now() - started, error: String(err?.message || err).slice(0, 300) };
  }
}

/**
 * Turn the probe results into one light, plus the reasons behind it.
 *
 * Extracted and exported so the verdict can be tested without standing up an
 * authenticated admin request — it is the part with actual logic in it.
 *
 * `down` is reserved for the core: without Postgres or Redis the marketplace
 * itself is unusable. Everything else is `degraded`, because an operator has to
 * be able to tell "the whole app is down" from "AI is down" at a glance.
 */
export function statusVerdict({ database, redisStatus, aiService, queues, breakers }) {
  // An OPEN breaker means a dependency is being refused calls RIGHT NOW.
  // breakerStates() has existed and been exported since the breakers shipped and
  // nothing ever called it, so an open circuit on Gemini, Sarvam, Razorpay or
  // FastAPI was knowable and shown nowhere.
  const openBreakers = (breakers?.breakers || [])
    .filter((b) => b?.state === CIRCUIT_STATES.OPEN)
    .map((b) => b.name);

  // The AI service ANSWERING is not the same as the AI service WORKING: it
  // reports healthy with no Celery worker deployed, while every scan queues
  // forever. /health/details now carries that verdict, so honour it rather than
  // treating a 200 as proof.
  const scansStuck = aiService?.detail?.worker?.stuck === true;

  const coreOk = Boolean(database?.ok) && Boolean(redisStatus?.ok);
  if (!coreOk) return { overall: 'down', degradedBecause: [] };

  const degradedBecause = [
    ...(aiService?.ok ? [] : ['ai_service_unreachable']),
    ...(queues?.ok ? [] : ['queue_unavailable']),
    ...(scansStuck ? ['scans_queued_no_worker'] : []),
    ...openBreakers.map((n) => `breaker_open:${n}`),
  ];

  return {
    overall: degradedBecause.length ? 'degraded' : 'healthy',
    degradedBecause,
  };
}

statusRouter.get('/status', async (_req, res) => {
  try {
    const DAY = 24 * 60 * 60 * 1000;
    const [database, redisStatus, aiService, queues, budget, recentErrors, disabledFlags, breakers, realtime] = await Promise.all([
      probe('database', async () => {
        await prisma.$queryRaw`SELECT 1`;
        return {};
      }),
      probe('redis', async () => {
        const status = redis?.status ?? 'unavailable';
        if (status !== 'ready') throw new Error(`redis status: ${status}`);
        return { status };
      }),
      probe('aiService', async () => {
        const detail = await getSigned('/health/details', { timeoutMs: 4000 });
        return { detail };
      }),
      probe('queues', async () => ({ queues: await getQueueStats() })),
      probe('budget', async () => await getBudgetSummary()),
      // 5xx in the last 15 minutes — the fastest signal that something just broke.
      probe('errors', async () => ({
        last15m: await prisma.errorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } } }),
        last24h: await prisma.errorLog.count({ where: { createdAt: { gte: new Date(Date.now() - DAY) } } }),
      })),
      probe('flags', async () => {
        const off = await prisma.featureFlag.findMany({ where: { isEnabled: false }, select: { featureKey: true, disabledReason: true } });
        return { disabled: off };
      }),
      // Circuit-breaker state (claude.md §56). breakerStates() has existed and
      // been exported since the breakers shipped, and nothing had ever called
      // it — so an OPEN breaker on Gemini, Sarvam, Razorpay or FastAPI was
      // knowable and never shown anywhere. In-process, so no await and no
      // failure mode; the probe wrapper is kept only for a uniform shape.
      probe('breakers', async () => ({ breakers: breakerStates() })),
      // Two more counters that would otherwise be computed and shown nowhere,
      // which is how breakerStates() spent its whole life. Neither is a fault
      // on its own: sockets evicted means revocation is reaching live
      // connections, and jobs shed means the queue fail-open path is protecting
      // the request path. Both are rates an operator wants to see move.
      probe('realtime', async () => ({ socketReauth: reauthStats(), inlineQueue: inlineStats(), authCache: authCacheStats() })),
    ]);

    const { overall, degradedBecause } = statusVerdict({ database, redisStatus, aiService, queues, breakers });

    return sendSuccess(res, {
      overall,
      checkedAt: new Date().toISOString(),
      degradedBecause,
      checks: { database, redis: redisStatus, aiService, queues, budget, errors: recentErrors, flags: disabledFlags, breakers, realtime },
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load system status');
  }
});

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

export { flagsRouter, healthRouter, queuesRouter, jobsRouter, errorLogsRouter, statusRouter };
