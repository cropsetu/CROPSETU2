/**
 * Unit tests for the logger's PII redaction (redact()).
 * Ensures sensitive object keys are masked before anything is logged.
 */
import { jest } from '@jest/globals';

const { redact } = await import('../../../src/utils/logger.js');

describe('redact — secret keys', () => {
  test('fully redacts secrets and financial identifiers', () => {
    const out = redact({
      password: 'hunter2',
      otp: '123456',
      token: 'eyJabc',
      refreshToken: 'r-tok',
      authorization: 'Bearer x',
      aadharNumber: '123456789012',
      panNumber: 'ABCDE1234F',
      bankAccountNumber: '12345678901234',
      bankIfsc: 'SBIN0012345',
      gstNumber: '27ABCDE1234F1Z5',
    });
    for (const k of Object.keys(out)) {
      expect(out[k]).toBe('***REDACTED***');
    }
  });

  test('key matching is case-insensitive', () => {
    expect(redact({ Authorization: 'Bearer x' }).Authorization).toBe('***REDACTED***');
    expect(redact({ GSTNumber: '27ABCDE1234F1Z5' }).GSTNumber).toBe('***REDACTED***');
  });
});

describe('redact — phone masking', () => {
  test('masks phone to last 4 digits', () => {
    expect(redact({ phone: '9876543210' }).phone).toBe('••••••3210');
    expect(redact({ mobile: '+91 98765 43210' }).mobile).toBe('••••••3210');
  });

  test('short/empty phone values do not leak', () => {
    expect(redact({ phone: '12' }).phone).toBe('****');
    expect(redact({ phone: null }).phone).toBeNull();
  });
});

describe('redact — structure handling', () => {
  test('redacts nested objects and arrays', () => {
    const out = redact({
      user: { name: 'Asha', phone: '9876543210', sellerProfile: { panNumber: 'ABCDE1234F' } },
      tokens: [{ accessToken: 'a' }, { refreshToken: 'b' }],
    });
    expect(out.user.name).toBe('Asha');                 // non-sensitive preserved
    expect(out.user.phone).toBe('••••••3210');
    expect(out.user.sellerProfile.panNumber).toBe('***REDACTED***');
    expect(out.tokens[0].accessToken).toBe('***REDACTED***');
    expect(out.tokens[1].refreshToken).toBe('***REDACTED***');
  });

  test('passes primitives through unchanged', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  test('preserves Error objects (stack intact)', () => {
    const err = new Error('boom');
    expect(redact(err)).toBe(err);
    expect(redact({ err }).err).toBe(err);
  });

  test('handles circular references without throwing', () => {
    const obj = { phone: '9876543210' };
    obj.self = obj;
    const out = redact(obj);
    expect(out.phone).toBe('••••••3210');
    expect(out.self).toBe('[Circular]');
  });

  test('does not mutate the input object', () => {
    const input = { password: 'secret', user: { phone: '9876543210' } };
    redact(input);
    expect(input.password).toBe('secret');
    expect(input.user.phone).toBe('9876543210');
  });
});
