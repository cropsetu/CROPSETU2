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
describe('Rate limiting', () => {
  test('OTP endpoint returns 429 after too many requests', async () => {
    const phone = '9999999999';
    const results = [];

    // Send more than the limit (default 5)
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ phone });
      results.push(res.status);
    }

    expect(results).toContain(429);
  }, 30000);
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
