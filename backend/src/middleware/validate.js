/**
 * Express-validator middleware — runs after validation chain,
 * returns 400 with structured errors if any rule failed.
 */
import { validationResult } from 'express-validator';
import { sendError } from '../utils/response.js';

export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map(e => e.msg);
    return sendError(res, messages.join(', '), 400, errors.array());
  }
  next();
}
