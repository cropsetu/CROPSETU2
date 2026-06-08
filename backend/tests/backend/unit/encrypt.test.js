/**
 * Unit tests for src/utils/encrypt.js
 * Covers: encrypt, decrypt, masking helpers, stripHtml
 */
import { jest } from '@jest/globals';

// Must set the key BEFORE importing encrypt module
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex

const {
  encrypt, decrypt, encryptNumber, decryptNumber,
  maskAadhaar, maskAccount, maskPan, maskIfsc, stripHtml,
} = await import('../../../src/utils/encrypt.js');

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

  test('every encryption uses a fresh, unique 96-bit IV (GCM nonce safety)', () => {
    // IV is the first hex segment of the 3-part legacy format (iv:tag:ct).
    const ivOf = (ct) => ct.split(':')[0];
    const ivs = new Set();
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const iv = ivOf(encrypt('fixed-plaintext')); // same plaintext each time
      expect(iv).toHaveLength(24);                  // 12 bytes = 96-bit IV
      expect(iv).not.toBe('0'.repeat(24));          // never the degenerate all-zero IV
      ivs.add(iv);
    }
    expect(ivs.size).toBe(N); // all IVs distinct — no (key, IV) reuse
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

  test('GST number round-trips and is ciphertext at rest', () => {
    const gst = '27ABCDE1234F1Z5';
    const cipher = encrypt(gst);
    expect(cipher).not.toBe(gst);          // not stored in plaintext
    expect(cipher).not.toContain(gst);     // ciphertext does not embed it
    expect(decrypt(cipher)).toBe(gst);     // decrypts back exactly
  });

  test('GST opt-out empty value stays empty (encrypt is a no-op on "")', () => {
    // PUT /me stores '' when gstOptOut is set; it must remain falsy so the
    // profile-completion truthiness check keeps working.
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });
});

describe('encryptNumber / decryptNumber (lat / lng / income)', () => {
  test('round-trips a positive coordinate', () => {
    const cipher = encryptNumber(19.9975);
    expect(typeof cipher).toBe('string');
    expect(cipher).not.toBe('19.9975');       // ciphertext at rest
    expect(decryptNumber(cipher)).toBe(19.9975);
  });

  test('round-trips a negative coordinate and an integer income', () => {
    expect(decryptNumber(encryptNumber(-73.7898))).toBe(-73.7898);
    expect(decryptNumber(encryptNumber(450000))).toBe(450000);
  });

  test('ciphertext is in iv:tag:ciphertext form (not the raw number)', () => {
    const cipher = encryptNumber(12.34);
    expect(cipher.split(':')).toHaveLength(3);
  });

  test('accepts numeric strings', () => {
    expect(decryptNumber(encryptNumber('19.9975'))).toBe(19.9975);
  });

  test('passes null / undefined / empty through on encrypt, returns null on decrypt', () => {
    expect(encryptNumber(null)).toBeNull();
    expect(encryptNumber(undefined)).toBeUndefined();
    expect(encryptNumber('')).toBe('');
    expect(decryptNumber(null)).toBeNull();
    expect(decryptNumber(undefined)).toBeNull();
    expect(decryptNumber('')).toBeNull();
  });

  test('non-finite input encrypts to null (never persists garbage)', () => {
    expect(encryptNumber('not-a-number')).toBeNull();
    expect(encryptNumber(NaN)).toBeNull();
  });

  test('decrypts legacy plaintext numbers (pre-encryption rows)', () => {
    // After the Float→String migration, old rows hold a bare numeric string.
    expect(decryptNumber('19.9975')).toBe(19.9975);
    expect(decryptNumber('450000')).toBe(450000);
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
