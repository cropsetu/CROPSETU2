/**
 * Admin CMS — government schemes, MSP rates, crop master, pest alerts, mandi sync.
 *   /api/v1/admin/schemes      CRUD (multilingual; soft-delete via isActive)
 *   /api/v1/admin/msp          CRUD (MSPRate)
 *   /api/v1/admin/crop-master  CRUD (CropMaster)
 *   /api/v1/admin/pest-alerts  GET / POST (+ optional region broadcast) / PATCH
 *   /api/v1/admin/mandi/sync   GET status / POST trigger
 *
 * ADMIN gate applied by the parent router. Mutations audited.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendCreated, sendServerError, sendNotFound } from '../../utils/response.js';
import { sanitizeSearch } from '../../utils/sanitizeSearch.js';
import { stripHtml } from '../../utils/encrypt.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { broadcastNotification } from '../../services/adminBroadcast.service.js';

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// ── Government Schemes ────────────────────────────────────────────────────────
export const schemesRouter = Router();
const SCHEME_FIELDS = ['schemeCode', 'schemeName', 'schemeNameHi', 'schemeNameMr', 'ministry', 'type', 'state', 'description', 'benefitsSummary', 'eligibility', 'documentsReq', 'applicationUrl', 'helpline', 'benefitAmount', 'benefitType', 'deadline', 'isActive', 'fullText'];

schemesRouter.get(
  '/',
  [query('type').optional().isString().isLength({ max: 60 }), query('state').optional().isString().isLength({ max: 60 }), query('isActive').optional().isBoolean(), query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.type) where.type = req.query.type;
      if (req.query.state) where.state = req.query.state;
      if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
      const search = sanitizeSearch(req.query.search);
      if (search) where.OR = [{ schemeName: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.governmentScheme, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load schemes');
    }
  },
);

schemesRouter.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const scheme = await prisma.governmentScheme.findUnique({ where: { id: req.params.id } });
    if (!scheme) return sendNotFound(res, 'Scheme');
    return sendSuccess(res, scheme);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load scheme');
  }
});

schemesRouter.post(
  '/',
  [
    body('schemeCode').isString().trim().isLength({ min: 2, max: 60 }),
    body('schemeName').isString().trim().isLength({ min: 2, max: 200 }),
    body('type').isString().trim().isLength({ min: 2, max: 60 }),
    body('description').isString().trim().isLength({ min: 2, max: 5000 }),
    body('benefitsSummary').isString().trim().isLength({ min: 2, max: 2000 }),
    body('benefitType').isString().trim().isLength({ min: 1, max: 60 }),
    body('eligibility').optional().isObject(),
    body('documentsReq').optional().isArray(),
    body('benefitAmount').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    try {
      const data = pick(req.body, SCHEME_FIELDS);
      data.eligibility = req.body.eligibility ?? {};
      data.documentsReq = req.body.documentsReq ?? [];
      const created = await prisma.governmentScheme.create({ data });
      await adminAudit(req, ADMIN_ACTIONS.SCHEME_CREATE, 'GovernmentScheme', created.id, { after: { schemeCode: created.schemeCode, schemeName: created.schemeName } });
      return sendCreated(res, created);
    } catch (err) {
      if (err?.code === 'P2002') return sendServerError(res, Object.assign(new Error('schemeCode already exists'), { expose: true }), 'Duplicate scheme', 409);
      return sendServerError(res, err, 'Failed to create scheme');
    }
  },
);

schemesRouter.patch('/:id', [param('id').isUUID(), body('benefitAmount').optional({ nullable: true }).isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const before = await prisma.governmentScheme.findUnique({ where: { id: req.params.id }, select: { id: true, schemeName: true, isActive: true } });
    if (!before) return sendNotFound(res, 'Scheme');
    const data = pick(req.body, SCHEME_FIELDS.filter((f) => f !== 'schemeCode'));
    const updated = await prisma.governmentScheme.update({ where: { id: req.params.id }, data });
    await adminAudit(req, ADMIN_ACTIONS.SCHEME_UPDATE, 'GovernmentScheme', updated.id, { before, after: { schemeName: updated.schemeName, isActive: updated.isActive } });
    return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update scheme');
  }
});

// Soft delete: deactivate (SchemeApplication cascades on hard delete — keep them).
schemesRouter.delete('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const before = await prisma.governmentScheme.findUnique({ where: { id: req.params.id }, select: { id: true, isActive: true } });
    if (!before) return sendNotFound(res, 'Scheme');
    await prisma.governmentScheme.update({ where: { id: req.params.id }, data: { isActive: false } });
    await adminAudit(req, ADMIN_ACTIONS.SCHEME_DELETE, 'GovernmentScheme', before.id, { before, after: { isActive: false }, metadata: { mode: 'soft-deactivate' } });
    return sendSuccess(res, { id: before.id, isActive: false });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete scheme');
  }
});

// ── MSP Rates ─────────────────────────────────────────────────────────────────
export const mspRouter = Router();
const MSP_FIELDS = ['commodity', 'commodityHi', 'season', 'year', 'mspPrice', 'previousYearMSP', 'increasePercent', 'bonusIfAny', 'procurementAgency', 'procurementStartDate', 'procurementEndDate'];

mspRouter.get(
  '/',
  [query('season').optional().isString().isLength({ max: 30 }), query('year').optional().isString().isLength({ max: 12 }), query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.season) where.season = req.query.season;
      if (req.query.year) where.year = req.query.year;
      const search = sanitizeSearch(req.query.search);
      if (search) where.commodity = { contains: search, mode: 'insensitive' };
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.mSPRate, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load MSP rates');
    }
  },
);

mspRouter.post(
  '/',
  [body('commodity').isString().trim().isLength({ min: 1, max: 120 }), body('season').isString().trim().isLength({ min: 1, max: 30 }), body('year').isString().trim().isLength({ min: 1, max: 12 }), body('mspPrice').isFloat({ min: 0 })],
  validate,
  async (req, res) => {
    try {
      const created = await prisma.mSPRate.create({ data: pick(req.body, MSP_FIELDS) });
      await adminAudit(req, ADMIN_ACTIONS.MSP_CREATE, 'MSPRate', created.id, { after: { commodity: created.commodity, season: created.season, year: created.year } });
      return sendCreated(res, created);
    } catch (err) {
      if (err?.code === 'P2002') return sendServerError(res, Object.assign(new Error('An MSP rate for that commodity/season/year already exists'), { expose: true }), 'Duplicate MSP rate', 409);
      return sendServerError(res, err, 'Failed to create MSP rate');
    }
  },
);

mspRouter.patch('/:id', [param('id').isUUID(), body('mspPrice').optional().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const before = await prisma.mSPRate.findUnique({ where: { id: req.params.id }, select: { id: true, commodity: true, mspPrice: true } });
    if (!before) return sendNotFound(res, 'MSP rate');
    const updated = await prisma.mSPRate.update({ where: { id: req.params.id }, data: pick(req.body, MSP_FIELDS) });
    await adminAudit(req, ADMIN_ACTIONS.MSP_UPDATE, 'MSPRate', updated.id, { before, after: { mspPrice: updated.mspPrice } });
    return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update MSP rate');
  }
});

mspRouter.delete('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const before = await prisma.mSPRate.findUnique({ where: { id: req.params.id }, select: { id: true, commodity: true } });
    if (!before) return sendNotFound(res, 'MSP rate');
    await prisma.mSPRate.delete({ where: { id: req.params.id } });
    await adminAudit(req, ADMIN_ACTIONS.MSP_DELETE, 'MSPRate', before.id, { before });
    return sendSuccess(res, { id: before.id, deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete MSP rate');
  }
});

// ── Crop Master ───────────────────────────────────────────────────────────────
export const cropMasterRouter = Router();
const CROP_FIELDS = ['name', 'nameHi', 'nameMr', 'category', 'seasons', 'maturityDays', 'varieties', 'seedRate', 'spacing', 'fertilizerSchedule', 'irrigationSchedule', 'commonPests', 'commonDiseases', 'harvestIndicators', 'mspCommodityCode', 'agmarknetCode', 'kcInitial', 'kcMid', 'kcLate'];

cropMasterRouter.get(
  '/',
  [query('category').optional().isString().isLength({ max: 60 }), query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.category) where.category = req.query.category;
      const search = sanitizeSearch(req.query.search);
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.cropMaster, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load crop master');
    }
  },
);

cropMasterRouter.post(
  '/',
  [body('name').isString().trim().isLength({ min: 1, max: 120 }), body('nameHi').isString().trim().isLength({ min: 1, max: 120 }), body('category').isString().trim().isLength({ min: 1, max: 60 })],
  validate,
  async (req, res) => {
    try {
      const created = await prisma.cropMaster.create({ data: pick(req.body, CROP_FIELDS) });
      await adminAudit(req, ADMIN_ACTIONS.CROP_MASTER_CREATE, 'CropMaster', created.id, { after: { name: created.name } });
      return sendCreated(res, created);
    } catch (err) {
      if (err?.code === 'P2002') return sendServerError(res, Object.assign(new Error('A crop with that name already exists'), { expose: true }), 'Duplicate crop', 409);
      return sendServerError(res, err, 'Failed to create crop');
    }
  },
);

cropMasterRouter.patch('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const before = await prisma.cropMaster.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!before) return sendNotFound(res, 'Crop');
    const updated = await prisma.cropMaster.update({ where: { id: req.params.id }, data: pick(req.body, CROP_FIELDS.filter((f) => f !== 'name')) });
    await adminAudit(req, ADMIN_ACTIONS.CROP_MASTER_UPDATE, 'CropMaster', updated.id, { before, after: { name: updated.name } });
    return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update crop');
  }
});

cropMasterRouter.delete('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const before = await prisma.cropMaster.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!before) return sendNotFound(res, 'Crop');
    await prisma.cropMaster.delete({ where: { id: req.params.id } });
    await adminAudit(req, ADMIN_ACTIONS.CROP_MASTER_DELETE, 'CropMaster', before.id, { before });
    return sendSuccess(res, { id: before.id, deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete crop');
  }
});

// ── Pest Alerts ───────────────────────────────────────────────────────────────
export const pestAlertsRouter = Router();

pestAlertsRouter.get(
  '/',
  [query('state').optional().isString().isLength({ max: 60 }), query('isActive').optional().isBoolean(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.state) where.state = req.query.state;
      if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.pestAlert, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load pest alerts');
    }
  },
);

pestAlertsRouter.post(
  '/',
  [
    body('pest').isString().trim().isLength({ min: 1, max: 120 }),
    body('severity').isString().trim().isLength({ min: 1, max: 30 }),
    body('state').isString().trim().isLength({ min: 1, max: 60 }),
    body('validUntil').isISO8601(),
    body('affectedCrops').optional().isArray(),
    body('districts').optional().isArray(),
    body('broadcast').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const data = pick(req.body, ['pest', 'pestHi', 'affectedCrops', 'severity', 'state', 'districts', 'lat', 'lng', 'radiusKm', 'symptoms', 'solutions', 'triggerConditions', 'source', 'isActive']);
      data.affectedCrops = req.body.affectedCrops ?? [];
      data.districts = req.body.districts ?? [];
      data.validUntil = new Date(req.body.validUntil);
      if (req.body.validFrom) data.validFrom = new Date(req.body.validFrom);
      data.source = req.body.source ?? 'manual';

      const created = await prisma.pestAlert.create({ data });

      let broadcast = null;
      if (req.body.broadcast === true) {
        // Region broadcast: notify users in the alert's state (+ districts if given).
        const district = data.districts.length === 1 ? data.districts[0] : undefined;
        broadcast = await broadcastNotification({
          filters: { state: data.state, district },
          type: 'SYSTEM',
          title: `Pest alert: ${created.pest}`,
          body: `${created.severity} severity ${created.pest} reported in ${created.state}. Check recommended action in the app.`,
          data: { kind: 'pest_alert', pestAlertId: created.id },
        });
      }

      await adminAudit(req, ADMIN_ACTIONS.PEST_ALERT_CREATE, 'PestAlert', created.id, { after: { pest: created.pest, state: created.state }, metadata: { broadcast: broadcast ?? null } });
      return sendCreated(res, { alert: created, broadcast });
    } catch (err) {
      return sendServerError(res, err, 'Failed to create pest alert');
    }
  },
);

pestAlertsRouter.patch('/:id', [param('id').isUUID(), body('isActive').optional().isBoolean()], validate, async (req, res) => {
  try {
    const before = await prisma.pestAlert.findUnique({ where: { id: req.params.id }, select: { id: true, isActive: true, pest: true } });
    if (!before) return sendNotFound(res, 'Pest alert');
    const data = pick(req.body, ['isActive', 'severity', 'validUntil']);
    if (data.validUntil) data.validUntil = new Date(data.validUntil);
    const updated = await prisma.pestAlert.update({ where: { id: req.params.id }, data });
    await adminAudit(req, ADMIN_ACTIONS.PEST_ALERT_UPDATE, 'PestAlert', updated.id, { before, after: { isActive: updated.isActive } });
    return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update pest alert');
  }
});

// ── Mandi price-sync status + trigger ────────────────────────────────────────
export const mandiRouter = Router();

mandiRouter.get('/sync', [query('limit').optional().isInt({ min: 1, max: 100 })], validate, async (req, res) => {
  try {
    const take = req.query.limit ? parseInt(req.query.limit, 10) : 25;
    const items = await prisma.priceDataSync.findMany({ orderBy: { startedAt: 'desc' }, take });
    return sendSuccess(res, { items });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load sync status');
  }
});

// Records a manual sync trigger. Wiring the actual data.gov.in fetch worker to
// this record is a follow-up; the row gives ops a visible, audited trigger point.
mandiRouter.post('/sync', [body('state').optional().isString().isLength({ max: 60 }), body('commodity').optional().isString().isLength({ max: 120 })], validate, async (req, res) => {
  try {
    const row = await prisma.priceDataSync.create({
      data: { syncType: 'manual', state: req.body.state ?? null, commodity: req.body.commodity ?? null, status: 'queued' },
    });
    await adminAudit(req, ADMIN_ACTIONS.MANDI_SYNC_TRIGGER, 'PriceDataSync', row.id, { after: { syncType: 'manual', state: row.state, commodity: row.commodity } });
    return sendCreated(res, row);
  } catch (err) {
    return sendServerError(res, err, 'Failed to trigger mandi sync');
  }
});
