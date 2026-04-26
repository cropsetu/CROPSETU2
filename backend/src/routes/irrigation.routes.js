/**
 * Irrigation Scheduler Routes
 *
 * GET  /api/v1/irrigation/today?crop=soybean&lat=18.52&lon=73.85&sowingDate=2025-07-01
 * GET  /api/v1/irrigation/weekly?crop=soybean&lat=18.52&lon=73.85
 * POST /api/v1/irrigation/log          — farmer logs irrigation action
 * GET  /api/v1/irrigation/history?crop=soybean&days=30
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import { getIrrigationRecommendation } from '../services/irrigation.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── GET /api/v1/irrigation/today ─────────────────────────────────────────────
router.get('/today', authenticate, async (req, res) => {
  if (!await isEnabled('irrigation')) return sendError(res, 'सिंचाई शेड्यूलर अभी उपलब्ध नहीं है।', 503);

  const { crop, sowingDate, fieldName } = req.query;
  const lat = parseFloat(req.query.lat || '18.52');
  const lon = parseFloat(req.query.lon || '73.85');

  if (isNaN(lat) || isNaN(lon)) return sendError(res, 'Valid lat and lon are required', 400);
  if (!crop?.trim()) return sendError(res, 'crop is required', 400);

  try {
    const recommendation = await getIrrigationRecommendation({
      userId:    req.user.id,
      lat, lon,
      cropName:  crop.trim(),
      sowingDate: sowingDate || null,
      fieldName:  fieldName?.trim() || null,
    });

    return sendSuccess(res, recommendation);
  } catch (err) {
    console.error('[Irrigation]', err.message);
    return sendError(res, err.message || 'सिंचाई डेटा उपलब्ध नहीं है।', 503);
  }
});

// ── GET /api/v1/irrigation/weekly ────────────────────────────────────────────
// Returns the weeklyForecast strip from the same engine
router.get('/weekly', authenticate, async (req, res) => {
  if (!await isEnabled('irrigation')) return sendError(res, 'सिंचाई शेड्यूलर अभी उपलब्ध नहीं है।', 503);

  const lat  = parseFloat(req.query.lat  || '18.52');
  const lon  = parseFloat(req.query.lon  || '73.85');
  const crop = req.query.crop || 'soybean';
  const sowingDate = req.query.sowingDate || null;

  try {
    const rec = await getIrrigationRecommendation({ userId: req.user.id, lat, lon, cropName: crop, sowingDate });
    return sendSuccess(res, rec.weeklyForecast, 200, {
      crop, source: 'Open-Meteo + FAO Hargreaves',
    });
  } catch (err) {
    return sendError(res, 'Weather data unavailable. Please try again.', 503);
  }
});

// ── POST /api/v1/irrigation/log ───────────────────────────────────────────────
// Farmer logs what they actually did (irrigated / skipped)
router.post('/log', authenticate, async (req, res) => {
  const { logId, farmerAction } = req.body;

  if (!logId)      return sendError(res, 'logId is required', 400);
  if (!['irrigated', 'skipped', 'pending'].includes(farmerAction)) {
    return sendError(res, 'farmerAction must be irrigated | skipped | pending', 400);
  }

  const log = await prisma.irrigationLog.findFirst({ where: { id: logId, userId: req.user.id } });
  if (!log) return sendError(res, 'Log not found', 404);

  const updated = await prisma.irrigationLog.update({
    where: { id: log.id },
    data:  { farmerAction },
  });

  return sendSuccess(res, updated);
});

// ── GET /api/v1/irrigation/history ───────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  const crop = req.query.crop || null;
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = { userId: req.user.id, date: { gte: since } };
  if (crop) where.crop = { contains: crop, mode: 'insensitive' };

  const logs = await prisma.irrigationLog.findMany({
    where, orderBy: { date: 'desc' }, take: 60,
  });

  return sendSuccess(res, logs, 200, {
    crop: crop || 'all', days, total: logs.length,
  });
});

export default router;
