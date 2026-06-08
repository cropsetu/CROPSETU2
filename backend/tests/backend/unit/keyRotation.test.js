/**
 * Unit tests for versioned-key encryption + rotation.
 * Loads the encrypt module fresh under different key configs via resetModules,
 * so we can exercise legacy ↔ versioned interop and re-encryption.
 */
import { jest } from '@jest/globals';

const KEY0 = 'a'.repeat(64); // legacy key (id "0")
const KEY2 = 'b'.repeat(64); // rotation key (id "2")

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/x';
process.env.JWT_SECRET = 'c'.repeat(32);

async function loadEncrypt({ keys = '', active = '' } = {}) {
  jest.resetModules();
  process.env.FIELD_ENCRYPTION_KEY = KEY0;
  process.env.FIELD_ENCRYPTION_KEYS = keys;
  process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = active;
  return import('../../../src/utils/encrypt.js');
}

describe('legacy (single-key) behavior', () => {
  test('active key "0" emits the historic 3-part format and round-trips', async () => {
    const enc = await loadEncrypt({ keys: '', active: '' });
    expect(enc.activeKeyId()).toBe('0');
    const ct = enc.encrypt('SECRET');
    expect(ct.split(':')).toHaveLength(3);     // iv:tag:ct (no key id)
    expect(enc.keyIdOf(ct)).toBe('0');
    expect(enc.needsRotation(ct)).toBe(false);
    expect(enc.decrypt(ct)).toBe('SECRET');
  });
});

describe('versioned active key + cross-key interop', () => {
  test('active versioned key emits 4-part format and decrypts legacy data', async () => {
    // 1) make a legacy-key ciphertext
    const legacy = await loadEncrypt({ keys: '', active: '' });
    const legacyCt = legacy.encrypt('PAN-ABCDE1234F');

    // 2) reload with key "2" active (key "0" still available for decryption)
    const enc = await loadEncrypt({ keys: `2:${KEY2}`, active: '2' });
    expect(enc.activeKeyId()).toBe('2');

    // new writes use key "2"
    const newCt = enc.encrypt('PAN-ABCDE1234F');
    expect(newCt.startsWith('2:')).toBe(true);
    expect(newCt.split(':')).toHaveLength(4);
    expect(enc.keyIdOf(newCt)).toBe('2');
    expect(enc.decrypt(newCt)).toBe('PAN-ABCDE1234F');

    // old key-0 ciphertext still decrypts (zero downtime)
    expect(enc.decrypt(legacyCt)).toBe('PAN-ABCDE1234F');
    expect(enc.keyIdOf(legacyCt)).toBe('0');
    expect(enc.needsRotation(legacyCt)).toBe(true);
    expect(enc.needsRotation(newCt)).toBe(false);
  });

  test('rotateCiphertext re-encrypts legacy data under the active key', async () => {
    const legacy = await loadEncrypt({ keys: '', active: '' });
    const legacyCt = legacy.encrypt('1234567890');

    const enc = await loadEncrypt({ keys: `2:${KEY2}`, active: '2' });
    const rotated = enc.rotateCiphertext(legacyCt);

    expect(rotated).not.toBe(legacyCt);
    expect(rotated.startsWith('2:')).toBe(true);
    expect(enc.decrypt(rotated)).toBe('1234567890'); // value preserved
    expect(enc.needsRotation(rotated)).toBe(false);  // now on active key
  });

  test('rotateCiphertext is a no-op for active-key, plaintext, and empty values', async () => {
    const enc = await loadEncrypt({ keys: `2:${KEY2}`, active: '2' });
    const onActive = enc.encrypt('x');
    expect(enc.rotateCiphertext(onActive)).toBe(onActive); // already active key
    expect(enc.rotateCiphertext('plain-legacy-value')).toBe('plain-legacy-value');
    expect(enc.rotateCiphertext('')).toBe('');
    expect(enc.rotateCiphertext(null)).toBeNull();
  });

  test('ciphertext under a retired/unknown key id cannot be decrypted (returns null)', async () => {
    const enc = await loadEncrypt({ keys: `2:${KEY2}`, active: '2' });
    // craft a value claiming key id "9" which is not registered
    const ct = enc.encrypt('data');                 // "2:iv:tag:ct"
    const forged = ct.replace(/^2:/, '9:');          // pretend it's key "9"
    expect(enc.decrypt(forged)).toBeNull();
    // rotateCiphertext must NOT clobber data it cannot decrypt
    expect(enc.rotateCiphertext(forged)).toBe(forged);
  });
});

describe('startup validation', () => {
  test('active key id not present in the registry aborts boot', async () => {
    await expect(loadEncrypt({ keys: '', active: '7' })).rejects.toThrow(/FIELD_ENCRYPTION_ACTIVE_KEY_ID/);
  });

  test('reserved id "0" in FIELD_ENCRYPTION_KEYS is rejected', async () => {
    await expect(loadEncrypt({ keys: `0:${KEY2}`, active: '0' })).rejects.toThrow(/reserved/);
  });
});
