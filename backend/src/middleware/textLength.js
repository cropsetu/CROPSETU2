/**
 * Free-text length guards.
 *
 * The global body parser caps the whole request (~100 KB for normal routes), but
 * a single free-text field can still be tens of KB — enough to bloat a DB row and
 * multiply across rows. These builders add a per-field upper bound so oversized
 * inputs are rejected with 400 before they reach the database.
 *
 * Pair with `validate` (which turns any failed rule into a 400). Required fields
 * keep their own `.notEmpty()` validators elsewhere in the chain; `maxLen` only
 * adds the ceiling, so it is safe to spread alongside them.
 */
import { body } from 'express-validator';

/**
 * Build optional max-length validators from a { field: maxChars } map.
 * Skips absent/empty values (checkFalsy) so it never makes an optional field
 * required — it only rejects values longer than `maxChars`.
 *
 * @param {Record<string, number>} fieldMaxMap
 * @returns {import('express-validator').ValidationChain[]}
 */
export function maxLen(fieldMaxMap) {
  return Object.entries(fieldMaxMap).map(([field, max]) =>
    body(field)
      .optional({ checkFalsy: true })
      .isLength({ max })
      .withMessage(`${field} must be at most ${max} characters`));
}
