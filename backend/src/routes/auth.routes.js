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

import { validate }       from '../middleware/validate.js';
import { authenticate }   from '../middleware/auth.js';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import {
  wantsCookieAuth,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  setCsrfCookie,
  clearCsrfCookie,
} from '../utils/cookies.js';
import { generateCsrfToken } from '../middleware/csrf.js';
import { auditAuthEvent, AUTH_ACTIONS, maskPhone } from '../services/audit.service.js';
import { assessLoginRisk, notifyRiskyLogin } from '../services/loginRisk.service.js';
import { normalizeIndianMobile, indianMobileBody } from '../utils/phone.js';
import { sendOtp, verifyOtp } from '../services/otp.service.js';
import { captureSignupConsent } from '../services/consent.service.js';
import { reportSecurityEvent } from '../services/incident.service.js';
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenByRaw,
  revokeAllRefreshTokens,
  bumpTokenVersion,
  enforceSessionLimit,
} from '../utils/jwt.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendUnauthorized, sendServerError } from '../utils/response.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

const router = Router();

// ── OTP send rate limits (sliding window, Redis-backed w/ in-memory fallback) ──
// Per-phone: caps SMS-bombing of one number. Per-IP: caps total SMS cost from a
// single network across many numbers. Both return 429 + Retry-After when hit.
const otpIpLimiter = rateLimiter({
  windowMs: ENV.OTP_RATE_LIMIT_WINDOW_MS,
  max:      ENV.OTP_IP_RATE_LIMIT_MAX,
  prefix:   'otp:ip',
  key:      clientIp,
  message:  'Too many OTP requests from this network. Please try again later.',
});

const otpPhoneLimiter = rateLimiter({
  windowMs: ENV.OTP_RATE_LIMIT_WINDOW_MS,
  max:      ENV.OTP_RATE_LIMIT_MAX,
  prefix:   'otp:phone',
  // Only key on a well-formed phone; malformed input falls through to the
  // validator below (422) instead of being rate-limited.
  // Normalize so the per-phone limit keys consistently regardless of how the
  // number was formatted (+91 / 0 / spaces); malformed input → null (not limited,
  // falls through to the validator's 400).
  key:      (req) => normalizeIndianMobile(req.body?.phone),
  message:  'Too many OTP requests for this number. Please try again later.',
});

// ── OTP verify rate limits ─────────────────────────────────────────────────────
// Cap the RATE of verification attempts in a short window to stop rapid code
// guessing. Complements the AUTH-4 lockout (which locks after repeated failures)
// and the per-session attempt cap. Both return 429 + Retry-After when exceeded.
const otpVerifyIpLimiter = rateLimiter({
  windowMs: ENV.OTP_VERIFY_RATE_LIMIT_WINDOW_MS,
  max:      ENV.OTP_VERIFY_IP_RATE_LIMIT_MAX,
  prefix:   'otp:verify:ip',
  key:      clientIp,
  message:  'Too many verification attempts from this network. Please try again later.',
});

const otpVerifyPhoneLimiter = rateLimiter({
  windowMs: ENV.OTP_VERIFY_RATE_LIMIT_WINDOW_MS,
  max:      ENV.OTP_VERIFY_RATE_LIMIT_MAX,
  prefix:   'otp:verify:phone',
  // Normalize so the per-phone limit keys consistently regardless of how the
  // number was formatted (+91 / 0 / spaces); malformed input → null (not limited,
  // falls through to the validator's 400).
  key:      (req) => normalizeIndianMobile(req.body?.phone),
  message:  'Too many verification attempts for this number. Please try again later.',
});

// ── POST /send-otp ─────────────────────────────────────────────────────────────
router.post(
  '/send-otp',
  otpIpLimiter,
  otpPhoneLimiter,
  [
    indianMobileBody('phone'),
  ],
  validate,
  async (req, res) => {
    try {
      const { phone } = req.body; // normalized to 10 digits by indianMobileBody
      const result = await sendOtp(phone);
      return sendSuccess(res, result, 200);
    } catch (err) {
      return sendServerError(res, err, 'Failed to send OTP. Please try again.');
    }
  }
);

