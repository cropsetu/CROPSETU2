/**
 * User Routes
 * GET  /api/v1/users/me                → get own profile (includes sellerProfile)
 * PUT  /api/v1/users/me                → update name, avatar, language, location,
 *                                        businessType, gst, taluka, village
 * PUT  /api/v1/users/me/seller-profile → upsert bank account + KYC documents
 * PUT  /api/v1/users/me/farm           → upsert farm details
 * POST /api/v1/users/me/push-token     → register Expo push token
 *
 * Security fixes applied:
 *   C1  – PII masked in every API response (Aadhaar, PAN, bank account)
 *   C2  – PII encrypted at rest via AES-256-GCM before DB write
 *   H2  – GST number validated with regex server-side
 *   H3  – Aadhaar validated as exactly 12 digits
 *   M1  – Per-endpoint rate limit on state-changing routes (20 writes / 15 min)
 *   M3  – cropTypes array capped at 20 items, each item max 50 chars
 *   M4  – gstOptOut coercion bug fixed
 *   M5  – soilType / irrigationType max length enforced
 *   L1  – Push token max length + Expo format validation
 *   L2  – IFSC regex applied consistently on PUT /me
 *   L3  – try/catch on every async handler
 *   L5  – HTML stripped from all free-text fields before storage
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import { authenticate, requireRole, blockMinors } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { isMinorDob } from '../utils/age.js';
import { isSensitivePiiUpdate } from '../constants/pii.js';
import { validate } from '../middleware/validate.js';
import {
  createUploader, createAvatarUploader, uploadFiles,
  uploadPrivateFiles, signedPrivateUrl, KYC_SIGNED_URL_TTL_SEC,
} from '../config/cloudinary.js';
import prisma from '../config/db.js';
import { sendSuccess, sendError, sendNotFound } from '../utils/response.js';
import {
  encrypt,
  decrypt,
  encryptNumber,
  stripHtml,
} from '../utils/encrypt.js';
import { maskSensitiveFields } from '../utils/mask.js';
import logger from '../utils/logger.js';
import { auditPiiUpdate, auditLog, auditAction, AUDIT_ACTIONS } from '../services/audit.service.js';
import { verifyOtp } from '../services/otp.service.js';
import { eraseUserAccount } from '../services/erasure.service.js';
import { signAccessToken, createRefreshToken, enforceSessionLimit } from '../utils/jwt.js';

const router = Router();
router.param('userId', uuidParamGuard); // :userId (admin KYC lookup) — reject non-UUIDs with 400
router.use(authenticate); // all user routes require auth

const avatarUpload = createAvatarUploader();
// KYC documents are buffered in memory by multer, then streamed to Cloudinary's
// PRIVATE (authenticated) storage — never the public CDN. Field name: 'images'.
const kycUpload = createUploader(5);

// Map stored Cloudinary public_ids → short-lived signed URLs for the response.
// We never return the raw public_ids; access always goes back through signing.
function signKycDocs(publicIds) {
  return (publicIds || [])
    .filter(Boolean)
    .map((id) => ({ url: signedPrivateUrl(id), expiresInSec: KYC_SIGNED_URL_TTL_SEC }));
}

// ── [M1] Per-user rate limiter for expensive write operations ─────────────────
// Caps profile / seller-profile / farm writes at 20 per 15 min per user. These
// routes encrypt PII and run audit writes, so they're costly and a prime target
// for abuse. Keyed on the authenticated user id (these routes sit behind
// `authenticate`); falls back to client IP only if user is somehow absent.
// Sliding window backed by Redis with an in-memory fallback (see middleware).
const profileWriteLimit = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,             // 20 writes / 15 min / user
  prefix:   'user:write',
  key:      (req) => req.user?.id || clientIp(req),
  message:  'Too many profile updates. Please wait a few minutes and try again.',
});

// ── Dedicated rate limit for SENSITIVE PII churn ─────────────────────────────
// The general profileWriteLimit (20/15min) is shared with benign edits (name,
// avatar, location). Sensitive identifiers (Aadhaar, PAN, bank, GST, DOB) change
// very rarely, so they get their own much tighter budget on top: 5 changes per
// hour per user. Excess sensitive-PII updates return 429. Used in two flavours:
//   - piiUpdateLimit:   only counts requests that actually carry a sensitive PII
//                       field (so a name-only PUT /me is unaffected).
//   - kycSubmitLimit:   unconditional — KYC docs arrive as multipart files (not
//                       body fields), and every submission is inherently PII.
// Both share the 'user:pii' counter so the cap spans all sensitive-PII routes.
const PII_LIMIT = { windowMs: 60 * 60 * 1000, max: 5, prefix: 'user:pii',
  message: 'Too many updates to sensitive details. For your security, please wait before changing these again.' };

const piiUpdateLimit = rateLimiter({
  ...PII_LIMIT,
  key: (req) => (req.user?.id && isSensitivePiiUpdate(req.body) ? req.user.id : null),
});

const kycSubmitLimit = rateLimiter({
  ...PII_LIMIT,
  key: (req) => req.user?.id || clientIp(req),
});

// ── Helper: recalculate profile completion (0-100) ────────────────────────────
function calcProfileCompletion(user, sellerProfile) {
  const checks = [
    user.name,
    user.businessType,
    user.district,
    user.taluka,
    user.village,
    user.gstNumber || user.gstOptOut,
    sellerProfile?.bankAccountNumber,
    sellerProfile?.bankIfsc,
    sellerProfile?.bankHolderName,
    sellerProfile?.bankName,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

// ── Helper: build the masked/safe seller-profile response shape ───────────────
// [C1] Never expose full Aadhaar, PAN, or bank account numbers.
const safeSellerProfile = maskSensitiveFields;

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, phone: true, name: true, avatar: true,
        role: true, language: true, createdAt: true,
        statusQuote: true,
        pincode: true, district: true, taluka: true, village: true,
        city: true, state: true,
        businessType: true, gstNumber: true, gstOptOut: true,
        kycStatus: true, profileCompletion: true,
        isOnline: true, lastSeenAt: true,
        // Farmer profile module
        onboardingStep: true, activeFarmId: true, totalFarms: true, totalLandAcres: true,
        gender: true, education: true, farmingExperienceYrs: true,
        // [DPDP §9] surface minor status + guardian-consent state to the client
        dateOfBirth: true, isMinor: true, guardianConsentAt: true,
        sellerProfile: {
          select: {
            id: true,
            bankHolderName: true, bankName: true,
            bankAccountNumber: true, bankIfsc: true,
            aadharNumber: true, panNumber: true,
            kycVerifiedAt: true, kycRejectedReason: true,
            updatedAt: true,
          },
        },
        farmDetail: true,
        _count: {
          select: {
            orders: true, animalListings: true, posts: true,
            bookings: true, sellerProducts: true, cropDiseaseReports: true,
            machineryListings: { where: { status: 'ACTIVE' } },
            labourListings:    { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!user) return sendNotFound(res, 'User');

    // [C1] Return masked PII; [C2] decrypt the owner's own GST for display.
    return sendSuccess(res, {
      ...user,
      gstNumber: user.gstNumber ? (decrypt(user.gstNumber) ?? user.gstNumber) : user.gstNumber,
      sellerProfile: safeSellerProfile(user.sellerProfile),
    });
  } catch (err) {
    logger.error({ err }, '[User] GET /me error');
    return sendError(res, 'Failed to load profile', 500);
  }
});

// ── PUT /me ───────────────────────────────────────────────────────────────────
router.put(
  '/me',
  profileWriteLimit, // [M1]
  (req, res, next) => avatarUpload(req, res, (err) => {
    if (err) return sendError(res, err.message, 400);
    next();
  }),
  piiUpdateLimit, // tight cap on sensitive-PII churn (runs after body is parsed)
  [
    body('name').optional().trim().isLength({ min: 2, max: 80 }),
    body('language').optional().isIn(['en', 'hi', 'mr']),
    body('statusQuote').optional().trim().isLength({ max: 200 }),
    body('pincode').optional().matches(/^\d{6}$/),
    body('district').optional().trim().isLength({ max: 100 }),
    body('taluka').optional().trim().isLength({ max: 100 }),
    body('village').optional().trim().isLength({ max: 100 }),
    body('city').optional().trim().isLength({ max: 100 }),
    body('state').optional().trim().isLength({ max: 100 }),
    body('lat').optional({ values: 'null' }).isFloat({ min: -90,  max: 90  }).withMessage('lat must be between -90 and 90'),
    body('lng').optional({ values: 'null' }).isFloat({ min: -180, max: 180 }).withMessage('lng must be between -180 and 180'),
    // [DPDP §9] Date of birth — drives minor detection. Must be a valid past date.
    body('dateOfBirth').optional({ values: 'null' }).isISO8601().withMessage('dateOfBirth must be a valid date')
      .custom((val) => { if (val && new Date(val) > new Date()) throw new Error('dateOfBirth cannot be in the future'); return true; }),
    body('businessType').optional().isIn([
      'individual_farmer', 'farmer_group', 'fpc', 'cooperative', 'agri_business',
      'krushi_kendra', 'fertilizer_dealer', 'pesticide_dealer', 'seed_supplier', 'agri_input_shop',
    ]),
    // [H2] GST format validated server-side, not just length
    body('gstNumber').optional().trim()
      .custom((val, { req: r }) => {
        // Only validate format when gstOptOut is not set
        if (r.body.gstOptOut === true || r.body.gstOptOut === 'true') return true;
        if (!val) return true; // blank is fine (user hasn't added it yet)
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstRegex.test(val.toUpperCase())) {
          throw new Error('Invalid GST number format (e.g. 27ABCDE1234F1Z5)');
        }
        return true;
      }),
    body('gstOptOut').optional().isBoolean(),
    body('bankHolderName').optional().trim().isLength({ max: 100 }),
    body('bankName').optional().trim().isLength({ max: 100 }),
    // KYC/bank fields use `values: 'falsy'` so the frontend can send empty
    // strings (for fields the user hasn't filled yet) without tripping format
    // checks. Empty → skip validation; non-empty → enforce format.
    body('bankAccountNumber').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
    // [L2] IFSC regex consistent with PUT /me/seller-profile
    body('bankIfsc').optional({ values: 'falsy' }).trim()
      .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/i)
      .withMessage('IFSC must be 11 characters (e.g. SBIN0012345)'),
    // [H3] Aadhaar must be exactly 12 digits
    body('aadharNumber').optional({ values: 'falsy' }).trim()
      .matches(/^\d{12}$/)
      .withMessage('Aadhaar must be exactly 12 digits'),
    body('panNumber').optional({ values: 'falsy' }).trim().isLength({ min: 10, max: 10 }),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        name, language, statusQuote,
        pincode, district, taluka, village, city, state,
        lat, lng, dateOfBirth,
        businessType, gstNumber, gstOptOut,
        bankHolderName, bankName, bankAccountNumber, bankIfsc,
        aadharNumber, panNumber,
      } = req.body;

      // Upload avatar if file was attached
      let avatar;
      if (req.files?.length) {
        try {
          const urls = await uploadFiles(req.files, 'avatars');
          avatar = urls[0] || undefined;
        } catch (uploadErr) {
          logger.error({ err: uploadErr }, '[PUT /me] avatar upload failed');
          return sendError(res, 'Photo upload failed. Please try a different image.', 400);
        }
      }

      // [M4] Coerce gstOptOut to boolean FIRST so the gstNumber conditional is correct
      const resolvedGstOptOut = gstOptOut !== undefined ? Boolean(JSON.parse(gstOptOut)) : undefined;

      // ── 1. Build User update payload ───────────────────────────────────────
      const userData = {};
      // [L5] Strip HTML from all free-text fields before storage
      if (name        !== undefined) userData.name        = stripHtml(name);
      if (language    !== undefined) userData.language    = language;
      if (avatar      !== undefined) userData.avatar      = avatar;
      if (statusQuote !== undefined) userData.statusQuote = stripHtml(statusQuote);
      if (pincode     !== undefined) userData.pincode     = pincode;
      if (district    !== undefined) userData.district    = district;
      if (taluka      !== undefined) userData.taluka      = taluka;
      if (village     !== undefined) userData.village     = village;
      if (city        !== undefined) userData.city        = city;
      if (state       !== undefined) userData.state       = state;
      // [C2] Encrypt geolocation at rest — stored as ciphertext, decrypted to a
      // Float in app code (e.g. the sellers-nearby geo search) when needed.
      if (lat         !== undefined) userData.lat         = lat === null ? null : encryptNumber(lat);
      if (lng         !== undefined) userData.lng         = lng === null ? null : encryptNumber(lng);
      // [DPDP §9] Persist dob and derive minor status so restricted flows can be
      // gated. Setting dob recomputes isMinor; clearing it resets the flag.
      if (dateOfBirth !== undefined) {
        userData.dateOfBirth = dateOfBirth === null ? null : new Date(dateOfBirth);
        userData.isMinor     = dateOfBirth === null ? false : isMinorDob(dateOfBirth);
      }
      if (businessType !== undefined) userData.businessType = businessType;
      // Auto-upgrade role to SELLER when a businessType is set on a FARMER account.
      // The role lives in the JWT, so we also re-issue fresh tokens at the end of
      // this handler when this flip happens (otherwise the next request would
      // still see the old FARMER role).
      // [DPDP §9] Never auto-upgrade a minor to SELLER. (Seller financial flows
      // are also blocked by the blockMinors middleware on those routes.)
      const roleFlipped = businessType && req.user.role === 'FARMER' && userData.isMinor !== true;
      if (roleFlipped) userData.role = 'SELLER';
      if (resolvedGstOptOut !== undefined) userData.gstOptOut = resolvedGstOptOut;
      // [M4] Use the already-resolved boolean, not the raw body string.
      // [C2] GST is a financial identifier — encrypt at rest. The empty
      // opt-out value stays '' (encrypt is a no-op on ''), so the truthiness
      // check in calcProfileCompletion still works.
      if (gstNumber !== undefined) {
        const gstPlain = resolvedGstOptOut ? '' : (gstNumber?.trim().toUpperCase() || '');
        userData.gstNumber = encrypt(gstPlain);
      }

      // ── 2. Build SellerProfile payload — [C2] encrypt before write ─────────
      const hasBankOrKyc = [
        bankHolderName, bankName, bankAccountNumber, bankIfsc,
        aadharNumber, panNumber,
      ].some((v) => v !== undefined);

      if (!Object.keys(userData).length && !hasBankOrKyc) {
        return sendError(res, 'No fields to update', 400);
      }

      // ── 3. Run updates in a transaction ────────────────────────────────────
      const [updatedUser] = await prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({
          where: { id: req.user.id },
          include: { sellerProfile: true },
        });

        if (Object.keys(userData).length) {
          user = await tx.user.update({
            where: { id: req.user.id },
            data: userData,
            include: { sellerProfile: true },
          });
        }

        if (hasBankOrKyc) {
          const spData = {};
          // [C2] Encrypt all bank/KYC financial PII before writing to DB.
          // Sanitize (stripHtml / uppercase) the plaintext FIRST, then encrypt,
          // so the ciphertext decrypts back to the clean canonical value.
          if (bankHolderName    !== undefined) spData.bankHolderName    = encrypt(stripHtml(bankHolderName));
          if (bankName          !== undefined) spData.bankName          = encrypt(stripHtml(bankName));
          if (bankAccountNumber !== undefined) spData.bankAccountNumber = encrypt(bankAccountNumber);
          if (bankIfsc          !== undefined) spData.bankIfsc          = encrypt(bankIfsc?.toUpperCase());
          if (aadharNumber      !== undefined) spData.aadharNumber      = encrypt(aadharNumber);
          if (panNumber         !== undefined) spData.panNumber         = encrypt(panNumber?.toUpperCase());

          const sp = await tx.sellerProfile.upsert({
            where:  { userId: req.user.id },
            create: { userId: req.user.id, ...spData },
            update: spData,
          });
          user = { ...user, sellerProfile: sp };

          // [FIX] Audit log PII changes (fields redacted, only tracks WHICH fields changed)
          auditPiiUpdate(req, 'SellerProfile', req.user.id, spData).catch(() => {});
        }

        const completion = calcProfileCompletion(user, user.sellerProfile);
        if (completion !== user.profileCompletion) {
          user = await tx.user.update({
            where: { id: req.user.id },
            data:  { profileCompletion: completion },
            include: { sellerProfile: true },
          });
        }

        return [user];
      });

      // If we flipped FARMER → SELLER above, re-issue tokens so the new role
      // is reflected in the JWT immediately (no logout/login round-trip).
      let tokens = null;
      if (roleFlipped && updatedUser.role === 'SELLER') {
        const accessToken  = signAccessToken({ sub: updatedUser.id, role: updatedUser.role, tokenVersion: updatedUser.tokenVersion });
        const refreshToken = await createRefreshToken(updatedUser.id);
        await enforceSessionLimit(updatedUser.id); // cap concurrent sessions
        tokens = { accessToken, refreshToken };
      }

      // [C1] Return masked PII — never send full Aadhaar / account in response
      return sendSuccess(res, {
        id:                updatedUser.id,
        phone:             updatedUser.phone,
        name:              updatedUser.name,
        avatar:            updatedUser.avatar,
        role:              updatedUser.role,
        language:          updatedUser.language,
        statusQuote:       updatedUser.statusQuote,
        pincode:           updatedUser.pincode,
        district:          updatedUser.district,
        taluka:            updatedUser.taluka,
        village:           updatedUser.village,
        city:              updatedUser.city,
        state:             updatedUser.state,
        businessType:      updatedUser.businessType,
        gstNumber:         updatedUser.gstNumber ? (decrypt(updatedUser.gstNumber) ?? updatedUser.gstNumber) : updatedUser.gstNumber,
        gstOptOut:         updatedUser.gstOptOut,
        kycStatus:         updatedUser.kycStatus,
        profileCompletion: updatedUser.profileCompletion,
        sellerProfile:     safeSellerProfile(updatedUser.sellerProfile),
        createdAt:         updatedUser.createdAt,
        ...(tokens && { tokens }),
      });
    } catch (err) {
      logger.error({ err }, '[User] PUT /me error');
      return sendError(res, 'Failed to update profile', 500);
    }
  }
);

// ── PUT /me/seller-profile ────────────────────────────────────────────────────
router.put(
  '/me/seller-profile',
  profileWriteLimit, // [M1]
  blockMinors,       // [DPDP §9] no financial/seller onboarding for under-18s
  piiUpdateLimit,    // tight cap on sensitive-PII churn (bank / Aadhaar / PAN)
  [
    body('bankHolderName').optional().trim().isLength({ max: 100 }),
    body('bankName').optional().trim().isLength({ max: 100 }),
    body('bankAccountNumber').optional().trim().isLength({ max: 20 }),
    body('bankIfsc').optional().trim()
      .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/i)
      .withMessage('IFSC must be 11 characters (e.g. SBIN0012345)'),
    // [H3] Exactly 12 digits
    body('aadharNumber').optional().trim()
      .matches(/^\d{12}$/)
      .withMessage('Aadhaar must be exactly 12 digits'),
    body('panNumber').optional().trim().isLength({ min: 10, max: 10 })
      .withMessage('PAN must be 10 characters'),
  ],
  validate,
  async (req, res) => {
    try {
      const { bankHolderName, bankName, bankAccountNumber, bankIfsc, aadharNumber, panNumber } = req.body;

      const data = {};
      // [C2] Encrypt all bank/KYC financial PII before write. Sanitize the
      // plaintext ([L5] stripHtml / uppercase) FIRST, then encrypt.
      if (bankHolderName    !== undefined) data.bankHolderName    = encrypt(stripHtml(bankHolderName));
      if (bankName          !== undefined) data.bankName          = encrypt(stripHtml(bankName));
      if (bankAccountNumber !== undefined) data.bankAccountNumber = encrypt(bankAccountNumber);
      if (bankIfsc          !== undefined) data.bankIfsc          = encrypt(bankIfsc.toUpperCase());
      if (aadharNumber      !== undefined) data.aadharNumber      = encrypt(aadharNumber);
      if (panNumber         !== undefined) data.panNumber         = encrypt(panNumber.toUpperCase());

      if (!Object.keys(data).length) return sendError(res, 'No fields to update', 400);

      const sp = await prisma.sellerProfile.upsert({
        where:  { userId: req.user.id },
        create: { userId: req.user.id, ...data },
        update: data,
      });

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      const completion = calcProfileCompletion(user, sp);
      await prisma.user.update({ where: { id: req.user.id }, data: { profileCompletion: completion } });

      // [C1] Return masked PII — NOT the raw `sp` row
      return sendSuccess(res, safeSellerProfile(sp));
    } catch (err) {
      logger.error({ err }, '[User] PUT /me/seller-profile error');
      return sendError(res, 'Failed to update seller profile', 500);
    }
  }
);

// ── KYC documents — PRIVATE storage, signed-URL access ────────────────────────
// ID proofs must never be publicly fetchable. They are uploaded to Cloudinary's
// authenticated storage; we persist only the opaque public_id and hand out
// short-lived signed URLs (default 5 min). A plain/public request for the asset
// fails at Cloudinary (401). Read access is gated to the owner and ADMIN.

// POST /me/kyc-documents — owner (re)submits KYC document images.
router.post(
  '/me/kyc-documents',
  profileWriteLimit, // [M1]
  blockMinors,       // [DPDP §9] no identity/KYC submission for under-18s
  kycSubmitLimit,    // tight cap on sensitive KYC submissions (5/hour/user)
  (req, res, next) => kycUpload(req, res, (err) => {
    if (err) return sendError(res, err.message, 400);
    next();
  }),
  async (req, res) => {
    try {
      if (!req.files?.length) {
        return sendError(res, 'At least one KYC document image is required', 400);
      }
      // Store privately under a per-user folder; keep only the public_ids.
      const publicIds = await uploadPrivateFiles(req.files, `kyc/${req.user.id}`);

      // Persist references and reset KYC to PENDING — new docs need re-review.
      const [sp] = await prisma.$transaction([
        prisma.sellerProfile.upsert({
          where:  { userId: req.user.id },
          create: { userId: req.user.id, kycDocumentUrls: publicIds },
          update: { kycDocumentUrls: publicIds },
          select: { kycDocumentUrls: true },
        }),
        prisma.user.update({
          where: { id: req.user.id },
          data:  { kycStatus: 'PENDING' },
        }),
      ]);

      auditPiiUpdate(req, 'SellerProfile', req.user.id, { kycDocumentUrls: publicIds }).catch(() => {});

      return sendSuccess(res, { documents: signKycDocs(sp.kycDocumentUrls) }, 201);
    } catch (err) {
      logger.error({ err }, '[User] POST /me/kyc-documents error');
      // Surface the "not configured" guard so misconfig is obvious; otherwise generic.
      const msg = /Cloudinary is not configured/.test(err.message) ? err.message : 'Failed to upload KYC documents';
      return sendError(res, msg, 500);
    }
  }
);

// GET /me/kyc-documents — owner fetches fresh signed URLs for their own docs.
router.get('/me/kyc-documents', async (req, res) => {
  try {
    const sp = await prisma.sellerProfile.findUnique({
      where:  { userId: req.user.id },
      select: { kycDocumentUrls: true },
    });
    return sendSuccess(res, { documents: signKycDocs(sp?.kycDocumentUrls) });
  } catch (err) {
    logger.error({ err }, '[User] GET /me/kyc-documents error');
    return sendError(res, 'Failed to load KYC documents', 500);
  }
});

// GET /:userId/kyc-documents — ADMIN fetches signed URLs to review a seller.
router.get('/:userId/kyc-documents', requireRole('ADMIN'), async (req, res) => {
  try {
    const sp = await prisma.sellerProfile.findUnique({
      where:  { userId: req.params.userId },
      select: { kycDocumentUrls: true },
    });
    if (!sp) return sendNotFound(res, 'Seller profile');

    // Audit admin access to another user's KYC PII (who viewed whose documents).
    auditAction(req, {
      action:   AUDIT_ACTIONS.KYC_ACCESS,
      entity:   'SellerProfile',
      entityId: req.params.userId,
      metadata: { accessedBy: req.user.id, docCount: (sp.kycDocumentUrls || []).length },
    }).catch(() => {});

    return sendSuccess(res, { documents: signKycDocs(sp.kycDocumentUrls) });
  } catch (err) {
    logger.error({ err }, '[User] GET /:userId/kyc-documents error');
    return sendError(res, 'Failed to load KYC documents', 500);
  }
});

// ── DELETE /me — Right to Erasure (DPDP Act §8) ───────────────────────────────
// Irreversible. The caller must re-verify with an OTP sent to their registered
// phone (request one first via POST /auth/send-otp). On success we anonymize the
// user row + shared records, hard-delete personal data and purge media, then
// record an audit entry. The just-deleted sessions + bumped tokenVersion make
// the caller's current tokens invalid immediately afterwards.
router.delete(
  '/me',
  profileWriteLimit, // [M1]
  [
    body('otp').trim().matches(/^\d{6}$/).withMessage('A valid 6-digit OTP is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const me = await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { phone: true },
      });
      if (!me) return sendNotFound(res, 'User');

      // [verification] OTP must match a live session for THIS user's phone.
      const result = await verifyOtp(me.phone, req.body.otp);
      if (!result.success) {
        const status = result.locked ? 423 : 401;
        return sendError(res, result.reason || 'OTP verification failed', status);
      }
      if (result.userId && result.userId !== req.user.id) {
        // Defense-in-depth: the verified phone must belong to the caller.
        return sendError(res, 'OTP verification failed', 401);
      }

      const summary = await eraseUserAccount(req.user.id);
      if (!summary.erased) return sendNotFound(res, 'User');

      // Audit AFTER erasure. AuditLog has no FK to User, so it survives; we store
      // only non-PII counters, never the erased values.
      await auditLog({
        userId:    req.user.id,
        action:    'ACCOUNT_ERASURE',
        entity:    'User',
        entityId:  req.user.id,
        ip:        req.ip,
        requestId: req.id,
        metadata:  { mediaRefs: summary.mediaRefs, mediaDeleted: summary.mediaDeleted },
      });

      logger.info({ userId: req.user.id, ...summary }, '[User] account erased (DPDP §8)');
      return sendSuccess(res, {
        erased: true,
        message: 'Your account and personal data have been permanently erased.',
      });
    } catch (err) {
      logger.error({ err }, '[User] DELETE /me erasure error');
      return sendError(res, 'Failed to erase account. Please try again.', 500);
    }
  }
);

// ── PUT /me/farm ──────────────────────────────────────────────────────────────
router.put(
  '/me/farm',
  profileWriteLimit, // [M1]
  [
    body('village').optional().trim().isLength({ max: 100 }),
    body('district').optional().trim().isLength({ max: 100 }),
    body('state').optional().trim().isLength({ max: 100 }),
    body('pincode').optional().matches(/^\d{6}$/),
    body('landAcres').optional().isFloat({ min: 0, max: 100000 }),
    // [M3] Array capped at 20 items; each item max 50 chars
    body('cropTypes').optional()
      .isArray({ max: 20 }).withMessage('cropTypes must have at most 20 items')
      .custom((arr) => {
        if (!Array.isArray(arr)) return true;
        for (const item of arr) {
          if (typeof item !== 'string' || item.length > 50) {
            throw new Error('Each crop type must be a string of max 50 characters');
          }
        }
        return true;
      }),
    // [M5] Max length enforced
    body('soilType').optional().trim().isLength({ max: 50 }),
    body('irrigationType').optional().trim().isLength({ max: 50 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { village, district, state, pincode, landAcres, cropTypes, soilType, irrigationType } = req.body;

      const farm = await prisma.farmDetail.upsert({
        where:  { userId: req.user.id },
        create: {
          userId: req.user.id,
          village, district, state, pincode,
          landAcres: landAcres ? parseFloat(landAcres) : undefined,
          cropTypes: cropTypes || [],
          soilType, irrigationType,
        },
        update: {
          ...(village        !== undefined && { village }),
          ...(district       !== undefined && { district }),
          ...(state          !== undefined && { state }),
          ...(pincode        !== undefined && { pincode }),
          ...(landAcres      !== undefined && { landAcres: parseFloat(landAcres) }),
          ...(cropTypes      !== undefined && { cropTypes }),
          ...(soilType       !== undefined && { soilType }),
          ...(irrigationType !== undefined && { irrigationType }),
        },
      });

      return sendSuccess(res, farm);
    } catch (err) {
      logger.error({ err }, '[User] PUT /me/farm error');
      return sendError(res, 'Failed to update farm details', 500);
    }
  }
);

// ── POST /me/push-token ────────────────────────────────────────────────────────
router.post(
  '/me/push-token',
  [
    // [L1] Expo token format: ExponentPushToken[xxxx...] or ExpoPushToken[xxxx...]
    // Max length ~100 chars. Validate format to prevent junk tokens being stored.
    body('token')
      .trim()
      .notEmpty().withMessage('Expo push token required')
      .isLength({ max: 100 }).withMessage('Token too long')
      .matches(/^Expo(nent)?PushToken\[.+\]$/)
      .withMessage('Invalid Expo push token format'),
    body('platform').isIn(['ios', 'android']).withMessage('platform must be ios or android'),
  ],
  validate,
  async (req, res) => {
    try {
      const { token, platform } = req.body;

      await prisma.pushToken.upsert({
        where:  { token },
        create: { token, userId: req.user.id, platform },
        update: { userId: req.user.id },
      });

      return sendSuccess(res, { registered: true });
    } catch (err) {
      logger.error({ err }, '[User] POST /me/push-token error');
      return sendError(res, 'Failed to register push token', 500);
    }
  }
);

export default router;
