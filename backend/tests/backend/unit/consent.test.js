/**
 * Unit tests for consent capture (DPDP §5) — pure logic only (no DB).
 *   - reduceEffectiveConsents(): append-only rows -> latest state per purpose
 *   - constants: required signup purposes + purpose/enum parity
 */
import { jest } from '@jest/globals';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // env.js requires this at import

const { reduceEffectiveConsents } =
  await import('../../../src/services/consent.service.js');
const {
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_VALUES,
  REQUIRED_SIGNUP_PURPOSES,
  CONSENT_PURPOSE_INFO,
  isValidPurpose,
} = await import('../../../src/constants/consent.js');

describe('reduceEffectiveConsents', () => {
  test('latest row per purpose wins (grant then withdraw)', () => {
    const rows = [
      { purpose: 'MARKETING', granted: true,  policyVersion: '2026-06-01', createdAt: '2026-06-01T10:00:00Z' },
      { purpose: 'MARKETING', granted: false, policyVersion: '2026-06-01', createdAt: '2026-06-02T10:00:00Z' },
      { purpose: 'LOCATION',  granted: true,  policyVersion: '2026-06-01', createdAt: '2026-06-01T09:00:00Z' },
    ];
    const eff = reduceEffectiveConsents(rows);
    expect(eff.MARKETING.granted).toBe(false); // withdrawal is newer
    expect(eff.LOCATION.granted).toBe(true);
  });

  test('order-independent: out-of-order rows still resolve to newest', () => {
    const rows = [
      { purpose: 'AI_PROCESSING', granted: false, createdAt: '2026-06-05T00:00:00Z' },
      { purpose: 'AI_PROCESSING', granted: true,  createdAt: '2026-06-01T00:00:00Z' },
    ];
    const eff = reduceEffectiveConsents(rows);
    expect(eff.AI_PROCESSING.granted).toBe(false);
  });

  test('empty input yields no effective consents', () => {
    expect(reduceEffectiveConsents([])).toEqual({});
  });
});

describe('consent constants', () => {
  test('required signup purposes are Terms, Privacy, Data Processing', () => {
    expect(REQUIRED_SIGNUP_PURPOSES).toEqual([
      CONSENT_PURPOSES.TERMS_OF_SERVICE,
      CONSENT_PURPOSES.PRIVACY_POLICY,
      CONSENT_PURPOSES.DATA_PROCESSING,
    ]);
  });

  test('every purpose has informed-consent metadata', () => {
    for (const p of CONSENT_PURPOSE_VALUES) {
      expect(CONSENT_PURPOSE_INFO[p]).toBeDefined();
      expect(typeof CONSENT_PURPOSE_INFO[p].description).toBe('string');
      expect(typeof CONSENT_PURPOSE_INFO[p].required).toBe('boolean');
    }
  });

  test('required purposes are flagged required in the catalogue', () => {
    for (const p of REQUIRED_SIGNUP_PURPOSES) {
      expect(CONSENT_PURPOSE_INFO[p].required).toBe(true);
    }
  });

  test('isValidPurpose accepts known and rejects unknown purposes', () => {
    expect(isValidPurpose('MARKETING')).toBe(true);
    expect(isValidPurpose('NONSENSE')).toBe(false);
    expect(isValidPurpose(undefined)).toBe(false);
  });
});
