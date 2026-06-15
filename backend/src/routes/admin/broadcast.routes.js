/**
 * Admin Broadcast — /api/v1/admin/notifications
 *
 * GET  /notifications/preview   estimate the audience for a target filter
 * POST /notifications           send a notification to a targeted audience
 *                               (district / state / role / crop), or dry-run.
 *                               Optional `templateKey` resolves title/body from a
 *                               NotificationTemplate (target `lang`, 'en' fallback).
 * GET  /notifications/history   keyset list of BroadcastLog (recent sends + counts)
 *
 * ADMIN gate + CONTENT_MODERATOR scope applied by the parent router. Sends are
 * audited (target + count) and recorded as a BroadcastLog history row.
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError } from '../../utils/response.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { estimateAudience, broadcastNotification } from '../../services/adminBroadcast.service.js';
import { keysetList } from '../../utils/adminList.js';
import { SUPPORTED_LANGS } from './notificationTemplates.routes.js';

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

/** Pick a language from an i18n JSON map, falling back to English ('en'). */
function pickLang(map, lang) {
  if (!map || typeof map !== 'object') return null;
  const value = map[lang] ?? map.en;
  return typeof value === 'string' && value.trim() ? value : null;
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

// Recent broadcasts with real estimated/sent/failed counts (delivery history).
router.get(
  '/history',
  [query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.broadcastLog, { where: {}, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load broadcast history');
    }
  },
);

router.post(
  '/',
  [
    // title/body are required UNLESS a templateKey resolves them (checked below).
    body('title').optional().isString().trim().isLength({ min: 2, max: 120 }),
    body('body').optional().isString().trim().isLength({ min: 2, max: 1000 }),
    body('templateKey').optional().isString().trim().isLength({ min: 2, max: 80 }),
    body('lang').optional().isIn(SUPPORTED_LANGS),
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
      const templateKey = req.body.templateKey?.trim() || null;

      // Resolve title/body. A template supplies them (target `lang`, 'en'
      // fallback); when the broadcast targets multiple languages we default to
      // 'en'. An explicit title/body in the request always wins over the template.
      let { title, body: msgBody } = req.body;
      if (templateKey) {
        const tpl = await prisma.notificationTemplate.findUnique({ where: { key: templateKey } });
        if (!tpl) return sendServerError(res, Object.assign(new Error(`Template "${templateKey}" not found`), { expose: true }), 'Unknown template', 404);
        if (!tpl.isActive) return sendServerError(res, Object.assign(new Error(`Template "${templateKey}" is inactive`), { expose: true }), 'Inactive template', 409);
        const lang = req.body.lang || 'en'; // multi-language audiences default to 'en'
        title = title || pickLang(tpl.titleI18n, lang);
        msgBody = msgBody || pickLang(tpl.bodyI18n, lang);
      }

      if (!title || !String(title).trim() || !msgBody || !String(msgBody).trim()) {
        return sendServerError(res, Object.assign(new Error('A title and body are required (provide them or a resolvable templateKey)'), { expose: true }), 'Missing message', 400);
      }

      if (req.body.dryRun === true) {
        const estimated = await estimateAudience(filters);
        return sendSuccess(res, { dryRun: true, estimated, sent: 0, title, body: msgBody, templateKey });
      }

      const result = await broadcastNotification({
        filters, type: 'SYSTEM', title, body: msgBody,
        data: { kind: 'admin_broadcast', ...(templateKey ? { templateKey } : {}) },
        log: true, sentBy: req.user?.id ?? null, templateKey,
      });
      await adminAudit(req, ADMIN_ACTIONS.BROADCAST_SEND, 'BroadcastLog', result.logId ?? 'broadcast', {
        after: { title, sent: result.sent, failed: result.failed, estimated: result.estimated, capped: result.capped, templateKey },
        metadata: { filters },
      });
      return sendSuccess(res, { ...result, title, body: msgBody, templateKey });
    } catch (err) {
      return sendServerError(res, err, 'Failed to send broadcast');
    }
  },
);

export default router;
