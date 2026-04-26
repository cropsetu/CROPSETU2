/**
 * Saved Addresses Routes
 * GET    /api/v1/addresses              — list user's saved addresses
 * POST   /api/v1/addresses              — save a new address
 * PUT    /api/v1/addresses/:id          — update an address
 * DELETE /api/v1/addresses/:id          — delete an address
 * PATCH  /api/v1/addresses/:id/default  — set as default address
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendNotFound } from '../utils/response.js';

const router = Router();

function normalisePhone(raw) {
  return raw.replace(/\D/g, '').replace(/^(91|0)/, '');
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const addresses = await prisma.savedAddress.findMany({
    where:   { userId: req.user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return sendSuccess(res, addresses);
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  [
    body('type').optional().isIn(['HOME', 'OFFICE', 'OTHER']),
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('phone').notEmpty(),
    body('flat').trim().notEmpty().isLength({ max: 100 }),
    body('street').trim().notEmpty().isLength({ max: 200 }),
    body('city').trim().notEmpty().isLength({ max: 100 }),
    body('state').trim().notEmpty().isLength({ max: 100 }),
    body('pincode').matches(/^\d{6}$/),
    body('landmark').optional().trim().isLength({ max: 200 }),
    body('isDefault').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    const { type = 'HOME', name, phone, flat, street, city, state, pincode, landmark, isDefault } = req.body;

    const normPhone = normalisePhone(phone);
    if (!/^[6-9]\d{9}$/.test(normPhone)) {
      return sendError(res, 'Invalid phone number', 400);
    }

    // If marking as default, unset all existing defaults first
    if (isDefault) {
      await prisma.savedAddress.updateMany({
        where: { userId: req.user.id },
        data:  { isDefault: false },
      });
    }

    const address = await prisma.savedAddress.create({
      data: {
        userId:   req.user.id,
        type,
        name:     name.trim().slice(0, 100),
        phone:    normPhone,
        flat:     flat.trim().slice(0, 100),
        street:   street.trim().slice(0, 200),
        city:     city.trim().slice(0, 100),
        state:    state.trim().slice(0, 100),
        pincode:  pincode.trim(),
        landmark: landmark?.trim().slice(0, 200) || null,
        isDefault: Boolean(isDefault),
      },
    });
    return sendCreated(res, address);
  }
);

// ── Update ────────────────────────────────────────────────────────────────────
router.put(
  '/:id',
  authenticate,
  [
    body('type').optional().isIn(['HOME', 'OFFICE', 'OTHER']),
    body('name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('phone').optional().notEmpty(),
    body('flat').optional().trim().notEmpty().isLength({ max: 100 }),
    body('street').optional().trim().notEmpty().isLength({ max: 200 }),
    body('city').optional().trim().notEmpty().isLength({ max: 100 }),
    body('state').optional().trim().notEmpty().isLength({ max: 100 }),
    body('pincode').optional().matches(/^\d{6}$/),
    body('landmark').optional().trim(),
  ],
  validate,
  async (req, res) => {
    const addr = await prisma.savedAddress.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!addr) return sendNotFound(res, 'Address');

    const data = {};
    const { type, name, phone, flat, street, city, state, pincode, landmark } = req.body;
    if (type     !== undefined) data.type     = type;
    if (name     !== undefined) data.name     = name.trim().slice(0, 100);
    if (flat     !== undefined) data.flat     = flat.trim().slice(0, 100);
    if (street   !== undefined) data.street   = street.trim().slice(0, 200);
    if (city     !== undefined) data.city     = city.trim().slice(0, 100);
    if (state    !== undefined) data.state    = state.trim().slice(0, 100);
    if (pincode  !== undefined) data.pincode  = pincode.trim();
    if (landmark !== undefined) data.landmark = landmark?.trim().slice(0, 200) || null;
    if (phone    !== undefined) {
      const norm = normalisePhone(phone);
      if (!/^[6-9]\d{9}$/.test(norm)) return sendError(res, 'Invalid phone number', 400);
      data.phone = norm;
    }

    const updated = await prisma.savedAddress.update({ where: { id: req.params.id }, data });
    return sendSuccess(res, updated);
  }
);

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const addr = await prisma.savedAddress.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!addr) return sendNotFound(res, 'Address');
  await prisma.savedAddress.delete({ where: { id: req.params.id } });
  return sendSuccess(res, { deleted: true });
});

// ── Set default ───────────────────────────────────────────────────────────────
router.patch('/:id/default', authenticate, async (req, res) => {
  const addr = await prisma.savedAddress.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!addr) return sendNotFound(res, 'Address');

  await prisma.$transaction([
    prisma.savedAddress.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } }),
    prisma.savedAddress.update({ where: { id: req.params.id }, data: { isDefault: true } }),
  ]);
  return sendSuccess(res, { updated: true });
});

export default router;
