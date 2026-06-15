/**
 * Admin runtime settings — typed key/value config, AI model routing, env-status,
 * and the company AI budget rollup.
 *   GET   /admin/settings              grouped settings (secrets masked)
 *   PATCH /admin/settings/:key         set a non-secret setting (audited, type-validated)
 *   GET   /admin/settings/env-status   expected env vars: PRESENT / ABSENT only (never values)
 *   GET   /admin/settings/budget       company-wide AI token/cost vs the monthly budget cap
 *
 * ADMIN gate applied by the parent router. This surface NEVER reads or writes a
 * .env file on disk and NEVER returns a secret value — see services/settings.service.js.
 */
import { Router } from 'express';
import { body, param } from 'express-validator';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError } from '../../utils/response.js';
import { adminAudit } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import {
  listSettings,
  setSetting,
  getSetting,
  getEnvStatus,
  getBudgetSummary,
} from '../../services/settings.service.js';

const router = Router();

// Grouped settings (effective values; secrets shown as ••••).
router.get('/', async (_req, res) => {
  try {
    return sendSuccess(res, { groups: await listSettings() });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load settings');
  }
});

// Expected env vars — present/absent only. Static manifest read; no DB, no values.
router.get('/env-status', (_req, res) => {
  try {
    return sendSuccess(res, { groups: getEnvStatus() });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load environment status');
  }
});

// Company-wide AI spend / tokens vs the configured monthly budget cap.
router.get('/budget', async (_req, res) => {
  try {
    return sendSuccess(res, await getBudgetSummary());
  } catch (err) {
    return sendServerError(res, err, 'Failed to load AI budget');
  }
});

// Update one non-secret setting. Validated against its manifest type + audited.
router.patch(
  '/:key',
  [param('key').isString().trim().isLength({ min: 1, max: 100 }), body('value').exists()],
  validate,
  async (req, res) => {
    try {
      const { key } = req.params;
      const before = await getSetting(key).catch(() => undefined);
      const result = await setSetting(key, req.body.value, req.user.id);
      await adminAudit(req, ADMIN_ACTIONS.SETTING_UPDATE, 'AppSetting', key, {
        before: { value: before },
        after: { value: result.value },
      });
      return sendSuccess(res, { key, value: result.value });
    } catch (err) {
      return sendServerError(res, err, 'Failed to update setting');
    }
  },
);

export default router;
