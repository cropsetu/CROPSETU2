/**
 * Admin Disputes — /api/v1/admin/disputes  (scope: CONTENT_MODERATOR)
 *
 * GET   /disputes        list (keyset; filter ?type= & ?status=)
 * GET   /disputes/:id    detail + linked context resolved by type+refId:
 *                          ANIMAL_TRADE → the Chat + recent ChatMessages
 *                          RENT_BOOKING → the Booking
 *                          ORDER        → the Order + items
 *                        — all with PII masked (phones via maskPhone).
 * POST  /disputes        create (admin/support opens a case)         — audited
 * PATCH /disputes/:id    assign / change status / set resolution     — audited
 *
 * ADMIN gate + authenticate applied by the parent admin router; this sub-router is
 * additionally gated behind requireScope(CONTENT_MODERATOR) at mount. Mutations
 * audited as ADMIN_DISPUTE_CREATE / ADMIN_DISPUTE_UPDATE.
 *
 * NOTE: there is no user-facing "raise a dispute" flow yet — cases are created by
 * admins/support through POST /disputes (or a future user endpoint). Disputes
 * reference the underlying transaction by a loose `refId` (NOT a hard FK), so a
 * case survives deletion of the thing it points at.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendCreated, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { maskPhone } from '../../utils/adminPii.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

const router = Router();

const DISPUTE_TYPES = ['ANIMAL_TRADE', 'RENT_BOOKING', 'ORDER'];
const DISPUTE_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'];

/** Mask the phone on a {id,name,phone} user summary (PII) — null-safe. */
function maskUser(u) {
  if (!u) return null;
  return { ...u, phone: maskPhone(u.phone) };
}

/** Mask the phone inside a delivery-address JSON blob (PII). */
function maskAddress(addr) {
  if (!addr || typeof addr !== 'object') return addr;
  const out = { ...addr };
  if (out.phone) out.phone = maskPhone(String(out.phone));
  return out;
}

/**
 * Resolve the linked transaction context for a dispute, with PII masked. Returns
 * { kind, ... } or { kind: 'unknown', refId } when the referenced row is gone
 * (refId is a loose pointer, not a FK — the target may have been deleted).
 */
async function resolveContext(dispute) {
  const { type, refId } = dispute;

  if (type === 'ANIMAL_TRADE') {
    // refId is a Chat id (the animal-trade marketplace conversation). Fall back to
    // treating refId as an AnimalListing id if no chat matches.
    const chat = await prisma.chat.findUnique({
      where: { id: refId },
      include: {
        listing: { select: { id: true, animal: true, breed: true, price: true, status: true, sellerLocation: true } },
        buyer: { select: { id: true, name: true, phone: true } },
        seller: { select: { id: true, name: true, phone: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, senderId: true, text: true, imageUrl: true, readAt: true, createdAt: true } },
      },
    });
    if (chat) {
      return {
        kind: 'chat',
        chat: {
          id: chat.id, listingId: chat.listingId, createdAt: chat.createdAt, updatedAt: chat.updatedAt,
          listing: chat.listing,
          buyer: maskUser(chat.buyer),
          seller: maskUser(chat.seller),
          // Oldest-first for display.
          messages: [...chat.messages].reverse(),
        },
      };
    }
    const listing = await prisma.animalListing.findUnique({
      where: { id: refId },
      include: { seller: { select: { id: true, name: true, phone: true } } },
    });
    if (listing) {
      return { kind: 'listing', listing: { ...listing, seller: maskUser(listing.seller) } };
    }
    return { kind: 'unknown', refId };
  }

  if (type === 'RENT_BOOKING') {
    const booking = await prisma.booking.findUnique({
      where: { id: refId },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        machineryListing: { select: { id: true, name: true, owner: { select: { id: true, name: true, phone: true } } } },
        labourListing: { select: { id: true, groupName: true, name: true, provider: { select: { id: true, name: true, phone: true } } } },
      },
    });
    if (!booking) return { kind: 'unknown', refId };
    return {
      kind: 'booking',
      booking: {
        ...booking,
        user: maskUser(booking.user),
        machineryListing: booking.machineryListing
          ? { ...booking.machineryListing, owner: maskUser(booking.machineryListing.owner) }
          : null,
        labourListing: booking.labourListing
          ? { ...booking.labourListing, provider: maskUser(booking.labourListing.provider) }
          : null,
      },
    };
  }

  if (type === 'ORDER') {
    const order = await prisma.order.findUnique({
      where: { id: refId },
      include: {
        user: { select: { id: true, name: true, phone: true, district: true, state: true } },
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
      },
    });
    if (!order) return { kind: 'unknown', refId };
    return {
      kind: 'order',
      order: { ...order, deliveryAddress: maskAddress(order.deliveryAddress), user: maskUser(order.user) },
    };
  }

  return { kind: 'unknown', refId };
}

