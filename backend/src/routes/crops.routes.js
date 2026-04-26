/**
 * Crop Master Routes
 *
 * GET /api/v1/crops                    — list all crops (name + category)
 * GET /api/v1/crops/search?q=soy&lang=hi  — search by Hindi or English name
 * GET /api/v1/crops/:name              — full crop detail (fertilizer, irrigation, pests, diseases)
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── GET /api/v1/crops ─────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
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
router.get('/search', authenticate, async (req, res) => {
  const { q, lang = 'en' } = req.query;
  if (!q || q.trim().length < 2) return sendError(res, 'q (min 2 chars) is required', 400);

  const query = q.trim().toLowerCase();

  const crops = await prisma.cropMaster.findMany({
    where: {
      OR: [
        { name:   { contains: query, mode: 'insensitive' } },
        { nameHi: { contains: query, mode: 'insensitive' } },
        { nameMr: { contains: query, mode: 'insensitive' } },
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
