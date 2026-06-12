/**
 * Admin Broadcast — /api/v1/admin/notifications
 *
 * GET  /notifications/preview   estimate the audience for a target filter
 * POST /notifications           send a notification to a targeted audience
 *                               (district / state / role / crop), or dry-run
 *
 * ADMIN gate applied by the parent router. Sends are audited (target + count).
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError } from '../../utils/response.js';
import { adminAudit } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { estimateAudience, broadcastNotification } from '../../services/adminBroadcast.service.js';

const router = Router();

const ROLES = ['FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER', 'ADMIN', 'SELLER'];

function filtersFrom(src) {
  return {
    district: src.district || undefined,
    state: src.state || undefined,
    role: src.role || undefined,
    crop: src.crop || undefined,
  };
}

router.get(
  '/preview',
  [query('district').optional().isString().isLength({ max: 60 }), query('state').optional().isString().isLength({ max: 60 }), query('role').optional().isIn(ROLES), query('crop').optional().isString().isLength({ max: 60 })],
  validate,
  async (req, res) => {
    try {
      const estimated = await estimateAudience(filtersFrom(req.query));
      return sendSuccess(res, { estimated });
    } catch (err) {
      return sendServerError(res, err, 'Failed to estimate audience');
    }
  },
);

router.post(
  '/',
  [
    body('title').isString().trim().isLength({ min: 2, max: 120 }),
    body('body').isString().trim().isLength({ min: 2, max: 1000 }),
    body('district').optional().isString().isLength({ max: 60 }),
    body('state').optional().isString().isLength({ max: 60 }),
    body('role').optional().isIn(ROLES),
    body('crop').optional().isString().isLength({ max: 60 }),
    body('dryRun').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const filters = filtersFrom(req.body);
      if (req.body.dryRun === true) {
        const estimated = await estimateAudience(filters);
        return sendSuccess(res, { dryRun: true, estimated, sent: 0 });
      }
      const result = await broadcastNotification({
        filters, type: 'SYSTEM', title: req.body.title, body: req.body.body,
        data: { kind: 'admin_broadcast' },
      });
      await adminAudit(req, ADMIN_ACTIONS.BROADCAST_SEND, 'Notification', 'broadcast', {
        after: { title: req.body.title, sent: result.sent, estimated: result.estimated, capped: result.capped },
        metadata: { filters },
      });
      return sendSuccess(res, result);
    } catch (err) {
      return sendServerError(res, err, 'Failed to send broadcast');
    }
  },
);

export default router;
