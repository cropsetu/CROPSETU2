/**
 * Pest Alert Routes
 *
 * GET  /api/v1/pest/alerts?lat=18.52&lon=73.85&crops=soybean,tur
 * GET  /api/v1/pest/alerts/:id
 * GET  /api/v1/pest/forecast?district=Pune&crop=soybean
 * POST /api/v1/pest/report        — farmer reports a pest sighting
 */
import { Router } from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import { generatePestAlerts } from '../services/pestRisk.service.js';
import { checkCredits, deductCredits, pestLevelToFeatureType, getCreditSummary } from '../services/aiCredit.service.js';
import { stripHtml } from '../utils/encrypt.js';
import { ENV } from '../config/env.js';
import prisma from '../config/db.js';

const AI_BASE = ENV.AI_BACKEND_URL || 'http://localhost:8001';

const router = Router();

// ── GET /api/v1/pest/alerts ───────────────────────────────────────────────────
// Live weather-based risk assessment OR cached DB alerts for the area
router.get('/alerts', authenticate, async (req, res) => {
  if (!await isEnabled('pest_alerts')) {
    return sendError(res, 'कीट चेतावनी सेवा अभी उपलब्ध नहीं है।', 503);
  }

  const lat      = parseFloat(req.query.lat      || '18.52');
  const lon      = parseFloat(req.query.lon      || '73.85');
  const state    = req.query.state    || req.user?.state    || 'Maharashtra';
  const district = req.query.district || req.user?.district || 'Pune';
  const cropsRaw = req.query.crops    || '';
  const dayOfSeason = parseInt(req.query.dayOfSeason || '45', 10);
  const crops    = cropsRaw ? cropsRaw.split(',').map(c => c.trim()) : [];

  if (isNaN(lat) || isNaN(lon)) return sendError(res, 'Valid lat and lon are required', 400);

  // Check for existing DB alerts (within last 24 hours) for this area
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingAlerts = await prisma.pestAlert.findMany({
    where: {
      state:     { contains: state, mode: 'insensitive' },
      isActive:  true,
      validUntil: { gt: new Date() },
      createdAt: { gte: since },
    },
    orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
  });

  // Severity sort: critical first
  const severityOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
  existingAlerts.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  if (existingAlerts.length > 0) {
    return sendSuccess(res, existingAlerts, 200, {
      source: 'cached', generatedAt: existingAlerts[0].createdAt, attribution: 'स्रोत: Open-Meteo + ICAR NCIPM नियम',
    });
  }

  // Generate fresh alerts via risk engine
  const freshAlerts = await generatePestAlerts({ lat, lon, state, district, crops, dayOfSeason });

  if (!freshAlerts.length) {
    return sendSuccess(res, [], 200, {
      message: '✅ वर्तमान मौसम में कोई सक्रिय कीट जोखिम नहीं है।',
      source: 'Open-Meteo + ICAR rules',
      attribution: 'स्रोत: Open-Meteo + ICAR NCIPM नियम',
    });
  }

  // Persist to DB for caching
  const saved = [];
  for (const alert of freshAlerts) {
    const record = await prisma.pestAlert.create({ data: alert }).catch(() => null);
    if (record) saved.push(record);
  }

  saved.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));
  return sendSuccess(res, saved, 200, {
    source: 'live', generatedAt: new Date(), attribution: 'स्रोत: Open-Meteo + ICAR NCIPM नियम',
  });
});

// ── GET /api/v1/pest/alerts/:id ───────────────────────────────────────────────
router.get('/alerts/:id', authenticate, async (req, res) => {
  const alert = await prisma.pestAlert.findUnique({ where: { id: req.params.id } });
  if (!alert) return sendError(res, 'Pest alert not found', 404);
  return sendSuccess(res, alert);
});

// ── GET /api/v1/pest/forecast ─────────────────────────────────────────────────
// Returns upcoming 7-day pest risk for a specific crop and district
router.get('/forecast', authenticate, async (req, res) => {
  if (!await isEnabled('pest_alerts')) return sendError(res, 'कीट चेतावनी सेवा अभी उपलब्ध नहीं है।', 503);

  const district    = req.query.district || req.user?.district || 'Pune';
  const crop        = req.query.crop     || 'soybean';
  const dayOfSeason = parseInt(req.query.dayOfSeason || '45', 10);

  // Get alerts from DB for this crop + district (last 7 days)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const alerts = await prisma.pestAlert.findMany({
    where: {
      districts: { has: district },
      affectedCrops: { has: crop.toLowerCase() },
      isActive:  true,
      validUntil: { gt: new Date() },
    },
    orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    take: 10,
  });

  return sendSuccess(res, alerts, 200, {
    district, crop, dayOfSeason, attribution: 'स्रोत: Open-Meteo + ICAR NCIPM नियम',
  });
});

// ── POST /api/v1/pest/report ──────────────────────────────────────────────────
// Farmer reports a pest sighting (community crowdsourcing)
router.post('/report', authenticate, async (req, res) => {
  const { pest, crop, description, severity, district, state } = req.body;

  if (!pest || !crop) return sendError(res, 'pest and crop are required', 400);
  if (typeof pest !== 'string' || pest.trim().length > 200) return sendError(res, 'pest must be a string (max 200 chars)', 400);
  if (typeof crop !== 'string' || crop.trim().length > 100) return sendError(res, 'crop must be a string (max 100 chars)', 400);

  const report = await prisma.pestAlert.create({
    data: {
      pest:          stripHtml(pest.trim()),
      pestHi:        null,
      affectedCrops: [stripHtml(crop.trim().toLowerCase())],
      severity:      ['low', 'moderate', 'high', 'critical'].includes(severity) ? severity : 'moderate',
      state:         state || req.user?.state    || 'Maharashtra',
      districts:     [district || req.user?.district || ''],
      symptoms:      description ? [{ description: stripHtml(description), descriptionHi: '' }] : [],
      solutions:     {},
      validFrom:     new Date(),
      validUntil:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      source:        'farmer_report',
      isActive:      true,
    },
  });

  return sendSuccess(res, report, 201);
});

