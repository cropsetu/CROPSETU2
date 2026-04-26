/**
 * AgriPredict Routes — thin proxy to FastAPI (port 8001)
 *
 * All heavy async work (paginated data.gov.in fetches, Claude predictions,
 * asyncpg DB writes) runs in the FastAPI process. Express only handles auth
 * and forwards requests, same pattern as /ai/scan and /ai/chat.
 *
 * FastAPI endpoints (prefix /agripredict):
 *   GET  /filters/states
 *   GET  /filters/districts?state=...
 *   GET  /filters/commodities?state=...&district=...
 *   GET  /prices/history?commodity=...&state=...&district=...
 *   POST /predict        { commodity, state, district }
 *   GET  /compare?commodity=...&state=...&district=...
 *   POST /sync/trigger   { commodity, state, district?, max_pages? }  → 202
 *   GET  /sync/status?commodity=...&state=...
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendError } from '../utils/response.js';
import { deductCredits } from '../services/aiCredit.service.js';
import { ENV } from '../config/env.js';

const router  = Router();
const AI_BASE = ENV.AI_BACKEND_URL || 'http://localhost:8001';

// ── Generic proxy helpers ─────────────────────────────────────────────────────

async function proxyGet(res, path, timeoutMs = 15_000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${AI_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    const body = await resp.json();
    if (!resp.ok) {
      const detail = body?.detail || 'AgriPredict service error';
      const isDbDown = typeof detail === 'string' && detail.includes('PostgreSQL unreachable');
      return sendError(
        res,
        isDbDown ? 'Price database temporarily unavailable — please try again later' : detail,
        resp.status,
      );
    }
    // FastAPI wraps in { success, data } — pass data through transparently
    return res.status(200).json(body);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return sendError(res, 'AgriPredict service timeout', 504);
    return sendError(res, 'Price service temporarily unavailable — please try again later', 503);
  }
}

async function proxyPost(res, path, body, timeoutMs = 120_000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${AI_BASE}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    const out = await resp.json();
    if (!resp.ok) {
      const detail = out?.detail || 'AgriPredict service error';
      const isDbDown = typeof detail === 'string' && detail.includes('PostgreSQL unreachable');
      return sendError(
        res,
        isDbDown ? 'Price database temporarily unavailable — please try again later' : detail,
        resp.status,
      );
    }
    return res.status(resp.status).json(out);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return sendError(res, 'Prediction timed out — try again', 504);
    return sendError(res, 'Price service temporarily unavailable — please try again later', 503);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/v1/agripredict/filters/states
router.get('/filters/states', authenticate, (_req, res) =>
  proxyGet(res, '/agripredict/filters/states')
);

// GET /api/v1/agripredict/filters/districts?state=...
router.get('/filters/districts', authenticate, (req, res) => {
  const { state } = req.query;
  if (!state) return sendError(res, 'state query param required', 400);
  return proxyGet(res, `/agripredict/filters/districts?state=${encodeURIComponent(state)}`);
});

// GET /api/v1/agripredict/filters/commodities?state=...&district=...
router.get('/filters/commodities', authenticate, (req, res) => {
  const { state, district } = req.query;
  if (!state) return sendError(res, 'state query param required', 400);
  const qs = new URLSearchParams({ state });
  if (district) qs.set('district', district);
  return proxyGet(res, `/agripredict/filters/commodities?${qs}`);
});

// GET /api/v1/agripredict/prices/history
router.get('/prices/history', authenticate, (req, res) => {
  const { commodity, state, district } = req.query;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  const qs = new URLSearchParams({ commodity, state });
  if (district) qs.set('district', district);
  return proxyGet(res, `/agripredict/prices/history?${qs}`);
});

// POST /api/v1/agripredict/predict
router.post('/predict', authenticate, async (req, res) => {
  const { commodity, state, district = '' } = req.body;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  // Deduct credits for AI price prediction (non-blocking)
  deductCredits(req.user.id, 'ai_chat_claude', {
    model: 'claude-haiku', description: `Price prediction: ${commodity} in ${state}`,
  }).catch(() => {});
  return proxyPost(res, '/agripredict/predict', { commodity, state, district }, 120_000);
});

// GET /api/v1/agripredict/compare
router.get('/compare', authenticate, (req, res) => {
  const { commodity, state, district } = req.query;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  const qs = new URLSearchParams({ commodity, state });
  if (district) qs.set('district', district);
  return proxyGet(res, `/agripredict/compare?${qs}`);
});

// POST /api/v1/agripredict/sync/trigger  → non-blocking 202
router.post('/sync/trigger', authenticate, (req, res) => {
  const { commodity, state, district, max_pages = 10 } = req.body;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  return proxyPost(
    res, '/agripredict/sync/trigger',
    { commodity, state, district: district || null, max_pages: Math.min(max_pages, 50) },
    10_000  // 202 comes back instantly; actual sync runs in FastAPI background
  );
});

// GET /api/v1/agripredict/sync/status
router.get('/sync/status', authenticate, (req, res) => {
  const { commodity, state } = req.query;
  const qs = new URLSearchParams();
  if (commodity) qs.set('commodity', commodity);
  if (state)     qs.set('state',     state);
  return proxyGet(res, `/agripredict/sync/status?${qs}`);
});

export default router;
