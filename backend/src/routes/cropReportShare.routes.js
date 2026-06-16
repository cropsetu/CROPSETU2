/**
 * Crop Report Share Routes — Farmer ↔ Krushi Kendra seller bridge.
 *
 * A share is a triple (report, farmer who OWNS the report, seller it was sent
 * to). The only parties to a share are that OWNER and that SHAREE — a crop
 * report and its diagnosis must never be reachable by anyone else.
 *
 * ── ACCESS MATRIX (enforced by each handler's WHERE clause) ──────────────────
 * Legend: ✓ allowed · ✗ denied (404 — scoped query yields no row, no existence
 * leak) · 401 unauthenticated · "self" = only ever sees rows where they are the
 * farmer/seller, so cross-user access is structurally impossible.
 *
 *   Route                                  │ Owner │ Sharee │ Other authed │ Public
 *   ───────────────────────────────────────┼───────┼────────┼──────────────┼───────
 *   GET  /sellers/nearby                    │  ✓¹   │  ✓¹    │     ✓¹       │  401
 *   POST /:reportId/share                   │  ✓²   │  ✗     │     ✗        │  401
 *   GET  /:reportId/shares                  │  ✓²   │  ✗     │     ✗        │  401
 *   GET  /me/shares                         │ self  │  —     │    self      │  401
 *   GET  /seller/inbox                      │  —    │  self  │    self      │  401
 *   GET  /seller/inbox/:shareId             │  ✗    │  ✓     │     ✗        │  401
 *   POST /seller/inbox/:shareId/reply       │  ✗    │  ✓     │     ✗        │  401
 *
 *   ¹ Directory lookup — open to any authenticated user; returns no report data.
 *   ² Owner is gated on owning the *report* (CropDiseaseReport.userId === me);
 *     a report you don't own returns 404.
 *
 * Every per-resource handler MUST filter by the caller's id (userId/farmerId for
 * the owner, sellerId for the sharee). The matrix above is verified cell-by-cell
 * in tests/backend/api/cropReportShare.api.test.js — keep them in lock-step.
 */
import { Router } from 'express';
import { body } from 'express-validator';

import { authenticate } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, paginationMeta } from '../utils/response.js';
import { sendPushToUser } from '../services/push.service.js';
import { decryptNumber } from '../utils/encrypt.js';
import { KRUSHI_KENDRA_TYPES } from '../constants/kendra.js';
import logger from '../utils/logger.js';
import prisma from '../config/db.js';

const router = Router();
router.param('reportId', uuidParamGuard); // crop report id
router.param('shareId', uuidParamGuard);  // report-share id

// Upper bound on candidate sellers scanned for the in-app Haversine filter.
// Because lat/lng are encrypted we can't pre-filter by a SQL bounding box, so
// we cap the scan to keep the query bounded and decrypt at most this many rows.
const CANDIDATE_SCAN_CAP = 1000;

