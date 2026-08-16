/**
 * Admin — agri-chemical compliance.
 *
 *   /admin/product-compliance       review queue, approve / reject / suspend
 *   /admin/seller-licences          licence verification per regulated class
 *   /admin/product-batches          batch register, expiry queue, quarantine
 *   /admin/recalls                  raise a recall, see who is affected, close it
 *   /admin/sale-blocks              stop a sale by product / seller / batch / geography
 *   /admin/subcategories            subcategory master data
 *
 * Every mutation here is audited (see ADMIN_ACTIONS.COMPLIANCE_* / LICENCE_* /
 * RECALL_* / SALE_BLOCK_*). A regulator's question is "who cleared this for sale,
 * when, and on what evidence", and the AuditLog row is the answer.
 *
 * ── The boundary this file draws ─────────────────────────────────────────────
 * Compliance fields are writable ONLY here and by the seller's own submission
 * endpoint (which lands in PENDING_REVIEW and cannot self-approve). They are not
 * reachable from any customer or seller catalog API — a seller who could set
 * `status: APPROVED` on their own pesticide would make this whole layer theatre.
 *
 * The ADMIN gate is applied once by the parent router; the scope gate is per
 * mount below.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendCreated, sendError, sendServerError, sendNotFound } from '../../utils/response.js';
import { stripHtml, deepStripHtml } from '../../utils/encrypt.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { invalidateSaleBlocks, findAffectedBuyers } from '../../services/shopCompliance.service.js';
import { bumpListingVersion } from '../../utils/listingCache.js';
import { invalidateBuyBox } from '../../services/buyBox.service.js';
import { getSetting } from '../../services/settings.service.js';
import logger from '../../utils/logger.js';

const REGULATED_KINDS = [
  'NONE', 'SEED', 'FERTILIZER', 'BIO_PRODUCT', 'PESTICIDE',
  'INSECTICIDE', 'FUNGICIDE', 'HERBICIDE', 'PLANT_GROWTH_REGULATOR',
];
const COMPLIANCE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const LICENCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUSPENDED'];
const BLOCK_SCOPES = ['PRODUCT', 'SELLER', 'CATEGORY', 'BATCH', 'STATE', 'DISTRICT'];

/** Anything that can change what is sellable has to drop the storefront caches. */
async function invalidateShopCaches() {
  await Promise.all([
    bumpListingVersion('agristore:products'),
    invalidateBuyBox(),
    invalidateSaleBlocks(),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Product compliance
// ═══════════════════════════════════════════════════════════════════════════════
export const productComplianceRouter = Router();

productComplianceRouter.get(
  '/',
  [
    query('status').optional().isIn(COMPLIANCE_STATUSES),
    query('kind').optional().isIn(REGULATED_KINDS),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.kind) where.regulatedKind = req.query.kind;

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.productCompliance, {
        where, cursor, limit,
        select: {
          id: true, productId: true, regulatedKind: true, status: true,
          registrationNumber: true, registrationValidTo: true, activeIngredient: true,
          labelVersion: true, requiresBatch: true, reviewedBy: true, reviewedAt: true,
          rejectionReason: true, createdAt: true, updatedAt: true,
          product: { select: { id: true, name: true, brand: true, status: true, categoryId: true } },
        },
      });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load compliance records');
    }
  },
);

productComplianceRouter.get('/:productId', [param('productId').isUUID()], validate, async (req, res) => {
  try {
    const record = await prisma.productCompliance.findUnique({
      where: { productId: req.params.productId },
      include: { product: { select: { id: true, name: true, brand: true, manufacturer: true, categoryId: true, status: true } } },
    });
    if (!record) return sendNotFound(res, 'Compliance record');
    return sendSuccess(res, record);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load compliance record');
  }
});

/**
 * Label fields, as an admin may edit them.
 *
 * Every one is a TRANSCRIPTION of the approved manufacturer label. Nothing in
 * this codebase generates any of it — see the note in shopCompliance.service.js.
 * A reviewer's job is to check the transcription against the label document, not
 * to compose advice.
 */
