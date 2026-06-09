/**
 * Telemetry Routes — client-side error/crash ingest.
 *
 * POST /api/v1/telemetry/client-error
 *   The mobile/web app's crash reporter forwards unhandled errors (render-tree
 *   crashes from the error boundary, global JS errors, unhandled rejections)
 *   here so production crashes are visible in the server logs instead of dying
 *   silently on the device. Complements OPS-9 frontend logging.
 *
 * Public (errors can happen pre-login): optionalAuth attaches userId when a token
 * is present. Tightly rate-limited per IP so a crash-looping or malicious client
 * can't flood the logs.
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import logger from '../utils/logger.js';

const router = Router();

const errorIngestLimiter = rateLimiter({
  windowMs: 60_000,
  max:      30,            // 30 reports / IP / minute — generous for a crash burst, bounded
  prefix:   'telemetry:client-error',
  key:      clientIp,
  message:  'Too many error reports. Please slow down.',
});

router.post(
  '/client-error',
  errorIngestLimiter,
  optionalAuth,
  [
    body('message').isString().trim().isLength({ min: 1, max: 1000 }),
    body('name').optional().isString().trim().isLength({ max: 200 }),
    body('stack').optional().isString().isLength({ max: 10000 }),
    body('componentStack').optional().isString().isLength({ max: 10000 }),
    body('fatal').optional().isBoolean(),
    body('platform').optional().isString().trim().isLength({ max: 60 }),
    body('appVersion').optional().isString().trim().isLength({ max: 40 }),
    body('context').optional().isObject(),
  ],
  validate,
  (req, res) => {
    const { message, name, stack, componentStack, fatal, platform, appVersion, context } = req.body;

    // Log at error level with structured fields so OPS log aggregation/alerting
    // can pick up client crashes the same way it does server errors.
    logger.error(
      {
        clientError: {
          name:           name || 'Error',
          message,
          stack,
          componentStack,
          fatal:          !!fatal,
          platform,
          appVersion,
          context,
          userId:         req.user?.id || null,
          requestId:      req.id,
        },
      },
      '[ClientError] Unhandled frontend error',
    );

    // Fire-and-forget from the client's perspective — nothing to return.
    return res.status(204).end();
  },
);

export default router;
