/**
 * Unit tests for src/utils/mask.js — maskSensitiveFields()
 *
 * Guards the two bug classes this module had:
 *   1. Field-name mismatches vs the Prisma SellerProfile model
 *      (aadharNumber / panNumber / bankAccountNumber / bankIfsc).
 *   2. Missing decryption — values are stored encrypted, so masking must
 *      decrypt first, then reveal only a partial of the PLAINTEXT.
 */
import { jest } from '@jest/globals';

// Must set the key BEFORE importing modules that read it at load time.
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex

const { encrypt } = await import('../../../src/utils/encrypt.js');
const { maskSensitiveFields } = await import('../../../src/utils/mask.js');

describe('maskSensitiveFields — field mappings + decryption', () => {
  test('masks all encrypted PII fields with correct partials', () => {
    const profile = {
      id: 'sp_1',
      bankHolderName:    encrypt('Asha Patil'),
      bankName:          encrypt('State Bank'),
      aadharNumber:      encrypt('123456789012'),
      panNumber:         encrypt('ABCDE1234F'),
      bankAccountNumber: encrypt('12345678901234'),
      bankIfsc:          encrypt('SBIN0012345'),
    };

    const out = maskSensitiveFields(profile);

    // [bug 1] correct field names are produced; [bug 2] decrypted before mask
    expect(out.aadharNumber).toBe('••••-••••-9012');
    expect(out.panNumber).toBe('ABCDE•••4F');
    expect(out.bankAccountNumber).toBe('••••••1234');
    expect(out.bankIfsc).toBe('SBIN0012345');

    // Display-only bank fields are decrypted to full plaintext for the owner
    expect(out.bankHolderName).toBe('Asha Patil');
    expect(out.bankName).toBe('State Bank');
    expect(out.id).toBe('sp_1');
  });

  test('decrypts bankHolderName / bankName / bankIfsc (no ciphertext leaks)', () => {
    const holderCipher = encrypt('Asha Patil');
    const nameCipher   = encrypt('State Bank');
    const ifscCipher   = encrypt('SBIN0012345');

    // sanity: each is genuine ciphertext, not the plaintext
    expect(holderCipher).not.toBe('Asha Patil');

    const out = maskSensitiveFields({
      bankHolderName: holderCipher,
      bankName: nameCipher,
      bankIfsc: ifscCipher,
    });

    expect(out.bankHolderName).toBe('Asha Patil');
    expect(out.bankName).toBe('State Bank');
    expect(out.bankIfsc).toBe('SBIN0012345');
    // none of the colon-delimited ciphertext survives into the response
    expect(out.bankHolderName).not.toContain(':');
    expect(out.bankName).not.toContain(':');
  });

  test('masked output never contains the full secret or the raw ciphertext', () => {
    const aadhaarCipher = encrypt('123456789012');
    const out = maskSensitiveFields({ aadharNumber: aadhaarCipher });

    expect(out.aadharNumber).not.toBe(aadhaarCipher);       // not the ciphertext
    expect(out.aadharNumber).not.toContain('12345678');     // not the full PII
    expect(out.aadharNumber.endsWith('9012')).toBe(true);   // only last 4 shown
  });

  test('does NOT mask wrong/legacy field names (aadhaarNumber/bankAccount/ifscCode)', () => {
    // These keys do not exist on the Prisma model; they must pass through
    // untouched so a typo never silently leaves real PII unmasked elsewhere.
    const out = maskSensitiveFields({
      aadhaarNumber: 'should-not-be-touched',
      bankAccount: 'should-not-be-touched',
      ifscCode: 'should-not-be-touched',
    });
    expect(out.aadhaarNumber).toBe('should-not-be-touched');
    expect(out.bankAccount).toBe('should-not-be-touched');
    expect(out.ifscCode).toBe('should-not-be-touched');
  });

  test('handles legacy plaintext values (pre-encryption migration window)', () => {
    const out = maskSensitiveFields({
      aadharNumber: '123456789012',      // legacy unencrypted row
      panNumber: 'ABCDE1234F',
      bankAccountNumber: '12345678901234',
      bankHolderName: 'Asha Patil',      // legacy plaintext bank fields
      bankName: 'State Bank',
      bankIfsc: 'SBIN0012345',
    });
    expect(out.aadharNumber).toBe('••••-••••-9012');
    expect(out.panNumber).toBe('ABCDE•••4F');
    expect(out.bankAccountNumber).toBe('••••••1234');
    expect(out.bankHolderName).toBe('Asha Patil');
    expect(out.bankName).toBe('State Bank');
    expect(out.bankIfsc).toBe('SBIN0012345');
  });

  test('returns null/undefined profile unchanged', () => {
    expect(maskSensitiveFields(null)).toBeNull();
    expect(maskSensitiveFields(undefined)).toBeUndefined();
  });

  test('leaves absent PII fields absent (no spurious keys added)', () => {
    const out = maskSensitiveFields({ bankHolderName: 'Asha' });
    expect(out).toEqual({ bankHolderName: 'Asha' });
    expect('aadharNumber' in out).toBe(false);
  });

  test('does not mutate the input object', () => {
    const cipher = encrypt('123456789012');
    const profile = { aadharNumber: cipher };
    maskSensitiveFields(profile);
    expect(profile.aadharNumber).toBe(cipher); // original untouched
  });
});
