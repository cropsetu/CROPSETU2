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
import { getSigned, postSignedJSON } from '../utils/fastapi-signed.js';

const router  = Router();

// ── Generic proxy helpers (HMAC-signed) ───────────────────────────────────────
// All Express → FastAPI calls go through the shared signed helper so the
// FastAPI public URL on Railway cannot be hit directly. The same secret is
// shared with fastapi/security/auth.py.

function _handleProxyError(res, err, fallbackMsg) {
  if (err.status === 504 || err.name === 'AbortError') {
    return sendError(res, 'AgriPredict service timeout', 504);
  }
  const detail = err.detail ?? err.message;
  const isDbDown = typeof detail === 'string' && detail.includes('PostgreSQL unreachable');
  if (isDbDown) {
    return sendError(res, 'Price database temporarily unavailable — please try again later', err.status || 503);
  }
  if (err.status && err.status >= 400 && err.status < 500) {
    return sendError(res, detail || fallbackMsg, err.status);
  }
  return sendError(res, fallbackMsg, 503);
}

async function proxyGet(res, path, userId, timeoutMs = 15_000) {
  try {
    const body = await getSigned(path, { userId, timeoutMs });
    // FastAPI wraps in { success, data } — pass through transparently
    return res.status(200).json(body);
  } catch (err) {
    return _handleProxyError(res, err, 'Price service temporarily unavailable — please try again later');
  }
}

async function proxyPost(res, path, body, userId, timeoutMs = 120_000) {
  try {
    const envelope = await postSignedJSON(path, body, { userId, timeoutMs });
    return res.status(200).json(envelope);
  } catch (err) {
    return _handleProxyError(res, err, 'Prediction timed out — try again');
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/v1/agripredict/filters/states
router.get('/filters/states', authenticate, (req, res) =>
  proxyGet(res, '/agripredict/filters/states', req.user?.id)
);

// GET /api/v1/agripredict/filters/districts?state=...
router.get('/filters/districts', authenticate, (req, res) => {
  const { state } = req.query;
  if (!state) return sendError(res, 'state query param required', 400);
  return proxyGet(res, `/agripredict/filters/districts?state=${encodeURIComponent(state)}`, req.user?.id);
});

// GET /api/v1/agripredict/filters/commodities?state=...&district=...
router.get('/filters/commodities', authenticate, (req, res) => {
  const { state, district } = req.query;
  if (!state) return sendError(res, 'state query param required', 400);
  const qs = new URLSearchParams({ state });
  if (district) qs.set('district', district);
  return proxyGet(res, `/agripredict/filters/commodities?${qs}`, req.user?.id);
});

// GET /api/v1/agripredict/prices/history
router.get('/prices/history', authenticate, (req, res) => {
  const { commodity, state, district } = req.query;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  const qs = new URLSearchParams({ commodity, state });
  if (district) qs.set('district', district);
  return proxyGet(res, `/agripredict/prices/history?${qs}`, req.user?.id);
});

// POST /api/v1/agripredict/predict
router.post('/predict', authenticate, async (req, res) => {
  const { commodity, state, district = '' } = req.body;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  // Deduct credits for AI price prediction (non-blocking)
  deductCredits(req.user.id, 'ai_chat_claude', {
    model: 'claude-haiku', description: `Price prediction: ${commodity} in ${state}`,
  }).catch(() => {});
  return proxyPost(res, '/agripredict/predict', { commodity, state, district }, req.user?.id, 120_000);
});

// GET /api/v1/agripredict/compare
router.get('/compare', authenticate, (req, res) => {
  const { commodity, state, district } = req.query;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  const qs = new URLSearchParams({ commodity, state });
  if (district) qs.set('district', district);
  return proxyGet(res, `/agripredict/compare?${qs}`, req.user?.id);
});

// POST /api/v1/agripredict/sync/trigger  → non-blocking 202
router.post('/sync/trigger', authenticate, (req, res) => {
  const { commodity, state, district, max_pages = 10 } = req.body;
  if (!commodity || !state) return sendError(res, 'commodity and state are required', 400);
  return proxyPost(
    res, '/agripredict/sync/trigger',
    { commodity, state, district: district || null, max_pages: Math.min(max_pages, 50) },
    req.user?.id,
    10_000  // 202 comes back instantly; actual sync runs in FastAPI background
  );
});

// GET /api/v1/agripredict/sync/status
router.get('/sync/status', authenticate, (req, res) => {
  const { commodity, state } = req.query;
  const qs = new URLSearchParams();
  if (commodity) qs.set('commodity', commodity);
  if (state)     qs.set('state',     state);
  return proxyGet(res, `/agripredict/sync/status?${qs}`, req.user?.id);
});

export default router;
