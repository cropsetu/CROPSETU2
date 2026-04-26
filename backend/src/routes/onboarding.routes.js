/**
 * Onboarding Routes — First-time farmer profile setup.
 * POST /api/v1/onboarding/complete — Single-transaction save of name + location + first farm
 * POST /api/v1/onboarding/skip     — Skip onboarding (fill in later)
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendError } from '../utils/response.js';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

const router = Router();
router.use(authenticate);

// ── POST /onboarding/complete ────────────────────────────────────────────────
router.post(
  '/complete',
  [
    body('firstName').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
    body('lastName').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
    body('district').optional({ values: 'falsy' }).trim(),
    body('taluka').optional({ values: 'falsy' }).trim(),
    body('village').optional({ values: 'falsy' }).trim(),
    body('state').optional({ values: 'falsy' }).trim(),
    body('pincode').optional({ values: 'falsy' }).matches(/^\d{6}$/),
    body('latitude').optional({ values: 'falsy' }).isFloat({ min: 6, max: 38 }),
    body('longitude').optional({ values: 'falsy' }).isFloat({ min: 68, max: 98 }),
    body('landSizeAcres').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 10000 }),
    body('soilType').optional({ values: 'falsy' }).isIn(['BLACK_COTTON', 'RED', 'ALLUVIAL', 'SANDY', 'LATERITE', 'CLAY_LOAM', 'SANDY_LOAM', 'UNKNOWN']),
    body('irrigationType').optional({ values: 'falsy' }).isIn(['DRIP', 'SPRINKLER', 'FLOOD', 'FURROW', 'RAINFED', 'MIXED']),
    body('farmName').optional({ values: 'falsy' }).trim().isLength({ max: 60 }),
    body('cropTypes').optional({ values: 'falsy' }).isArray({ max: 10 }),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        firstName, lastName, farmName, state, district, taluka, village, pincode,
        latitude, longitude, landSizeAcres, soilType, irrigationType, cropTypes,
      } = req.body;

      const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

      const result = await prisma.$transaction(async (tx) => {
        // 1. Update user profile
        const updateData = { onboardingStep: 'COMPLETE' };
        if (fullName) updateData.name = fullName;
        if (state) updateData.state = state;
        if (district) updateData.district = district;
        if (taluka) updateData.taluka = taluka;
        if (village) updateData.village = village;
        if (pincode) updateData.pincode = pincode;

        const user = await tx.user.update({
          where: { id: req.user.id },
          data: updateData,
        });

        // 2. Create or update first farm (if land size provided)
        let farm = null;
        if (landSizeAcres && parseFloat(landSizeAcres) > 0) {
          const acres = parseFloat(landSizeAcres);
          const farmData = {
            farmName: farmName || `${firstName || 'My'}'s Farm`,
            village: village || null,
            taluka: taluka || null,
            district,
            state: state || 'Maharashtra',
            pincode: pincode || null,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            landSizeAcres: acres,
            landSizeHectares: Math.round(acres * 0.4047 * 1000) / 1000,
            landSizeGunta: Math.round(acres * 40 * 100) / 100,
            soilType: soilType || 'UNKNOWN',
            irrigationSystem: irrigationType || 'RAINFED',
          };

          // Check if user already has a farm (from a previous partial onboarding)
          const existingFarm = await tx.farm.findFirst({
            where: { farmerId: req.user.id },
            orderBy: { farmNumber: 'asc' },
          });

          if (existingFarm) {
            farm = await tx.farm.update({
              where: { id: existingFarm.id },
              data: farmData,
            });
          } else {
            farm = await tx.farm.create({
              data: { farmerId: req.user.id, farmNumber: 1, farmAlias: 'Farm 1', ...farmData },
            });
          }

          // 3. Set as active farm + update counts
          const farmAgg = await tx.farm.aggregate({
            where: { farmerId: req.user.id, isActive: true },
            _count: true,
            _sum: { landSizeAcres: true },
          });
          await tx.user.update({
            where: { id: req.user.id },
            data: {
              activeFarmId: farm.id,
              totalFarms: farmAgg._count,
              totalLandAcres: farmAgg._sum.landSizeAcres || acres,
            },
          });
        }

        // 4. Also update legacy FarmDetail for backward compat
        await tx.farmDetail.upsert({
          where: { userId: req.user.id },
          create: {
            userId: req.user.id,
            village, district, pincode,
            landAcres: landSizeAcres ? parseFloat(landSizeAcres) : null,
            cropTypes: cropTypes || [],
            soilType: soilType?.toLowerCase() || null,
            irrigationType: irrigationType?.toLowerCase() || null,
          },
          update: {
            village, district, pincode,
            landAcres: landSizeAcres ? parseFloat(landSizeAcres) : undefined,
            cropTypes: cropTypes || undefined,
            soilType: soilType?.toLowerCase() || undefined,
            irrigationType: irrigationType?.toLowerCase() || undefined,
          },
        });

        return { user, farm };
      });

      return sendSuccess(res, {
        user: {
          id: result.user.id,
          name: result.user.name,
          onboardingStep: 'COMPLETE',
          state: result.user.state,
          district: result.user.district,
          taluka: result.user.taluka,
          village: result.user.village,
          pincode: result.user.pincode,
        },
        farm: result.farm,
      });
    } catch (err) {
      logger.error({ err }, '[Onboarding] complete error');
      return sendError(res, err.message || 'Onboarding failed', 500);
    }
  }
);

// ── POST /onboarding/skip ────────────────────────────────────────────────────
router.post('/skip', async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { onboardingStep: 'COMPLETE' },
    });
    return sendSuccess(res, { onboardingStep: 'COMPLETE' });
  } catch (err) {
    logger.error({ err }, '[Onboarding] skip error');
    return sendError(res, 'Failed to skip onboarding', 500);
  }
});

export default router;