// ── POST /verify-otp ───────────────────────────────────────────────────────────
router.post(
  '/verify-otp',
  otpVerifyIpLimiter,
  otpVerifyPhoneLimiter,
  [
    indianMobileBody('phone', 'Invalid phone'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('name').optional().trim().isLength({ min: 2, max: 80 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { phone, otp, name } = req.body;
      const result = await verifyOtp(phone, otp);

      if (!result.success) {
        // Account temporarily locked by brute-force protection → 423 Locked.
        if (result.locked) {
          await auditAuthEvent(null, AUTH_ACTIONS.OTP_LOCKOUT, req.ip, {
            phone: maskPhone(phone), outcome: 'locked',
          });
          res.setHeader('Retry-After', result.retryAfterSec);
          return sendError(res, result.reason, 423, { retryAfter: result.retryAfterSec });
        }
        await auditAuthEvent(null, AUTH_ACTIONS.OTP_FAILURE, req.ip, {
          phone: maskPhone(phone), outcome: 'failure', reason: result.reason,
        });
        return sendError(res, result.reason, 400);
      }

      let user;

      if (result.isNewUser) {
        // Register the new user — onboardingStep defaults to BASIC
        user = await prisma.user.create({
          data: { phone, name: name || null },
          select: { id: true, phone: true, name: true, role: true, language: true, onboardingStep: true, activeFarmId: true, totalFarms: true, tokenVersion: true },
        });
        // [DPDP §5] Capture proof of the required consents accepted on the
        // signup screen (Terms, Privacy, core data processing). Best-effort:
        // logged but never blocks registration.
        await captureSignupConsent({
          userId:    user.id,
          ip:        req.ip,
          userAgent: req.headers['user-agent'] || null,
        });
      } else {
        user = await prisma.user.findUnique({
          where: { id: result.userId },
          select: { id: true, phone: true, name: true, role: true, language: true, onboardingStep: true, activeFarmId: true, totalFarms: true, tokenVersion: true },
        });
      }

      const accessToken  = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });
      const refreshToken = await createRefreshToken(user.id);

      // Cap concurrent sessions — a new login evicts the oldest beyond the limit.
      await enforceSessionLimit(user.id);

      // ── Fraud / ATO risk signals ──────────────────────────────────────────
      // Brute-force is already blocked upstream (OTP lockout + rate limits). Here
      // we flag a *successful* login that looks risky vs the account's recent
      // history. Assess BEFORE recording this login so it compares against prior
      // events only. A brand-new account is the baseline — never risky.
      const userAgent = req.headers['user-agent'] || null;
      const risk = result.isNewUser
        ? { risky: false, signals: [], notify: false }
        : await assessLoginRisk({ userId: user.id, ip: req.ip, userAgent });

      await auditAuthEvent(user.id, AUTH_ACTIONS.LOGIN, req.ip, {
        outcome: 'success', isNewUser: result.isNewUser, userAgent,
      });

      if (risk.risky) {
        // Forensic flag for every risky login; user alert only on the strong
        // signal (new device) to avoid mobile/CGNAT IP-change noise.
        await auditAuthEvent(user.id, AUTH_ACTIONS.LOGIN_RISKY, req.ip, {
          signals: risk.signals, userAgent,
        });
        if (risk.notify) notifyRiskyLogin(user.id, risk.signals).catch(() => {});
      }

      // Don't leak the internal tokenVersion in the API response.
      const { tokenVersion: _tv, ...safeUser } = user;

      const body = { accessToken, isNewUser: result.isNewUser, user: safeUser };
      if (wantsCookieAuth(req)) {
        // Web: refresh token lives only in the httpOnly cookie, never in JS.
        setRefreshCookie(res, refreshToken);
        // Issue a CSRF token for the new cookie session.
        const csrf = generateCsrfToken();
        setCsrfCookie(res, csrf);
        body.csrfToken = csrf;
      } else {
        body.refreshToken = refreshToken; // mobile: body token → SecureStore
      }

      return sendCreated(res, body);
    } catch (err) {
      logger.error({ err }, '[Auth] verify-otp error');
      return sendError(res, 'Authentication failed', 500);
    }
  }
);

// ── POST /refresh ──────────────────────────────────────────────────────────────
// Mobile sends { userId, refreshToken } in the body. Web sends nothing — the
// refresh token rides in the httpOnly cookie and the new one is set back as a
// cookie (never exposed to JS). The token hash identifies the user either way.
router.post(
  '/refresh',
  [
    body('refreshToken').optional(),
    body('userId').optional(),
  ],
  validate,
  async (req, res) => {
    const cookieMode = wantsCookieAuth(req);
    try {
      const rawToken = req.body.refreshToken || readRefreshCookie(req);
      if (!rawToken) return sendUnauthorized(res, 'Refresh token required');

      // Rotate: spend the presented token, mint a successor, detect reuse.
      const result = await rotateRefreshToken(rawToken, req.body.userId || null);

      if (result.status === 'reuse') {
        // Replayed a spent token → the lineage was just burned. Force re-login.
        if (cookieMode) clearRefreshCookie(res);
        await auditAuthEvent(result.userId, AUTH_ACTIONS.TOKEN_REUSE, req.ip, {
          outcome: 'reuse_detected', familyId: result.familyId,
        });
        logger.warn(
          { userId: result.userId, familyId: result.familyId },
          '[Auth] Refresh token reuse detected — revoked token family'
        );
        // Auto-log a security incident: a replayed refresh token means the token
        // leaked and both the user and an attacker held it. Best-effort.
        reportSecurityEvent({
          title:           'Refresh token reuse detected',
          description:     'A spent refresh token was replayed; the token family was revoked. Possible token theft / account-takeover attempt.',
          category:        'ACCOUNT_TAKEOVER',
          severity:        'HIGH',
          affectedUserIds: result.userId ? [result.userId] : [],
          dataCategories:  ['session'],
          metadata:        { familyId: result.familyId, ip: req.ip },
        }).catch(() => {});
        return sendUnauthorized(res, 'Refresh token reuse detected. Please sign in again.');
      }
      if (result.status !== 'ok') {
        if (cookieMode) clearRefreshCookie(res);
        return sendUnauthorized(res, 'Invalid or expired refresh token');
      }

      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { id: true, role: true, isActive: true, tokenVersion: true },
      });
      if (!user || !user.isActive) {
        // Don't leave a freshly-minted token dangling for a disabled account.
        await revokeAllRefreshTokens(result.userId);
        if (cookieMode) clearRefreshCookie(res);
        return sendUnauthorized(res, 'Account not found');
      }

      const accessToken = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });

      await auditAuthEvent(user.id, AUTH_ACTIONS.TOKEN_REFRESH, req.ip, { outcome: 'success' });

      if (cookieMode) {
        setRefreshCookie(res, result.refreshToken);
        const csrf = generateCsrfToken();
        setCsrfCookie(res, csrf); // rotate the CSRF token alongside the refresh token
        return sendSuccess(res, { accessToken, csrfToken: csrf });
      }
      return sendSuccess(res, { accessToken, refreshToken: result.refreshToken });
    } catch (err) {
      logger.error({ err }, '[Auth] refresh error');
      return sendError(res, 'Token refresh failed', 500);
    }
  }
);

