/**
 * Crop Cycle Routes — Full crop lifecycle tracking
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendCreated, sendError, sendNotFound } from '../utils/response.js';
import logger from '../utils/logger.js';
import {
  createCropCycle, listCropCycles, getCropCycleDetail, updateCropCycle,
  advanceGrowthStage, addFertilizer, addPesticide, addIrrigationLog,
  addObservedEvent, recordHarvest, recordSale, completeCycle, getCycleFinancials,
} from '../services/cropCycle.service.js';

const router = Router();

// This router is mounted at the root API prefix so it can serve both
// /farms/:farmId/cycles and /cycles/:cycleId. Without this guard, every
// unknown /api/v1/* URL would hit authenticate and return 401 instead of 404.
router.use((req, _res, next) => {
  const p = req.path;
  if (p.startsWith('/farms/') || p.startsWith('/cycles/')) return authenticate(req, _res, next);
  return next('router');
});
const wl = (_req, _res, next) => next();   // rate limit disabled for now

// List cycles for a farm
router.get('/farms/:farmId/cycles', [param('farmId').isUUID(), query('season').optional(), query('year').optional().isInt(), query('status').optional()], validate, async (req, res) => {
  try { return sendSuccess(res, await listCropCycles(req.params.farmId, req.query)); }
  catch (e) { logger.error({ err: e }, '[CropCycle] list'); return sendError(res, 'Failed', 500); }
});

// Create cycle
router.post('/farms/:farmId/cycles', wl, [param('farmId').isUUID(), body('cropName').notEmpty().trim(), body('season').notEmpty().isIn(['KHARIF', 'RABI', 'ZAID', 'PERENNIAL']), body('year').notEmpty().isInt(), body('areaAllocatedAcres').notEmpty().isFloat({ min: 0.01 })], validate, async (req, res) => {
  try {
    const cycle = await createCropCycle(req.user.id, req.params.farmId, req.body);
    return cycle ? sendCreated(res, cycle) : sendNotFound(res, 'Farm');
  } catch (e) { logger.error({ err: e }, '[CropCycle] create'); return sendError(res, e.message || 'Failed', 400); }
});

// Get cycle detail
router.get('/cycles/:cycleId', [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const c = await getCropCycleDetail(req.params.cycleId);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { logger.error({ err: e }, '[CropCycle] get'); return sendError(res, 'Failed', 500); }
});

// Update cycle
router.patch('/cycles/:cycleId', wl, [param('cycleId').isUUID()], validate, async (req, res) => {
  try { return sendSuccess(res, await updateCropCycle(req.params.cycleId, req.user.id, req.body)); }
  catch (e) { logger.error({ err: e }, '[CropCycle] update'); return sendError(res, 'Failed', 500); }
});

// Advance growth stage
router.post('/cycles/:cycleId/stage', wl, [param('cycleId').isUUID(), body('stage').notEmpty()], validate, async (req, res) => {
  try { return sendSuccess(res, await advanceGrowthStage(req.params.cycleId, req.user.id, req.body.stage)); }
  catch (e) { return sendError(res, 'Failed', 500); }
});

// Add fertilizer
router.post('/cycles/:cycleId/fertilizer', wl, [param('cycleId').isUUID(), body('productName').notEmpty().trim()], validate, async (req, res) => {
  try {
    const c = await addFertilizer(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add pesticide
router.post('/cycles/:cycleId/pesticide', wl, [param('cycleId').isUUID(), body('productName').notEmpty().trim()], validate, async (req, res) => {
  try {
    const c = await addPesticide(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Add irrigation log
router.post('/cycles/:cycleId/irrigation', wl, [param('cycleId').isUUID()], validate, async (req, res) => {
  try {
    const c = await addIrrigationLog(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Log event (pest/weather)
router.post('/cycles/:cycleId/event', wl, [param('cycleId').isUUID(), body('type').notEmpty()], validate, async (req, res) => {
  try {
    const c = await addObservedEvent(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Record harvest
router.post('/cycles/:cycleId/harvest', wl, [param('cycleId').isUUID(), body('yieldKg').notEmpty().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const c = await recordHarvest(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Record sale
router.post('/cycles/:cycleId/sale', wl, [param('cycleId').isUUID(), body('soldQuantityKg').notEmpty().isFloat({ min: 0 }), body('pricePerKgInr').notEmpty().isFloat({ min: 0 })], validate, async (req, res) => {
  try {
    const c = await recordSale(req.params.cycleId, req.user.id, req.body);
    return c ? sendSuccess(res, c) : sendNotFound(res, 'Crop cycle');
  } catch (e) { return sendError(res, 'Failed', 500); }
});

// Complete cycle (recompute financials)
router.post('/cycles/:cycleId/complete', wl, [param('cycleId').isUUID()], validate, async (req, res) => {
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
