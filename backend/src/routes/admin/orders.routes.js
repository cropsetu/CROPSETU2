/**
 * Admin Orders — /api/v1/admin/orders
 *
 * GET   /orders          list (filter status / paymentStatus / date range / userId)
 * GET   /orders/:id      full order + items + buyer (delivery-address phone masked)
 * PATCH /orders/:id      change status / paymentStatus; refund → status REFUNDED
 *
 * ADMIN gate applied by parent router. Mutations audited.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { maskPhone } from '../../utils/adminPii.js';
import { adminAudit, listParams, dateRange } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

const router = Router();

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

/** Mask the phone inside a delivery-address JSON blob (PII) for default responses. */
function maskAddress(addr) {
  if (!addr || typeof addr !== 'object') return addr;
  const out = { ...addr };
  if (out.phone) out.phone = maskPhone(String(out.phone));
  return out;
}

router.get(
  '/',
  [
    query('status').optional().isIn(ORDER_STATUSES),
    query('paymentStatus').optional().isIn(PAYMENT_STATUSES),
    query('userId').optional().isUUID(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
      if (req.query.userId) where.userId = req.query.userId;
      const range = dateRange(req.query.from, req.query.to);
      if (range) where.createdAt = range;

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.order, {
        where, cursor, limit,
        include: {
          user: { select: { id: true, name: true, phone: true } },
          _count: { select: { items: true } },
        },
      });
      const items = page.items.map((o) => ({
        ...o,
        deliveryAddress: undefined, // omit PII blob from the list
        user: o.user ? { ...o.user, phone: maskPhone(o.user.phone) } : null,
      }));
      return sendSuccess(res, { items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load orders');
    }
  },
);

router.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, phone: true, district: true, state: true } },
        items: { include: { product: { select: { id: true, name: true, images: true } } } },
      },
    });
    if (!order) return sendNotFound(res, 'Order');
    return sendSuccess(res, {
      ...order,
      deliveryAddress: maskAddress(order.deliveryAddress),
      user: order.user ? { ...order.user, phone: maskPhone(order.user.phone) } : null,
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load order');
  }
});

router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('status').optional().isIn(ORDER_STATUSES),
    body('paymentStatus').optional().isIn(PAYMENT_STATUSES),
    body('refund').optional().isBoolean(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, paymentStatus: true } });
      if (!before) return sendNotFound(res, 'Order');

      const data = {};
      if (req.body.refund === true) {
        data.status = 'REFUNDED';
        data.paymentStatus = 'refunded';
      } else {
        if (req.body.status !== undefined) data.status = req.body.status;
        if (req.body.paymentStatus !== undefined) data.paymentStatus = req.body.paymentStatus;
      }
      if (!Object.keys(data).length) return sendServerError(res, Object.assign(new Error('Provide status, paymentStatus, or refund'), { expose: true }), 'Nothing to update', 400);

      const updated = await prisma.order.update({ where: { id: req.params.id }, data, select: { id: true, status: true, paymentStatus: true } });
      await adminAudit(req, ADMIN_ACTIONS.ORDER_UPDATE, 'Order', updated.id, {
        before, after: updated, metadata: { reason: req.body.reason ?? null, refund: req.body.refund === true },
      });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update order');
    }
  },
);

export default router;
