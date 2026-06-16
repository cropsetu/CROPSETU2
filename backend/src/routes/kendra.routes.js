/**
 * Krushi Seva Kendra onboarding & status — /api/v1/kendra
 *
 * Powers the dedicated Kendra website (a standalone web app, separate from the
 * mobile farmer app and the admin panel). A Kendra:
 *   1. signs in with phone OTP (reuses /auth — same as the admin SPA);
 *   2. POST /register — submits business details + dealer LICENCE (number / type /
 *      issuing state / expiry) and its location. This promotes FARMER → SELLER
 *      (consent-gated, DPDP §5) and sets kycStatus = SUBMITTED;
 *   3. POST /users/me/licence-documents — uploads the licence scans PRIVATELY;
 *   4. waits for an ADMIN to verify the licence (kycStatus → VERIFIED). Only then
 *      does the Kendra surface to nearby farmers (see cropReportShare.routes.js);
 *   5. receives & replies to crop-diagnosis reports via /crop-reports/seller/*.
 *
 * GET /me returns the onboarding stage so the website routes to the right screen
 * (register → pending → approved/inbox). All routes require authentication.
 */
import { Router } from 'express';
import { body } from 'express-validator';

import { authenticate, blockMinors } from '../middleware/auth.js';
import { clientIp, rateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError, sendNotFound } from '../utils/response.js';
import { encryptNumber, stripHtml } from '../utils/encrypt.js';
import { signedPrivateUrl, KYC_SIGNED_URL_TTL_SEC } from '../config/cloudinary.js';
import { CONSENT_PURPOSES, CONSENT_POLICY_VERSION } from '../constants/consent.js';
import { KRUSHI_KENDRA_TYPES, isKendraBusinessType } from '../constants/kendra.js';
import logger from '../utils/logger.js';
import prisma from '../config/db.js';

const router = Router();
router.use(authenticate); // every Kendra route requires a signed-in user

// Tight cap on registration churn — a real Kendra registers once, then edits rarely.
const registerLimit = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max:      10,
  prefix:   'kendra:register',
  key:      (req) => req.user?.id || clientIp(req),
  message:  'Too many registration attempts. Please wait a while and try again.',
});

// Map stored private licence-doc public_ids → short-lived signed URLs.
function signDocs(publicIds) {
  return (publicIds || [])
    .filter(Boolean)
    .map((id) => ({ url: signedPrivateUrl(id), expiresInSec: KYC_SIGNED_URL_TTL_SEC }));
}

// Coarse onboarding stage the website routes on.
//   UNREGISTERED → not yet a Kendra (no Kendra businessType / no licence on file)
//   PENDING      → submitted, awaiting admin verification (kycStatus PENDING|SUBMITTED)
//   APPROVED     → admin verified the licence (kycStatus VERIFIED) → discoverable
//   REJECTED     → admin rejected; the Kendra can resubmit
function deriveStage(user, sp) {
  if (!isKendraBusinessType(user.businessType) || !sp?.licenceNumber) return 'UNREGISTERED';
  switch (user.kycStatus) {
    case 'VERIFIED': return 'APPROVED';
    case 'REJECTED': return 'REJECTED';
    default:         return 'PENDING';
  }
}

// ── GET /me — Kendra onboarding status (drives the website's routing) ──────────
router.get('/me', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, phone: true, name: true, role: true, businessType: true,
        kycStatus: true, district: true, taluka: true, village: true,
        pincode: true, state: true,
        sellerProfile: {
          select: {
            licenceNumber: true, licenceType: true, licenceIssuingState: true,
            licenceExpiry: true, licenceVerifiedAt: true, licenceDocUrls: true,
            kycRejectedReason: true,
          },
        },
      },
    });
    if (!user) return sendNotFound(res, 'User');

    const sp = user.sellerProfile;
    return sendSuccess(res, {
      id:           user.id,
      phone:        user.phone,
      name:         user.name,
      role:         user.role,
      businessType: user.businessType,
      kycStatus:    user.kycStatus,
      stage:        deriveStage(user, sp),
      location: {
        district: user.district, taluka: user.taluka,
        village:  user.village,  pincode: user.pincode, state: user.state,
      },
      licence: sp
        ? {
            number:         sp.licenceNumber,
            type:           sp.licenceType,
            issuingState:   sp.licenceIssuingState,
            expiry:         sp.licenceExpiry,
            verifiedAt:     sp.licenceVerifiedAt,
            rejectedReason: sp.kycRejectedReason,
            documents:      signDocs(sp.licenceDocUrls),
            documentCount:  sp.licenceDocUrls?.length || 0,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, '[Kendra] GET /me error');
    return sendError(res, 'Failed to load Kendra status', 500);
  }
});

