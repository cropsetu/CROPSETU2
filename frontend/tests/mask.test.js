/**
 * Tests for src/utils/mask.js — PII masking utilities.
 *
 * Run:  npm test -- --testPathPattern=mask.test
 */
import { jest } from '@jest/globals';

// ── Stub encrypt.js so decrypt() is an identity function ─────────────────────

jest.unstable_mockModule('../src/utils/encrypt.js', () => ({
  encrypt:     jest.fn((v) => v),
  decrypt:     jest.fn((v) => v),
  maskAadhaar: jest.fn((val) => {
    if (!val) return null;
    const s = String(val);
    return s.length > 4 ? 'XXXX XXXX ' + s.slice(-4) : s;
  }),
  maskAccount: jest.fn((val) => {
    if (!val) return null;
    const s = String(val);
    return s.length > 4 ? 'X'.repeat(s.length - 4) + s.slice(-4) : s;
  }),
  maskPan: jest.fn((val) => {
    if (!val) return null;
    const s = String(val);
    return s.length > 4 ? s.slice(0, 2) + 'XXXXX' + s.slice(-2) : s;
  }),
  maskIfsc: jest.fn((val) => val ?? null),
  stripHtml: jest.fn((v) => v),
}));

const { maskSensitiveFields, maskAadhaar, maskAccount, maskPan, maskIfsc }
  = await import('../src/utils/mask.js');

// ── maskAccount ────────────────────────────────────────────────────────────────

describe('maskAccount', () => {
  it('shows only last 4 digits: XXXXXXXXXX1234', () => {
    expect(maskAccount('12345678901234')).toBe('XXXXXXXXXX1234');
  });

  it('handles short account numbers unchanged', () => {
    expect(maskAccount('1234')).toBe('1234');
  });

  it('returns null for null', () => {
    expect(maskAccount(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(maskAccount(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(maskAccount('')).toBeNull();
  });

  it('does not expose the first digits', () => {
    const result = maskAccount('123456789012');
    expect(result).not.toContain('12345678');
    expect(result).toContain('9012');
  });
});

// ── maskAadhaar ────────────────────────────────────────────────────────────────

describe('maskAadhaar', () => {
  it('shows XXXX XXXX + last 4 digits', () => {
    expect(maskAadhaar('123456789012')).toBe('XXXX XXXX 9012');
  });

  it('returns null for null input', () => {
    expect(maskAadhaar(null)).toBeNull();
  });

  it('does not expose full Aadhaar', () => {
    const result = maskAadhaar('123456789012');
    expect(result).not.toContain('123456789');
  });
});

// ── maskPan ────────────────────────────────────────────────────────────────────

describe('maskPan', () => {
  it('shows first 2 chars + XXXXX + last 2 chars', () => {
    expect(maskPan('ABCDE1234F')).toBe('ABXXXXX4F');
  });

  it('returns null for null input', () => {
    expect(maskPan(null)).toBeNull();
  });

  it('does not expose PAN digits', () => {
    const result = maskPan('ABCDE1234F');
    expect(result).not.toContain('CDE1234');
  });
});

// ── maskIfsc ───────────────────────────────────────────────────────────────────

describe('maskIfsc', () => {
  it('returns IFSC in full (bank branch identifier, not personal PII)', () => {
    expect(maskIfsc('SBIN0001234')).toBe('SBIN0001234');
  });

  it('returns null for null input', () => {
    expect(maskIfsc(null)).toBeNull();
  });
});

// ── maskSensitiveFields ────────────────────────────────────────────────────────

describe('maskSensitiveFields', () => {
  const raw = {
    id:                'sp-1',
    bankHolderName:    'Ramesh Kumar',
    bankName:          'State Bank of India',
    bankAccountNumber: '12345678901234',
    bankIfsc:          'SBIN0001234',
    aadharNumber:      '123456789012',
    panNumber:         'ABCDE1234F',
    kycVerifiedAt:     '2025-01-01T00:00:00Z',
    kycRejectedReason: null,
    updatedAt:         '2025-06-01T00:00:00Z',
    // Extra field that must NOT leak
    _rawData:          'SHOULD NOT APPEAR',
  };

  let result;
  beforeAll(() => { result = maskSensitiveFields(raw); });

  it('masks bank account showing only last 4 digits', () => {
    expect(result.bankAccountNumber).toBe('XXXXXXXXXX1234');
    expect(result.bankAccountNumber).not.toContain('12345678');
  });

  it('masks Aadhaar showing only last 4 digits', () => {
    expect(result.aadharNumber).toBe('XXXX XXXX 9012');
    expect(result.aadharNumber).not.toContain('123456789');
  });

  it('masks PAN showing first 2 and last 2', () => {
    expect(result.panNumber).toBe('ABXXXXX4F');
    expect(result.panNumber).not.toContain('CDE1234');
  });

  it('preserves IFSC in full', () => {
    expect(result.bankIfsc).toBe('SBIN0001234');
  });

  it('preserves non-PII fields', () => {
    expect(result.id).toBe('sp-1');
    expect(result.bankHolderName).toBe('Ramesh Kumar');
    expect(result.bankName).toBe('State Bank of India');
  });

  it('does not include unlisted fields (no leakage via extra keys)', () => {
    expect(result._rawData).toBeUndefined();
  });

  it('returns null for null input', () => {
    expect(maskSensitiveFields(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(maskSensitiveFields(undefined)).toBeNull();
  });

  it('handles missing PII fields gracefully', () => {
    const minimal = { id: 'sp-2', bankHolderName: 'Test' };
    const out = maskSensitiveFields(minimal);
    expect(out).not.toBeNull();
    expect(out.bankAccountNumber).toBeNull();
    expect(out.aadharNumber).toBeNull();
  });

  it('handles short account numbers (≤4 digits) without masking', () => {
    const out = maskSensitiveFields({ ...raw, bankAccountNumber: '1234' });
    expect(out.bankAccountNumber).toBe('1234');
  });
});
