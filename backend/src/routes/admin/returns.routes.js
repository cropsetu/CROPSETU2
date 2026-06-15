/**
 * Admin Returns / RMA — /api/v1/admin/returns
 *
 * GET   /returns        list (filter ?status=)
 * GET   /returns/:id    detail + linked order/items (delivery-address phone masked)
 * PATCH /returns/:id    approve / reject / refund (REFUNDED flips the Order atomically)
 *
 * ADMIN gate + SUPPORT scope applied by the parent router. Mutations audited.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { maskPhone } from '../../utils/adminPii.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

const router = Router();

const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'COMPLETED'];

/** Mask the phone inside a delivery-address JSON blob (PII) for default responses. */
function maskAddress(addr) {
  if (!addr || typeof addr !== 'object') return addr;
  const out = { ...addr };
  if (out.phone) out.phone = maskPhone(String(out.phone));
  return out;
}

// ── GET /returns ──────────────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(RETURN_STATUSES),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.returnRequest, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load return requests');
    }
  },
);

// ── GET /returns/:id ──────────────────────────────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const rma = await prisma.returnRequest.findUnique({ where: { id: req.params.id } });
    if (!rma) return sendNotFound(res, 'Return request');

    // Load the linked order (scalar FK, no relation) for context.
    const order = await prisma.order.findUnique({
      where: { id: rma.orderId },
      include: {
        user: { select: { id: true, name: true, phone: true, district: true, state: true } },
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
      },
    });

    return sendSuccess(res, {
      ...rma,
      order: order
        ? {
            ...order,
            deliveryAddress: maskAddress(order.deliveryAddress),
            user: order.user ? { ...order.user, phone: maskPhone(order.user.phone) } : null,
          }
        : null,
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load return request');
  }
});

// ── PATCH /returns/:id ────────────────────────────────────────────────────────
// approve / reject / refund. On REFUNDED, atomically flip the linked Order to
// REFUNDED + paymentStatus=refunded, enforcing refundAmount ≤ order.totalAmount.
router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('status').isIn(RETURN_STATUSES),
    body('refundAmount').optional({ nullable: true }).isFloat({ min: 0 }),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.returnRequest.findUnique({
        where: { id: req.params.id },
        select: { id: true, orderId: true, status: true, refundAmount: true, reason: true },
      });
      if (!before) return sendNotFound(res, 'Return request');

      const status = req.body.status;
      const data = { status, resolvedBy: req.user?.id ?? null };
      if (req.body.refundAmount !== undefined) data.refundAmount = req.body.refundAmount;
      if (req.body.reason !== undefined && req.body.reason !== '') data.reason = req.body.reason;

      let updated;
      if (status === 'REFUNDED') {
        // The linked order must exist and the refund cannot exceed its total.
        const order = await prisma.order.findUnique({
          where: { id: before.orderId },
          select: { id: true, status: true, paymentStatus: true, totalAmount: true },
        });
        if (!order) return sendNotFound(res, 'Order');

        const total = Number(order.totalAmount);
        const refund = req.body.refundAmount !== undefined ? Number(req.body.refundAmount) : total;
        if (Number.isFinite(refund) && refund > total) {
          return sendServerError(res, Object.assign(new Error('refundAmount cannot exceed the order total'), { expose: true }), 'Refund exceeds order total', 400);
        }
        data.refundAmount = refund;

        // Flip the return AND the order atomically.
        const [ret] = await prisma.$transaction([
          prisma.returnRequest.update({ where: { id: req.params.id }, data }),
          prisma.order.update({ where: { id: order.id }, data: { status: 'REFUNDED', paymentStatus: 'refunded' } }),
        ]);
        updated = ret;
      } else {
        updated = await prisma.returnRequest.update({ where: { id: req.params.id }, data });
      }

      await adminAudit(req, ADMIN_ACTIONS.RETURN_UPDATE, 'ReturnRequest', updated.id, {
        before: { status: before.status, refundAmount: before.refundAmount },
        after: { status: updated.status, refundAmount: updated.refundAmount },
        metadata: { reason: req.body.reason ?? null, orderId: before.orderId, orderRefunded: status === 'REFUNDED' },
      });

      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update return request');
    }
  },
);

export default router;
