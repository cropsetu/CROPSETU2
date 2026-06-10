/**
 * Shared string-matching helpers for APP-SIDE filtering.
 *
 * Our Prisma queries match names/states/districts case-insensitively (via
 * `mode: 'insensitive'` or by storing/looking up lowercased values). Plain JS
 * `===`/`!==` is case-sensitive, so app-side filtering that compares the same
 * kind of value with `===` silently disagrees with the DB layer: e.g.
 * "Maharashtra" !== "maharashtra" drops an otherwise-matching row. That
 * inconsistency between layers causes missed results.
 *
 * Use these wherever app code filters on a value the DB would compare
 * case-insensitively, so both layers fold case the same way.
 */

/**
 * Case-insensitive equality — folds BOTH sides to lowercase before comparing.
 * Null-safe: null/undefined equals only null/undefined.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function equalsIgnoreCase(a, b) {
  if (a == null || b == null) return a === b;
  return String(a).toLowerCase() === String(b).toLowerCase();
}