// Haversine — great-circle distance in km between two lat/lng pairs.
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── GET nearby Krushi Kendra sellers ───────────────────────────────────────
// Only ADMIN-VERIFIED Kendras are returned (User.kycStatus = 'VERIFIED'): a
// Kendra onboards on the dedicated website with its dealer licence and is only
// discoverable to farmers AFTER an admin verifies that licence — "verification
// before approval". Unverified / pending / rejected Kendras never surface here.
// Strategy:
//   1. Prefer GPS distance: when both farmer and seller have lat/lng, sort by
//      Haversine and return distanceKm. Default radius = 150 km (Kendras are
//      sparse in rural areas; the farmer can narrow via ?radiusKm, max 200).
//   2. Fallback to district/taluka string match for sellers without coords.
router.get('/sellers/nearby', authenticate, async (req, res) => {
  const { district, taluka, type, lat: qLat, lng: qLng, radiusKm } = req.query;
  const me = req.user.id;

  // Resolve farmer reference: query params (live device GPS) win, else stored user row
  let farmerLat = qLat ? Number(qLat) : null;
  let farmerLng = qLng ? Number(qLng) : null;
  let queryDistrict = district;
  let queryTaluka   = taluka;
  const farmer = await prisma.user.findUnique({
    where:  { id: req.user.id },
    select: { lat: true, lng: true, district: true, taluka: true },
  });
  // lat/lng are encrypted at rest — decrypt the stored row back to numbers.
  if (farmerLat == null) farmerLat = decryptNumber(farmer?.lat);
  if (farmerLng == null) farmerLng = decryptNumber(farmer?.lng);
  if (!queryDistrict)   queryDistrict = farmer?.district || null;
  if (!queryTaluka)     queryTaluka   = farmer?.taluka   || null;

  const businessTypes = type ? [type] : KRUSHI_KENDRA_TYPES;
  const RADIUS_KM = Math.min(Math.max(Number(radiusKm) || 150, 1), 200);

  const SELLER_SELECT = {
    id: true, name: true, phone: true, avatar: true,
    businessType: true, district: true, taluka: true, village: true,
    lat: true, lng: true,
    _count: { select: { sellerProducts: true } },
  };

  let sellers = [];

  if (farmerLat != null && farmerLng != null) {
    // GPS path. lat/lng are encrypted at rest, so a SQL bounding-box pre-filter
    // (gte/lte on the columns) is no longer possible — non-deterministic GCM
    // ciphertext has no orderable form. Instead we fetch candidate sellers of
    // the right businessType that have coords, decrypt in app code, then filter
    // + sort precisely by Haversine. CANDIDATE_SCAN_CAP bounds the scan; if it
    // is ever hit we log so the truncation is visible rather than silent.
    const candidates = await prisma.user.findMany({
      where: {
        id:           { not: me },
        businessType: { in: businessTypes },
        kycStatus:    'VERIFIED', // only admin-approved Kendras are discoverable
        lat:          { not: null },
        lng:          { not: null },
      },
      select: SELLER_SELECT,
      take: CANDIDATE_SCAN_CAP,
    });
    if (candidates.length === CANDIDATE_SCAN_CAP) {
      logger.warn(
        { businessTypes, cap: CANDIDATE_SCAN_CAP },
        '[sellers/nearby] candidate scan hit cap — some distant sellers may be omitted',
      );
    }

    sellers = candidates
      .map((s) => {
        const sLat = decryptNumber(s.lat);
        const sLng = decryptNumber(s.lng);
        return {
          ...s,
          lat:          sLat,
          lng:          sLng,
          productCount: s._count.sellerProducts,
          distanceKm:   sLat != null && sLng != null
            ? haversineKm(farmerLat, farmerLng, sLat, sLng)
            : null,
          proximity:    'gps',
        };
      })
      .filter((s) => s.distanceKm != null && s.distanceKm <= RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 30)
      .map(({ _count, ...rest }) => rest);
  }

  // Top-up: if GPS yielded few/no results OR farmer has no coords yet,
  // fall back to district/taluka string match for sellers without coords.
  if (sellers.length < 10 && queryDistrict) {
    const excludeIds = new Set([me, ...sellers.map((s) => s.id)]);
    const fallback = await prisma.user.findMany({
      where: {
        id:           { notIn: [...excludeIds] },
        businessType: { in: businessTypes },
        kycStatus:    'VERIFIED', // only admin-approved Kendras are discoverable
        district:     queryDistrict,
      },
      select: SELLER_SELECT,
      take: 30 - sellers.length,
    });
    sellers.push(
      ...fallback
        .map((s) => ({
          ...s,
          // Decrypt coords so the response never carries ciphertext (these
          // sellers are matched by district and may or may not have coords).
          lat:          decryptNumber(s.lat),
          lng:          decryptNumber(s.lng),
          productCount: s._count.sellerProducts,
          distanceKm:   null,
          proximity:    s.taluka === queryTaluka ? 'taluka' : 'district',
        }))
        .map(({ _count, ...rest }) => rest)
    );
  }

  return sendSuccess(res, sellers, 200, {
    farmerLat, farmerLng, farmerDistrict: queryDistrict, farmerTaluka: queryTaluka,
    radiusKm: RADIUS_KM, total: sellers.length,
    usedGps:  farmerLat != null && farmerLng != null,
  });
});

