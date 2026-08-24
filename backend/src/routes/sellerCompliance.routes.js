/**
 * Seller — compliance submission, batch register, delivery areas.
 *
 * Mounted at /api/v1/agristore/seller-compliance (SELLER roles only).
 *
 * ── The one rule this file is built around ──────────────────────────────────
 * A SELLER MAY SUBMIT; ONLY AN ADMIN MAY APPROVE.
 *
 * Every write here lands in PENDING_REVIEW / PENDING. There is no field a seller
 * can set that grants their own product or their own licence permission to be
 * sold — `status`, `reviewedBy`, `reviewedAt` and `rejectionReason` are stripped
 * from every payload, not merely omitted from the validator, because a
 * mass-assignment hole in exactly this file would make the whole compliance layer
 * decorative.
 *
 * Batches are the exception, and deliberately: a seller records their own stock
 * lots and expiry dates without review, because that is inventory, and requiring
 * an admin to approve each carton would mean nobody records any. What a seller
 * CANNOT do is un-quarantine or un-recall a batch — those are set by an admin and
 * are refused here.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { sendSuccess, sendCreated, sendError, sendServerError, sendNotFound, sendForbidden } from '../utils/response.js';
import { stripHtml, deepStripHtml } from '../utils/encrypt.js';
import { auditAction, AUDIT_ACTIONS } from '../services/audit.service.js';
import { invalidateSaleBlocks } from '../services/shopCompliance.service.js';
import { isValidPincode, serviceAreaMatchKey } from '../services/serviceability.service.js';
import { D } from '../utils/money.js';

const router = Router();
router.param('id', uuidParamGuard);
router.param('listingId', uuidParamGuard);
router.param('productId', uuidParamGuard);

const SELLER_ROLES = ['SELLER', 'VERIFIED_FARMER', 'ADMIN'];
router.use(authenticate, requireRole(...SELLER_ROLES));

const REGULATED_KINDS = [
  'SEED', 'FERTILIZER', 'BIO_PRODUCT', 'PESTICIDE',
  'INSECTICIDE', 'FUNGICIDE', 'HERBICIDE', 'PLANT_GROWTH_REGULATOR',
];

/**
 * Fields a seller may never write, on any compliance object.
 * Enumerated once, stripped once, so adding a route cannot forget it.
 */
const PROTECTED_FIELDS = ['status', 'reviewedBy', 'reviewedAt', 'rejectionReason', 'sellerId', 'id'];