// ── POST /change-phone ───────────────────────────────────────────────────────
// Change the account's login phone number. Requires an OTP proving control of
// the NEW number (client must call /send-otp for it first). On success the
// number is swapped, the token version is bumped (invalidating every token
// issued under the old number), all refresh tokens are revoked, and a fresh
// token pair is returned so the current device stays signed in.
router.post(
  '/change-phone',
  authenticate,
  [
    indianMobileBody('newPhone'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  async (req, res) => {
    try {
      const { newPhone, otp } = req.body;

      const me = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, phone: true, role: true },
      });
      if (!me) return sendUnauthorized(res, 'Account not found');
      if (me.phone === newPhone) {
        return sendError(res, 'New number must be different from your current number', 400);
      }

      // Reject if the number already belongs to someone else (phone is unique).
      const taken = await prisma.user.findUnique({ where: { phone: newPhone }, select: { id: true } });
      if (taken) return sendError(res, 'This number is already linked to another account', 409);

      // Prove ownership of the new number.
      const result = await verifyOtp(newPhone, otp);
      if (!result.success) {
        if (result.locked) {
          res.setHeader('Retry-After', result.retryAfterSec);
          return sendError(res, result.reason, 423, { retryAfter: result.retryAfterSec });
        }
        return sendError(res, result.reason, 400);
      }

      // Swap the number and bump the token version atomically.
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id: me.id },
          data:  { phone: newPhone },
          select: { id: true, role: true },
        });
        const tokenVersion = await bumpTokenVersion(u.id, tx);
        return { ...u, tokenVersion };
      });

      // Kill every existing session, then hand the caller a fresh pair.
      await revokeAllRefreshTokens(updated.id);
      const accessToken  = signAccessToken({ sub: updated.id, role: updated.role, tokenVersion: updated.tokenVersion });
      const refreshToken = await createRefreshToken(updated.id);

      const body = { accessToken, phone: newPhone };
      if (wantsCookieAuth(req)) {
        setRefreshCookie(res, refreshToken); // rotate the cookie too
        const csrf = generateCsrfToken();
        setCsrfCookie(res, csrf);
        body.csrfToken = csrf;
      } else {
        body.refreshToken = refreshToken;
      }
      return sendSuccess(res, body);
    } catch (err) {
      // Unique-violation race between the check and the update.
      if (err?.code === 'P2002') {
        return sendError(res, 'This number is already linked to another account', 409);
      }
      logger.error({ err }, '[Auth] change-phone error');
      return sendError(res, 'Phone change failed', 500);
    }
  }
);

// ── POST /logout ───────────────────────────────────────────────────────────────
// refreshToken comes from the body (mobile) or the cookie (web). Either way we
// revoke the whole lineage and clear the cookie.
router.post(
  '/logout',
  authenticate,
  [body('refreshToken').optional()],
  validate,
  async (req, res) => {
    try {
      const rawToken = req.body.refreshToken || readRefreshCookie(req);
      if (rawToken) await revokeRefreshTokenByRaw(req.user.id, rawToken);
      clearRefreshCookie(res);
      clearCsrfCookie(res);
      await auditAuthEvent(req.user.id, AUTH_ACTIONS.LOGOUT, req.ip, { outcome: 'success' });
      return sendSuccess(res, { message: 'Logged out successfully' });
    } catch {
      clearRefreshCookie(res);
      clearCsrfCookie(res);
      return sendSuccess(res, { message: 'Logged out' });
    }
  }
);

// ── POST /logout-all ───────────────────────────────────────────────────────────
router.post('/logout-all', authenticate, async (req, res) => {
  await revokeAllRefreshTokens(req.user.id);
  clearRefreshCookie(res);
  clearCsrfCookie(res);
  return sendSuccess(res, { message: 'Logged out from all devices' });
});

export default router;