const complianceBody = [
  body('regulatedKind').optional().isIn(REGULATED_KINDS),
  body('registrationNumber').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('registrationAuthority').optional({ nullable: true }).isString().isLength({ max: 160 }),
  body('registrationValidTo').optional({ nullable: true }).isISO8601(),
  body('activeIngredient').optional({ nullable: true }).isString().isLength({ max: 300 }),
  body('formulation').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('concentration').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('approvedCrops').optional().isArray({ max: 200 }),
  body('targetPests').optional().isArray({ max: 200 }),
  body('dosageText').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('safetyEquipment').optional().isArray({ max: 30 }),
  body('storageInstructions').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('firstAidText').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('precautionText').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('labelDocId').optional({ nullable: true }).isString().isLength({ max: 300 }),
  body('labelVersion').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('requiresBatch').optional().isBoolean(),
  body('requiresExpiry').optional().isBoolean(),
  body('minShelfLifeDays').optional().isInt({ min: 0, max: 3650 }),
];

function pickComplianceData(b) {
  const data = {};
  const strFields = [
    'registrationNumber', 'registrationAuthority', 'activeIngredient', 'formulation',
    'concentration', 'dosageText', 'storageInstructions', 'firstAidText',
    'precautionText', 'labelDocId', 'labelVersion',
  ];
  for (const k of strFields) {
    if (b[k] !== undefined) data[k] = b[k] === null ? null : stripHtml(String(b[k])) || null;
  }
  for (const k of ['approvedCrops', 'targetPests', 'safetyEquipment']) {
    if (b[k] !== undefined) data[k] = deepStripHtml(Array.isArray(b[k]) ? b[k].map(String) : []);
  }
  if (b.regulatedKind !== undefined) data.regulatedKind = b.regulatedKind;
  if (b.requiresBatch !== undefined) data.requiresBatch = !!b.requiresBatch;
  if (b.requiresExpiry !== undefined) data.requiresExpiry = !!b.requiresExpiry;
  if (b.minShelfLifeDays !== undefined) data.minShelfLifeDays = parseInt(b.minShelfLifeDays, 10);
  if (b.registrationValidTo !== undefined) {
    data.registrationValidTo = b.registrationValidTo ? new Date(b.registrationValidTo) : null;
  }
  return data;
}

productComplianceRouter.put(
  '/:productId',
  [param('productId').isUUID(), ...complianceBody],
  validate,
  async (req, res) => {
    try {
      const product = await prisma.product.findUnique({
        where: { id: req.params.productId },
        select: { id: true, name: true },
      });
      if (!product) return sendNotFound(res, 'Product');

      const data = pickComplianceData(req.body);
      const before = await prisma.productCompliance.findUnique({ where: { productId: product.id } });

      // An edit to the label after approval invalidates the approval: the thing
      // that was reviewed is no longer the thing on the page. It goes back into
      // the queue rather than silently changing what a farmer is shown as
      // "approved label information".
      const resetsApproval = before?.status === 'APPROVED' && Object.keys(data).length > 0;

      const record = await prisma.productCompliance.upsert({
        where: { productId: product.id },
        create: { productId: product.id, ...data, status: 'PENDING_REVIEW' },
        update: {
          ...data,
          ...(resetsApproval ? { status: 'PENDING_REVIEW', reviewedBy: null, reviewedAt: null } : {}),
        },
      });

      await adminAudit(req, ADMIN_ACTIONS.COMPLIANCE_UPDATE, 'ProductCompliance', record.id, {
        before: before ? { status: before.status, labelVersion: before.labelVersion } : null,
        after: { status: record.status, labelVersion: record.labelVersion },
        metadata: { productId: product.id, resetsApproval },
      });
      await invalidateShopCaches();

      return sendSuccess(res, record);
    } catch (err) {
      return sendServerError(res, err, 'Failed to save compliance record');
    }
  },
);

