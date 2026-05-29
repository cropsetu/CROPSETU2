/**
 * Auth Routes
 * POST /api/v1/auth/send-otp     → request OTP
 * POST /api/v1/auth/verify-otp   → verify OTP, get tokens
 * POST /api/v1/auth/refresh       → rotate refresh token
 * POST /api/v1/auth/logout        → revoke refresh token
 * POST /api/v1/auth/logout-all    → revoke all devices
 */
import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';

import { validate }       from '../middleware/validate.js';
import { authenticate }   from '../middleware/auth.js';
import { sendOtp, verifyOtp } from '../services/otp.service.js';
import {
  signAccessToken,
  createRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
} from '../utils/jwt.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendUnauthorized } from '../utils/response.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

const router = Router();

// OTP send rate limit — disabled for now; re-enable before production.
const otpLimiter = (_req, _res, next) => next();

// ── POST /send-otp ─────────────────────────────────────────────────────────────
router.post(
  '/send-otp',
  otpLimiter,
  [
    body('phone')
      .trim()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Enter a valid 10-digit Indian mobile number'),
  ],
  validate,
  async (req, res) => {
    try {
      const { phone } = req.body;
      const result = await sendOtp(phone);
      return sendSuccess(res, result, 200);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }
);

// ── POST /verify-otp ───────────────────────────────────────────────────────────
router.post(
  '/verify-otp',
  [
    body('phone').trim().matches(/^[6-9]\d{9}$/).withMessage('Invalid phone'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('name').optional().trim().isLength({ min: 2, max: 80 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { phone, otp, name } = req.body;
      const result = await verifyOtp(phone, otp);

      if (!result.success) {
        return sendError(res, result.reason, 400);
      }

      let user;

      if (result.isNewUser) {
        // Register the new user — onboardingStep defaults to BASIC
        user = await prisma.user.create({
          data: { phone, name: name || null },
          select: { id: true, phone: true, name: true, role: true, language: true, onboardingStep: true, activeFarmId: true, totalFarms: true },
        });
      } else {
        user = await prisma.user.findUnique({
          where: { id: result.userId },
          select: { id: true, phone: true, name: true, role: true, language: true, onboardingStep: true, activeFarmId: true, totalFarms: true },
        });
      }

      const accessToken  = signAccessToken({ sub: user.id, role: user.role });
      const refreshToken = await createRefreshToken(user.id);

      return sendCreated(res, {
        accessToken,
        refreshToken,
        isNewUser: result.isNewUser,
        user,
      });
    } catch (err) {
      logger.error({ err }, '[Auth] verify-otp error');
      return sendError(res, 'Authentication failed', 500);
    }
  }
);

// ── POST /refresh ──────────────────────────────────────────────────────────────
router.post(
  '/refresh',
  [
    body('refreshToken').notEmpty().withMessage('refreshToken is required'),
    body('userId').notEmpty().withMessage('userId is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { userId, refreshToken: rawToken } = req.body;

      const record = await validateRefreshToken(userId, rawToken);
      if (!record) return sendUnauthorized(res, 'Invalid or expired refresh token');

      // Rotate: revoke old, issue new
      await revokeRefreshToken(record.id);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      });
      if (!user || !user.isActive) return sendUnauthorized(res, 'Account not found');

      const accessToken  = signAccessToken({ sub: user.id, role: user.role });
      const newRefreshToken = await createRefreshToken(user.id);

      return sendSuccess(res, { accessToken, refreshToken: newRefreshToken });
    } catch (err) {
      return sendError(res, 'Token refresh failed', 500);
    }
  }
);

// ── POST /logout ───────────────────────────────────────────────────────────────
router.post(
  '/logout',
  authenticate,
  [body('refreshToken').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { refreshToken: rawToken } = req.body;
      const record = await validateRefreshToken(req.user.id, rawToken);
      if (record) await revokeRefreshToken(record.id);
      return sendSuccess(res, { message: 'Logged out successfully' });
    } catch {
      return sendSuccess(res, { message: 'Logged out' });
    }
  }
);

// ── POST /logout-all ───────────────────────────────────────────────────────────
router.post('/logout-all', authenticate, async (req, res) => {
  await revokeAllRefreshTokens(req.user.id);
  return sendSuccess(res, { message: 'Logged out from all devices' });
});

export default router;