// ─── POST share a report with a seller ──────────────────────────────────────
router.post(
  '/:reportId/share',
  authenticate,
  [
    body('sellerId').isString().notEmpty(),
    body('message').optional().isString().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    const { reportId } = req.params;
    const { sellerId, message } = req.body;

    if (sellerId === req.user.id) return sendError(res, 'Cannot share with yourself', 400);

    const [report, seller] = await Promise.all([
      prisma.cropDiseaseReport.findFirst({
        where:  { id: reportId, userId: req.user.id },
        select: { id: true, primaryDisease: true, cropType: true },
      }),
      prisma.user.findUnique({
        where:  { id: sellerId },
        select: { id: true, businessType: true, name: true, kycStatus: true },
      }),
    ]);

    if (!report) return sendNotFound(res, 'Report');
    if (!seller) return sendNotFound(res, 'Seller');

    if (!seller.businessType || !KRUSHI_KENDRA_TYPES.includes(seller.businessType)) {
      return sendError(res, 'Selected user is not a Krushi Kendra seller', 400);
    }
    // Only admin-verified Kendras can receive reports (mirrors the discovery gate
    // above — a report must never be shareable to an unapproved Kendra).
    if (seller.kycStatus !== 'VERIFIED') {
      return sendError(res, 'This Krushi Kendra is not yet verified', 400);
    }

    // Idempotent: if already shared, return existing
    const existing = await prisma.cropReportShare.findFirst({
      where: { reportId, farmerId: req.user.id, sellerId },
    });
    if (existing) return sendSuccess(res, existing);

    const share = await prisma.cropReportShare.create({
      data: {
        reportId,
        farmerId: req.user.id,
        sellerId,
        message:  message || null,
      },
    });

    // Push the seller — best-effort, non-blocking
    sendPushToUser({
      userId: sellerId,
      type:   'CROP_REPORT_RECEIVED',
      title:  'New crop diagnosis report',
      body:   `${report.cropType} — ${report.primaryDisease}. Tap to suggest treatment.`,
      data:   { kind: 'crop_report_share', shareId: share.id, reportId },
    }).catch(() => {});

    return sendCreated(res, share);
  }
);

// Resolve recommendedProductIds → Product objects, for use on the farmer side
// (cards on the diagnosis screen) and the seller side (echo back what they
// recommended). Returns [] when the share has no products attached.
async function resolveRecommendedProducts(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];
  return prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: {
      id: true, name: true, nameHi: true, nameMr: true,
      price: true, mrp: true, unit: true, stock: true,
      images: true, sellerId: true, brand: true, minOrderQty: true,
    },
  });
}

// ─── GET all shares the farmer has sent (history) ───────────────────────────
// NOTE: must be registered BEFORE '/:reportId/shares' — otherwise Express
// matches "/me/shares" as that param route with reportId="me", which the
// uuidParamGuard then rejects with 400, making this endpoint unreachable.
router.get('/me/shares', authenticate, async (req, res) => {
  const page  = parseInt(req.query.page  || '1',  10);
  const limit = parseInt(req.query.limit || '20', 10);

  const [shares, total] = await Promise.all([
    prisma.cropReportShare.findMany({
      where:   { farmerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      include: {
        seller: { select: { id: true, name: true, businessType: true, village: true, taluka: true } },
        report: { select: { id: true, cropType: true, primaryDisease: true, riskLevel: true } },
      },
    }),
    prisma.cropReportShare.count({ where: { farmerId: req.user.id } }),
  ]);

  return sendSuccess(res, shares, 200, paginationMeta(total, page, limit));
});

// ─── GET shares for a single report (farmer view) ───────────────────────────
router.get('/:reportId/shares', authenticate, async (req, res) => {
  const { reportId } = req.params;

  const report = await prisma.cropDiseaseReport.findFirst({
    where:  { id: reportId, userId: req.user.id },
    select: { id: true },
  });
  if (!report) return sendNotFound(res, 'Report');

  const shares = await prisma.cropReportShare.findMany({
    where:   { reportId, farmerId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      seller: {
        select: { id: true, name: true, phone: true, avatar: true, businessType: true, village: true, taluka: true, district: true },
      },
    },
  });

  // Resolve product objects for each share that has recommendations attached
  const enriched = await Promise.all(
    shares.map(async (s) => ({
      ...s,
      recommendedProducts: await resolveRecommendedProducts(s.recommendedProductIds),
    }))
  );

  return sendSuccess(res, enriched);
});

// ─── GET seller's inbox ─────────────────────────────────────────────────────
router.get('/seller/inbox', authenticate, async (req, res) => {
  const page  = parseInt(req.query.page  || '1',  10);
  const limit = parseInt(req.query.limit || '20', 10);
  const status = req.query.status; // optional: PENDING | REPLIED | CLOSED

  const where = {
    sellerId: req.user.id,
    ...(status && { status }),
  };

  const [shares, total, unread] = await Promise.all([
    prisma.cropReportShare.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      include: {
        farmer: { select: { id: true, name: true, phone: true, village: true, taluka: true, district: true } },
        report: {
          select: {
            id: true, cropType: true, growthStage: true, primaryDisease: true,
            riskLevel: true, overallRisk: true, confidenceScore: true, imageCount: true, createdAt: true,
          },
        },
      },
    }),
    prisma.cropReportShare.count({ where }),
    prisma.cropReportShare.count({ where: { sellerId: req.user.id, readAt: null } }),
  ]);

  return sendSuccess(res, shares, 200, { ...paginationMeta(total, page, limit), unread });
});