function rejectProtectedFields(req, res, next) {
  const attempted = PROTECTED_FIELDS.filter((k) => req.body?.[k] !== undefined);
  if (attempted.length) {
    return sendError(
      res,
      'Approval status is set by KrushiSarva after review and cannot be submitted with your request.',
      403,
      { rejectedFields: attempted },
    );
  }
  return next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Licences
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/licences', async (req, res) => {
  const licences = await prisma.sellerLicence.findMany({
    where: { sellerId: req.user.id },
    select: {
      id: true, kind: true, licenceNumber: true, issuingAuthority: true, state: true,
      district: true, validFrom: true, validTo: true, status: true, rejectionReason: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return sendSuccess(res, licences);
});

/**
 * Submit or resubmit a licence for one regulated class.
 *
 * Upsert on (sellerId, kind): a renewal replaces the record and returns it to
 * PENDING, which is the correct behaviour — a new document has not been checked
 * just because the old one was.
 */
router.post(
  '/licences',
  rejectProtectedFields,
  [
    body('kind').isIn(REGULATED_KINDS),
    body('licenceNumber').isString().trim().isLength({ min: 3, max: 120 }),
    body('issuingAuthority').optional().isString().isLength({ max: 160 }),
    body('state').optional().isString().isLength({ max: 120 }),
    body('district').optional().isString().isLength({ max: 120 }),
    body('validFrom').optional().isISO8601(),
    body('validTo').isISO8601().withMessage('licence expiry date is required'),
    body('documentIds').optional().isArray({ max: 10 }),
  ],
  validate,
  async (req, res) => {
    try {
      const b = req.body;
      const validTo = new Date(b.validTo);
      if (validTo <= new Date()) {
        return sendError(res, 'This licence has already expired. Please upload a current licence.', 400);
      }

      const data = {
        licenceNumber: stripHtml(b.licenceNumber),
        issuingAuthority: b.issuingAuthority ? stripHtml(b.issuingAuthority) : null,
        state: b.state ? stripHtml(b.state) : null,
        district: b.district ? stripHtml(b.district) : null,
        validFrom: b.validFrom ? new Date(b.validFrom) : null,
        validTo,
        documentIds: deepStripHtml(Array.isArray(b.documentIds) ? b.documentIds.map(String).slice(0, 10) : []),
        // Always. Never from the request.
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      };

      const licence = await prisma.sellerLicence.upsert({
        where: { sellerId_kind: { sellerId: req.user.id, kind: b.kind } },
        create: { sellerId: req.user.id, kind: b.kind, ...data },
        update: data,
        select: { id: true, kind: true, status: true, validTo: true, createdAt: true },
      });

      auditAction(req, {
        action: AUDIT_ACTIONS.SELLER_LICENCE_SUBMIT,
        entity: 'SellerLicence',
        entityId: licence.id,
        after: { kind: licence.kind, status: licence.status },
        metadata: { sellerId: req.user.id },
      }).catch(() => {});

      return sendCreated(res, licence);
    } catch (err) {
      return sendServerError(res, err, 'Could not submit the licence. Please try again.');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Product compliance submission
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Submit the approved-label information for a product this seller proposed.
 *
 * Restricted to the catalog rows this seller created: the compliance record is
 * shared by every seller of that product, so letting an arbitrary seller rewrite
 * the safety text on someone else's listing would be the catalog-split bug all
 * over again, with worse consequences.
 *
 * Everything submitted is a TRANSCRIPTION of the manufacturer's approved label.
 * The reviewer checks it against the uploaded label document.
 */
router.put(
  '/products/:productId/compliance',
  rejectProtectedFields,
  [
    body('regulatedKind').isIn(REGULATED_KINDS),
    body('registrationNumber').optional().isString().isLength({ max: 120 }),
    body('registrationAuthority').optional().isString().isLength({ max: 160 }),
    body('registrationValidTo').optional().isISO8601(),
    body('activeIngredient').optional().isString().isLength({ max: 300 }),
    body('formulation').optional().isString().isLength({ max: 60 }),
    body('concentration').optional().isString().isLength({ max: 60 }),
    body('approvedCrops').optional().isArray({ max: 200 }),
    body('targetPests').optional().isArray({ max: 200 }),
    body('dosageText').optional().isString().isLength({ max: 4000 }),
    body('safetyEquipment').optional().isArray({ max: 30 }),
    body('storageInstructions').optional().isString().isLength({ max: 2000 }),
    body('firstAidText').optional().isString().isLength({ max: 4000 }),
    body('precautionText').optional().isString().isLength({ max: 4000 }),
    body('labelDocId').optional().isString().isLength({ max: 300 }),
    body('labelVersion').optional().isString().isLength({ max: 60 }),
  ],
  validate,
  async (req, res) => {
    try {
      const product = await prisma.product.findUnique({
        where: { id: req.params.productId },
        select: { id: true, createdBySellerId: true, sellerId: true },
      });
      if (!product) return sendNotFound(res, 'Product');

      const isOwner = product.createdBySellerId === req.user.id || product.sellerId === req.user.id;
      if (!isOwner && req.user.role !== 'ADMIN') {
        return sendForbidden(
          res,
          'Label and safety information is shared by every seller of this product and can only be updated by the seller who added it, or by KrushiSarva.',
        );
      }

      const b = req.body;
      const str = (v) => (v == null ? null : stripHtml(String(v)) || null);
      const arr = (v) => deepStripHtml(Array.isArray(v) ? v.map(String) : []);

      const data = {
        regulatedKind: b.regulatedKind,
        registrationNumber: str(b.registrationNumber),
        registrationAuthority: str(b.registrationAuthority),
        registrationValidTo: b.registrationValidTo ? new Date(b.registrationValidTo) : null,
        activeIngredient: str(b.activeIngredient),
        formulation: str(b.formulation),
        concentration: str(b.concentration),
        approvedCrops: arr(b.approvedCrops),
        targetPests: arr(b.targetPests),
        dosageText: str(b.dosageText),
        safetyEquipment: arr(b.safetyEquipment),
        storageInstructions: str(b.storageInstructions),
        firstAidText: str(b.firstAidText),
        precautionText: str(b.precautionText),
        labelDocId: str(b.labelDocId),
        labelVersion: str(b.labelVersion),
        // A submission is a submission, whether it is the first or the fifth.
        status: 'PENDING_REVIEW',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      };

      const record = await prisma.productCompliance.upsert({
        where: { productId: product.id },
        create: { productId: product.id, ...data },
        update: data,
        select: { id: true, productId: true, regulatedKind: true, status: true, updatedAt: true },
      });

      auditAction(req, {
        action: AUDIT_ACTIONS.PRODUCT_COMPLIANCE_SUBMIT,
        entity: 'ProductCompliance',
        entityId: record.id,
        after: { status: record.status, regulatedKind: record.regulatedKind },
        metadata: { productId: product.id, sellerId: req.user.id },
      }).catch(() => {});

      return sendSuccess(res, record);
    } catch (err) {
      return sendServerError(res, err, 'Could not save the compliance details. Please try again.');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Batches
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/listings/:listingId/batches', async (req, res) => {
  const listing = await prisma.sellerListing.findUnique({
    where: { id: req.params.listingId },
    select: { id: true, sellerId: true },
  });
  if (!listing) return sendNotFound(res, 'Offer');
  if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res, 'Not your offer');

  const batches = await prisma.productBatch.findMany({
    where: { listingId: listing.id },
    orderBy: [{ status: 'asc' }, { expiryDate: 'asc' }],
  });
  return sendSuccess(res, batches);
});

/**
 * Record a stock lot.
 *
 * `quantity` here is what the seller HOLDS of this lot; it does not move
 * `SellerListing.stockQty`. Stock stays a single authoritative counter because
 * checkout's Serializable decrement runs on it — splitting the sellable number
 * across two tables would put the oversell guarantee at the mercy of keeping them
 * in step. Batches say WHICH lots make the number up.
 */
router.post(
  '/listings/:listingId/batches',
  rejectProtectedFields,
  [
    body('batchNumber').isString().trim().isLength({ min: 1, max: 120 }),
    body('manufactureDate').optional().isISO8601(),
    body('expiryDate').optional().isISO8601(),
    body('quantity').isInt({ min: 0, max: 1_000_000 }),
  ],
  validate,
  async (req, res) => {
    try {
      const listing = await prisma.sellerListing.findUnique({
        where: { id: req.params.listingId },
        select: { id: true, sellerId: true, variant: { select: { productId: true } } },
      });
      if (!listing) return sendNotFound(res, 'Offer');
      if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res, 'Not your offer');

      const b = req.body;
      const expiryDate = b.expiryDate ? new Date(b.expiryDate) : null;
      const manufactureDate = b.manufactureDate ? new Date(b.manufactureDate) : null;

      if (expiryDate && manufactureDate && expiryDate <= manufactureDate) {
        return sendError(res, 'The expiry date must be after the manufacturing date.', 400);
      }
      // Recording an already-expired lot as sellable stock is either a typo or an
      // attempt to move dead stock. Either way it must not become ACTIVE.
      const alreadyExpired = expiryDate && expiryDate <= new Date();

      // Compliance may require an expiry for this product class.
      const compliance = listing.variant?.productId
        ? await prisma.productCompliance.findUnique({
            where: { productId: listing.variant.productId },
            select: { requiresExpiry: true, regulatedKind: true },
          })
        : null;
      if (compliance && compliance.regulatedKind !== 'NONE' && compliance.requiresExpiry && !expiryDate) {
        return sendError(res, 'An expiry date is required for this product.', 400);
      }

      const batch = await prisma.productBatch.upsert({
        where: { listingId_batchNumber: { listingId: listing.id, batchNumber: stripHtml(b.batchNumber) } },
        create: {
          listingId: listing.id,
          sellerId: listing.sellerId,
          batchNumber: stripHtml(b.batchNumber),
          manufactureDate,
          expiryDate,
          quantity: parseInt(b.quantity, 10),
          status: alreadyExpired ? 'EXPIRED' : 'ACTIVE',
        },
        update: {
          manufactureDate,
          expiryDate,
          quantity: parseInt(b.quantity, 10),
          // A seller updating a lot may move it back to ACTIVE only from ACTIVE /
          // EXPIRING_SOON / EXPIRED. QUARANTINED and RECALLED are admin states and
          // are preserved — a seller cannot lift a stop-sale by re-saving a form.
          ...(alreadyExpired ? { status: 'EXPIRED' } : {}),
        },
      });

      if (batch.status === 'QUARANTINED' || batch.status === 'RECALLED') {
        return sendError(
          res,
          'This batch has been held by KrushiSarva and cannot be edited. Contact support.',
          403,
          { batchStatus: batch.status },
        );
      }

      await invalidateSaleBlocks();
      return sendCreated(res, batch);
    } catch (err) {
      return sendServerError(res, err, 'Could not save the batch. Please try again.');
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Delivery service areas
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/service-areas', async (req, res) => {
  const areas = await prisma.sellerServiceArea.findMany({
    where: { sellerId: req.user.id },
    orderBy: [{ pincode: 'asc' }, { pincodePrefix: 'asc' }],
  });
  return sendSuccess(res, areas);
});

/**
 * Declare where this seller delivers, how long it takes, and what it costs.
 *
 * A seller with NO rows keeps today's behaviour exactly (serviceable everywhere,
 * platform default ETA), so this is additive and no existing seller goes offline
 * by not having filled it in.
 */
router.post(
  '/service-areas',
  rejectProtectedFields,
  [
    body('pincode').optional().isString().isLength({ min: 6, max: 6 }),
    body('pincodePrefix').optional().isString().isLength({ min: 3, max: 3 }),
    body('state').optional().isString().isLength({ max: 120 }),
    body('district').optional().isString().isLength({ max: 120 }),
    body('etaMinDays').isInt({ min: 0, max: 90 }),
    body('etaMaxDays').isInt({ min: 0, max: 90 }),
    body('surcharge').optional().isFloat({ min: 0, max: 100000 }),
    body('codAvailable').optional().isBoolean(),
    body('pickupAvailable').optional().isBoolean(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    const b = req.body;
    if (!b.pincode && !b.pincodePrefix && !b.district && !b.state) {
      return sendError(res, 'Give a PIN code, a 3-digit PIN prefix, a district or a state.', 400);
    }
    if (b.pincode && !isValidPincode(b.pincode)) {
      return sendError(res, 'Enter a valid 6-digit PIN code.', 400);
    }
    if (b.pincodePrefix && !/^[1-9][0-9]{2}$/.test(b.pincodePrefix)) {
      return sendError(res, 'A PIN prefix is the first 3 digits of a PIN code.', 400);
    }
    const etaMin = parseInt(b.etaMinDays, 10);
    const etaMax = parseInt(b.etaMaxDays, 10);
    if (etaMax < etaMin) {
      return sendError(res, 'The slowest delivery estimate cannot be earlier than the fastest.', 400);
    }

    try {
      const data = {
        state: b.state ? stripHtml(b.state) : null,
        district: b.district ? stripHtml(b.district) : null,
        etaMinDays: etaMin,
        etaMaxDays: etaMax,
        surcharge: b.surcharge != null ? D(b.surcharge).toFixed(2) : '0.00',
        codAvailable: b.codAvailable !== false,
        pickupAvailable: b.pickupAvailable === true,
        isActive: b.isActive !== false,
      };

      // One non-null key per area — see serviceAreaMatchKey(). Upserting on
      // (sellerId, pincode, pincodePrefix) was impossible: Prisma rejects a null
      // inside a compound-unique WHERE, and Postgres would not have enforced it
      // anyway because it treats NULLs as distinct.
      const matchKey = serviceAreaMatchKey({
        pincode: b.pincode, pincodePrefix: b.pincodePrefix,
        district: data.district, state: data.state,
      });
      if (!matchKey) return sendError(res, 'Give a PIN code, a 3-digit PIN prefix, a district or a state.', 400);

      const area = await prisma.sellerServiceArea.upsert({
        where: { sellerId_matchKey: { sellerId: req.user.id, matchKey } },
        create: {
          sellerId: req.user.id,
          matchKey,
          pincode: b.pincode || null,
          pincodePrefix: b.pincodePrefix || null,
          ...data,
        },
        update: data,
      });

      return sendCreated(res, area);
    } catch (err) {
      return sendServerError(res, err, 'Could not save the delivery area. Please try again.');
    }
  },
);

router.delete('/service-areas/:id', async (req, res) => {
  const area = await prisma.sellerServiceArea.findUnique({ where: { id: req.params.id } });
  if (!area) return sendSuccess(res, { deleted: true }); // idempotent
  if (area.sellerId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res, 'Not your delivery area');

  await prisma.sellerServiceArea.delete({ where: { id: area.id } });
  return sendSuccess(res, { deleted: true });
});

export default router;
