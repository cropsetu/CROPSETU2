/**
 * Unit tests for the account-erasure (DPDP §8) helpers.
 *   - anonymizedUserFields(): the User-row PII scrub patch
 *   - publicIdFromUrl(): Cloudinary public_id extraction used to purge media
 *
 * These cover the pure logic without touching the DB or Cloudinary network.
 */
import { jest } from '@jest/globals';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // env.js requires this at import

const { anonymizedUserFields, ANON_NAME } =
  await import('../../../src/services/erasure.service.js');
const { publicIdFromUrl } =
  await import('../../../src/config/cloudinary.js');

describe('anonymizedUserFields', () => {
  const USER_ID = 'user-123';
  const patch = anonymizedUserFields(USER_ID);

  test('replaces phone with a unique, non-loginable sentinel', () => {
    expect(patch.phone).toBe('deleted_user-123');
    // sentinel is not a valid 10-digit phone → cannot be used to request an OTP
    expect(/^\d{10}$/.test(patch.phone)).toBe(false);
  });

  test('clears every PII field', () => {
    const piiFields = [
      'avatar', 'statusQuote',
      'pincode', 'district', 'city', 'state', 'taluka', 'village', 'lat', 'lng',
      'gstNumber', 'aadhaarLast4', 'annualHouseholdIncome',
      'dateOfBirth', 'dependents', 'familySize', 'education', 'gender',
      'preferredContactMethod', 'preferredMandi', 'businessType', 'activeFarmId',
    ];
    for (const f of piiFields) {
      expect(patch[f]).toBeNull();
    }
  });

  test('name becomes the anonymous placeholder', () => {
    expect(patch.name).toBe(ANON_NAME);
    expect(patch.name).toBe('Deleted User');
  });

  test('deactivates the account', () => {
    expect(patch.isActive).toBe(false);
    expect(patch.isOnline).toBe(false);
    expect(patch.gstOptOut).toBe(false);
  });

  test('increments tokenVersion to revoke outstanding JWTs', () => {
    expect(patch.tokenVersion).toEqual({ increment: 1 });
  });

  test('does not retain the original PII anywhere in the patch', () => {
    // No field should carry a real-looking phone/aadhaar value.
    const serialized = JSON.stringify(patch);
    expect(serialized).not.toMatch(/\b\d{10,12}\b/);
  });
});

describe('publicIdFromUrl', () => {
  test('extracts public_id from a public upload secure_url (drops version + ext)', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1700000000/farmeasy/avatars/abc123.jpg';
    expect(publicIdFromUrl(url)).toBe('farmeasy/avatars/abc123');
  });

  test('handles authenticated delivery URLs', () => {
    const url = 'https://res.cloudinary.com/demo/image/authenticated/v123/farmeasy/kyc/u1/doc.jpg';
    expect(publicIdFromUrl(url)).toBe('farmeasy/kyc/u1/doc');
  });

  test('handles nested folders and no version segment', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/farmeasy/scans/u9/x.png';
    expect(publicIdFromUrl(url)).toBe('farmeasy/scans/u9/x');
  });

  test('returns null for non-Cloudinary strings (e.g. raw KYC public_ids)', () => {
    expect(publicIdFromUrl('farmeasy/kyc/u1/doc1')).toBeNull(); // already a public_id
    expect(publicIdFromUrl('https://example.com/foo.jpg')).toBeNull();
    expect(publicIdFromUrl('')).toBeNull();
    expect(publicIdFromUrl(null)).toBeNull();
    expect(publicIdFromUrl(undefined)).toBeNull();
  });
});
