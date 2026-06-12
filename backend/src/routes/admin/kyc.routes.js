/**
 * Admin KYC / Seller verification — /api/v1/admin/kyc
 *
 * GET  /kyc?status=            seller KYC queue (filter by User.kycStatus)
 * GET  /kyc/:userId            view seller KYC: masked bank fields + short-lived
 *                              signed document URLs (this access is itself audited;
 *                              ?reveal=true&reason= decrypts bank/Aadhaar/PAN)
 * POST /kyc/:userId/verify     approve → kycStatus VERIFIED, role → SELLER
 * POST /kyc/:userId/reject     reject  → kycStatus REJECTED + reason
 *
 * ADMIN gate + authenticate applied by the parent admin router.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { maskSensitiveFields } from '../../utils/mask.js';
import { decrypt } from '../../utils/encrypt.js';
import { maskPhone, auditReveal } from '../../utils/adminPii.js';
import { signedPrivateUrl } from '../../config/cloudinary.js';
import { adminAudit, listParams, revealValidators } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import logger from '../../utils/logger.js';

const router = Router();

const KYC_STATUSES = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];
// Roles that "become a seller" on KYC approval (ADMIN/SELLER are left as-is).
const SELLER_FLIP_FROM = new Set(['FARMER', 'VERIFIED_FARMER', 'LABOUR_PROVIDER', 'MACHINERY_OWNER']);

// ── GET /kyc — the seller KYC queue ──────────────────────────────────────────
router.get(
  '/',
  [query('status').optional().isIn(KYC_STATUSES), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.status) where.user = { kycStatus: req.query.status };
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.sellerProfile, {
        where, cursor, limit,
        include: { user: { select: { id: true, name: true, phone: true, kycStatus: true, role: true, district: true, state: true } } },
      });
      const items = page.items.map((sp) => ({
        id: sp.id,
        userId: sp.userId,
        createdAt: sp.createdAt,
        kycVerifiedAt: sp.kycVerifiedAt,
        kycRejectedReason: sp.kycRejectedReason,
        documentCount: sp.kycDocumentUrls?.length || 0,
        user: sp.user ? { ...sp.user, phone: maskPhone(sp.user.phone) } : null,
      }));
      return sendSuccess(res, { items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load KYC queue');
    }
  },
);

// ── GET /kyc/:userId — review one seller's KYC ───────────────────────────────
router.get(
  '/:userId',
  [param('userId').isUUID(), ...revealValidators()],
  validate,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const sp = await prisma.sellerProfile.findUnique({
        where: { userId },
        include: { user: { select: { id: true, name: true, phone: true, kycStatus: true, role: true, district: true, state: true, aadhaarLast4: true } } },
      });
      if (!sp) return sendNotFound(res, 'Seller profile');

      const reveal = String(req.query.reveal) === 'true';

      // Viewing KYC documents/fields is PII access — always audited.
      await adminAudit(req, ADMIN_ACTIONS.KYC_DOCS_ACCESS, 'SellerProfile', sp.id, {
        metadata: { userId, reveal, reason: req.query.reason ?? null },
      });
      if (reveal) {
        await auditReveal(req, { entity: 'SellerProfile', entityId: sp.id, fields: ['bankAccountNumber', 'aadharNumber', 'panNumber'], reason: req.query.reason });
      }

      // Short-lived signed URLs for the private KYC document assets (best-effort).
      const documents = (sp.kycDocumentUrls || []).map((publicId, i) => {
        let url = null;
        try { url = signedPrivateUrl(publicId, { resourceType: 'image' }); }
        catch (e) { logger.warn('[KYC] signed url failed: %s', e.message); }
        return { index: i, publicId, url };
      });

      const bank = reveal
        ? {
            bankHolderName: decrypt(sp.bankHolderName) ?? sp.bankHolderName,
            bankName: decrypt(sp.bankName) ?? sp.bankName,
            bankAccountNumber: decrypt(sp.bankAccountNumber) ?? sp.bankAccountNumber,
            bankIfsc: decrypt(sp.bankIfsc) ?? sp.bankIfsc,
            aadharNumber: decrypt(sp.aadharNumber) ?? sp.aadharNumber,
            panNumber: decrypt(sp.panNumber) ?? sp.panNumber,
          }
        : maskSensitiveFields({
            bankHolderName: sp.bankHolderName, bankName: sp.bankName, bankAccountNumber: sp.bankAccountNumber,
            bankIfsc: sp.bankIfsc, aadharNumber: sp.aadharNumber, panNumber: sp.panNumber,
          });

      return sendSuccess(res, {
        userId,
        piiRevealed: reveal,
        user: sp.user ? { ...sp.user, phone: reveal ? sp.user.phone : maskPhone(sp.user.phone) } : null,
        kycVerifiedAt: sp.kycVerifiedAt,
        kycRejectedReason: sp.kycRejectedReason,
        bank,
        documents,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load KYC detail');
    }
  },
);

// ── POST /kyc/:userId/verify ─────────────────────────────────────────────────
router.post('/:userId/verify', [param('userId').isUUID(), body('note').optional().isString().trim().isLength({ max: 1000 })], validate, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, kycStatus: true } });
    if (!user) return sendNotFound(res, 'User');
    const sp = await prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!sp) return sendNotFound(res, 'Seller profile');

    const flipRole = SELLER_FLIP_FROM.has(user.role);
    const userData = { kycStatus: 'VERIFIED' };
    if (flipRole) {
      userData.role = 'SELLER';
      // Propagate the new SELLER role on the user's next request (silent refresh).
      userData.tokenVersion = { increment: 1 };
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: userData }),
      prisma.sellerProfile.update({ where: { userId }, data: { kycVerifiedAt: new Date(), kycRejectedReason: null } }),
    ]);

    await adminAudit(req, ADMIN_ACTIONS.KYC_VERIFY, 'User', userId, {
      before: { kycStatus: user.kycStatus, role: user.role },
      after: { kycStatus: 'VERIFIED', role: flipRole ? 'SELLER' : user.role },
      metadata: { note: req.body.note ?? null, roleFlipped: flipRole },
    });

    return sendSuccess(res, { userId, kycStatus: 'VERIFIED', role: flipRole ? 'SELLER' : user.role });
  } catch (err) {
    return sendServerError(res, err, 'Failed to verify KYC');
  }
});

// ── POST /kyc/:userId/reject ─────────────────────────────────────────────────
router.post('/:userId/reject', [param('userId').isUUID(), body('reason').isString().trim().isLength({ min: 3, max: 1000 })], validate, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, kycStatus: true } });
    if (!user) return sendNotFound(res, 'User');
    const sp = await prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!sp) return sendNotFound(res, 'Seller profile');

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { kycStatus: 'REJECTED' } }),
      prisma.sellerProfile.update({ where: { userId }, data: { kycRejectedReason: req.body.reason, kycVerifiedAt: null } }),
    ]);

    await adminAudit(req, ADMIN_ACTIONS.KYC_REJECT, 'User', userId, {
      before: { kycStatus: user.kycStatus },
      after: { kycStatus: 'REJECTED' },
      metadata: { reason: req.body.reason },
    });

    return sendSuccess(res, { userId, kycStatus: 'REJECTED' });
  } catch (err) {
    return sendServerError(res, err, 'Failed to reject KYC');
  }
});

export default router;
