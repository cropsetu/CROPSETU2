/**
 * Tests for sanitizeSearch — the guard that keeps user-supplied search/filter
 * terms from becoming pathological Prisma `contains` (ILIKE) patterns.
 *
 * Acceptance for this finding: malicious filter input can't degrade performance.
 * The core property is that the output NEVER contains a SQL LIKE metacharacter
 * (% or _) or the escape char (\), and is length-bounded — so it can only ever
 * match as a literal substring, never as a wildcard scan.
 */
import { sanitizeSearch } from '../../../src/utils/sanitizeSearch.js';

describe('sanitizeSearch', () => {
  test('strips LIKE wildcards and the escape char', () => {
    expect(sanitizeSearch('a%b_c\\d')).toBe('a b c d');
    const out = sanitizeSearch('%_%_%_%_%_%_');
    expect(out).toBeNull(); // nothing but wildcards → no usable term
  });

  test('output is always free of %, _ and \\ (the catastrophic-pattern guard)', () => {
    const hostile = '%' .repeat(50) + '_'.repeat(50) + '\\'.repeat(20) + 'wheat';
    const out = sanitizeSearch(hostile);
    expect(out).not.toMatch(/[%_\\]/);
    expect(out).toContain('wheat');
  });

  test('caps length to bound query cost', () => {
    const out = sanitizeSearch('x'.repeat(5000));
    expect(out.length).toBe(100);
    expect(sanitizeSearch('y'.repeat(50), 20).length).toBe(20);
  });

  test('collapses whitespace runs and trims', () => {
    expect(sanitizeSearch('  red   gram  ')).toBe('red gram');
  });

  test('returns null for empty / whitespace / null / undefined', () => {
    expect(sanitizeSearch('')).toBeNull();
    expect(sanitizeSearch('   ')).toBeNull();
    expect(sanitizeSearch(null)).toBeNull();
    expect(sanitizeSearch(undefined)).toBeNull();
  });

  test('coerces non-strings (e.g. an array from duplicated query params)', () => {
    // express populates req.query.x as an array when x is repeated; must not throw.
    expect(() => sanitizeSearch(['a%b', 'c'])).not.toThrow();
    expect(sanitizeSearch(['a%b', 'c'])).not.toMatch(/[%_\\]/);
  });

  test('ordinary search terms pass through unchanged', () => {
    expect(sanitizeSearch('Mahindra Tractor')).toBe('Mahindra Tractor');
    expect(sanitizeSearch('soybean')).toBe('soybean');
  });
});
