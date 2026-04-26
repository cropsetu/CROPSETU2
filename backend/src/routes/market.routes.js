/**
 * Market Price Routes — real data.gov.in + Claude predictions (via FastAPI)
 *
 * GET /api/v1/market/prices?crop=Tomato&state=Maharashtra&district=Pune  — live mandi prices
 * GET /api/v1/market/predict?crop=Tomato&state=Maharashtra&district=Pune — Claude prediction (FastAPI)
 * GET /api/v1/market/crops                                               — supported crops + states
 *
 * Extended historical/forecast: use /api/v1/agripredict/prices/history
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { getMandiPrices } from '../services/mandiPrice.service.js';
import { ENV } from '../config/env.js';

const AI_BASE = ENV.AI_BACKEND_URL || 'http://localhost:8001';

const SUPPORTED_STATES = [
  'Maharashtra','Punjab','Madhya Pradesh','Uttar Pradesh','Karnataka',
  'Andhra Pradesh','Rajasthan','Gujarat','Telangana','Tamil Nadu',
  'Bihar','West Bengal','Haryana','Odisha','Chhattisgarh',
];

const SUPPORTED_CROPS = [
  'Tomato','Onion','Potato','Wheat','Rice','Soyabean','Cotton','Maize',
  'Gram','Arhar/Tur','Groundnut','Mustard','Bajra','Jowar',
  'Sugarcane','Ginger','Garlic','Turmeric','Chilli','Brinjal','Cauliflower',
  'Cabbage','Okra','Capsicum','Cucumber','Peas','Moong','Urad','Masoor',
];

async function fastApiPredict(commodity, state, district) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const resp = await fetch(`${AI_BASE}/agripredict/predict`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ commodity, state, district: district || '' }),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    const body = await resp.json();
    if (!resp.ok) throw Object.assign(new Error(body?.detail || 'FastAPI error'), { status: resp.status });
    return body.data;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

const router = Router();

// ── GET /api/v1/market/prices ─────────────────────────────────────────────────
router.get('/prices', authenticate, async (req, res) => {
  const crop     = req.query.crop     || req.query.commodity || 'Tomato';
  const state    = req.query.state    || req.user?.state || 'Maharashtra';
  const district = req.query.district || req.query.city  || null;

  if (!crop || typeof crop !== 'string' || crop.trim().length === 0 || crop.length > 60) {
    return sendError(res, 'Invalid crop name', 400);
  }

  try {
    const { data, stale, source, fetchedAt, cachedAt } = await getMandiPrices(crop, state, district);

    if (!data.length) {
      return sendError(res, `No data found for ${crop} in ${district || state}. Try a different state or trigger a sync.`, 404);
    }

    const sorted = [...data].sort((a, b) => (b.modalPrice || 0) - (a.modalPrice || 0));
    return sendSuccess(res, sorted, 200, {
      commodity:   crop,
      state,
      district:    district || null,
      total:       sorted.length,
      source:      stale ? `Cached (${source})` : `data.gov.in`,
      isStale:     stale,
      fetchedAt:   fetchedAt || cachedAt || null,
      attribution: 'Source: Agmarknet / data.gov.in, Government of India',
    });
  } catch (err) {
    console.error('[Market/prices]', err.message);
    return sendError(res, 'Mandi price data unavailable. Please try again.', 503);
  }
});

// ── GET /api/v1/market/predict ────────────────────────────────────────────────
// Proxies to FastAPI — cache-first Claude prediction
router.get('/predict', authenticate, async (req, res) => {
  const crop     = req.query.crop     || req.query.commodity || 'Tomato';
  const state    = req.query.state    || req.user?.state || 'Maharashtra';
  const district = req.query.district || '';

  if (!crop || typeof crop !== 'string' || crop.trim().length === 0 || crop.length > 60) {
    return sendError(res, 'Invalid crop name', 400);
  }

  try {
    const result = await fastApiPredict(crop, state, district);

    if (result?.error === 'insufficient_data') {
      return sendError(res, result.message, 404);
    }

    return sendSuccess(res, result, 200, {
      cached:    result?.cached,
      cachedAt:  result?.cached_at  || null,
      expiresAt: result?.expires_at || null,
    });
  } catch (err) {
    console.error('[Market/predict]', err.message);
    return sendError(res, 'Price prediction unavailable. Please try again.', 503);
  }
});

// ── GET /api/v1/market/crops ──────────────────────────────────────────────────
router.get('/crops', authenticate, async (req, res) => {
  const { state } = req.query;
  try {
    if (state) {
      // Ask FastAPI for live commodities from DB
      const ctrl  = new AbortController();
      setTimeout(() => ctrl.abort(), 5_000);
      const resp = await fetch(
        `${AI_BASE}/agripredict/filters/commodities?state=${encodeURIComponent(state)}`,
        { signal: ctrl.signal }
      ).catch(() => null);
      if (resp?.ok) {
        const body = await resp.json().catch(() => null);
        const commodities = body?.data?.commodities || [];
        if (commodities.length) {
          return sendSuccess(res, { crops: commodities, states: SUPPORTED_STATES });
        }
      }
    }
    // Fallback to static list
    return sendSuccess(res, { crops: SUPPORTED_CROPS, states: SUPPORTED_STATES });
  } catch {
    return sendSuccess(res, { crops: SUPPORTED_CROPS, states: SUPPORTED_STATES });
  }
});

export default router;
