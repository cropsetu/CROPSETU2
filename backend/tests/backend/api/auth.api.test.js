/**
 * API tests for /api/v1/auth/*
 * Tests: OTP flow, token refresh, logout, rate limiting, security
 */
import request from 'supertest';
import { getApp, cleanupTestData, prisma } from '../../fixtures/setup.js';

let app;

beforeAll(async () => {
  app = await getApp();
});

afterAll(async () => {
  await cleanupTestData();
});

describe('POST /api/v1/auth/send-otp', () => {
  test('200 — valid Indian phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '9876543210' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBeDefined();
  });

  test('422 — phone starting with 0-5 rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '1234567890' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('422 — phone with letters rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '98765abcde' });

    expect(res.status).toBe(422);
  });

  test('422 — phone with 9 digits rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '987654321' });

    expect(res.status).toBe(422);
  });

  test('422 — phone with 11 digits rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '98765432101' });

    expect(res.status).toBe(422);
  });

  test('422 — missing phone field', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({});

    expect(res.status).toBe(422);
  });

  test('security — SQL injection in phone field rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: "' OR 1=1--" });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/auth/verify-otp', () => {
  let phone;

  beforeEach(async () => {
    phone = `9${String(Date.now()).slice(-9)}`;
    await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone });
  });

  test('201 — valid OTP (dev bypass) creates new user + returns tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.isNewUser).toBe(true);
    expect(res.body.data.user.phone).toBe(phone);
  });

  test('201 — existing user returns isNewUser=false', async () => {
    // First verification creates the user
    await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    // Send new OTP
    await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone });

    // Second verification
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    expect(res.status).toBe(201);
    expect(res.body.data.isNewUser).toBe(false);
  });

  test('400 — wrong OTP', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '111111' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('422 — OTP with 5 digits rejected', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '12345' });

    expect(res.status).toBe(422);
  });

  test('422 — missing OTP', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone });

    expect(res.status).toBe(422);
  });

  test('response does NOT leak OTP hash or session details', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('otpSession');
    expect(body).not.toContain('$2b$'); // bcrypt hash prefix
  });
});

describe('POST /api/v1/auth/refresh', () => {
  let userId, refreshToken;

  beforeAll(async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });
    userId = res.body.data.user.id;
    refreshToken = res.body.data.refreshToken;
  });

  test('200 — valid refresh rotates tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    // New refresh token should be different
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  test('401 — old refresh token is invalidated after rotation', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken }); // old token from beforeAll

    expect(res.status).toBe(401);
  });

  test('401 — random refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken: 'totally-made-up-token' });

    expect(res.status).toBe(401);
  });

  test('422 — missing userId', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'something' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('200 — valid logout revokes token', async () => {
    // Create a fresh user
    const phone = `8${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    const { accessToken, refreshToken } = verifyRes.body.data;

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('Logged out');
  });

  test('401 — logout without auth header', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'something' });

    expect(res.status).toBe(401);
  });
});
