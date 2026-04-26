/**
 * Feature Flag Routes (Admin)
 *
 * GET   /api/v1/admin/features          — list all flags
 * PATCH /api/v1/admin/features/:key     — enable / disable a feature
 * GET   /api/v1/health/apis             — external API health dashboard
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { invalidateCache } from '../services/featureFlag.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── Simple admin guard ────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return sendError(res, 'Admin access required', 403);
  next();
}

// ── GET /api/v1/admin/features ────────────────────────────────────────────────
router.get('/features', authenticate, requireAdmin, async (_req, res) => {
  const flags = await prisma.featureFlag.findMany({ orderBy: { featureKey: 'asc' } });
  return sendSuccess(res, flags);
});

// ── PATCH /api/v1/admin/features/:key ────────────────────────────────────────
router.patch('/features/:key', authenticate, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { isEnabled, disabledReason } = req.body;

  if (typeof isEnabled !== 'boolean') return sendError(res, 'isEnabled (boolean) is required', 400);

  const flag = await prisma.featureFlag.upsert({
    where:  { featureKey: key },
    create: {
      featureKey:    key,
      isEnabled,
      disabledReason: isEnabled ? null : (disabledReason || null),
      disabledAt:    isEnabled ? null : new Date(),
      enabledAt:     isEnabled ? new Date() : null,
      updatedBy:     req.user.id,
    },
    update: {
      isEnabled,
      disabledReason: isEnabled ? null : (disabledReason || null),
      disabledAt:    isEnabled ? null : new Date(),
      enabledAt:     isEnabled ? new Date() : null,
      updatedBy:     req.user.id,
    },
  });

  invalidateCache();
  return sendSuccess(res, flag);
});

// ── GET /api/v1/health/apis ───────────────────────────────────────────────────
router.get('/health/apis', authenticate, requireAdmin, async (req, res) => {
  const { hours = 24 } = req.query;
  const since = new Date(Date.now() - parseInt(hours, 10) * 60 * 60 * 1000);

  const logs = await prisma.aPIHealthLog.findMany({
    where:   { timestamp: { gte: since } },
    orderBy: { timestamp: 'desc' },
    take:    500,
  });

  // Summarise by source
  const summary = {};
  for (const log of logs) {
    if (!summary[log.source]) summary[log.source] = { success: 0, failure: 0, timeout: 0, rate_limited: 0, avgMs: 0, total: 0 };
    summary[log.source][log.status] = (summary[log.source][log.status] || 0) + 1;
    summary[log.source].total++;
    if (log.responseTimeMs) summary[log.source].avgMs += log.responseTimeMs;
  }
  for (const s of Object.values(summary)) {
    s.avgMs = s.total ? Math.round(s.avgMs / s.total) : 0;
    s.successRate = s.total ? Math.round((s.success / s.total) * 100) : 0;
  }

  return sendSuccess(res, { summary, recentLogs: logs.slice(0, 50) });
});

export default router;
