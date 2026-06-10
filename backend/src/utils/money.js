/**
 * Exact money math helpers (fixed-point Decimal).
 *
 * Money columns are DECIMAL, which Prisma returns as Prisma.Decimal. Native JS
 * operators must NOT be used on them:
 *   - `+` triggers string concatenation (Decimal.valueOf() returns a string), so
 *     `0 + decimal` → "0100.5", a silent corruption bug.
 *   - `*`, `-`, `/` coerce to float, reintroducing the rounding drift we are
 *     trying to eliminate.
 * Always do money arithmetic through these helpers, which stay in Decimal.
 */
import { Prisma } from '@prisma/client';

const { Decimal } = Prisma;

/**
 * Coerce any money-ish value to an exact Decimal. JS numbers are stringified
 * first so we capture the intended decimal (String(0.1) === '0.1') rather than
 * the float's full binary expansion. null/undefined/NaN/garbage → 0.
 */
export function D(value) {
  if (value == null) return new Decimal(0);
  if (Decimal.isDecimal(value)) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Decimal(String(value)) : new Decimal(0);
  try { return new Decimal(value); } catch { return new Decimal(0); }
}

/** Sum a list exactly, picking the amount from each item (default identity). */
export function sumD(list, pick = (x) => x) {
  return (Array.isArray(list) ? list : []).reduce((s, x) => s.plus(D(pick(x))), new Decimal(0));
}

/** Round to `dp` decimal places (default 2 — minor units), returning a Decimal. */
export function round2(value, dp = 2) {
  return D(value).toDecimalPlaces(dp);
}

/**
 * Convert a money amount to integer minor units (paise/cents) for payment
 * gateways. Exact: 19.99 → 1999, never 1998.9999999.
 */
export function toMinorUnits(value, factor = 100) {
  return D(value).times(factor).toDecimalPlaces(0).toNumber();
}

export { Decimal };
