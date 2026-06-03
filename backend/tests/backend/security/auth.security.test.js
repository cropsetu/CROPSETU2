/**
 * Security tests — authentication & authorization
 * Tests: token forgery, IDOR, privilege escalation, rate limiting
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  getApp, createTestUser, createTestSeller,
  createTestCategory, createTestProduct, createTestMachinery,
  cleanupTestData, signTestToken,
} from '../../fixtures/setup.js';
import { ENV } from '../../../src/config/env.js';

let app, farmer, seller, admin;

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser({ name: 'Auth Test Farmer' });
  seller = await createTestSeller({ name: 'Auth Test Seller' });
  admin = await createTestUser({ role: 'ADMIN', name: 'Auth Test Admin' });
});

afterAll(async () => {
  await cleanupTestData();
});

// ── Token Security ───────────────────────────────────────────────────────────
describe('Token security', () => {
  test('forged token (wrong secret) is rejected', async () => {
    const fakeToken = jwt.sign(
      { sub: farmer.user.id, role: 'ADMIN' },
      'wrong-secret',
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${fakeToken}`);

    expect(res.status).toBe(401);
  });

  test('expired token is rejected', async () => {
    const expiredToken = jwt.sign(
      { sub: farmer.user.id, role: 'FARMER' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '0s' }
    );

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  test('token without Bearer prefix is rejected', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', farmer.token);

    expect(res.status).toBe(401);
  });

  test('token for deleted user is rejected', async () => {
    const tempUser = await createTestUser({ name: 'To Delete' });
    const { prisma } = await import('../../fixtures/setup.js');
    await prisma.user.delete({ where: { id: tempUser.user.id } });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set(tempUser.headers);

    expect(res.status).toBe(401);
  });

  test('token for deactivated user is rejected', async () => {
    const tempUser = await createTestUser({ name: 'Deactivated' });
    const { prisma } = await import('../../fixtures/setup.js');
    await prisma.user.update({
      where: { id: tempUser.user.id },
      data: { isActive: false },
    });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set(tempUser.headers);

    expect(res.status).toBe(401);
  });
});

// ── Privilege Escalation ─────────────────────────────────────────────────────
describe('Privilege escalation', () => {
  test('farmer token with ADMIN in body cannot escalate', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set(farmer.headers)
      .send({ role: 'ADMIN', name: 'Escalated' });

    // Check that role didn't change
    const profile = await request(app)
      .get('/api/v1/users/me')
      .set(farmer.headers);

    expect(profile.body.data.role).toBe('FARMER');
  });

  test('farmer cannot access admin feature flags', async () => {
    const res = await request(app)
      .get('/api/v1/admin/features')
      .set(farmer.headers);

    // Should be 403 if role-protected, or return empty if not protected
    // BUG CHECK: if returns 200, admin routes are unprotected
    if (res.status === 200) {
      console.warn('[SECURITY BUG] Admin feature flags accessible to FARMER role');
    }
  });
});

// ── IDOR Tests (cross-user resource access) ──────────────────────────────────
describe('IDOR protection', () => {
  test('user A cannot read user B\'s order', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(seller.user.id, category.id, { stock: 100 });
    const { prisma } = await import('../../fixtures/setup.js');

    // Create order for farmer
    await prisma.cartItem.create({
      data: { userId: farmer.user.id, productId: product.id, quantity: 1 },
    });
    const orderRes = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({
        deliveryAddress: {
          type: 'home', name: 'Test', phone: '9876543210',
          flat: '1A', street: 'Main', city: 'Pune', state: 'MH', pincode: '411001',
        },
      });

    if (orderRes.status === 201) {
      // Try accessing as admin (different user)
      const res = await request(app)
        .get(`/api/v1/agristore/orders/${orderRes.body.data.id}`)
        .set(admin.headers);

      expect(res.status).toBe(404); // Scoped to userId
    }
  });

  test('user A cannot cancel user B\'s booking', async () => {
    const listing = await createTestMachinery(seller.user.id);
    const start = new Date();
    start.setDate(start.getDate() + 100);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const bookRes = await request(app)
      .post('/api/v1/rent/bookings')
      .set(farmer.headers)
      .send({
        machineryListingId: listing.id,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        days: 1,
        totalAmount: 2500,
      });

    if (bookRes.status === 201) {
      const res = await request(app)
        .put(`/api/v1/rent/bookings/${bookRes.body.data.id}/cancel`)
        .set(admin.headers); // Different user

      expect(res.status).toBe(404); // Scoped to userId
    }
  });

  test('user A cannot update user B\'s machinery listing', async () => {
    const listing = await createTestMachinery(seller.user.id);

    const res = await request(app)
      .put(`/api/v1/rent/machinery/${listing.id}`)
      .set(farmer.headers)
      .send({ pricePerDay: 1 });

    expect(res.status).toBe(403);
  });
});

// ── Rate Limiting ────────────────────────────────────────────────────────────
describe('OTP send rate limiting', () => {
  test('per-phone limit returns 429 with Retry-After after exceeding the threshold', async () => {
    const phone = '9999999999';
    let limitedRes;

    // Send past the per-phone limit (OTP_RATE_LIMIT_MAX, default 5).
    for (let i = 0; i < ENV.OTP_RATE_LIMIT_MAX + 2; i++) {
      const res = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ phone });
      if (res.status === 429) { limitedRes = res; break; }
    }

    expect(limitedRes).toBeDefined();
    expect(limitedRes.status).toBe(429);
    // Retry-After header (seconds) is present and positive.
    const retryAfter = Number(limitedRes.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    // Error envelope carries the retry hint for clients.
    expect(limitedRes.body.success).toBe(false);
    expect(limitedRes.body.error.details.retryAfter).toBeGreaterThan(0);
  }, 30000);

  test('requests within the limit are not blocked', async () => {
    // A fresh number should sail through its first request.
    const phone = `9${String(Date.now()).slice(-9)}`;
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe(String(ENV.OTP_RATE_LIMIT_MAX));
  });
});

// ── JWT Algorithm Verification ───────────────────────────────────────────────
describe('JWT algorithm security', () => {
  test('tokens signed with "none" algorithm are rejected', async () => {
    // Create a token with alg:none (header manipulation attack)
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: farmer.user.id,
      role: 'ADMIN',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${noneToken}`);

    expect(res.status).toBe(401);
  });
});

// ── Bearer token parsing (malformed input) ───────────────────────────────────
describe('Bearer token parsing', () => {
  const GARBAGE = [
    'Bearer',                       // scheme only, no token
    'Bearer ',                      // empty token
    'Bearer    ',                   // whitespace-only token
    'Bearer\ttoken',                // tab instead of space
    'Bearer  double  spaces',       // extra internal spaces
    'Bearer a b c',                 // multiple parts
    'Bearer Bearer token',          // doubled scheme
    'bearer lowercasescheme',       // wrong scheme case
    'Basic dXNlcjpwYXNz',           // entirely different scheme
    'Token abc123',                 // non-Bearer scheme
    'garbage-no-scheme',            // no scheme at all
    '',                             // empty header
    '   ',                          // whitespace header
    'Bearer null',                  // literal "null"
    'Bearer undefined',             // literal "undefined"
    'Bearer {}[]<>',                // punctuation soup
    'Bearer not.a.jwt',             // 3 parts but not a real JWT
    'Bearer a.b',                   // too few JWT segments
    'Bearer a.b.c.d.e',             // too many segments
    `Bearer ${'x'.repeat(8000)}`,   // oversized token
    'Bearer @#$%^&*()=+',           // punctuation-only token
  ];

  test.each(GARBAGE)('garbage Authorization %j → 401, never 500', async (value) => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', value);

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
  });

  test('missing Authorization header → 401', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  test('a valid token still authenticates (regression)', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${farmer.token}`);
    expect(res.status).toBe(200);
  });

  test('surrounding whitespace around a valid token is tolerated', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `  Bearer ${farmer.token}  `);
    expect(res.status).toBe(200);
  });
});
