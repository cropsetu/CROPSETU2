/**
 * API tests for /api/v1/users/*
 * Covers: profile, seller profile, farm details, push tokens, PII masking
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller,
  cleanupTestData, prisma,
} from '../../fixtures/setup.js';
import { XSS_PAYLOADS } from '../../fixtures/factories.js';

let app;
let farmer, seller;

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser();
  seller = await createTestSeller();
});

afterAll(async () => {
  await cleanupTestData();
});

// ── GET /me ──────────────────────────────────────────────────────────────────
describe('GET /api/v1/users/me', () => {
  test('200 — returns authenticated user profile', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set(farmer.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(farmer.user.id);
    expect(res.body.data.phone).toBe(farmer.user.phone);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  test('401 — invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer invalid-token-here');
    expect(res.status).toBe(401);
  });

  test('PII masking — Aadhaar, bank account, PAN are masked in response', async () => {
    // Set up seller profile with PII
    await request(app)
      .put('/api/v1/users/me')
      .set(seller.headers)
      .send({
        aadharNumber: '123456789012',
        panNumber: 'ABCDE1234F',
        bankAccountNumber: '12345678901234',
        bankIfsc: 'SBIN0012345',
        bankHolderName: 'Test Seller',
        bankName: 'SBI',
      });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set(seller.headers);

    expect(res.status).toBe(200);

    if (res.body.data.sellerProfile) {
      const sp = res.body.data.sellerProfile;
      // Should be masked
      if (sp.aadharNumber) {
        expect(sp.aadharNumber).toContain('••••');
        expect(sp.aadharNumber).not.toBe('123456789012');
      }
      if (sp.bankAccountNumber) {
        expect(sp.bankAccountNumber).toContain('••••');
        expect(sp.bankAccountNumber).not.toBe('12345678901234');
      }
      if (sp.panNumber) {
        expect(sp.panNumber).toContain('•••');
        expect(sp.panNumber).not.toBe('ABCDE1234F');
      }
    }
  });

  test('response does not contain password hashes or internal IDs', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set(farmer.headers);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('$2b$'); // bcrypt prefix
    expect(body).not.toContain('password');
    expect(body).not.toContain('otpSession');
  });
});

// ── PUT /me ──────────────────────────────────────────────────────────────────
describe('PUT /api/v1/users/me', () => {
  test('200 — update name', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ name: 'Updated Farmer' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Farmer');
  });

  test('200 — update location fields', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({
        district: 'Nashik',
        taluka: 'Dindori',
        village: 'Vani',
        pincode: '422305',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.district).toBe('Nashik');
  });

  test('422 — invalid pincode (not 6 digits)', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ pincode: '1234' });

    expect(res.status).toBe(422);
  });

  test('422 — invalid language', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ language: 'french' });

    expect(res.status).toBe(422);
  });

  test('422 — invalid GST format', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ gstNumber: 'INVALID_GST' });

    expect(res.status).toBe(422);
  });

  test('200 — valid GST number accepted', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ gstNumber: '27ABCDE1234F1Z5' });

    expect(res.status).toBe(200);
  });

  test('200 — gstOptOut clears gstNumber', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ gstOptOut: true, gstNumber: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.gstOptOut).toBe(true);
  });

  test('422 — invalid Aadhaar (not 12 digits)', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ aadharNumber: '12345' });

    expect(res.status).toBe(422);
  });

  test('422 — invalid IFSC format', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ bankIfsc: 'NOTVALID' });

    expect(res.status).toBe(422);
  });

  test('XSS — HTML stripped from name', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ name: '<script>alert(1)</script>Farmer' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).not.toContain('<script>');
    expect(res.body.data.name).toContain('Farmer');
  });

  test('XSS — HTML stripped from statusQuote', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ statusQuote: '<img src=x onerror=alert(1)>Hello' });

    expect(res.status).toBe(200);
    expect(res.body.data.statusQuote).not.toContain('<img');
  });

  test('mass assignment — role field is ignored', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ name: 'Hacker', role: 'ADMIN' });

    expect(res.status).toBe(200);
    // Role should NOT change
    const profile = await request(app)
      .get('/api/v1/users/me')
      .set(farmer.headers);

    expect(profile.body.data.role).toBe('FARMER');
  });

  test('400 — no fields to update', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── PUT /me/farm ─────────────────────────────────────────────────────────────
describe('PUT /api/v1/users/me/farm', () => {
  test('200 — create/update farm details', async () => {
    const res = await request(app)
      .put('/api/v1/users/me/farm')
      .set(farmer.headers)
      .send({
        village: 'Shrigonda',
        district: 'Ahmednagar',
        landAcres: 5.5,
        cropTypes: ['Wheat', 'Soybean'],
        soilType: 'Black',
        irrigationType: 'Drip',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.landAcres).toBe(5.5);
    expect(res.body.data.cropTypes).toContain('Wheat');
  });

  test('422 — cropTypes with more than 20 items', async () => {
    const crops = Array.from({ length: 21 }, (_, i) => `Crop${i}`);
    const res = await request(app)
      .put('/api/v1/users/me/farm')
      .set(farmer.headers)
      .send({ cropTypes: crops });

    expect(res.status).toBe(422);
  });

  test('422 — negative landAcres', async () => {
    const res = await request(app)
      .put('/api/v1/users/me/farm')
      .set(farmer.headers)
      .send({ landAcres: -10 });

    expect(res.status).toBe(422);
  });
});

// ── POST /me/push-token ──────────────────────────────────────────────────────
describe('POST /api/v1/users/me/push-token', () => {
  test('200 — valid Expo push token', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/push-token')
      .set(farmer.headers)
      .send({
        token: 'ExponentPushToken[xxxxxx-test-token]',
        platform: 'android',
      });

    expect(res.status).toBe(200);
  });

  test('422 — invalid token format', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/push-token')
      .set(farmer.headers)
      .send({ token: 'not-a-push-token', platform: 'ios' });

    expect(res.status).toBe(422);
  });

  test('422 — invalid platform', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/push-token')
      .set(farmer.headers)
      .send({
        token: 'ExponentPushToken[valid-token]',
        platform: 'windows',
      });

    expect(res.status).toBe(422);
  });
});

// ── Profile write rate limiting (M1) ──────────────────────────────────────────
describe('Profile write rate limiting', () => {
  test('429 with Retry-After after exceeding the per-user write cap (20 / 15 min)', async () => {
    // Fresh user so its quota is independent of the shared farmer/seller above.
    const { headers } = await createTestUser();

    let limitedRes;
    for (let i = 0; i < 22; i++) {
      const res = await request(app)
        .put('/api/v1/users/me')
        .set(headers)
        .send({ name: `Rate Test ${i}` });
      if (res.status === 429) { limitedRes = res; break; }
    }

    expect(limitedRes).toBeDefined();
    expect(limitedRes.status).toBe(429);
    expect(Number(limitedRes.headers['retry-after'])).toBeGreaterThan(0);
    expect(limitedRes.body.success).toBe(false);
    expect(limitedRes.body.error.details.retryAfter).toBeGreaterThan(0);
  }, 30000);

  test('a different user is not affected by another user hitting the cap', async () => {
    // The previous test saturated its own user; a brand-new user still writes.
    const { headers } = await createTestUser();
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(headers)
      .send({ name: 'Independent User' });

    expect(res.status).toBe(200);
  });
});
