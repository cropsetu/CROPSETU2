/**
 * Fraud review routes (Admin) — surfaces fraud signals for human review.
 *
 * GET /api/v1/admin/fraud/device-clusters
 *     ?minAccounts=&days=&limit=
 *     Device fingerprints that back several distinct accounts (FRAUD-3
 *     multi-account detection), newest activity first. This is the "pull" review
 *     surface; flagged clusters are also "pushed" as FRAUD security incidents.
 */
import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError } from '../utils/response.js';
import logger from '../utils/logger.js';
import { listDeviceClusters } from '../services/deviceLink.service.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return sendError(res, 'Admin access required', 403);
  next();
}

router.use(authenticate, requireAdmin);

// ── GET /device-clusters ─────────────────────────────────────────────────────
router.get(
  '/device-clusters',
  [
    query('minAccounts').optional().isInt({ min: 2, max: 100 }),
    query('days').optional().isInt({ min: 1, max: 365 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  async (req, res) => {
    try {
      const clusters = await listDeviceClusters({
        minAccounts:  req.query.minAccounts ? parseInt(req.query.minAccounts, 10) : undefined,
        lookbackDays: req.query.days ? parseInt(req.query.days, 10) : undefined,
        limit:        req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      });
      return sendSuccess(res, { clusters });
    } catch (err) {
      logger.error({ err }, '[Fraud] GET /device-clusters error');
      return sendError(res, 'Failed to load device clusters', 500);
    }
  }
);

export default router;
