/**
 * Crop Disease Report Routes — FarmEasy Krishi Raksha
 *
 * READ-ONLY history for the AI scan reports, plus two pincode lookups. The
 * diagnosis itself lives on POST /api/v1/ai/scan (ai.routes.js → the FastAPI
 * agentic pipeline).
 *
 * REMOVED: POST /api/v1/crop-disease/predict.
 *   It was a SECOND, forked diagnosis path — it called ai.predict.service's
 *   "Dr. Krishi AI" prompt, which has its own schema, no ensemble ballot, no RAG
 *   grounding and, critically, never reaches fastapi/safety/validator, so nothing
 *   checked a named pesticide against the state ban list, the PHI table or the
 *   CIB&RC label claims. It then persisted that unvalidated output as a
 *   cropDiseaseReport row — the same rows ScanHistoryScreen and PastReportScreen
 *   render, so an unchecked chemical + dose reached the farmer's history looking
 *   exactly like a validated scan. On top of that the route had no rate limiter
 *   and no credit gate at all, so an authenticated caller could burn 4 × 5 MB of
 *   Gemini vision per request without spending a credit.
 *
 *   It had no client caller: the app calls only GET /reports and /reports/:id
 *   here, and /ai/scan for a diagnosis. Removing it deletes the exposure outright
 *   rather than rate-limiting a path that should not exist. ai.predict.service.js
 *   itself survives ONLY as ai.routes.js's USE_FASTAPI_FOR_SCAN=false rollback;
 *   when that flag retires, delete the service and that import together.
 */
import { Router } from 'express';
import { query } from 'express-validator';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { sendSuccess, sendError, sendServerError } from '../utils/response.js';
import { getWeatherData } from '../services/weather.service.js';
import { getSoilData } from '../services/soildata.service.js';
import prisma from '../config/db.js';

const router = Router();
router.param('id', uuidParamGuard); // reject non-UUID :id (reports) with 400 before Prisma

// Pagination guard — bounds page/limit so a caller can't request take:1000000
// (query bloat / memory DoS) or a negative skip (Prisma error).
export const listReportsRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
];

// Reusable 6-digit pincode query guard.
export const pincodeQueryRules = [
  query('pincode').matches(/^\d{6}$/).withMessage('Valid 6-digit pincode required'),
];

// ─── GET /api/v1/crop-disease/reports ────────────────────────────────────────
// List the authenticated user's past AI analysis reports (newest first)
router.get('/reports', authenticate, listReportsRules, validate, async (req, res) => {
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '10', 10);

  const [reports, total] = await Promise.all([
    prisma.cropDiseaseReport.findMany({
      where: { userId: req.user.id },
      select: {
        id: true, pincode: true, cropType: true, growthStage: true, variety: true,
        overallRisk: true, riskLevel: true, primaryDisease: true,
        confidenceScore: true, imageCount: true, createdAt: true,
        // Lightweight share summary so the history list can render a "Replied"
        // badge without a second round-trip. Newest share first.
        shares: {
          orderBy: { repliedAt: 'desc' },
          select: {
            id: true, status: true, available: true, fulfillment: true,
            sellerReply: true, repliedAt: true, sellerId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.cropDiseaseReport.count({ where: { userId: req.user.id } }),
  ]);

  // Derive convenience flags so the mobile list doesn't re-walk the shares array.
  const enriched = reports.map((r) => {
    const replied = r.shares.find((s) => s.status === 'REPLIED');
    return {
      ...r,
      hasReply: !!replied,
      shareStatus: replied ? 'REPLIED' : (r.shares.length ? 'PENDING' : null),
    };
  });

  const meta = { total, page, limit, totalPages: Math.ceil(total / limit) };
  return sendSuccess(res, enriched, 200, meta);
});

// ─── GET /api/v1/crop-disease/reports/:id ────────────────────────────────────
// Full report detail including complete AI JSON
router.get('/reports/:id', authenticate, async (req, res) => {
  const report = await prisma.cropDiseaseReport.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    // Include the Krushi Kendra shares + replies so the mobile history detail
    // can render the seller's response. Seller relation mirrors the fields the
    // /crop-reports/:reportId/shares endpoint returns so the shop name shows.
    include: {
      shares: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, available: true, fulfillment: true,
          fulfillmentNote: true, sellerReply: true, recommendedSku: true,
          recommendedProductIds: true, message: true, repliedAt: true, createdAt: true,
          seller: {
            select: {
              id: true, name: true, phone: true, avatar: true,
              businessType: true, village: true, taluka: true, district: true,
            },
          },
        },
      },
    },
  });
  if (!report) return sendError(res, 'Report not found', 404);
  return sendSuccess(res, report);
});

// ─── GET /api/v1/crop-disease/soil-info?pincode=413704 ───────────────────────
// Quick endpoint to preview soil data for a pincode (no AI, no auth needed)
router.get('/soil-info', pincodeQueryRules, validate, async (req, res) => {
  const { pincode } = req.query;
  const soilData = getSoilData(pincode);
  return sendSuccess(res, soilData);
});

// ─── GET /api/v1/crop-disease/weather?pincode=413704 ─────────────────────────
// Quick endpoint to check weather for a pincode
router.get('/weather', authenticate, pincodeQueryRules, validate, async (req, res) => {
  const { pincode } = req.query;
  try {
    const weatherData = await getWeatherData(pincode);
    return sendSuccess(res, weatherData);
  } catch (err) {
    return sendServerError(res, err, 'Weather service is temporarily unavailable. Please try again.', 503);
  }
});

export default router;