// ── GET /disputes ──────────────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('type').optional().isIn(DISPUTE_TYPES),
    query('status').optional().isIn(DISPUTE_STATUSES),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.type) where.type = req.query.type;
      if (req.query.status) where.status = req.query.status;
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.dispute, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load disputes');
    }
  },
);

// ── GET /disputes/:id ──────────────────────────────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id } });
    if (!dispute) return sendNotFound(res, 'Dispute');
    const context = await resolveContext(dispute);
    return sendSuccess(res, { dispute, context });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load dispute');
  }
});

// ── POST /disputes ─────────────────────────────────────────────────────────────
// Minimal create so the queue is usable until a user-facing raise-dispute flow
// exists. The actor (admin/support) is recorded as `raisedBy` unless one is given.
router.post(
  '/',
  [
    body('type').isIn(DISPUTE_TYPES),
    body('refId').isString().trim().isLength({ min: 1, max: 200 }),
    body('reason').isString().trim().isLength({ min: 3, max: 2000 }),
    body('raisedBy').optional().isUUID(),
    body('againstUser').optional({ nullable: true }).isUUID(),
    body('assignedTo').optional({ nullable: true }).isUUID(),
    body('status').optional().isIn(DISPUTE_STATUSES),
  ],
  validate,
  async (req, res) => {
    try {
      const created = await prisma.dispute.create({
        data: {
          type: req.body.type,
          refId: req.body.refId,
          reason: req.body.reason,
          raisedBy: req.body.raisedBy ?? req.user.id,
          againstUser: req.body.againstUser ?? null,
          assignedTo: req.body.assignedTo ?? null,
          status: req.body.status ?? 'OPEN',
        },
      });
      await adminAudit(req, ADMIN_ACTIONS.DISPUTE_CREATE, 'Dispute', created.id, {
        after: { type: created.type, refId: created.refId, status: created.status },
      });
      return sendCreated(res, created);
    } catch (err) {
      return sendServerError(res, err, 'Failed to create dispute');
    }
  },
);

// ── PATCH /disputes/:id ────────────────────────────────────────────────────────
// Assign `assignedTo`, change `status`, set `resolution`. At least one is required.
router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('status').optional().isIn(DISPUTE_STATUSES),
    body('assignedTo').optional({ nullable: true }).isUUID(),
    body('resolution').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.dispute.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, assignedTo: true, resolution: true },
      });
      if (!before) return sendNotFound(res, 'Dispute');

      const data = {};
      if (req.body.status !== undefined) data.status = req.body.status;
      if (req.body.assignedTo !== undefined) data.assignedTo = req.body.assignedTo || null;
      if (req.body.resolution !== undefined) data.resolution = req.body.resolution || null;
      if (!Object.keys(data).length) {
        return sendServerError(res, Object.assign(new Error('Provide status, assignedTo, or resolution'), { expose: true }), 'Nothing to update', 400);
      }

      const updated = await prisma.dispute.update({
        where: { id: req.params.id },
        data,
        select: { id: true, status: true, assignedTo: true, resolution: true, updatedAt: true },
      });
      await adminAudit(req, ADMIN_ACTIONS.DISPUTE_UPDATE, 'Dispute', updated.id, {
        before,
        after: { status: updated.status, assignedTo: updated.assignedTo, resolution: updated.resolution },
        metadata: { reason: req.body.reason ?? null },
      });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update dispute');
    }
  },
);

export default router;
