/**
 * Admin Dashboard metrics — /api/v1/admin/metrics
 *
 * GET /metrics            — KPI roll-up (users, orders+GMV, bookings, AI, T&S, API health)
 * GET /metrics/timeseries — daily series for a single metric (signups|gmv|ai_tokens|ai_cost)
 *
 * Read-only. ADMIN gate + authenticate are applied by the parent admin router.
 */
import { Router } from 'express';
import { query } from 'express-validator';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError } from '../../utils/response.js';
import { getDashboardMetrics, getTimeseries } from '../../services/adminMetrics.service.js';

const router = Router();

router.get(
  '/',
  [query('days').optional().isInt({ min: 1, max: 365 })],
  validate,
  async (req, res) => {
    try {
      const metrics = await getDashboardMetrics({ days: req.query.days ? parseInt(req.query.days, 10) : 30 });
      return sendSuccess(res, metrics);
    } catch (err) {
      return sendServerError(res, err, 'Failed to load dashboard metrics');
    }
  },
);

router.get(
  '/timeseries',
  [
    query('metric').optional().isIn(['signups', 'gmv', 'ai_tokens', 'ai_cost']),
    query('days').optional().isInt({ min: 1, max: 365 }),
  ],
  validate,
  async (req, res) => {
    try {
      const series = await getTimeseries({
        metric: req.query.metric || 'signups',
        days: req.query.days ? parseInt(req.query.days, 10) : 30,
      });
      return sendSuccess(res, { metric: req.query.metric || 'signups', series });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load time-series');
    }
  },
);

export default router;