productComplianceRouter.post(
  '/:productId/decision',
  [
    param('productId').isUUID(),
    body('decision').isIn(['APPROVE', 'REJECT', 'SUSPEND']),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
    // Approving without recording which label revision was checked would make the
    // approval unauditable — the order-item snapshot points at this string.
    body('labelVersion').optional().isString().isLength({ max: 60 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { decision, reason } = req.body;
      const record = await prisma.productCompliance.findUnique({ where: { productId: req.params.productId } });
      if (!record) return sendNotFound(res, 'Compliance record');

      if (decision !== 'APPROVE' && !String(reason || '').trim()) {
        return sendError(res, 'A reason is required to reject or suspend a compliance record.', 400);
      }
      if (decision === 'APPROVE' && record.regulatedKind !== 'NONE' && !record.registrationNumber) {
        return sendError(
          res,
          'A registration number from the approving authority is required before a regulated product can be approved for sale.',
          400,
        );
      }

      const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
      const updated = await prisma.productCompliance.update({
        where: { productId: req.params.productId },
        data: {
          status,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          rejectionReason: decision === 'APPROVE' ? null : stripHtml(reason),
          ...(req.body.labelVersion ? { labelVersion: stripHtml(req.body.labelVersion) } : {}),
        },
      });

      // Suspending must take live offers down NOW, not at the next cache TTL.
      if (status !== 'APPROVED') {
        await prisma.sellerListing.updateMany({
          where: { variant: { productId: req.params.productId }, status: 'ACTIVE' },
          data: { status: 'INACTIVE' },
        });
      }

      const action = decision === 'APPROVE'
        ? ADMIN_ACTIONS.COMPLIANCE_APPROVE
        : decision === 'REJECT' ? ADMIN_ACTIONS.COMPLIANCE_REJECT : ADMIN_ACTIONS.COMPLIANCE_SUSPEND;
      await adminAudit(req, action, 'ProductCompliance', updated.id, {
        before: { status: record.status },
        after: { status: updated.status, labelVersion: updated.labelVersion },
        metadata: { productId: req.params.productId, reason: reason || null },
      });
      await invalidateShopCaches();

      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to record the compliance decision');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Seller licences
// ═══════════════════════════════════════════════════════════════════════════════
export const sellerLicencesRouter = Router();

sellerLicencesRouter.get(
  '/',
  [
    query('status').optional().isIn(LICENCE_STATUSES),
    query('kind').optional().isIn(REGULATED_KINDS),
    query('sellerId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.kind) where.kind = req.query.kind;
      if (req.query.sellerId) where.sellerId = req.query.sellerId;

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.sellerLicence, {
        where, cursor, limit,
        select: {
          id: true, sellerId: true, kind: true, licenceNumber: true, issuingAuthority: true,
          state: true, district: true, validFrom: true, validTo: true, status: true,
          reviewedBy: true, reviewedAt: true, rejectionReason: true, createdAt: true,
          // documentIds are PRIVATE Cloudinary public_ids and are deliberately NOT
          // in this list projection — they are fetched one licence at a time
          // through the signed-URL endpoint, which audits the access.
          seller: { select: { id: true, name: true, district: true, state: true, kycStatus: true } },
        },
      });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load seller licences');
    }
  },
);

sellerLicencesRouter.post(
  '/:id/decision',
  [
    param('id').isUUID(),
    body('decision').isIn(['APPROVE', 'REJECT', 'SUSPEND']),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
    body('validTo').optional().isISO8601(),
  ],
  validate,
  async (req, res) => {
    try {
      const { decision, reason, validTo } = req.body;
      const licence = await prisma.sellerLicence.findUnique({ where: { id: req.params.id } });
      if (!licence) return sendNotFound(res, 'Licence');

      if (decision !== 'APPROVE' && !String(reason || '').trim()) {
        return sendError(res, 'A reason is required to reject or suspend a licence.', 400);
      }
      // A licence with no expiry is not a licence. Approving one without an end
      // date would mean the expiry sweeper could never retire it.
      const effectiveValidTo = validTo ? new Date(validTo) : licence.validTo;
      if (decision === 'APPROVE' && !effectiveValidTo) {
        return sendError(res, 'A licence expiry date is required before approval.', 400);
      }
      if (decision === 'APPROVE' && effectiveValidTo <= new Date()) {
        return sendError(res, 'This licence has already expired and cannot be approved.', 400);
      }

      const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
      const updated = await prisma.sellerLicence.update({
        where: { id: licence.id },
        data: {
          status,
          validTo: effectiveValidTo,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          rejectionReason: decision === 'APPROVE' ? null : stripHtml(reason),
        },
      });

      const action = decision === 'APPROVE'
        ? ADMIN_ACTIONS.LICENCE_APPROVE
        : decision === 'REJECT' ? ADMIN_ACTIONS.LICENCE_REJECT : ADMIN_ACTIONS.LICENCE_SUSPEND;
      await adminAudit(req, action, 'SellerLicence', updated.id, {
        before: { status: licence.status },
        after: { status: updated.status, validTo: updated.validTo },
        // The licence NUMBER is business-registration data, but it is still
        // identifying — the audit records the decision, not the document.
        metadata: { sellerId: licence.sellerId, kind: licence.kind, reason: reason || null },
      });
      await invalidateShopCaches();

      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to record the licence decision');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Batches
// ═══════════════════════════════════════════════════════════════════════════════
export const productBatchesRouter = Router();

productBatchesRouter.get(
  '/',
  [
    query('status').optional().isIn(['ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'RECALLED', 'QUARANTINED', 'DAMAGED']),
    query('sellerId').optional().isUUID(),
    query('expiringInDays').optional().isInt({ min: 0, max: 3650 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.sellerId) where.sellerId = req.query.sellerId;
      if (req.query.expiringInDays != null) {
        where.expiryDate = { lte: new Date(Date.now() + Number(req.query.expiringInDays) * 86_400_000) };
      }

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.productBatch, {
        where, cursor, limit,
        select: {
          id: true, listingId: true, sellerId: true, batchNumber: true,
          manufactureDate: true, expiryDate: true, quantity: true, status: true,
          quarantineReason: true, createdAt: true,
          listing: {
            select: {
              id: true, sellingPrice: true, stockQty: true,
              variant: { select: { unit: true, product: { select: { id: true, name: true, brand: true } } } },
            },
          },
        },
      });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load batches');
    }
  },
);

productBatchesRouter.post(
  '/:id/quarantine',
  [param('id').isUUID(), body('reason').isString().trim().isLength({ min: 3, max: 500 })],
  validate,
  async (req, res) => {
    try {
      const batch = await prisma.productBatch.findUnique({ where: { id: req.params.id } });
      if (!batch) return sendNotFound(res, 'Batch');

      const updated = await prisma.productBatch.update({
        where: { id: batch.id },
        data: { status: 'QUARANTINED', quarantineReason: stripHtml(req.body.reason) },
      });

      await adminAudit(req, ADMIN_ACTIONS.BATCH_QUARANTINE, 'ProductBatch', batch.id, {
        before: { status: batch.status, quantity: batch.quantity },
        after: { status: updated.status },
        metadata: { sellerId: batch.sellerId, batchNumber: batch.batchNumber, reason: req.body.reason },
      });
      await invalidateShopCaches();

      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to quarantine the batch');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Recalls
// ═══════════════════════════════════════════════════════════════════════════════
export const recallsRouter = Router();

recallsRouter.get(
  '/',
  [query('isActive').optional().isBoolean(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.productRecall, {
        where, cursor, limit,
        select: {
          id: true, productId: true, batchNumber: true, sellerId: true, reason: true,
          severity: true, advice: true, initiatedBy: true, notifiedCount: true,
          notifiedAt: true, isActive: true, createdAt: true,
          product: { select: { id: true, name: true, brand: true } },
        },
      });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load recalls');
    }
  },
);

/**
 * Raise a recall.
 *
 * Three things happen atomically, because a recall that only does the first is
 * worse than none: the record is created, the affected batches are marked
 * RECALLED, and a SaleBlock is raised so the sale gate refuses it on the next
 * request rather than at the next cache expiry.
 *
 * Buyer notification is a SEPARATE, explicit step (`/notify`) — sending a recall
 * message to a few thousand farmers is not something to do as a side effect of
 * filling in a form.
 */
recallsRouter.post(
  '/',
  [
    body('productId').isUUID(),
    body('batchNumber').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('sellerId').optional({ nullable: true }).isUUID(),
    body('reason').isString().trim().isLength({ min: 5, max: 1000 }),
    body('severity').optional().isIn(['HIGH', 'MEDIUM', 'LOW']),
    // Verbatim instruction from the manufacturer or authority. The platform must
    // not author recall advice of its own.
    body('advice').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { productId, batchNumber = null, sellerId = null, reason, severity = 'HIGH', advice = null } = req.body;
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
      if (!product) return sendNotFound(res, 'Product');

      const recall = await prisma.$transaction(async (tx) => {
        const r = await tx.productRecall.create({
          data: {
            productId, batchNumber, sellerId,
            reason: stripHtml(reason),
            severity,
            advice: advice ? stripHtml(advice) : null,
            initiatedBy: req.user.id,
          },
        });

        if (batchNumber) {
          await tx.productBatch.updateMany({
            where: {
              batchNumber,
              listing: { variant: { productId } },
              ...(sellerId ? { sellerId } : {}),
            },
            data: { status: 'RECALLED' },
          });
        }

        // Belt and braces: the sale gate checks recalls directly, and ALSO checks
        // sale blocks. Raising both means a bug in either path still stops the sale.
        await tx.saleBlock.create({
          data: {
            scope: batchNumber ? 'BATCH' : 'PRODUCT',
            productId,
            sellerId,
            batchNumber,
            reason: `Recall: ${reason}`.slice(0, 500),
            publicMessage: 'This product has been recalled and is not available for sale.',
            createdBy: req.user.id,
          },
        });

        return r;
      });

      await adminAudit(req, ADMIN_ACTIONS.RECALL_CREATE, 'ProductRecall', recall.id, {
        after: { productId, batchNumber, sellerId, severity },
        metadata: { productName: product.name, reason },
      });
      await invalidateShopCaches();

      // How many buyers this affects, so the admin knows the blast radius before
      // deciding to notify.
      const affected = await findAffectedBuyers({ productId, batchNumber, sellerId });
      return sendCreated(res, { ...recall, affectedBuyerCount: affected.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to raise the recall');
    }
  },
);

recallsRouter.get('/:id/affected', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const recall = await prisma.productRecall.findUnique({ where: { id: req.params.id } });
    if (!recall) return sendNotFound(res, 'Recall');

    const affected = await findAffectedBuyers({
      productId: recall.productId,
      batchNumber: recall.batchNumber,
      sellerId: recall.sellerId,
    });
    // User IDs and order counts only — this is an operational list, not a contact
    // export. Phone numbers stay behind the audited PII-reveal surface.
    return sendSuccess(res, { count: affected.length, buyers: affected });
  } catch (err) {
    return sendServerError(res, err, 'Failed to resolve affected buyers');
  }
});

recallsRouter.post('/:id/notify', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const recall = await prisma.productRecall.findUnique({
      where: { id: req.params.id },
      include: { product: { select: { name: true } } },
    });
    if (!recall) return sendNotFound(res, 'Recall');
    if (!recall.isActive) return sendError(res, 'This recall has been closed.', 400);

    const affected = await findAffectedBuyers({
      productId: recall.productId,
      batchNumber: recall.batchNumber,
      sellerId: recall.sellerId,
    });

    if (affected.length) {
      // In-app notifications. The body is the reviewer's own recall text plus the
      // manufacturer's advice — no generated wording, because a recall message is
      // a safety communication and must say exactly what was approved.
      await prisma.notification.createMany({
        data: affected.map((a) => ({
          userId: a.userId,
          type: 'SYSTEM',
          title: `Product recall: ${recall.product?.name || 'a product you bought'}`,
          message: [recall.reason, recall.advice].filter(Boolean).join('\n\n').slice(0, 1000),
          data: {
            kind: 'PRODUCT_RECALL',
            recallId: recall.id,
            productId: recall.productId,
            batchNumber: recall.batchNumber,
            orderIds: a.orderIds,
          },
        })),
        skipDuplicates: true,
      });
    }

    const updated = await prisma.productRecall.update({
      where: { id: recall.id },
      data: { notifiedCount: affected.length, notifiedAt: new Date() },
    });

    await adminAudit(req, ADMIN_ACTIONS.RECALL_NOTIFY, 'ProductRecall', recall.id, {
      after: { notifiedCount: affected.length },
      metadata: { productId: recall.productId, batchNumber: recall.batchNumber },
    });

    logger.warn({ recallId: recall.id, notified: affected.length }, '[Compliance] recall notification sent');
    return sendSuccess(res, { notified: affected.length, recall: updated });
  } catch (err) {
    return sendServerError(res, err, 'Failed to notify affected buyers');
  }
});

recallsRouter.post(
  '/:id/close',
  [param('id').isUUID(), body('reason').isString().trim().isLength({ min: 3, max: 500 })],
  validate,
  async (req, res) => {
    try {
      const recall = await prisma.productRecall.findUnique({ where: { id: req.params.id } });
      if (!recall) return sendNotFound(res, 'Recall');

      await prisma.$transaction([
        prisma.productRecall.update({ where: { id: recall.id }, data: { isActive: false } }),
        // Lift the block this recall raised, and nothing else — an unrelated block
        // on the same product stays in force.
        prisma.saleBlock.updateMany({
          where: {
            productId: recall.productId,
            batchNumber: recall.batchNumber,
            reason: { startsWith: 'Recall:' },
            isActive: true,
          },
          data: { isActive: false },
        }),
      ]);

      await adminAudit(req, ADMIN_ACTIONS.RECALL_CLOSE, 'ProductRecall', recall.id, {
        before: { isActive: true },
        after: { isActive: false },
        metadata: { reason: req.body.reason },
      });
      await invalidateShopCaches();

      return sendSuccess(res, { closed: true });
    } catch (err) {
      return sendServerError(res, err, 'Failed to close the recall');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Sale blocks
// ═══════════════════════════════════════════════════════════════════════════════
export const saleBlocksRouter = Router();

saleBlocksRouter.get(
  '/',
  [query('isActive').optional().isBoolean(), query('scope').optional().isIn(BLOCK_SCOPES)],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
      if (req.query.scope) where.scope = req.query.scope;

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.saleBlock, { where, cursor, limit });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load sale blocks');
    }
  },
);

saleBlocksRouter.post(
  '/',
  [
    body('scope').isIn(BLOCK_SCOPES),
    body('productId').optional({ nullable: true }).isUUID(),
    body('sellerId').optional({ nullable: true }).isUUID(),
    body('categoryId').optional({ nullable: true }).isUUID(),
    body('batchNumber').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('state').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('district').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('reason').isString().trim().isLength({ min: 5, max: 500 }),
    body('publicMessage').optional({ nullable: true }).isString().isLength({ max: 300 }),
    body('expiresAt').optional({ nullable: true }).isISO8601(),
  ],
  validate,
  async (req, res) => {
    try {
      const b = req.body;
      // Each scope needs its own key. A STATE block with no state, or a PRODUCT
      // block with no product, would either match nothing or match everything —
      // and "matches everything" is a marketplace-wide outage typed by accident.
      const required = {
        PRODUCT: 'productId', SELLER: 'sellerId', CATEGORY: 'categoryId',
        BATCH: 'batchNumber', STATE: 'state', DISTRICT: 'district',
      }[b.scope];
      if (!b[required]) {
        return sendError(res, `A ${b.scope} block requires ${required}.`, 400);
      }

      const block = await prisma.saleBlock.create({
        data: {
          scope: b.scope,
          productId: b.productId || null,
          sellerId: b.sellerId || null,
          categoryId: b.categoryId || null,
          batchNumber: b.batchNumber ? stripHtml(b.batchNumber) : null,
          state: b.state ? stripHtml(b.state) : null,
          district: b.district ? stripHtml(b.district) : null,
          reason: stripHtml(b.reason),
          publicMessage: b.publicMessage ? stripHtml(b.publicMessage) : null,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          createdBy: req.user.id,
        },
      });

      await adminAudit(req, ADMIN_ACTIONS.SALE_BLOCK_CREATE, 'SaleBlock', block.id, {
        after: { scope: block.scope, productId: block.productId, sellerId: block.sellerId, state: block.state, district: block.district },
        metadata: { reason: b.reason },
      });
      await invalidateShopCaches();

      return sendCreated(res, block);
    } catch (err) {
      return sendServerError(res, err, 'Failed to create the sale block');
    }
  },
);

saleBlocksRouter.delete(
  '/:id',
  [param('id').isUUID(), body('reason').optional().isString().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const block = await prisma.saleBlock.findUnique({ where: { id: req.params.id } });
      if (!block) return sendNotFound(res, 'Sale block');

      // Lifted, never deleted: the record of what was blocked and when is the
      // audit trail a regulator would ask for.
      await prisma.saleBlock.update({ where: { id: block.id }, data: { isActive: false } });

      await adminAudit(req, ADMIN_ACTIONS.SALE_BLOCK_LIFT, 'SaleBlock', block.id, {
        before: { isActive: true, scope: block.scope },
        after: { isActive: false },
        metadata: { reason: req.body?.reason || null },
      });
      await invalidateShopCaches();

      return sendSuccess(res, { lifted: true });
    } catch (err) {
      return sendServerError(res, err, 'Failed to lift the sale block');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Subcategory master data
// ═══════════════════════════════════════════════════════════════════════════════
export const subcategoriesRouter = Router();

subcategoriesRouter.get('/', [query('categoryId').optional().isUUID()], validate, async (req, res) => {
  try {
    const items = await prisma.subcategory.findMany({
      where: req.query.categoryId ? { categoryId: req.query.categoryId } : {},
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return sendSuccess(res, { items });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load subcategories');
  }
});

const subcategoryBody = [
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('nameHi').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('nameMr').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('icon').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  body('isActive').optional().isBoolean(),
  body('attributeSchema').optional({ nullable: true }).isString().isLength({ max: 80 }),
];

function pickSubcategory(b) {
  const data = {};
  for (const k of ['name', 'nameHi', 'nameMr', 'icon', 'attributeSchema']) {
    if (b[k] !== undefined) data[k] = b[k] === null ? null : stripHtml(String(b[k])) || null;
  }
  if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10);
  if (b.isActive !== undefined) data.isActive = !!b.isActive;
  return data;
}

subcategoriesRouter.post(
  '/',
  [body('categoryId').isUUID(), body('name').isString().trim().isLength({ min: 1, max: 80 }), ...subcategoryBody],
  validate,
  async (req, res) => {
    try {
      const category = await prisma.category.findUnique({ where: { id: req.body.categoryId }, select: { id: true } });
      if (!category) return sendError(res, 'Invalid category', 400);

      const created = await prisma.subcategory.create({
        data: { categoryId: req.body.categoryId, ...pickSubcategory(req.body) },
      });
      await adminAudit(req, ADMIN_ACTIONS.SUBCATEGORY_CREATE, 'Subcategory', created.id, {
        after: { name: created.name, categoryId: created.categoryId },
      });
      await bumpListingVersion('agristore:categories');
      return sendCreated(res, created);
    } catch (err) {
      if (err?.code === 'P2002') {
        return sendError(res, 'A subcategory with that name already exists in this category.', 409);
      }
      return sendServerError(res, err, 'Failed to create the subcategory');
    }
  },
);

subcategoriesRouter.patch('/:id', [param('id').isUUID(), ...subcategoryBody], validate, async (req, res) => {
  try {
    const before = await prisma.subcategory.findUnique({ where: { id: req.params.id } });
    if (!before) return sendNotFound(res, 'Subcategory');

    const updated = await prisma.subcategory.update({ where: { id: before.id }, data: pickSubcategory(req.body) });
    await adminAudit(req, ADMIN_ACTIONS.SUBCATEGORY_UPDATE, 'Subcategory', updated.id, {
      before: { name: before.name, isActive: before.isActive, sortOrder: before.sortOrder },
      after: { name: updated.name, isActive: updated.isActive, sortOrder: updated.sortOrder },
    });
    await Promise.all([bumpListingVersion('agristore:categories'), bumpListingVersion('agristore:products')]);
    return sendSuccess(res, updated);
  } catch (err) {
    if (err?.code === 'P2002') {
      return sendError(res, 'A subcategory with that name already exists in this category.', 409);
    }
    return sendServerError(res, err, 'Failed to update the subcategory');
  }
});

subcategoriesRouter.delete('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const before = await prisma.subcategory.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { products: true } } },
    });
    if (!before) return sendNotFound(res, 'Subcategory');

    // Deactivated, not deleted, when products still point at it — deleting would
    // orphan live catalogue rows to satisfy a tidy-up.
    if (before._count.products > 0) {
      const updated = await prisma.subcategory.update({ where: { id: before.id }, data: { isActive: false } });
      await adminAudit(req, ADMIN_ACTIONS.SUBCATEGORY_UPDATE, 'Subcategory', updated.id, {
        before: { isActive: true }, after: { isActive: false },
        metadata: { deactivatedInsteadOfDeleted: true, productCount: before._count.products },
      });
      await bumpListingVersion('agristore:categories');
      return sendSuccess(res, { deactivated: true, productCount: before._count.products });
    }

    await prisma.subcategory.delete({ where: { id: before.id } });
    await adminAudit(req, ADMIN_ACTIONS.SUBCATEGORY_DELETE, 'Subcategory', before.id, {
      before: { name: before.name, categoryId: before.categoryId },
    });
    await bumpListingVersion('agristore:categories');
    return sendSuccess(res, { deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete the subcategory');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Payment intents — the reconciliation queue
// ═══════════════════════════════════════════════════════════════════════════════
export const paymentIntentsRouter = Router();

/**
 * The queue that matters most: PAID intents with no order. Each row is a farmer
 * whose money was taken and who has nothing to show for it.
 */
paymentIntentsRouter.get(
  '/',
  [
    query('status').optional().isIn(['CREATED', 'PENDING', 'PAID', 'ORDER_CREATED', 'FAILED', 'CANCELLED', 'REFUND_INITIATED', 'REFUNDED', 'EXPIRED']),
    query('orphaned').optional().isBoolean(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.status = req.query.status;
      if (req.query.orphaned === 'true') { where.status = 'PAID'; where.orderId = null; }

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.paymentIntent, {
        where, cursor, limit,
        select: {
          id: true, userId: true, provider: true, providerOrderId: true,
          providerPaymentId: true, amount: true, currency: true, status: true,
          orderId: true, failureReason: true, reconciledAt: true, reconcileNote: true,
          createdAt: true, updatedAt: true,
        },
      });
      return sendSuccess(res, { items: page.items }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load payment intents');
    }
  },
);
