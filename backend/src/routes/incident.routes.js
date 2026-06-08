/**
 * Security Incident Routes (Admin) — incident log + breach-notification ops.
 *
 * GET   /api/v1/admin/incidents          — list incidents (filterable)
 * GET   /api/v1/admin/incidents/:id      — incident detail + timeline
 * POST  /api/v1/admin/incidents          — log a new incident
 * POST  /api/v1/admin/incidents/:id/updates — add a timeline note / status change
 * POST  /api/v1/admin/incidents/:id/notify  — record Board/users notification
 *
 * See docs/SECURITY_INCIDENT_RESPONSE.md for the response runbook.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendSuccess, sendCreated, sendError, sendNotFound } from '../utils/response.js';
import logger from '../utils/logger.js';
import {
  recordIncident, addIncidentUpdate, markNotified,
  listIncidents, getIncident,
} from '../services/incident.service.js';

const router = Router();

const CATEGORIES = ['DATA_BREACH', 'UNAUTHORIZED_ACCESS', 'ACCOUNT_TAKEOVER', 'TOKEN_COMPROMISE', 'OTP_ABUSE', 'PII_EXPOSURE', 'VULNERABILITY', 'PHISHING', 'SYSTEM_COMPROMISE', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'];

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return sendError(res, 'Admin access required', 403);
  next();
}

router.use(authenticate, requireAdmin);

// ── GET / ──────────────────────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(STATUSES),
    query('severity').optional().isIn(SEVERITIES),
    query('category').optional().isIn(CATEGORIES),
  ],
  validate,
  async (req, res) => {
    try {
      const incidents = await listIncidents({
        status: req.query.status, severity: req.query.severity, category: req.query.category,
      });
      return sendSuccess(res, { incidents });
    } catch (err) {
      logger.error({ err }, '[Incident] GET / error');
      return sendError(res, 'Failed to load incidents', 500);
    }
  }
);

// ── GET /:id ────────────────────────────────────────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const incident = await getIncident(req.params.id);
    if (!incident) return sendNotFound(res, 'Incident');
    return sendSuccess(res, incident);
  } catch (err) {
    logger.error({ err }, '[Incident] GET /:id error');
    return sendError(res, 'Failed to load incident', 500);
  }
});

// ── POST / — log a new incident ──────────────────────────────────────────────────
router.post(
  '/',
  [
    body('title').trim().isLength({ min: 3, max: 200 }),
    body('category').isIn(CATEGORIES),
    body('severity').isIn(SEVERITIES),
    body('description').optional().trim().isLength({ max: 5000 }),
    body('affectedUserIds').optional().isArray(),
    body('affectedUserCount').optional().isInt({ min: 0 }),
    body('dataCategories').optional().isArray(),
  ],
  validate,
  async (req, res) => {
    try {
      const incident = await recordIncident({
        title:             req.body.title,
        description:       req.body.description ?? null,
        category:          req.body.category,
        severity:          req.body.severity,
        source:            'manual',
        reportedById:      req.user.id,
        affectedUserIds:   req.body.affectedUserIds ?? [],
        affectedUserCount: req.body.affectedUserCount ?? null,
        dataCategories:    req.body.dataCategories ?? [],
      });
      return sendCreated(res, incident);
    } catch (err) {
      logger.error({ err }, '[Incident] POST / error');
      return sendError(res, 'Failed to log incident', 500);
    }
  }
);

// ── POST /:id/updates — timeline note / status change ────────────────────────────
router.post(
  '/:id/updates',
  [
    param('id').isUUID(),
    body('note').trim().isLength({ min: 1, max: 5000 }),
    body('statusTo').optional().isIn(STATUSES),
  ],
  validate,
  async (req, res) => {
    try {
      const update = await addIncidentUpdate({
        incidentId: req.params.id,
        authorId:   req.user.id,
        note:       req.body.note,
        statusTo:   req.body.statusTo ?? null,
      });
      if (!update) return sendNotFound(res, 'Incident');
      return sendCreated(res, update);
    } catch (err) {
      logger.error({ err }, '[Incident] POST /:id/updates error');
      return sendError(res, 'Failed to add incident update', 500);
    }
  }
);

// ── POST /:id/notify — record Board/users notification ───────────────────────────
router.post(
  '/:id/notify',
  [
    param('id').isUUID(),
    body('target').isIn(['board', 'users']),
  ],
  validate,
  async (req, res) => {
    try {
      const incident = await getIncident(req.params.id);
      if (!incident) return sendNotFound(res, 'Incident');
      await markNotified({ incidentId: req.params.id, target: req.body.target, authorId: req.user.id });
      return sendSuccess(res, await getIncident(req.params.id));
    } catch (err) {
      logger.error({ err }, '[Incident] POST /:id/notify error');
      return sendError(res, 'Failed to record notification', 500);
    }
  }
);

export default router;
