/**
 * Admin Notification Templates — /api/v1/admin/notification-templates
 *
 * Reusable, multilingual push-notification templates. titleI18n / bodyI18n carry
 * the 9 supported languages (en + hi/mr/ta/kn/ml/te/bn/gu/pa) as JSON maps keyed
 * by language code; a broadcast may resolve its title/body from a template `key`.
 *
 *   GET    /                 keyset list (filter ?category= & ?isActive=)
 *   POST   /                 create (duplicate key → 409 P2002)
 *   PATCH  /:id              update (key immutable)
 *   DELETE /:id              soft-delete (isActive = false)
 *
 * ADMIN gate + CONTENT_MODERATOR scope applied by the parent router. Mutations
 * audited via adminAudit + NOTIFICATION_TEMPLATE_* actions.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendCreated, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

const router = Router();

// The 9 supported app languages (en is the canonical fallback).
export const SUPPORTED_LANGS = ['en', 'hi', 'mr', 'ta', 'kn', 'ml', 'te', 'bn', 'gu', 'pa'];

/**
 * Validate an i18n map: a plain object keyed by supported language codes whose
 * values are non-empty strings, with `en` REQUIRED (the resolver's fallback).
 * Keeps the JSON shape consistent across templates (mirrors the per-column 9-lang
 * pattern used by Category / GovernmentScheme, expressed here as a JSON map).
 */
function validI18n(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('must be an object of { lang: text }');
  }
  const keys = Object.keys(value);
  if (!keys.length) throw new Error('must include at least the English (en) text');
  for (const k of keys) {
    if (!SUPPORTED_LANGS.includes(k)) throw new Error(`unsupported language code: ${k}`);
    if (typeof value[k] !== 'string' || !value[k].trim()) throw new Error(`text for "${k}" must be a non-empty string`);
    if (value[k].length > 1000) throw new Error(`text for "${k}" is too long (max 1000)`);
  }
  if (!value.en || !String(value.en).trim()) throw new Error('English (en) text is required');
  return true;
}

router.get(
  '/',
  [
    query('category').optional().isString().isLength({ max: 60 }),
    query('isActive').optional().isBoolean(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.category) where.category = req.query.category;
      if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.notificationTemplate, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load notification templates');
    }
  },
);

router.post(
  '/',
  [
    body('key').isString().trim().isLength({ min: 2, max: 80 }).matches(/^[a-z0-9._-]+$/i).withMessage('key may contain only letters, digits, dot, dash, underscore'),
    body('category').optional().isString().trim().isLength({ min: 1, max: 60 }),
    body('isActive').optional().isBoolean(),
    body('titleI18n').custom(validI18n),
    body('bodyI18n').custom(validI18n),
  ],
  validate,
  async (req, res) => {
    try {
      const created = await prisma.notificationTemplate.create({
        data: {
          key: req.body.key.trim(),
          titleI18n: req.body.titleI18n,
          bodyI18n: req.body.bodyI18n,
          category: req.body.category?.trim() || 'general',
          isActive: req.body.isActive ?? true,
          createdBy: req.user?.id ?? null,
        },
      });
      await adminAudit(req, ADMIN_ACTIONS.NOTIFICATION_TEMPLATE_CREATE, 'NotificationTemplate', created.id, { after: { key: created.key, category: created.category } });
      return sendCreated(res, created);
    } catch (err) {
      if (err?.code === 'P2002') return sendServerError(res, Object.assign(new Error('A template with that key already exists'), { expose: true }), 'Duplicate template key', 409);
      return sendServerError(res, err, 'Failed to create notification template');
    }
  },
);

router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('category').optional().isString().trim().isLength({ min: 1, max: 60 }),
    body('isActive').optional().isBoolean(),
    body('titleI18n').optional().custom(validI18n),
    body('bodyI18n').optional().custom(validI18n),
  ],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.notificationTemplate.findUnique({ where: { id: req.params.id }, select: { id: true, key: true, category: true, isActive: true } });
      if (!before) return sendNotFound(res, 'Notification template');
      // key is immutable (it is the broadcast lookup handle).
      const data = {};
      if (req.body.titleI18n !== undefined) data.titleI18n = req.body.titleI18n;
      if (req.body.bodyI18n !== undefined) data.bodyI18n = req.body.bodyI18n;
      if (req.body.category !== undefined) data.category = req.body.category.trim();
      if (req.body.isActive !== undefined) data.isActive = req.body.isActive;
      const updated = await prisma.notificationTemplate.update({ where: { id: req.params.id }, data });
      await adminAudit(req, ADMIN_ACTIONS.NOTIFICATION_TEMPLATE_UPDATE, 'NotificationTemplate', updated.id, { before, after: { category: updated.category, isActive: updated.isActive } });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update notification template');
    }
  },
);

// Soft delete: deactivate so historical BroadcastLog rows keep resolving the key.
router.delete('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const before = await prisma.notificationTemplate.findUnique({ where: { id: req.params.id }, select: { id: true, key: true, isActive: true } });
    if (!before) return sendNotFound(res, 'Notification template');
    await prisma.notificationTemplate.update({ where: { id: req.params.id }, data: { isActive: false } });
    await adminAudit(req, ADMIN_ACTIONS.NOTIFICATION_TEMPLATE_DELETE, 'NotificationTemplate', before.id, { before, after: { isActive: false }, metadata: { mode: 'soft-deactivate' } });
    return sendSuccess(res, { id: before.id, isActive: false });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete notification template');
  }
});

export default router;