// ── POST /register — submit Kendra business details + dealer licence ──────────
// Atomic: location + businessType + (consent-gated) FARMER→SELLER promotion +
// licence fields + kycStatus=SUBMITTED all commit together. Licence DOCUMENTS are
// uploaded separately via POST /users/me/licence-documents (multipart, private).
router.post(
  '/register',
  registerLimit,
  blockMinors, // [DPDP §9] no seller/financial onboarding for under-18s
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Business name is required'),
    body('businessType').isIn(KRUSHI_KENDRA_TYPES)
      .withMessage('Select a valid Krushi Seva Kendra business type'),
    body('district').trim().isLength({ min: 1, max: 100 }).withMessage('District is required'),
    body('taluka').optional().trim().isLength({ max: 100 }),
    body('village').optional().trim().isLength({ max: 100 }),
    body('state').optional().trim().isLength({ max: 100 }),
    body('pincode').optional({ values: 'falsy' }).matches(/^\d{6}$/).withMessage('Pincode must be 6 digits'),
    body('lat').optional({ values: 'null' }).isFloat({ min: -90,  max: 90  }),
    body('lng').optional({ values: 'null' }).isFloat({ min: -180, max: 180 }),
    body('licenceNumber').trim().isLength({ min: 3, max: 60 }).withMessage('Licence number is required'),
    body('licenceType').optional().trim().isLength({ max: 60 }),
    body('licenceIssuingState').optional().trim().isLength({ max: 100 }),
    body('licenceExpiry').optional({ values: 'null' }).isISO8601().withMessage('Licence expiry must be a valid date')
      .custom((val) => { if (val && new Date(val) < new Date()) throw new Error('Licence has already expired'); return true; }),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        name, businessType, district, taluka, village, state, pincode,
        lat, lng, licenceNumber, licenceType, licenceIssuingState, licenceExpiry,
      } = req.body;

      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where:  { id: req.user.id },
          select: { id: true, role: true, isMinor: true },
        });

        const userData = {
          name:         stripHtml(name),
          businessType,
          district:     stripHtml(district),
          kycStatus:    'SUBMITTED',
        };
        if (taluka  !== undefined) userData.taluka  = stripHtml(taluka);
        if (village !== undefined) userData.village = stripHtml(village);
        if (state   !== undefined) userData.state   = stripHtml(state);
        if (pincode)               userData.pincode = pincode;
        // [C2] geolocation encrypted at rest — decrypted in the nearby-Kendra search.
        if (lat !== undefined && lat !== null) userData.lat = encryptNumber(lat);
        if (lng !== undefined && lng !== null) userData.lng = encryptNumber(lng);

        // [DPDP §5/§9] consent-gated FARMER → SELLER promotion; minors never flip.
        const promote = current.role === 'FARMER' && current.isMinor !== true;
        if (promote) userData.role = 'SELLER';

        const user = await tx.user.update({ where: { id: req.user.id }, data: userData });

        const licenceData = {
          licenceNumber:       stripHtml(licenceNumber),
          licenceType:         licenceType ? stripHtml(licenceType) : null,
          licenceIssuingState: licenceIssuingState ? stripHtml(licenceIssuingState) : null,
          licenceExpiry:       licenceExpiry ? new Date(licenceExpiry) : null,
        };
        await tx.sellerProfile.upsert({
          where:  { userId: req.user.id },
          create: { userId: req.user.id, ...licenceData },
          // a fresh submission supersedes any prior rejection reason
          update: { ...licenceData, kycRejectedReason: null },
        });

        if (promote) {
          // DPDP §5 proof of the explicit opt-in, atomic with the role change.
          await tx.consentRecord.create({
            data: {
              userId:        req.user.id,
              purpose:       CONSENT_PURPOSES.SELLER_ONBOARDING,
              granted:       true,
              policyVersion: CONSENT_POLICY_VERSION,
              method:        'kendra_onboarding',
              ip:            clientIp(req),
              userAgent:     req.headers['user-agent'] || null,
              metadata:      JSON.stringify({ businessType }),
            },
          });
        }
        return user;
      });

      const rolePromoted = req.user.role === 'FARMER' && updated.role === 'SELLER';
      return sendSuccess(
        res,
        {
          id:           updated.id,
          role:         updated.role,
          businessType: updated.businessType,
          kycStatus:    updated.kycStatus,
          stage:        'PENDING',
          rolePromoted,
          // NEXT STEPS for the web client:
          //  1. if rolePromoted, POST /auth/refresh to pick up the SELLER role;
          //  2. POST /users/me/licence-documents to upload the licence scans.
        },
        201,
      );
    } catch (err) {
      logger.error({ err }, '[Kendra] POST /register error');
      return sendError(res, 'Failed to register Kendra', 500);
    }
  },
);

export default router;