// ─── GET single share with full report (seller view) ────────────────────────
router.get('/seller/inbox/:shareId', authenticate, async (req, res) => {
  const share = await prisma.cropReportShare.findFirst({
    where: { id: req.params.shareId, sellerId: req.user.id },
    include: {
      farmer: { select: { id: true, name: true, phone: true, village: true, taluka: true, district: true } },
      report: true,
    },
  });

  if (!share) return sendNotFound(res, 'Report share');

  // Mark read on first open
  if (!share.readAt) {
    prisma.cropReportShare.update({
      where: { id: share.id },
      data:  { readAt: new Date() },
    }).catch(() => {});
  }

  const recommendedProducts = await resolveRecommendedProducts(share.recommendedProductIds);
  return sendSuccess(res, { ...share, recommendedProducts });
});

// ─── POST seller reply ──────────────────────────────────────────────────────
router.post(
  '/seller/inbox/:shareId/reply',
  authenticate,
  [
    body('reply').isString().trim().isLength({ min: 4, max: 2000 }),
    body('recommendedSku').optional().isString(),
    body('recommendedProductIds').optional().isArray({ max: 10 }),
    body('recommendedProductIds.*').optional().isString(),
    body('available').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    const { reply, recommendedSku, available, recommendedProductIds } = req.body;

    const share = await prisma.cropReportShare.findFirst({
      where:  { id: req.params.shareId, sellerId: req.user.id },
      select: { id: true, farmerId: true, reportId: true },
    });
    if (!share) return sendNotFound(res, 'Report share');

    // Validate that any product IDs the seller is recommending actually belong
    // to this seller. Prevents sellers from advertising another shop's stock.
    let safeProductIds = [];
    if (Array.isArray(recommendedProductIds) && recommendedProductIds.length) {
      const owned = await prisma.product.findMany({
        where: { id: { in: recommendedProductIds }, sellerId: req.user.id, isActive: true },
        select: { id: true },
      });
      safeProductIds = owned.map((p) => p.id);
    }

    const isAvailable = available === true || available === 'true';

    const updated = await prisma.cropReportShare.update({
      where: { id: share.id },
      data: {
        sellerReply:           reply,
        recommendedSku:        recommendedSku || null,
        recommendedProductIds: safeProductIds,
        available:             isAvailable,
        status:                'REPLIED',
        repliedAt:             new Date(),
      },
    });

    // Look up the seller's display info so the farmer's notification
    // identifies who has the pesticide ready for collection.
    const seller = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { name: true, village: true, taluka: true },
    });
    const sellerLabel = seller?.name
      || [seller?.village, seller?.taluka].filter(Boolean).join(', ')
      || 'Krushi Kendra';

    // Notification text adapts to whether the seller confirmed availability.
    const title = isAvailable
      ? 'Pesticide available — please collect'
      : 'Krushi Kendra recommendation received';
    const body = isAvailable
      ? `${sellerLabel}: please collect ${recommendedSku || 'the recommended product'}`
      : (reply.length > 80 ? `${reply.slice(0, 80)}…` : reply);

    sendPushToUser({
      userId: share.farmerId,
      type:   'CROP_REPORT_REPLIED',
      title,
      body,
      data:   { kind: 'crop_report_reply', shareId: share.id, reportId: share.reportId, available: isAvailable },
    }).catch(() => {});

    return sendSuccess(res, updated);
  }
);

export default router;
