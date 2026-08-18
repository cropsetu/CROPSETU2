/**
 * Untrusted page/limit parsing.
 *
 * Both of these reached Prisma raw before this pass:
 *   ?limit=1000000 → take: 1000000   — any authenticated user could ask the DB
 *                                      to materialise a million rows WITH image
 *                                      and author includes. No auth bypass
 *                                      needed; it is a normal request.
 *   ?page=abc      → skip: NaN       — Prisma throws, and on Express 4 without
 *                                      a try/catch the request never answers.
 */
import { parsePageSize, parsePageNumber, paginationMeta } from '../../../src/utils/response.js';

describe('parsePageSize', () => {
  test('caps an absurd request at max rather than honouring it', () => {
    expect(parsePageSize('1000000', 20, 50)).toBe(50);
    expect(parsePageSize(999, 20, 50)).toBe(50);
  });

  test('honours a reasonable request', () => {
    expect(parsePageSize('25', 20, 50)).toBe(25);
  });

  test('junk, missing, zero and negative all fall back to the default', () => {
    for (const bad of ['abc', '', null, undefined, '0', '-5', {}, []]) {
      expect(parsePageSize(bad, 20, 50)).toBe(20);
    }
  });

  test('a leading integer is honoured and still clamped', () => {
    // parseInt stops at the first non-digit, so '25abc' reads as 25. That is
    // fine BECAUSE of the clamp: whatever it parses lands inside [1, max], so
    // no malformed value can produce an unbounded take:.
    expect(parsePageSize('25abc', 20, 50)).toBe(25);
    expect(parsePageSize('1e9abc', 20, 50)).toBe(1);
    expect(parsePageSize('99999x', 20, 50)).toBe(50);
  });

  test('never returns NaN or a non-integer', () => {
    for (const v of ['3.7', '  8  ', 'Infinity', '0x10']) {
      const n = parsePageSize(v, 20, 50);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(50);
    }
  });
});

describe('parsePageNumber', () => {
  test('junk becomes page 1 instead of NaN reaching skip:', () => {
    for (const bad of ['abc', '', null, undefined, '0', '-3', NaN]) {
      expect(parsePageNumber(bad)).toBe(1);
    }
  });

  test('a real page number is preserved', () => {
    expect(parsePageNumber('7')).toBe(7);
    expect(parsePageNumber(12)).toBe(12);
  });

  test('the result is always safe to put in skip: (page - 1) * limit', () => {
    for (const v of ['abc', '-1', '0', '3', '99999']) {
      const skip = (parsePageNumber(v) - 1) * 20;
      expect(Number.isFinite(skip)).toBe(true);
      expect(skip).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('paginationMeta stays coherent with the parsed values', () => {
  test('totalPages is at least 1 so clients can always render "page X of Y"', () => {
    expect(paginationMeta(0, 1, 20).totalPages).toBe(1);
    expect(paginationMeta(41, 1, 20).totalPages).toBe(3);
  });
});