// ── POST /api/v1/pest/predict — AI-powered pest prediction with credit system ─
// Smart routing: rule-based (0 credits) → Haiku (1 credit) → Sonnet (5 credits)
router.post('/predict', authenticate, async (req, res) => {
  const { lat, lon, crops, state, district, dayOfSeason, language, weatherData } = req.body;

  const farmLat = lat || req.user?.lat || 19.9975;
  const farmLon = lon || req.user?.lon || 73.7898;

  // Pre-check: ensure user has at least 1 credit (Haiku minimum)
  // Rule-based (level 0) is always free; credit check is for AI enhancement
  let creditCheck;
  try {
    creditCheck = await checkCredits(req.user.id, 'ai_pest_haiku');
  } catch {
    creditCheck = { allowed: true, balance: null, cost: 0 };
  }

  try {
    const { data } = await axios.post(`${AI_BASE}/pest/predict`, {
      lat:            farmLat,
      lon:            farmLon,
      crops:          crops || [],
      state:          state    || req.user?.state    || 'Maharashtra',
      district:       district || req.user?.district || 'Pune',
      day_of_season:  dayOfSeason || 45,
      language:       language || 'en',
      weather_data:   weatherData || null,
    }, { timeout: 90000 });

    const result = data.data;
    const meta   = result?._meta || {};
    const level  = meta.level ?? 0;
    const featureType = pestLevelToFeatureType(level);
    const tokenUsage  = meta.token_usage || {};

    // Deduct credits based on actual engine used (not pre-estimated)
    let creditResult = { balance: creditCheck.balance, creditsUsed: 0 };
    if (level > 0) {
      try {
        creditResult = await deductCredits(req.user.id, featureType, {
          model: meta.model || 'unknown',
          tokensUsed: tokenUsage.total_tokens || 0,
          costUsd: tokenUsage.cost_usd || 0,
          description: `Pest prediction (level ${level}): ${meta.model || 'rule_based'}`,
          metadata: { farm: { lat: farmLat, lon: farmLon }, crops, engine: meta.engine },
        });
      } catch { /* non-blocking */ }
    }

    // Record in AIUsage for backward compatibility
    try {
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      await prisma.aIUsage.upsert({
        where:  { userId_date: { userId: req.user.id, date: today } },
        create: { userId: req.user.id, date: today, totalTokens: tokenUsage.total_tokens || 0, totalCostUsd: tokenUsage.cost_usd || 0, monthlyTokens: tokenUsage.total_tokens || 0, monthlyCostUsd: tokenUsage.cost_usd || 0 },
        update: {
          totalTokens:    { increment: tokenUsage.total_tokens || 0 },
          totalCostUsd:   { increment: tokenUsage.cost_usd || 0 },
          monthlyTokens:  { increment: tokenUsage.total_tokens || 0 },
          monthlyCostUsd: { increment: tokenUsage.cost_usd || 0 },
        },
      });
    } catch { /* non-blocking */ }

    return sendSuccess(res, result, 200, {
      source: meta.engine || 'rule_based',
      attribution: 'KisanRakshak AI — ICAR + Open-Meteo + Claude Agent',
      credits: {
        used: creditResult.creditsUsed,
        balance: creditResult.balance,
        level,
      },
      tokenUsage: {
        inputTokens: tokenUsage.input_tokens || 0,
        outputTokens: tokenUsage.output_tokens || 0,
        totalTokens: tokenUsage.total_tokens || 0,
        costUsd: tokenUsage.cost_usd || 0,
        model: meta.model || 'none',
      },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.detail || err.message;
    console.error('[PestPredict] FastAPI error:', msg);
    return sendError(res, `Pest prediction service error: ${msg}`, status);
  }
});

// ── POST /api/v1/pest/detect-image — Pest identification from photo ─────────
router.post('/detect-image', authenticate, async (req, res) => {
  const { imageBase64, mediaType, cropName, state, language } = req.body;

  if (!imageBase64) return sendError(res, 'imageBase64 is required', 400);

  try {
    const { data } = await axios.post(`${AI_BASE}/pest/detect-image`, {
      image_base64: imageBase64,
      media_type:   mediaType || 'image/jpeg',
      crop_name:    cropName,
      state:        state || req.user?.state || 'Maharashtra',
      language:     language || 'en',
    }, { timeout: 45000 });

    // Deduct credits for vision-based pest detection
    deductCredits(req.user.id, 'ai_scan_claude', {
      model: 'claude-sonnet-vision', description: `Pest image detection: ${cropName || 'crop'}`,
    }).catch(() => {});

    return sendSuccess(res, data.data);
  } catch (err) {
    const msg = err.response?.data?.detail || err.message;
    console.error('[PestDetect] FastAPI error:', msg);
    return sendError(res, `Pest detection error: ${msg}`, err.response?.status || 500);
  }
});

// ── GET /api/v1/pest/credits — User's AI credit balance & history ────────────
router.get('/credits', authenticate, async (req, res) => {
  try {
    const summary = await getCreditSummary(req.user.id);
    return sendSuccess(res, summary);
  } catch (err) {
    console.error('[Credits] Error:', err.message);
    return sendError(res, 'Failed to fetch credit info', 500);
  }
});

export default router;
