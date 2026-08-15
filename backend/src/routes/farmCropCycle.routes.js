/**
 * Crop Cycle Routes — Full crop lifecycle tracking
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import { idempotency } from '../middleware/idempotency.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError, paginationMeta, parsePageSize } from '../utils/response.js';
import logger from '../utils/logger.js';
import prisma from '../config/db.js';
import {
  createCropCycle, listCropCycles, getCropCycleDetail, updateCropCycle, deleteCropCycle,
  advanceGrowthStage, addFertilizer, addPesticide, addIrrigationLog,
  addObservedEvent, recordHarvest, recordSale, completeCycle, getCycleFinancials,
  addActivity, addLaborLog, addExpenseLog, addIncomeLog, getCycleLogPage,
} from '../services/cropCycle.service.js';
import { LOG_COLUMNS } from '../utils/jsonLog.js';

/**
 * Shared reply for the four log-append routes.
 *
 * `null`            → the cycle is not this farmer's (or is gone)      → 404
 * `{ error:'full' }`→ the log hit its ceiling                          → 409
 * anything else     → the refreshed cycle                              → 200
 *
 * The 409 matters: before the cap existed the array grew without limit, and the
 * alternative to telling the farmer is silently dropping the entry they just
 * typed — which is exactly the failure mode the atomic append was added to end.
 */
function replyLogAppend(res, result, label) {
  if (!result) return sendNotFound(res, 'Crop cycle');
  if (result.error === 'full') {
    return sendError(res, `This crop cycle already has the maximum number of ${label} entries. Start a new cycle or remove some entries.`, 409);
  }
  return sendSuccess(res, result);
}

const router = Router();

// This router is mounted at the root API prefix so it can serve both
// /farms/:farmId/cycles and /cycles/:cycleId. Without this guard, every
// unknown /api/v1/* URL would hit authenticate and return 401 instead of 404.
router.use((req, _res, next) => {
  const p = req.path;
  if (p.startsWith('/farms/') || p.startsWith('/cycles/')) return authenticate(req, _res, next);
  return next('router');
});
// Per-user write throttle shared across every crop-cycle mutation (cycle CRUD plus
// the fertilizer / pesticide / irrigation / labor / expense / income / harvest / sale
// sub-logs). Redis-backed sliding window shared across all instances (in-memory
// fallback when Redis is down — see middleware/rateLimit.js), so the cap holds in a
// clustered deploy. Keyed on the authenticated user id (router runs `authenticate`),
// falling back to client IP only if user is somehow absent. Logging a day's field
// activity can legitimately span many writes, so the budget is generous (120/15min ≈
// sustained 8/min) — enough for real logging, tight enough to stop scripted floods.
// Stacks on top of the global per-IP limiter.
const wl = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      120,            // 120 cycle writes / 15 min / user
  prefix:   'cycle:write',
  key:      (req) => req.user?.id || clientIp(req),
  message:  'Too many crop-cycle updates. Please wait a few minutes and try again.',
});
const idemCycle = idempotency('cycle_write');  // dedupe duplicate cycle writes (401-replay / retry)

// ── Ownership guard for every /cycles/:cycleId* route ─────────────────────────
// Centralizes the authorization check so no individual handler can forget it.
// Returns a clean 403 when another farmer's cycle is targeted (not a 404/500
// leaked from a scoped DB write), and — critically — closes the IDOR on the
// read-only detail and financials endpoints, which previously loaded a cycle by
// id with no owner scope. The per-route services still scope writes by farmerId,
// so this is also defense-in-depth for the mutating routes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function requireCycleOwner(req, res, next) {
  // Defer malformed ids to each route's param('cycleId').isUUID() → clean 400.
  if (!UUID_RE.test(req.params.cycleId || '')) return next();
  try {
    const cycle = await prisma.farmCropCycle.findUnique({
      where:  { id: req.params.cycleId },
      select: { farmerId: true },
    });
    if (!cycle) return sendNotFound(res, 'Crop cycle');
    if (cycle.farmerId !== req.user.id) return sendForbidden(res, 'Not your crop cycle');
    return next();
  } catch (err) {
    return next(err); // Express 4 won't catch async throws — hand to error handler
  }
}
router.use('/cycles/:cycleId', requireCycleOwner);

// List cycles for a farm
router.get('/farms/:farmId/cycles', [
  param('farmId').isUUID(),
  query('season').optional(), query('year').optional().isInt(), query('status').optional(),
  query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 50 }),
], validate, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = parsePageSize(req.query.limit, 20, 50);
    const { rows, total } = await listCropCycles(req.params.farmId, req.query, { page, limit });
    return sendSuccess(res, rows, 200, paginationMeta(total, page, limit));
  }
  catch (e) { logger.error({ err: e }, '[CropCycle] list'); return sendError(res, 'Failed', 500); }
});

/**
 * One page of a cycle's activity / labour / expense / income log, newest first.
 *
 * The cycle detail response carries these arrays in full, which is fine for a
 * young cycle and increasingly not fine for a perennial one logged daily. This
 * slices in the database so a long-running cycle costs the same to open as a
 * new one. Ownership is enforced by requireCycleOwner above AND again inside
 * the query.
 */
