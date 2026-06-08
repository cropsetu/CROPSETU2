/**
 * Field-level encryption helpers — AES-256-GCM with versioned keys.
 *
 * Sensitive PII (Aadhaar, PAN, bank account, GST, location) must be encrypted
 * before being written to the database and decrypted when read back.
 *
 * KEY ROTATION
 * ------------
 * Keys are held in a registry keyed by a short id. The legacy FIELD_ENCRYPTION_KEY
 * is always present under the reserved id "0"; extra keys come from
 * FIELD_ENCRYPTION_KEYS, and FIELD_ENCRYPTION_ACTIVE_KEY_ID picks which encrypts
 * NEW data. Because every listed key stays available for DECRYPTION, you can
 * deploy a new active key and re-encrypt existing rows in the background with no
 * downtime (see services/keyRotation.service.js + scripts/rotate-encryption-key.js).
 *
 * Storage formats (all hex, colon-separated):
 *   legacy (key "0"):  <iv>:<tag>:<ciphertext>            (3 parts — unchanged)
 *   versioned:         <keyId>:<iv>:<tag>:<ciphertext>    (4 parts)
 * Values matching neither shape are returned as-is so existing plaintext rows are
 * not broken during a migration window.
 */
import crypto from 'crypto';
import { ENV, LEGACY_ENCRYPTION_KEY_ID } from '../config/env.js';

const ALG    = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV recommended for GCM

/**
 * Generate a fresh 96-bit IV (nonce) for exactly one GCM encryption.
 *
 * ── IV UNIQUENESS — critical for AES-GCM ──────────────────────────────────────
 * GCM's confidentiality AND integrity collapse if a (key, IV) pair is EVER
 * reused. Two messages encrypted under the same key+IV leak the XOR of their
 * plaintexts and let an attacker forge the authentication tag. So every IV here
 * is drawn fresh from the OS CSPRNG (crypto.randomBytes) — never a counter, a
 * timestamp, or anything derived from the plaintext/key.
 *
 * Random 96-bit IVs keep the reuse (birthday-collision) probability below ~2^-32
 * up to roughly 2^32 (~4 billion) encryptions PER KEY. Rotate the field key
 * (see key rotation above) well before that volume. For this PII workload — a few
 * fields per user — that ceiling is effectively unreachable, and rotation gives a
 * further safety margin by resetting the per-key IV count.
 *
 * Defensive guard: fail CLOSED if the CSPRNG ever returns a wrong-length or
 * all-zero buffer (e.g. a broken/mocked RNG) rather than encrypt with a weak IV.
 */
function generateIv() {
  const iv = crypto.randomBytes(IV_LEN);
  if (iv.length !== IV_LEN || iv.every((b) => b === 0)) {
    throw new Error('[encrypt] Refusing to encrypt: CSPRNG returned a degenerate IV');
  }
  return iv;
}

// Build the id → key Buffer registry once. env.js has already validated every
// key (64-char hex) and that the active id exists, so this cannot be empty.
const KEY_REGISTRY = (() => {
  const reg = new Map();
  reg.set(LEGACY_ENCRYPTION_KEY_ID, Buffer.from(ENV.FIELD_ENCRYPTION_KEY, 'hex'));
  for (const [id, hex] of Object.entries(ENV.FIELD_ENCRYPTION_KEYS || {})) {
    reg.set(id, Buffer.from(hex, 'hex'));
  }
  return reg;
})();
const ACTIVE_KEY_ID = ENV.FIELD_ENCRYPTION_ACTIVE_KEY_ID || LEGACY_ENCRYPTION_KEY_ID;

/** The key id that encrypt() currently writes under. */
export function activeKeyId() {
  return ACTIVE_KEY_ID;
}

