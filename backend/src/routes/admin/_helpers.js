/**
 * Shared helpers for the admin router — audit wrapper, common validators, and
 * list-query parsing. Keeps every admin route file thin and consistent.
 */
import { query } from 'express-validator';
import { auditAction } from '../../services/audit.service.js';
import { boundedLimit } from '../../utils/adminList.js';

/**
 * Write an AuditLog row for an admin mutation. Best-effort — auditing must never
 * break the operation it records — but routes should `await` it so the row is
 * persisted before the response is sent.
 */
export async function adminAudit(req, action, entity, entityId, { before = null, after = null, metadata = null } = {}) {
  await auditAction(req, { action, entity, entityId, before, after, metadata }).catch(() => {});
}

/** Standard cursor + limit parsing for list endpoints. */
export function listParams(req, { def = 25, max = 100 } = {}) {
  return { cursor: req.query.cursor, limit: boundedLimit(req.query.limit, def, max) };
}

/**
 * Validators for the audited-reveal contract: `?reveal=true` REQUIRES a non-empty
 * `reason` (≤ 500 chars). Reveal without a reason is a 400 — never a silent
 * unmasked response.
 */
export function revealValidators() {
  return [
    query('reveal').optional().isBoolean().withMessage('reveal must be a boolean'),
    query('reason').optional().isString().trim().isLength({ max: 500 }),
    query('reason').custom((value, { req }) => {
      if (String(req.query.reveal) === 'true' && (!value || !String(value).trim())) {
        throw new Error('a reason is required to reveal PII');
      }
      return true;
    }),
  ];
}

/** Parse optional from/to ISO date filters into a Prisma range object (or null). */
export function dateRange(from, to) {
  const range = {};
  if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) range.gte = d; }
  if (to)   { const d = new Date(to);   if (!Number.isNaN(d.getTime())) range.lte = d; }
  return Object.keys(range).length ? range : null;
}

/** Send a keyset list result with the cursor in `meta`. */
export function sendList(res, sendSuccess, { items, hasMore, nextCursor }) {
  return sendSuccess(res, { items }, 200, { hasMore, nextCursor, count: items.length });
}
