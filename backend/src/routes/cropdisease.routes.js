/**
 * Crop Disease Prediction Routes — FarmEasy Krishi Raksha
 * POST /api/v1/crop-disease/predict
 * Accepts multipart/form-data (with optional images) OR JSON.
 */
import { Router } from 'express';
import { query } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { sendSuccess, sendError, sendServerError } from '../utils/response.js';
import { getWeatherData } from '../services/weather.service.js';
import { getSoilData } from '../services/soildata.service.js';
import { predictCropDisease } from '../services/ai.predict.service.js';
import prisma from '../config/db.js';

const router = Router();
router.param('id', uuidParamGuard); // reject non-UUID :id (reports) with 400 before Prisma

// ─── Multer — store to OS temp dir ───────────────────────────────────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },  // 5 MB per image, max 4
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── Cleanup temp files ───────────────────────────────────────────────────────
function cleanupFiles(files = []) {
  files.forEach((f) => {
    try { fs.unlinkSync(f.path); } catch { /* ignore */ }
  });
}

// ─── POST /api/v1/crop-disease/predict ───────────────────────────────────────
router.post(
  '/predict',
  authenticate,
  upload.array('images', 4),
  async (req, res) => {
    const uploadedFiles = req.files || [];

    try {
      // ── 1. Parse body fields (supports both JSON body and multipart) ────────
      const body = req.body;

      const {
        pincode,
        cropType,
        growthStage,
        variety,
        sowingDate,
        fieldArea,
        irrigationMethod,
        lastIrrigatedDate,
        fertilizerType,
        prevCrop,
        waterQuality,
        soilPh,
        organicCarbon,
        nitrogenLevel,
        phosphorusLevel,
        potassiumLevel,
        soilMoisture,
        lastFungicideDate,
      } = body;

      // Parse symptoms (may be JSON string or comma-separated)
      let symptoms = body.symptoms || [];
      if (typeof symptoms === 'string') {
        try {
          symptoms = JSON.parse(symptoms);
        } catch {
          symptoms = symptoms.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      // Parse symptomOnsetDays (optional integer)
      const symptomOnsetDays = body.symptomOnsetDays ? parseInt(body.symptomOnsetDays, 10) || null : null;

      // ── 2. Validate required fields ────────────────────────────────────────
      if (!pincode || !cropType || !growthStage) {
        cleanupFiles(uploadedFiles);
        return sendError(res, 'pincode, cropType, and growthStage are required', 400);
      }

      const pincodeNum = String(pincode).replace(/\D/g, '');
      if (pincodeNum.length !== 6) {
        cleanupFiles(uploadedFiles);
        return sendError(res, 'Invalid pincode — must be 6 digits', 400);
      }

      // ── 3. Fetch weather + soil data in parallel ───────────────────────────
      const [weatherData, soilData] = await Promise.allSettled([
        getWeatherData(pincodeNum),
        Promise.resolve(getSoilData(pincodeNum)),
      ]);

      const weather = weatherData.status === 'fulfilled' ? weatherData.value : null;
      const soil = soilData.status === 'fulfilled' ? soilData.value : null;

      if (!weather) {
        // Weather is important but not fatal — AI can still work with soil data
        console.warn('[CropDisease] Weather fetch failed:', weatherData.reason?.message);
      }

      // ── 4. Call AI prediction ──────────────────────────────────────────────
      // Build typed image objects — client sends imageType_0, imageType_1, ... alongside each file
      // Valid types: field_view | whole_plant | close_up | underside | other
      const VALID_IMAGE_TYPES = ['field_view', 'whole_plant', 'close_up', 'underside', 'other'];
      const images = uploadedFiles.map((f, idx) => {
        const rawType = body[`imageType_${idx}`] || body.imageType || 'other';
        const type = VALID_IMAGE_TYPES.includes(rawType) ? rawType : 'other';
        return { path: f.path, type };
      });

      const prediction = await predictCropDisease(
        {
          pincode: pincodeNum,
          cropType, growthStage, variety, sowingDate, fieldArea,
          irrigationMethod, lastIrrigatedDate, fertilizerType, prevCrop, waterQuality,
          soilPh, organicCarbon, nitrogenLevel, phosphorusLevel, potassiumLevel, soilMoisture,
          lastFungicideDate, symptoms, symptomOnsetDays,
          weather, soilData: soil,
        },
        images,
      );

      // ── 5. Cleanup temp images ─────────────────────────────────────────────
      cleanupFiles(uploadedFiles);

      // ── 6. Persist report to database ─────────────────────────────────────
      // Awaited so the saved row's id can be returned (lets the farmer share
      // the report with a Krushi Kendra seller from the result screen).
      let savedReportId = null;
      try {
        const saved = await prisma.cropDiseaseReport.create({
          data: {
            userId:          req.user.id,
            pincode:         pincodeNum,
            cropType,
            growthStage,
            variety:         variety    || null,
            fieldArea:       fieldArea  || null,
            symptoms:        Array.isArray(symptoms) ? symptoms : [],
            imageCount:      images.length,
            overallRisk:     prediction.overall_risk     ?? prediction.overallRisk     ?? 0,
            riskLevel:       prediction.risk_level       ?? prediction.riskLevel       ?? 'UNKNOWN',
            primaryDisease:  prediction.primary_disease?.name ?? prediction.primaryDisease?.name ?? 'Unknown',
            confidenceScore: prediction.confidence_score ?? prediction.confidenceScore ?? 0,
            fullReport:      prediction,
            weatherSnapshot: weather ?? null,
            soilSnapshot:    soil    ?? null,
          },
        });
        savedReportId = saved.id;
      } catch (err) {
        console.error('[CropDisease] Failed to save report:', err.message);
      }

      // ── 7. Return enriched response ────────────────────────────────────────
      return sendSuccess(res, {
        ...prediction,
        reportId: savedReportId,
        weatherSummary: weather
          ? {
              current: {
                temp: weather.current.temp,
                humidity: weather.current.humidity,
                weatherDesc: weather.current.weatherDesc,
                windSpeed: weather.current.windSpeed,
                dewPoint: weather.current.dewPoint,
              },
              riskLevel: weather.weatherRisk.riskLevel,
              riskFactors: weather.weatherRisk.riskFactors,
              forecast3Days: weather.forecast.slice(0, 3),
            }
          : null,
        soilSummary: soil
          ? {
              district: soil.district,
              zone: `Zone ${soil.agroClimaticZone.id} — ${soil.agroClimaticZone.name}`,
              soilType: soil.soil.soilType,
              avgPH: soil.soil.soilPH?.avg,
              organicCarbon: soil.soil.organicCarbon?.avg,
              kvkContact: soil.kvkContact,
            }
          : null,
      });
    } catch (err) {
      cleanupFiles(uploadedFiles);
      console.error('[CropDisease] Prediction error:', err.message);

      if (err.message?.includes('AI key configured')) {
        return sendError(res, 'AI service not configured. Set GEMINI_API_KEY in .env (free).', 503);
      }
      if (err.status === 429) {
        return sendError(res, 'AI service rate limit reached. Please try again in a moment.', 429);
      }

      return sendError(res, 'Prediction failed. Please try again.', 500);
    }
  },
);

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
