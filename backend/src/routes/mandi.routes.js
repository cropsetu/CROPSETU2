/**
 * Mandi Bhav Routes (Real Data — data.gov.in)
 *
 * GET  /api/v1/mandi/prices?commodity=Soybean&state=Maharashtra&district=Pune
 * GET  /api/v1/mandi/prices/:commodity/trend?market=Latur&days=30
 * GET  /api/v1/mandi/nearby?district=Pune&commodity=Soybean
 * POST /api/v1/mandi/alerts                 — set price alert
 * GET  /api/v1/mandi/alerts                 — list user's alerts
 * DELETE /api/v1/mandi/alerts/:id           — delete alert
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import { getMandiPrices, getPriceTrend, getNearbyMandiNames } from '../services/mandiPrice.service.js';
import prisma from '../config/db.js';

const router = Router();

const SUPPORTED_COMMODITIES = [
  'Tomato', 'Onion', 'Potato', 'Wheat', 'Rice', 'Soyabean', 'Cotton',
  'Arhar/Tur', 'Gram', 'Maize', 'Bajra', 'Jowar', 'Groundnut',
  'Sunflower Seed', 'Sugarcane',
];

// ── GET /api/v1/mandi/prices ──────────────────────────────────────────────────
router.get('/prices', authenticate, async (req, res) => {
  if (!await isEnabled('mandi_bhav')) {
    return sendError(res, 'मंडी भाव सेवा अभी उपलब्ध नहीं है। कृपया बाद में देखें।', 503);
  }

  const commodity = req.query.commodity || 'Soyabean';
  const state     = req.query.state     || req.user?.state || 'Maharashtra';
  const district  = req.query.district  || req.user?.district || null;

  const { data, stale, source, fetchedAt, cachedAt } = await getMandiPrices(commodity, state, district);

  if (!data.length) {
    return sendError(res, `No mandi data found for ${commodity} in ${district ? `${district}, ` : ''}${state}. Try a different commodity or state.`, 404);
  }

  // Service already sorts: freshest priceDate first, then highest modal price.
  // Don't re-sort here — that would bury small mandis whose reports are older.

  const sourceLabel = source === 'db-seeded'
    ? 'Cached (pre-seeded DB)'
    : source === 'db-cache'
      ? 'Cached (DB — updated today)'
      : source === 'data.gov.in'
        ? 'Live — data.gov.in'
        : source;

  return sendSuccess(res, data, 200, {
    commodity, state, district,
    total:     data.length,
    source:    sourceLabel,
    isStale:   stale,
    fetchedAt: fetchedAt || cachedAt || null,
    disclaimer: stale ? 'Prices from pre-seeded DB — may be a few days old. Live data.gov.in unavailable right now.' : null,
    attribution: 'Source: Agmarknet / data.gov.in, Government of India',
  });
});

// ── GET /api/v1/mandi/prices/:commodity/trend ─────────────────────────────────
router.get('/prices/:commodity/trend', authenticate, async (req, res) => {
  if (!await isEnabled('mandi_bhav')) return sendError(res, 'मंडी भाव सेवा अभी उपलब्ध नहीं है।', 503);

  const commodity = decodeURIComponent(req.params.commodity);
  const market    = req.query.market || '';
  const days      = Math.min(parseInt(req.query.days || '30', 10), 365);

  if (!market.trim()) return sendError(res, 'market query param is required', 400);

  const trend = await getPriceTrend(commodity, market, days);
  if (!trend.length) return sendError(res, `${days} दिनों में ${commodity} के लिए ${market} में कोई डेटा नहीं मिला`, 404);

  // Calculate moving average
  const prices = trend.map(t => t.modalPrice);
  const avg7   = prices.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, prices.length);
  const avg30  = prices.reduce((a, b) => a + b, 0) / prices.length;
  const currentPrice = prices[prices.length - 1] || 0;
  const priceVsAvg   = currentPrice && avg30 ? Math.round(((currentPrice - avg30) / avg30) * 100) : null;

  return sendSuccess(res, {
    commodity, market, days,
    trend,
    stats: { currentPrice, avg7: Math.round(avg7), avg30: Math.round(avg30), priceVsAvgPercent: priceVsAvg },
    attribution: 'स्रोत: data.gov.in, भारत सरकार',
  });
});

// ── GET /api/v1/mandi/nearby ──────────────────────────────────────────────────
router.get('/nearby', authenticate, async (req, res) => {
  if (!await isEnabled('mandi_bhav')) return sendError(res, 'मंडी भाव सेवा अभी उपलब्ध नहीं है।', 503);

  const district  = req.query.district  || req.user?.district || 'Pune';
  const state     = req.query.state     || req.user?.state    || 'Maharashtra';
  const commodity = req.query.commodity || 'Soyabean';

  const nearbyMandis = getNearbyMandiNames(district);
  if (!nearbyMandis.length) return sendError(res, `${district} जिले के लिए मंडी सूची उपलब्ध नहीं है`, 404);

  // Fetch prices for each nearby mandi from DB
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const results = await prisma.mandiPrice.findMany({
    where: {
      commodity: { contains: commodity, mode: 'insensitive' },
      state:     { contains: state,     mode: 'insensitive' },
      market:    { in: nearbyMandis },
      priceDate: { gte: since },
    },
    orderBy: [{ market: 'asc' }, { priceDate: 'desc' }],
  });

  // Deduplicate: one record per market (most recent)
  const seen = new Set();
  const deduped = results.filter(r => { if (seen.has(r.market)) return false; seen.add(r.market); return true; });

  return sendSuccess(res, deduped.sort((a, b) => b.modalPrice - a.modalPrice), 200, {
    district, state, commodity, nearbyMandis, attribution: 'स्रोत: data.gov.in, भारत सरकार',
  });
});

// ── POST /api/v1/mandi/alerts ─────────────────────────────────────────────────
router.post('/alerts', authenticate, async (req, res) => {
  const { commodity, market, targetPrice, condition, notificationMethod } = req.body;

  if (!commodity || !targetPrice || !condition) {
    return sendError(res, 'commodity, targetPrice, condition are required', 400);
  }
  if (typeof commodity !== 'string' || commodity.trim().length > 100) {
    return sendError(res, 'commodity must be a string (max 100 chars)', 400);
  }
  if (market && (typeof market !== 'string' || market.trim().length > 100)) {
    return sendError(res, 'market must be a string (max 100 chars)', 400);
  }
  if (!['above', 'below'].includes(condition)) return sendError(res, 'condition must be above or below', 400);
  if (!['push', 'whatsapp', 'both'].includes(notificationMethod || 'push')) {
    return sendError(res, 'notificationMethod must be push | whatsapp | both', 400);
  }
  if (isNaN(parseFloat(targetPrice)) || parseFloat(targetPrice) <= 0) {
    return sendError(res, 'targetPrice must be a positive number', 400);
  }

  const alert = await prisma.priceAlert.create({
    data: {
      userId:             req.user.id,
      commodity:          commodity.trim().replace(/<[^>]*>/g, ''),
      market:             market?.trim().replace(/<[^>]*>/g, '') || null,
      targetPrice:        parseFloat(targetPrice),
      condition,
      notificationMethod: notificationMethod || 'push',
    },
  });

  return sendSuccess(res, alert, 201);
});

// ── GET /api/v1/mandi/alerts ──────────────────────────────────────────────────
router.get('/alerts', authenticate, async (req, res) => {
  const alerts = await prisma.priceAlert.findMany({
    where:   { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return sendSuccess(res, alerts);
});

// ── DELETE /api/v1/mandi/alerts/:id ──────────────────────────────────────────
router.delete('/alerts/:id', authenticate, async (req, res) => {
  const alert = await prisma.priceAlert.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!alert) return sendError(res, 'Alert not found', 404);
  await prisma.priceAlert.delete({ where: { id: alert.id } });
  return sendSuccess(res, { deleted: true });
});

// ── GET /api/v1/mandi/commodities ────────────────────────────────────────────
router.get('/commodities', (_req, res) => {
  return sendSuccess(res, { commodities: SUPPORTED_COMMODITIES });
});

export default router;