router.get('/cycles/:cycleId/logs/:column', [
  param('cycleId').isUUID(),
  param('column').isIn(Object.keys(LOG_COLUMNS)),
  query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 100 }),
], validate, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = parsePageSize(req.query.limit, 30, 100);
    const r = await getCycleLogPage(req.params.cycleId, req.user.id, req.params.column, {
      offset: (page - 1) * limit, limit,
    });
    if (!r) return sendNotFound(res, 'Crop cycle');
    return sendSuccess(res, r.items, 200, paginationMeta(r.total, page, limit));
  } catch (e) { return sendServerError(res, e, 'Could not load the log.'); }
});

// Create cycle
router.post('/farms/:farmId/cycles', wl, idemCycle, [param('farmId').isUUID(), body('cropName').notEmpty().trim(), body('season').notEmpty().isIn(['KHARIF', 'RABI', 'ZAID', 'PERENNIAL']), body('year').notEmpty().isInt(), body('areaAllocatedAcres').notEmpty().isFloat({ min: 0.01 })], validate, async (req, res) => {
  try {
    const cycle = await createCropCycle(req.user.id, req.params.farmId, req.body);
    return cycle ? sendCreated(res, cycle) : sendNotFound(res, 'Farm');
  } catch (e) { return sendServerError(res, e, 'Could not create crop cycle.', 400); }
});

// Get cycle detail
router.get('/cycles/:cycleId', [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const c = await getCropCycleDetail(req.params.cycleId);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { logger.error({ err: e }, '[CropCycle] get'); return sendError(res, 'Failed', 500); }
});

// Update cycle
router.patch('/cycles/:cycleId', wl, idemCycle, [param('cycleId').isUUID()], validate, async (req, res) => {
  try { return sendSuccess(res, await updateCropCycle(req.params.cycleId, req.user.id, req.body)); }
  catch (e) { logger.error({ err: e }, '[CropCycle] update'); return sendError(res, 'Failed', 500); }
});

// Delete cycle (only the owning farmer can delete)
router.delete('/cycles/:cycleId', wl, idemCycle, [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const ok = await deleteCropCycle(req.params.cycleId, req.user.id);
    return ok ? sendSuccess(res, { deleted: true }) : sendNotFound(res, 'Crop cycle');
  } catch (e) { logger.error({ err: e }, '[CropCycle] delete'); return sendError(res, 'Failed', 500); }
});

// Advance growth stage
router.post('/cycles/:cycleId/stage', wl, idemCycle, [param('cycleId').isUUID(), body('stage').notEmpty()], validate, async (req, res) => {
  try { return sendSuccess(res, await advanceGrowthStage(req.params.cycleId, req.user.id, req.body.stage)); }
  catch (e) { return sendError(res, 'Failed', 500); }
});

// Add fertilizer
router.post('/cycles/:cycleId/fertilizer', wl, idemCycle, [param('cycleId').isUUID(), body('productName').notEmpty().trim()], validate, async (req, res) => {
  try {
    const c = await addFertilizer(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add pesticide
router.post('/cycles/:cycleId/pesticide', wl, idemCycle, [param('cycleId').isUUID(), body('productName').notEmpty().trim()], validate, async (req, res) => {
  try {
    const c = await addPesticide(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add irrigation log
router.post('/cycles/:cycleId/irrigation', wl, idemCycle, [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const c = await addIrrigationLog(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Log event (pest/weather)
router.post('/cycles/:cycleId/event', wl, idemCycle, [param('cycleId').isUUID(), body('type').notEmpty()], validate, async (req, res) => {
  try {
    const c = await addObservedEvent(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add generic activity (land-prep / sowing / scout / weeding / pruning / …)
router.post('/cycles/:cycleId/activity', wl, idemCycle, [param('cycleId').isUUID(), body('type').notEmpty()], validate, async (req, res) => {
  try {
    const c = await addActivity(req.params.cycleId, req.user.id, req.body);
    return replyLogAppend(res, c, 'activity');
  } catch (e) { return sendServerError(res, e, 'Could not add activity.', 400); }
});

// Add labour-cost log
router.post('/cycles/:cycleId/labor', wl, idemCycle, [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const c = await addLaborLog(req.params.cycleId, req.user.id, req.body);
    return replyLogAppend(res, c, 'labour');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add miscellaneous expense log
router.post('/cycles/:cycleId/expense', wl, idemCycle, [param('cycleId').isUUID(), body('amountInr').notEmpty().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const c = await addExpenseLog(req.params.cycleId, req.user.id, req.body);
    return replyLogAppend(res, c, 'expense');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add non-sale income log
router.post('/cycles/:cycleId/income', wl, idemCycle, [param('cycleId').isUUID(), body('amountInr').notEmpty().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const c = await addIncomeLog(req.params.cycleId, req.user.id, req.body);
    return replyLogAppend(res, c, 'income');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Record harvest
router.post('/cycles/:cycleId/harvest', wl, idemCycle, [param('cycleId').isUUID(), body('yieldKg').notEmpty().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const c = await recordHarvest(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Record sale
router.post('/cycles/:cycleId/sale', wl, idemCycle, [param('cycleId').isUUID(), body('soldQuantityKg').notEmpty().isFloat({ min: 0 }), body('pricePerKgInr').notEmpty().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const c = await recordSale(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Complete cycle (recompute financials)
router.post('/cycles/:cycleId/complete', wl, idemCycle, [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const c = await completeCycle(req.params.cycleId, req.user.id);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Get financials (P&L breakdown for charts)
router.get('/cycles/:cycleId/financials', [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const f = await getCycleFinancials(req.params.cycleId);
    return f ? sendSuccess(res, f) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

export default router;
