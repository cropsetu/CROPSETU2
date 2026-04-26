/**
 * Field-level encryption helpers — AES-256-GCM
 *
 * Sensitive PII (Aadhaar, PAN, bank account) must be encrypted before
 * being written to the database and decrypted when read back.
 *
 * Requires FIELD_ENCRYPTION_KEY in .env — a 64-char hex string (32 bytes).
 * Generate a new key with:  openssl rand -hex 32
 *
 * Storage format (all hex, colon-separated):
 *   <12-byte IV>:<16-byte GCM auth tag>:<ciphertext>
 * Stored values that do NOT match this format are returned as-is so that
 * existing plaintext rows are not broken during a migration window.
 */
import crypto from 'crypto';
import { ENV } from '../config/env.js';

const ALG    = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV recommended for GCM

function getKey() {
  if (!ENV.FIELD_ENCRYPTION_KEY) {
    // Log once per process — do NOT throw so the server still starts in dev.
    console.warn('[encrypt] FIELD_ENCRYPTION_KEY is not set — sensitive fields stored unencrypted');
    return null;
  }
  return Buffer.from(ENV.FIELD_ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns the ciphertext string, or the original value if encryption is
 * not configured (dev fallback with a loud warning).
 */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = getKey();
  if (!key) return plaintext; // no-op when key not configured

  const iv      = crypto.randomBytes(IV_LEN);
  const cipher  = crypto.createCipheriv(ALG, key, iv);
  const enc     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a ciphertext produced by encrypt().
 * Transparently passes through plaintext values (migration safety).
 */
export function decrypt(ciphertext) {
  if (ciphertext == null || ciphertext === '') return ciphertext;
  const key = getKey();
  if (!key) return ciphertext;

  // Not in encrypted format → treat as legacy plaintext (migration window)
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;

  const [ivHex, tagHex, encHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Decryption failure — key mismatch or corruption; return null rather than crash
    console.error('[encrypt] Decryption failed — possible key rotation needed');
    return null;
  }
}

// ── PII masking helpers (used in API responses) ───────────────────────────────
// Never return full sensitive values. Show just enough for the user to confirm
// the data is saved, but not enough to be useful if intercepted or logged.

/** Aadhaar 12 digits → ••••-••••-5678 */
export function maskAadhaar(val) {
  if (!val) return null;
  const plain = decrypt(val) ?? val;
  return `••••-••••-${String(plain).slice(-4)}`;
}

/** Bank account → ••••••3456 */
export function maskAccount(val) {
  if (!val) return null;
  const plain = decrypt(val) ?? val;
  return `••••••${String(plain).slice(-4)}`;
}

/** PAN 10 chars → ABCDE•••5F */
export function maskPan(val) {
  if (!val) return null;
  const plain = decrypt(val) ?? val;
  const s = String(plain);
  return `${s.slice(0, 5)}•••${s.slice(-2)}`;
}

/** IFSC 11 chars → SBIN•••••45 */
export function maskIfsc(val) {
  if (!val) return null;
  // IFSC is not PII — return in full (it identifies a bank branch, not a person)
  return decrypt(val) ?? val;
}

/** Strip HTML / script tags from user-supplied strings to prevent stored XSS. */
export function stripHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}
