/**
 * Standardised API response helpers.
 * All responses follow:  { success, data?, error?, meta? }
 */

export function sendSuccess(res, data = null, status = 200, meta = null) {
  const body = { success: true };
  if (data !== null) body.data = data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function sendCreated(res, data) {
  return sendSuccess(res, data, 201);
}

export function sendError(res, message, status = 400, details = null) {
  const body = { success: false, error: { message } };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

export function sendNotFound(res, entity = 'Resource') {
  return sendError(res, `${entity} not found`, 404);
}

export function sendUnauthorized(res, message = 'Unauthorized') {
  return sendError(res, message, 401);
}

export function sendForbidden(res, message = 'Forbidden') {
  return sendError(res, message, 403);
}

export function paginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
  };
}
