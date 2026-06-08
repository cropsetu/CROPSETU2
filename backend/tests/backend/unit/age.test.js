/**
 * Unit tests for DPDP §9 age helpers + minor-consent rules.
 */
import { jest } from '@jest/globals';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

const { computeAge, isMinorDob, AGE_OF_MAJORITY } = await import('../../../src/utils/age.js');
const { MINOR_PROHIBITED_PURPOSES, CONSENT_PURPOSES } = await import('../../../src/constants/consent.js');

const NOW = new Date('2026-06-08T00:00:00.000Z');

describe('computeAge', () => {
  test('computes whole-years age', () => {
    expect(computeAge('2000-06-08', NOW)).toBe(26);
    expect(computeAge('2010-01-01', NOW)).toBe(16);
  });

  test('accounts for birthday not yet reached this year', () => {
    expect(computeAge('2008-06-09', NOW)).toBe(17); // day before 18th birthday
    expect(computeAge('2008-06-08', NOW)).toBe(18); // exactly 18 today
  });

  test('returns null for missing/invalid dob', () => {
    expect(computeAge(null, NOW)).toBeNull();
    expect(computeAge('', NOW)).toBeNull();
    expect(computeAge('not-a-date', NOW)).toBeNull();
  });

  test('accepts Date objects', () => {
    expect(computeAge(new Date('1990-06-08'), NOW)).toBe(36);
  });
});

describe('isMinorDob', () => {
  test('under 18 is a minor', () => {
    expect(isMinorDob('2010-06-08', NOW)).toBe(true);
    expect(isMinorDob('2008-06-09', NOW)).toBe(true); // 17
  });

  test('18 and over is not a minor', () => {
    expect(isMinorDob('2008-06-08', NOW)).toBe(false); // exactly 18
    expect(isMinorDob('1990-01-01', NOW)).toBe(false);
  });

  test('unknown dob is treated as not-a-minor (cannot assert)', () => {
    expect(isMinorDob(null, NOW)).toBe(false);
    expect(isMinorDob(undefined, NOW)).toBe(false);
  });

  test('age of majority is 18 (DPDP Act)', () => {
    expect(AGE_OF_MAJORITY).toBe(18);
  });
});

describe('minor consent rules', () => {
  test('marketing is prohibited for minors (no targeted ads — §9(3))', () => {
    expect(MINOR_PROHIBITED_PURPOSES).toContain(CONSENT_PURPOSES.MARKETING);
  });

  test('essential purposes are NOT in the minor-prohibited list', () => {
    expect(MINOR_PROHIBITED_PURPOSES).not.toContain(CONSENT_PURPOSES.TERMS_OF_SERVICE);
    expect(MINOR_PROHIBITED_PURPOSES).not.toContain(CONSENT_PURPOSES.DATA_PROCESSING);
    expect(MINOR_PROHIBITED_PURPOSES).not.toContain(CONSENT_PURPOSES.GUARDIAN_CONSENT);
  });
});
