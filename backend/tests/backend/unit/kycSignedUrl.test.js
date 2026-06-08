/**
 * Unit tests for the KYC private-storage signed-URL helper.
 * Covers src/config/cloudinary.js → signedPrivateUrl().
 *
 * KYC documents are stored privately (type: 'authenticated'); they must only be
 * reachable through a short-lived, signed, EXPIRING URL. These tests assert the
 * generated URL is time-limited and tamper-evident (the signature binds the
 * expiry), without making any network calls.
 */
import { jest } from '@jest/globals';

// env.js requires this at import time.
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

const { cloudinary, signedPrivateUrl, KYC_SIGNED_URL_TTL_SEC } =
  await import('../../../src/config/cloudinary.js');

// Configure the shared Cloudinary singleton with dummy creds so URL signing is
// deterministic and offline (no real account needed).
cloudinary.config({
  cloud_name: 'demo',
  api_key:    '123456789012345',
  api_secret: 'abcdefghijklmnopqrstuvwxyz12',
});

describe('signedPrivateUrl', () => {
  const PUBLIC_ID = 'farmeasy/kyc/user-1/doc-1';

  test('returns null for empty input (no public_id → no URL)', () => {
    expect(signedPrivateUrl(null)).toBeNull();
    expect(signedPrivateUrl(undefined)).toBeNull();
    expect(signedPrivateUrl('')).toBeNull();
  });

  test('targets the authenticated (private) delivery type, never public upload', () => {
    const url = signedPrivateUrl(PUBLIC_ID);
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain('type=authenticated');
    expect(url).not.toContain('/image/upload/'); // must not be a public CDN URL
  });

  test('is signed and carries an expiry (short-lived by default)', () => {
    const before = Math.floor(Date.now() / 1000);
    const url = signedPrivateUrl(PUBLIC_ID);

    expect(url).toContain('signature=');
    const m = url.match(/expires_at=(\d+)/);
    expect(m).not.toBeNull();

    const expiresAt = Number(m[1]);
    // Expiry is ~now + default TTL (allow a couple seconds of slack)
    expect(expiresAt).toBeGreaterThanOrEqual(before + KYC_SIGNED_URL_TTL_SEC - 2);
    expect(expiresAt).toBeLessThanOrEqual(before + KYC_SIGNED_URL_TTL_SEC + 5);
  });

  test('encodes the public_id', () => {
    const url = signedPrivateUrl(PUBLIC_ID);
    // public_id appears URL-encoded (slashes → %2F)
    expect(decodeURIComponent(url)).toContain(PUBLIC_ID);
  });

  test('the signature binds the expiry (different TTL → different signature)', () => {
    const shortUrl = signedPrivateUrl(PUBLIC_ID, { expiresInSec: 60 });
    const longUrl  = signedPrivateUrl(PUBLIC_ID, { expiresInSec: 86400 });

    const sig = (u) => u.match(/signature=([a-f0-9]+)/)[1];
    // If the expiry weren't signed, an attacker could extend it freely.
    expect(sig(shortUrl)).not.toBe(sig(longUrl));
  });

  test('honors a custom TTL', () => {
    const before = Math.floor(Date.now() / 1000);
    const url = signedPrivateUrl(PUBLIC_ID, { expiresInSec: 30 });
    const expiresAt = Number(url.match(/expires_at=(\d+)/)[1]);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 - 2);
    expect(expiresAt).toBeLessThanOrEqual(before + 30 + 5);
  });
});
