/**
 * Standard response helpers — unify the JSON envelope across all routes.
 *
 * Success: { success: true, data, meta? }
 * Error:   { success: false, error: { message, details? } }
 */

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
