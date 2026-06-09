/**
 * Standard response helpers — unify the JSON envelope across all routes.
 *
 * Success: { success: true, data, meta? }
 * Error:   { success: false, error: { message, details? } }
 */
import logger from './logger.js';

export function sendSuccess(res, data, statusCode = 200, meta) {
  const payload = { success: true, data };
  if (meta !== undefined) payload.meta = meta;
  return res.status(statusCode).json(payload);
}

export function sendCreated(res, data) {
  return sendSuccess(res, data, 201);
}

export function sendError(res, message, statusCode = 500, details, extra) {
  const error = { message: String(message || 'Something went wrong') };
  if (details !== undefined) error.details = details;
  // Attach request_id from the response object (set by the request-id
  // middleware) so the client can quote it in support tickets and we can
  // correlate to logs.
  const reqId = extra?.requestId ?? res.req?.id;
  if (reqId) error.requestId = reqId;
  return res.status(statusCode).json({ success: false, error });
}

/**
 * Catch-block helper: log the real error server-side, return a SAFE message.
 *
 * Use this in route `catch` blocks instead of `sendError(res, err.message, …)`,
 * which leaks internal details (Prisma/SQL text, stack traces, upstream payloads)
 * to the client — an information-disclosure bug.
 *
 * The full error (with request_id + path for correlation) always goes to the
 * logs. The client only sees the error's own message when it was DELIBERATELY
 * marked client-safe via `err.expose === true` (same convention the global error
 * handler in app.js uses); otherwise it gets the generic `fallback`.
 *
 * @param {object} res
 * @param {Error}  err        the caught error (logged in full)
 * @param {string} fallback   generic, user-facing message for non-exposed errors
 * @param {number} [statusCode] overrides err.statusCode / err.status (default 500)
 */
export function sendServerError(res, err, fallback = 'Something went wrong. Please try again.', statusCode) {
  const status = statusCode ?? err?.statusCode ?? err?.status ?? 500;
  logger.error({ err, requestId: res.req?.id, path: res.req?.path }, '[Route Error]');
  const message = err?.expose === true && err?.message ? err.message : fallback;
  return sendError(res, message, status);
}

export function sendNotFound(res, resource = 'Resource') {
  return sendError(res, `${resource} not found`, 404);
}

export function sendUnauthorized(res, message = 'Unauthorized') {
  return sendError(res, message, 401);
}

export function sendForbidden(res, message = 'Forbidden') {
  return sendError(res, message, 403);
}

/**
 * Build pagination meta. Signature matches existing call sites: (total, page, limit).
 * Returns { page, limit, total, totalPages } — totalPages is ceil(total / limit),
 * minimum 1 so clients can always render "page X of Y".
 */
export function paginationMeta(total = 0, page = 1, limit = 20) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safePage  = Math.max(1, Number(page)  || 1);
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  return { page: safePage, limit: safeLimit, total: safeTotal, totalPages };
}
