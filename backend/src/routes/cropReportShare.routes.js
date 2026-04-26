/**
 * Crop Report Share Routes — Farmer ↔ Krushi Kendra seller bridge.
 *
 * Farmer side
 *   GET  /api/v1/crop-reports/sellers/nearby?district=&taluka=&type=
 *   POST /api/v1/crop-reports/:reportId/share        { sellerId, message? }
 *   GET  /api/v1/crop-reports/:reportId/shares        — list shares for one report
 *   GET  /api/v1/crop-reports/me/shares               — all reports the farmer has shared
 *
 * Seller side
 *   GET  /api/v1/crop-reports/seller/inbox            — list shares received
 *   GET  /api/v1/crop-reports/seller/inbox/:shareId   — full report + share
 *   POST /api/v1/crop-reports/seller/inbox/:shareId/reply { reply, recommendedSku? }
 */
import { Router } from 'express';
import { body } from 'express-validator';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, paginationMeta } from '../utils/response.js';
import { sendPushToUser } from '../services/push.service.js';
import prisma from '../config/db.js';

const router = Router();

const KRUSHI_KENDRA_TYPES = [
  'krushi_kendra',
  'fertilizer_dealer',
  'seed_supplier',
  'agri_input_shop',
  'pesticide_dealer',
];

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
// Strategy:
//   1. Prefer GPS distance: when both farmer and seller have lat/lng, sort by
//      Haversine and return distanceKm. Default radius = 25 km.
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
  if (farmerLat == null) farmerLat = farmer?.lat ?? null;
  if (farmerLng == null) farmerLng = farmer?.lng ?? null;
  if (!queryDistrict)   queryDistrict = farmer?.district || null;
  if (!queryTaluka)     queryTaluka   = farmer?.taluka   || null;

  const businessTypes = type ? [type] : KRUSHI_KENDRA_TYPES;
  const RADIUS_KM = Math.min(Math.max(Number(radiusKm) || 25, 1), 200);

  const SELLER_SELECT = {
    id: true, name: true, phone: true, avatar: true,
    businessType: true, district: true, taluka: true, village: true,
    lat: true, lng: true,
    _count: { select: { sellerProducts: true } },
  };

  let sellers = [];

  if (farmerLat != null && farmerLng != null) {
    // GPS path — fetch all candidate sellers in a generous bounding box, then
    // filter + sort precisely by Haversine in JS. Bounding box keeps the SQL
    // cheap; the precise filter lives in app code so we don't need PostGIS.
    const degLat = RADIUS_KM / 111; // ~1 deg latitude = 111 km
    const degLng = RADIUS_KM / (111 * Math.cos((farmerLat * Math.PI) / 180) || 1);
    const candidates = await prisma.user.findMany({
      where: {
        id:           { not: me },
        businessType: { in: businessTypes },
        lat:          { not: null, gte: farmerLat - degLat, lte: farmerLat + degLat },
        lng:          { not: null, gte: farmerLng - degLng, lte: farmerLng + degLng },
      },
      select: SELLER_SELECT,
      take: 100,
    });

    sellers = candidates
      .map((s) => ({
        ...s,
        productCount: s._count.sellerProducts,
        distanceKm:   haversineKm(farmerLat, farmerLng, s.lat, s.lng),
        proximity:    'gps',
      }))
      .filter((s) => s.distanceKm <= RADIUS_KM)
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
        district:     queryDistrict,
      },
      select: SELLER_SELECT,
      take: 30 - sellers.length,
    });
    sellers.push(
      ...fallback
        .map((s) => ({
          ...s,
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
        select: { id: true, businessType: true, name: true },
      }),
    ]);

    if (!report) return sendNotFound(res, 'Report');
    if (!seller) return sendNotFound(res, 'Seller');

    if (!seller.businessType || !KRUSHI_KENDRA_TYPES.includes(seller.businessType)) {
      return sendError(res, 'Selected user is not a Krushi Kendra seller', 400);
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

// ─── GET all shares the farmer has sent (history) ───────────────────────────
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
