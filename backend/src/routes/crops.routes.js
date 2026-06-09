/**
 * Crop Master Routes
 *
 * GET /api/v1/crops                    — list all crops (name + category)
 * GET /api/v1/crops/search?q=soy&lang=hi  — search by Hindi or English name
 * GET /api/v1/crops/:name              — full crop detail (fertilizer, irrigation, pests, diseases)
 */
import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';
import { isEnabled } from '../services/featureFlag.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── Validation rules ──────────────────────────────────────────────────────────
export const listCropsRules = [
  query('category').optional({ checkFalsy: true }).isString().trim().isLength({ max: 50 }),
  query('season').optional({ checkFalsy: true }).isString().trim().isLength({ max: 50 }),
];
export const searchCropsRules = [
  query('q').trim().isLength({ min: 2, max: 100 }).withMessage('q (min 2 chars) is required'),
  query('lang').optional({ checkFalsy: true }).isIn(['en', 'hi', 'mr']),
];

// ── GET /api/v1/crops ─────────────────────────────────────────────────────────
router.get('/', authenticate, listCropsRules, validate, async (req, res) => {
  if (!await isEnabled('crop_master')) {
    return sendError(res, 'फसल डेटाबेस अभी उपलब्ध नहीं है।', 503);
  }

  const { category, season } = req.query;
  const where = {};
  if (category) where.category = category;
  if (season)   where.seasons  = { has: season };

  const crops = await prisma.cropMaster.findMany({
    where,
    orderBy: { nameHi: 'asc' },
    select: { id: true, name: true, nameHi: true, nameMr: true, category: true, seasons: true, maturityDays: true },
  });

  return sendSuccess(res, crops, 200, {
    total:  crops.length,
    source: 'ICAR Package of Practices / MPKV Rahuri',
    updatedAt: '2025-04',
  });
});

// ── GET /api/v1/crops/search ──────────────────────────────────────────────────
router.get('/search', authenticate, searchCropsRules, validate, async (req, res) => {
  const { q, lang = 'en' } = req.query;

  // Strip LIKE wildcards so a crafted q can't become a pathological ILIKE scan.
  const searchTerm = sanitizeSearch(q)?.toLowerCase();
  if (!searchTerm) return sendSuccess(res, []); // q was only wildcards/whitespace

  const crops = await prisma.cropMaster.findMany({
    where: {
      OR: [
        { name:   { contains: searchTerm, mode: 'insensitive' } },
        { nameHi: { contains: searchTerm, mode: 'insensitive' } },
        { nameMr: { contains: searchTerm, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, nameHi: true, nameMr: true, category: true, seasons: true, maturityDays: true },
    take: 20,
  });

  return sendSuccess(res, crops);
});

// ── GET /api/v1/crops/:name ───────────────────────────────────────────────────
router.get('/:name', authenticate, async (req, res) => {
  if (!await isEnabled('crop_master')) {
    return sendError(res, 'फसल डेटाबेस अभी उपलब्ध नहीं है।', 503);
  }

  const crop = await prisma.cropMaster.findFirst({
    where: {
      OR: [
        { name:   { equals: req.params.name, mode: 'insensitive' } },
        { nameHi: { equals: req.params.name, mode: 'insensitive' } },
      ],
    },
  });

  if (!crop) return sendError(res, 'Crop not found', 404);

  return sendSuccess(res, {
    ...crop,
    meta: { source: 'ICAR Package of Practices + MPKV Rahuri', updatedAt: '2025-04' },
  });
});

export default router;
