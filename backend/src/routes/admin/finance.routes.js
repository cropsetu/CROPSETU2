/**
 * Admin finance — seller settlement ledger & payouts (scope FINANCE).
 *   /api/v1/admin/sellers/:id/ledger   GET  keyset list (newest first) / POST manual ADJUSTMENT
 *   /api/v1/admin/payouts              GET  list (?status= &sellerId=) / POST generate for a period
 *   /api/v1/admin/payouts/:id          PATCH transition to PAID / FAILED (+ reference)
 *
 * ADMIN gate + FINANCE scope applied by the parent router. Every mutation audited.
 * `sellerId` is a User id (a seller's account) carried as a scalar — see the
 * SellerLedgerEntry / Payout models (additive, no relation back onto User).
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendCreated, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import {
  getSellerBalance,
  getCommissionRatePct,
  generatePayoutForPeriod,
} from '../../services/settlement.service.js';

const LEDGER_TYPES = ['SALE', 'COMMISSION', 'REFUND', 'PAYOUT', 'ADJUSTMENT'];
const PAYOUT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED'];

// ── Sellers: settlement ledger ────────────────────────────────────────────────
export const sellersRouter = Router();

// GET /sellers/:id/ledger — keyset over the seller's ledger (newest first) + the
// seller's current net balance and the active commission rate for context.
sellersRouter.get(
  '/:id/ledger',
  [
    param('id').isString().trim().isLength({ min: 1, max: 64 }),
    query('type').optional().isIn(LEDGER_TYPES),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const sellerId = req.params.id;
      const where = { sellerId };
      if (req.query.type) where.type = req.query.type;

      const { cursor, limit } = listParams(req);
      const [page, balance, commissionRatePct] = await Promise.all([
        keysetList(prisma.sellerLedgerEntry, { where, cursor, limit }),
        getSellerBalance(sellerId),
        getCommissionRatePct(),
      ]);

      return sendSuccess(
        res,
        { items: page.items, sellerId, balance, commissionRatePct },
        200,
        { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length },
      );
    } catch (err) {
      return sendServerError(res, err, 'Failed to load seller ledger');
    }
  },
);

// POST /sellers/:id/ledger — record a manual signed ADJUSTMENT entry (audited).
// Seeding SALE/COMMISSION/REFUND from real orders is a follow-up; this lets an
// operator correct a balance in the meantime. `balanceAfter` is snapshotted in a
// transaction so concurrent writes stay consistent.
sellersRouter.post(
  '/:id/ledger',
  [
    param('id').isString().trim().isLength({ min: 1, max: 64 }),
    body('amount').isFloat().custom((v) => Number(v) !== 0).withMessage('amount must be a non-zero number'),
    body('note').isString().trim().isLength({ min: 3, max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const sellerId = req.params.id;
      const amount = Number(req.body.amount);

      const entry = await prisma.$transaction(async (tx) => {
        const agg = await tx.sellerLedgerEntry.aggregate({ where: { sellerId }, _sum: { amount: true } });
        const balanceBefore = Number(agg._sum.amount ?? 0);
        const balanceAfter = balanceBefore + amount;
        return tx.sellerLedgerEntry.create({
          data: {
            sellerId,
            type: 'ADJUSTMENT',
            amount,
            balanceAfter,
            note: req.body.note,
            createdBy: req.user.id,
          },
        });
      });

      await adminAudit(req, ADMIN_ACTIONS.LEDGER_ADJUST, 'SellerLedgerEntry', entry.id, {
        after: { sellerId, amount, balanceAfter: entry.balanceAfter },
        metadata: { note: req.body.note },
      });
      return sendCreated(res, entry);
    } catch (err) {
      return sendServerError(res, err, 'Failed to record ledger adjustment');
    }
  },
);

// ── Payouts ───────────────────────────────────────────────────────────────────
export const payoutsRouter = Router();

// GET /payouts — list/filter by status & sellerId (keyset, newest first).
payoutsRouter.get(
  '/',
  [
    query('status').optional().isIn(PAYOUT_STATUSES),
    query('sellerId').optional().isString().trim().isLength({ min: 1, max: 64 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.sellerId) where.sellerId = req.query.sellerId;

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.payout, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load payouts');
    }
  },
);

// POST /payouts — generate a payout for a seller over a settlement period (audited).
payoutsRouter.post(
  '/',
  [
    body('sellerId').isString().trim().isLength({ min: 1, max: 64 }),
    body('periodFrom').isISO8601(),
    body('periodTo').isISO8601(),
  ],
  validate,
  async (req, res) => {
    try {
      const { sellerId, periodFrom, periodTo } = req.body;
      const { payout, breakdown } = await generatePayoutForPeriod(
        sellerId,
        new Date(periodFrom),
        new Date(periodTo),
        req.user.id,
      );
      await adminAudit(req, ADMIN_ACTIONS.PAYOUT_CREATE, 'Payout', payout.id, {
        after: { sellerId, amount: payout.amount, status: payout.status, periodFrom: payout.periodFrom, periodTo: payout.periodTo },
        metadata: { breakdown },
      });
      return sendCreated(res, { payout, breakdown });
    } catch (err) {
      return sendServerError(res, err, 'Failed to generate payout');
    }
  },
);

// PATCH /payouts/:id — transition status (PAID / FAILED, or PROCESSING) + a
// reference/reason (audited). Terminal payouts (PAID/FAILED) can't be re-transitioned.
payoutsRouter.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('status').isIn(['PROCESSING', 'PAID', 'FAILED']),
    body('reference').optional().isString().trim().isLength({ max: 200 }),
    body('method').optional().isString().trim().isLength({ max: 60 }),
  ],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.payout.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, amount: true, sellerId: true },
      });
      if (!before) return sendNotFound(res, 'Payout');
      if (before.status === 'PAID' || before.status === 'FAILED') {
        return sendServerError(
          res,
          Object.assign(new Error('Payout is already finalised and cannot be changed'), { expose: true }),
          'Payout finalised', 409,
        );
      }

      const data = { status: req.body.status, processedBy: req.user.id };
      if (req.body.reference !== undefined) data.reference = req.body.reference;
      if (req.body.method !== undefined) data.method = req.body.method;

      const updated = await prisma.payout.update({
        where: { id: req.params.id },
        data,
        select: { id: true, status: true, method: true, reference: true, amount: true, sellerId: true, updatedAt: true },
      });
      await adminAudit(req, ADMIN_ACTIONS.PAYOUT_UPDATE, 'Payout', updated.id, {
        before: { status: before.status },
        after: { status: updated.status, method: updated.method, reference: updated.reference },
      });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update payout');
    }
  },
);
