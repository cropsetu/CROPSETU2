/**
 * Express-validator middleware — runs after validation chain,
 * returns 400 with structured errors if any rule failed.
 */
import { validationResult } from 'express-validator';
import { sendError } from '../utils/response.js';

export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const arr = errors.array();
    // Include field name in the message so callers see "price: must be a positive number"
    // rather than three "Invalid value" entries from chained validators.
    const messages = arr.map(e => `${e.path || e.param || 'field'}: ${e.msg}`);
    return sendError(res, messages.join('; '), 400, arr);
  }
  next();
}
