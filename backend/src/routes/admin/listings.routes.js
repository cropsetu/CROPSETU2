/**
 * Admin Rentals & Trade listings — animals, machinery, labour + bookings.
 *   /api/v1/admin/animals    GET list / PATCH (verified, status)
 *   /api/v1/admin/machinery  GET list / PATCH (status, available)
 *   /api/v1/admin/labour     GET list / PATCH (status, available)
 *   /api/v1/admin/bookings   GET list (filter status / type)
 *
 * ADMIN gate applied by the parent router. PATCHes audited as ADMIN_LISTING_UPDATE.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { sanitizeSearch } from '../../utils/sanitizeSearch.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

const LISTING_STATUSES = ['ACTIVE', 'SOLD', 'RENTED', 'INACTIVE'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

// ── Animals ───────────────────────────────────────────────────────────────────
export const animalsRouter = Router();

animalsRouter.get(
  '/',
  [query('status').optional().isIn(LISTING_STATUSES), query('verified').optional().isBoolean(), query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.verified !== undefined) where.verified = req.query.verified === 'true';
      const search = sanitizeSearch(req.query.search);
      if (search) where.OR = [{ animal: { contains: search, mode: 'insensitive' } }, { breed: { contains: search, mode: 'insensitive' } }, { sellerLocation: { contains: search, mode: 'insensitive' } }];
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.animalListing, { where, cursor, limit, include: { seller: { select: { id: true, name: true } } } });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load animal listings');
    }
  },
);

animalsRouter.patch(
  '/:id',
  [param('id').isUUID(), body('verified').optional().isBoolean(), body('status').optional().isIn(LISTING_STATUSES), body('reason').optional().isString().trim().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.animalListing.findUnique({ where: { id: req.params.id }, select: { id: true, verified: true, status: true } });
      if (!before) return sendNotFound(res, 'Animal listing');
      const data = {};
      if (req.body.verified !== undefined) data.verified = req.body.verified;
      if (req.body.status !== undefined) data.status = req.body.status;
      if (!Object.keys(data).length) return sendServerError(res, Object.assign(new Error('Provide verified or status'), { expose: true }), 'Nothing to update', 400);
      const updated = await prisma.animalListing.update({ where: { id: req.params.id }, data, select: { id: true, verified: true, status: true } });
      await adminAudit(req, ADMIN_ACTIONS.LISTING_UPDATE, 'AnimalListing', updated.id, { before, after: updated, metadata: { reason: req.body.reason ?? null } });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update animal listing');
    }
  },
);

// ── Generic owner-listing (machinery / labour) ───────────────────────────────
function ownerListingRouter({ model, entity, ownerRel, searchFields }) {
  const r = Router();
  r.get(
    '/',
    [query('status').optional().isIn(LISTING_STATUSES), query('available').optional().isBoolean(), query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
    validate,
    async (req, res) => {
      try {
        const where = {};
        if (req.query.status) where.status = req.query.status;
        if (req.query.available !== undefined) where.available = req.query.available === 'true';
        const search = sanitizeSearch(req.query.search);
        if (search) where.OR = searchFields.map((f) => ({ [f]: { contains: search, mode: 'insensitive' } }));
        const { cursor, limit } = listParams(req);
        const page = await keysetList(model, { where, cursor, limit, include: { [ownerRel]: { select: { id: true, name: true } } } });
        return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
      } catch (err) {
        return sendServerError(res, err, `Failed to load ${entity} listings`);
      }
    },
  );
  r.patch(
    '/:id',
    [param('id').isUUID(), body('status').optional().isIn(LISTING_STATUSES), body('available').optional().isBoolean(), body('reason').optional().isString().trim().isLength({ max: 500 })],
    validate,
    async (req, res) => {
      try {
        const before = await model.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, available: true } });
        if (!before) return sendNotFound(res, `${entity} listing`);
        const data = {};
        if (req.body.status !== undefined) data.status = req.body.status;
        if (req.body.available !== undefined) data.available = req.body.available;
        if (!Object.keys(data).length) return sendServerError(res, Object.assign(new Error('Provide status or available'), { expose: true }), 'Nothing to update', 400);
        const updated = await model.update({ where: { id: req.params.id }, data, select: { id: true, status: true, available: true } });
        await adminAudit(req, ADMIN_ACTIONS.LISTING_UPDATE, entity, updated.id, { before, after: updated, metadata: { reason: req.body.reason ?? null } });
        return sendSuccess(res, updated);
      } catch (err) {
        return sendServerError(res, err, `Failed to update ${entity} listing`);
      }
    },
  );
  return r;
}

export const machineryRouter = ownerListingRouter({
  model: prisma.machineryListing, entity: 'MachineryListing', ownerRel: 'owner',
  searchFields: ['name', 'brand', 'description', 'location'],
});

export const labourRouter = ownerListingRouter({
  model: prisma.labourListing, entity: 'LabourListing', ownerRel: 'provider',
  searchFields: ['name', 'leader', 'description', 'location'],
});

// ── Bookings ──────────────────────────────────────────────────────────────────
export const bookingsRouter = Router();

bookingsRouter.get(
  '/',
  [query('status').optional().isIn(BOOKING_STATUSES), query('type').optional().isIn(['machinery', 'labour']), query('userId').optional().isUUID(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.userId) where.userId = req.query.userId;
      if (req.query.type === 'machinery') where.machineryListingId = { not: null };
      if (req.query.type === 'labour') where.labourListingId = { not: null };
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.booking, {
        where, cursor, limit,
        include: {
          user: { select: { id: true, name: true } },
          machineryListing: { select: { id: true, name: true } },
          labourListing: { select: { id: true, groupName: true, name: true } },
        },
      });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load bookings');
    }
  },
);
