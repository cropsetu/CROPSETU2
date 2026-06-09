/**
 * Consent Routes — DPDP Act §5 consent capture & proof.
 *
 * GET  /api/v1/consent          — purposes catalogue + this user's effective consent
 * POST /api/v1/consent          — grant/withdraw consent for a purpose (captures proof)
 * GET  /api/v1/consent/history  — full append-only proof trail for this user
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { clientIp } from '../middleware/rateLimit.js';
import { sendSuccess, sendError } from '../utils/response.js';
import logger from '../utils/logger.js';
import prisma from '../config/db.js';
import {
  CONSENT_POLICY_VERSION,
  CONSENT_PURPOSE_VALUES,
  CONSENT_PURPOSE_INFO,
  MINOR_PROHIBITED_PURPOSES,
} from '../constants/consent.js';
import {
  recordConsent,
  getEffectiveConsents,
  getConsentHistory,
} from '../services/consent.service.js';
import { auditAction, AUDIT_ACTIONS } from '../services/audit.service.js';

const router = Router();
router.use(authenticate);

// ── GET /consent ──────────────────────────────────────────────────────────────
// Returns the purpose catalogue (informed consent) + the user's current state.
router.get('/', async (req, res) => {
  try {
    const effective = await getEffectiveConsents(req.user.id);
    const purposes = CONSENT_PURPOSE_VALUES.map((purpose) => {
      const rec = effective[purpose];
      return {
        purpose,
        ...CONSENT_PURPOSE_INFO[purpose],
        granted:        rec ? rec.granted : false,
        policyVersion:  rec ? rec.policyVersion : null,
        consentedAt:    rec ? rec.createdAt : null,
        // Flag stale consent so the client can re-prompt after a policy change.
        outdated:       rec ? rec.policyVersion !== CONSENT_POLICY_VERSION : false,
      };
    });
    return sendSuccess(res, { policyVersion: CONSENT_POLICY_VERSION, purposes });
  } catch (err) {
    logger.error({ err }, '[Consent] GET / error');
    return sendError(res, 'Failed to load consent settings', 500);
  }
});

// ── POST /consent ─────────────────────────────────────────────────────────────
// Grant or withdraw consent for a single purpose. Each call is an immutable,
// timestamped record with the request IP + user-agent stored as proof.
router.post(
  '/',
  [
    body('purpose').isIn(CONSENT_PURPOSE_VALUES).withMessage('Invalid consent purpose'),
    body('granted').isBoolean().withMessage('granted must be a boolean'),
  ],
  validate,
  async (req, res) => {
    try {
      const purpose = req.body.purpose;
      const granted = req.body.granted === true || req.body.granted === 'true';

      // [DPDP §9] Block targeted-advertising / behavioural purposes for minors,
      // regardless of guardian consent.
      const me = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { isMinor: true },
      });
      if (me?.isMinor && granted && MINOR_PROHIBITED_PURPOSES.includes(purpose)) {
        return sendError(res, 'This consent cannot be granted for users under 18 (DPDP Act §9).', 403);
      }

      const record = await recordConsent({
        userId:        req.user.id,
        purpose,
        granted,
        policyVersion: CONSENT_POLICY_VERSION,
        method:        'settings_toggle',
        ip:            clientIp(req),
        userAgent:     req.headers['user-agent'] || null,
      });

      // [DPDP §9] Recording verifiable guardian consent stamps the user so
      // guardian-gated processing can proceed; withdrawing it clears the stamp.
      if (purpose === 'GUARDIAN_CONSENT') {
        await prisma.user.update({
          where: { id: req.user.id },
          data:  { guardianConsentAt: granted ? new Date() : null },
        });
      }

      // The ConsentRecord above is the authoritative DPDP proof trail; also emit
      // a unified audit event so consent changes appear in the cross-cut log
      // alongside other sensitive operations (coordinated taxonomy).
      auditAction(req, {
        action:   AUDIT_ACTIONS.CONSENT_CHANGE,
        entity:   'ConsentRecord',
        entityId: record.id,
        after:    { purpose: record.purpose, granted: record.granted, policyVersion: record.policyVersion },
      }).catch(() => {});

      return sendSuccess(res, {
        purpose:       record.purpose,
        granted:       record.granted,
        policyVersion: record.policyVersion,
        consentedAt:   record.createdAt,
      });
    } catch (err) {
      logger.error({ err }, '[Consent] POST / error');
      return sendError(res, 'Failed to record consent', 500);
    }
  }
);

// ── GET /consent/history ──────────────────────────────────────────────────────
// The full proof trail (every grant/withdrawal), newest first.
router.get('/history', async (req, res) => {
  try {
    const history = await getConsentHistory(req.user.id);
    return sendSuccess(res, { history });
  } catch (err) {
    logger.error({ err }, '[Consent] GET /history error');
    return sendError(res, 'Failed to load consent history', 500);
  }
});

export default router;