/** Split a stored value into its parts, or null if it is not ciphertext-shaped. */
function parseCiphertext(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length === 3) return { keyId: LEGACY_ENCRYPTION_KEY_ID, iv: parts[0], tag: parts[1], ct: parts[2] };
  if (parts.length === 4) return { keyId: parts[0], iv: parts[1], tag: parts[2], ct: parts[3] };
  return null; // plaintext (or some other shape) → leave untouched
}

/** The key id a stored value is encrypted under, or null if it is not ciphertext. */
export function keyIdOf(value) {
  const p = parseCiphertext(value);
  return p ? p.keyId : null;
}

/** True if the value is ciphertext encrypted under a key OTHER than the active one. */
export function needsRotation(value) {
  const id = keyIdOf(value);
  return id != null && id !== ACTIVE_KEY_ID;
}

/**
 * Encrypt a plaintext string under the ACTIVE key.
 * The legacy key keeps the historic 3-part format; any other key prepends its id.
 */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = KEY_REGISTRY.get(ACTIVE_KEY_ID);

  const iv     = generateIv(); // fresh CSPRNG IV per encryption — never reused
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc    = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  const core   = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;

  return ACTIVE_KEY_ID === LEGACY_ENCRYPTION_KEY_ID ? core : `${ACTIVE_KEY_ID}:${core}`;
}

/**
 * Decrypt a ciphertext produced by encrypt() under ANY known key version.
 * Transparently passes through plaintext values (migration safety); returns null
 * when the value is ciphertext we cannot decrypt (corruption or a retired key).
 */
export function decrypt(ciphertext) {
  if (ciphertext == null || ciphertext === '') return ciphertext;

  const parsed = parseCiphertext(ciphertext);
  if (!parsed) return ciphertext; // legacy plaintext

  const key = KEY_REGISTRY.get(parsed.keyId);
  if (!key) {
    console.error(`[encrypt] No key registered for id "${parsed.keyId}" — cannot decrypt (retired key?)`);
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(parsed.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ct, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Decryption failure — key mismatch or corruption; return null rather than crash
    console.error('[encrypt] Decryption failed — possible key rotation needed');
    return null;
  }
}

/**
 * Re-encrypt a single stored value under the active key. Used by the rotation
 * runner. No-op for plaintext, empty, or values already on the active key.
 * Leaves undecryptable values untouched (surfaced by the runner) rather than
 * destroying data.
 */
export function rotateCiphertext(value) {
  if (value == null || value === '') return value;
  if (!needsRotation(value)) return value;
  const plain = decrypt(value);
  if (plain == null) return value; // cannot decrypt → don't clobber
  return encrypt(plain);
}

// ── Numeric PII helpers (lat / lng / income) ─────────────────────────────────
// Stored as ciphertext strings; callers work with JS numbers. encryptNumber and
// decryptNumber are the symmetric pair — encrypt on write, decrypt on read.

/**
 * Encrypt a numeric value for at-rest storage.
 * Passes null/undefined/'' through unchanged so absent values stay absent;
 * returns null for non-finite input rather than persisting garbage.
 */
export function encryptNumber(value) {
  if (value === null || value === undefined || value === '') return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return encrypt(String(n));
}

/**
 * Decrypt a value produced by encryptNumber back to a JS number.
 * Returns null for empty/undecryptable input. Legacy plaintext numbers (from
 * before the column was encrypted) pass through decrypt() and parse correctly.
 */
export function decryptNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(decrypt(value));
  return Number.isFinite(n) ? n : null;
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

/**
 * [FIX #7] Recursively strip HTML from all string values in an object or array.
 * Used for JSON fields like specifications, deliveryAddress, highlights.
 */
export function deepStripHtml(val) {
  if (val == null) return val;
  if (typeof val === 'string') return stripHtml(val);
  if (Array.isArray(val)) return val.map(deepStripHtml);
  if (typeof val === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(val)) {
      cleaned[stripHtml(k)] = deepStripHtml(v);
    }
    return cleaned;
  }
  return val;
}
