/**
 * Unit tests for src/utils/encrypt.js
 * Covers: encrypt, decrypt, masking helpers, stripHtml
 */
import { jest } from '@jest/globals';

// Must set the key BEFORE importing encrypt module
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex

const { encrypt, decrypt, maskAadhaar, maskAccount, maskPan, maskIfsc, stripHtml } =
  await import('../../../src/utils/encrypt.js');

describe('encrypt / decrypt', () => {
  test('round-trip: decrypt(encrypt(x)) === x', () => {
    const plain = 'SensitiveData12345';
    const cipher = encrypt(plain);
    expect(cipher).not.toBe(plain);
    expect(decrypt(cipher)).toBe(plain);
  });

  test('encrypt returns colon-separated format: iv:tag:ciphertext', () => {
    const cipher = encrypt('hello');
    const parts = cipher.split(':');
    expect(parts).toHaveLength(3);
    // IV = 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // GCM tag = 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
  });

  test('two encryptions of same plaintext produce different ciphertexts (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  test('encrypt(null) returns null', () => {
    expect(encrypt(null)).toBeNull();
  });

  test('encrypt("") returns ""', () => {
    expect(encrypt('')).toBe('');
  });

  test('decrypt of non-encrypted string returns it as-is (migration safety)', () => {
    expect(decrypt('plaintext-value')).toBe('plaintext-value');
  });

  test('decrypt of corrupted ciphertext returns null', () => {
    const result = decrypt('bad:data:here');
    expect(result).toBeNull();
  });

  test('handles numeric input by coercing to string', () => {
    const cipher = encrypt(123456789012);
    expect(decrypt(cipher)).toBe('123456789012');
  });
});

describe('maskAadhaar', () => {
  test('masks all but last 4 digits', () => {
    const encrypted = encrypt('123456789012');
    expect(maskAadhaar(encrypted)).toBe('••••-••••-9012');
  });

  test('handles null', () => {
    expect(maskAadhaar(null)).toBeNull();
  });

  test('handles unencrypted legacy value', () => {
    expect(maskAadhaar('123456789012')).toBe('••••-••••-9012');
  });
});

describe('maskAccount', () => {
  test('masks all but last 4 digits', () => {
    const encrypted = encrypt('12345678901234');
    expect(maskAccount(encrypted)).toBe('••••••1234');
  });

  test('handles null', () => {
    expect(maskAccount(null)).toBeNull();
  });
});

describe('maskPan', () => {
  test('shows first 5 and last 2, masks middle', () => {
    const encrypted = encrypt('ABCDE1234F');
    expect(maskPan(encrypted)).toBe('ABCDE•••4F');
  });

  test('handles null', () => {
    expect(maskPan(null)).toBeNull();
  });
});

describe('maskIfsc', () => {
  test('returns full IFSC (not PII)', () => {
    const encrypted = encrypt('SBIN0012345');
    expect(maskIfsc(encrypted)).toBe('SBIN0012345');
  });

  test('handles null', () => {
    expect(maskIfsc(null)).toBeNull();
  });
});

describe('stripHtml', () => {
  test('removes HTML tags', () => {
    expect(stripHtml('<b>bold</b>')).toBe('bold');
  });

  test('removes script tags and content between tags', () => {
    expect(stripHtml('<script>alert(1)</script>')).toBe('alert(1)');
  });

  test('removes nested tags', () => {
    expect(stripHtml('<div><p>hello</p></div>')).toBe('hello');
  });

  test('handles non-string input', () => {
    expect(stripHtml(123)).toBe(123);
    expect(stripHtml(null)).toBeNull();
  });

  test('trims whitespace', () => {
    expect(stripHtml('  hello  ')).toBe('hello');
  });

  test('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});
