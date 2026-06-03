/**
 * API tests for /api/v1/auth/*
 * Tests: OTP flow, token refresh, logout, rate limiting, security
 */
import request from 'supertest';
import { getApp, cleanupTestData, prisma } from '../../fixtures/setup.js';
import { resetRateLimitStore } from '../../../src/middleware/rateLimit.js';
import { ENV } from '../../../src/config/env.js';

let app;

beforeAll(async () => {
  app = await getApp();
});

// Reset rate-limit counters between tests so per-IP verify/send counts from one
// test don't leak into the next (they share an in-memory store + 60s window).
beforeEach(() => {
  resetRateLimitStore();
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

describe('OTP brute-force account lockout', () => {
  test('423 with Retry-After after N failed verifications', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });

    let lockedRes;
    // One more than the threshold to be sure the lock has tripped.
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phone, otp: '111111' }); // always wrong
      if (res.status === 423) { lockedRes = res; break; }
    }

    expect(lockedRes).toBeDefined();
    expect(lockedRes.status).toBe(423);
    expect(Number(lockedRes.headers['retry-after'])).toBeGreaterThan(0);
    expect(lockedRes.body.success).toBe(false);
    expect(lockedRes.body.error.details.retryAfter).toBeGreaterThan(0);
  }, 30000);

  test('while locked, even the correct OTP is rejected with 423', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });

    // Trip the lock with wrong OTPs.
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '111111' });
    }

    // The dev-bypass correct OTP must NOT get through while locked.
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    expect(res.status).toBe(423);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  }, 30000);
});

describe('OTP verify rate limiting & short code TTL', () => {
  test('excess verify attempts return 429 with Retry-After', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });

    let limited;
    for (let i = 0; i < ENV.OTP_VERIFY_RATE_LIMIT_MAX + 3; i++) {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phone, otp: '111111' }); // always wrong
      if (res.status === 429) { limited = res; break; }
    }

    expect(limited).toBeDefined();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.error.details.retryAfter).toBeGreaterThan(0);
  }, 30000);

  test('an expired OTP code is rejected (short TTL enforced)', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    // Seed an already-expired session directly (TTL elapsed).
    await prisma.otpSession.create({
      data: { phone, otp: 'expired-placeholder', expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired|not found/i);
  });

  test('OTP TTL is configured to a short window', () => {
    expect(ENV.OTP_EXPIRE_MINUTES).toBeGreaterThan(0);
    expect(ENV.OTP_EXPIRE_MINUTES).toBeLessThanOrEqual(10);
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

describe('Refresh token rotation & reuse detection', () => {
  let userId, tokenA;

  beforeAll(async () => {
    const phone = `7${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });
    userId = res.body.data.user.id;
    tokenA = res.body.data.refreshToken;
  });

  test('rotation issues a new token and replaying the old one burns the whole family', async () => {
    // 1. Rotate A → B
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken: tokenA });
    expect(r1.status).toBe(200);
    const tokenB = r1.body.data.refreshToken;
    expect(tokenB).toBeDefined();
    expect(tokenB).not.toBe(tokenA);

    // 2. Replay the now-spent token A → reuse detected → 401
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken: tokenA });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.message).toMatch(/reuse/i);

    // 3. The successor B must ALSO be invalid now — the leak revoked the lineage.
    const afterBurn = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken: tokenB });
    expect(afterBurn.status).toBe(401);
  }, 30000);
});

describe('Token invalidation on phone change', () => {
  test('previously issued tokens are rejected after a phone change', async () => {
    // 1. Register with the original number → real access/refresh tokens.
    const oldPhone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone: oldPhone });
    const reg = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: oldPhone, otp: '000000' });
    expect(reg.status).toBe(201);
    const oldAccess = reg.body.data.accessToken;

    // Sanity: the freshly issued token works.
    const before = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${oldAccess}`);
    expect(before.status).toBe(200);

    // 2. Change the phone number (OTP proves control of the new number).
    const newPhone = `8${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone: newPhone });
    const change = await request(app)
      .post('/api/v1/auth/change-phone')
      .set('Authorization', `Bearer ${oldAccess}`)
      .send({ newPhone, otp: '000000' });
    expect(change.status).toBe(200);
    const newAccess = change.body.data.accessToken;
    expect(newAccess).toBeDefined();

    // 3. The OLD token is now rejected (stale token version).
    const after = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${oldAccess}`);
    expect(after.status).toBe(401);

    // 4. The newly issued token still works.
    const withNew = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${newAccess}`);
    expect(withNew.status).toBe(200);
    expect(withNew.body.data.phone).toBe(newPhone);
  }, 30000);
});

describe('Web cookie auth transport (httpOnly refresh token)', () => {
  test('verify-otp (web) sets an httpOnly refresh cookie and keeps the token out of the body', async () => {
    const agent = request.agent(app);
    const phone = `9${String(Date.now()).slice(-9)}`;
    await agent.post('/api/v1/auth/send-otp').set('X-Auth-Transport', 'cookie').send({ phone });

    const res = await agent
      .post('/api/v1/auth/verify-otp')
      .set('X-Auth-Transport', 'cookie')
      .send({ phone, otp: '000000' });

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeDefined();
    // The refresh token must NOT be in JS-readable storage / response body.
    expect(res.body.data.refreshToken).toBeUndefined();
    // A CSRF token IS returned (for the double-submit header).
    expect(res.body.data.csrfToken).toBeDefined();

    // The refresh token must be delivered as an httpOnly cookie instead.
    const setCookie = (res.headers['set-cookie'] || []).join(' ; ');
    expect(setCookie).toMatch(/(^|\W)rt=/);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  test('refresh (web) reads the cookie, returns a fresh access token, no body refresh token', async () => {
    const agent = request.agent(app);
    const phone = `9${String(Date.now()).slice(-9)}`;
    await agent.post('/api/v1/auth/send-otp').set('X-Auth-Transport', 'cookie').send({ phone });
    const login = await agent.post('/api/v1/auth/verify-otp').set('X-Auth-Transport', 'cookie').send({ phone, otp: '000000' });
    const csrf = login.body.data.csrfToken;

    // No body — the agent replays the httpOnly cookie automatically (survives
    // "reload"). The CSRF token must be echoed in the header.
    const res = await agent
      .post('/api/v1/auth/refresh')
      .set('X-Auth-Transport', 'cookie')
      .set('X-CSRF-Token', csrf)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    // Cookie + CSRF token are rotated on every refresh.
    const setCookie = (res.headers['set-cookie'] || []).join(' ; ');
    expect(setCookie).toMatch(/(^|\W)rt=/);
    expect(res.body.data.csrfToken).toBeDefined();
  });

  test('CSRF: a cookie-auth mutation without a valid CSRF token is rejected (403)', async () => {
    const agent = request.agent(app);
    const phone = `9${String(Date.now()).slice(-9)}`;
    await agent.post('/api/v1/auth/send-otp').set('X-Auth-Transport', 'cookie').send({ phone });
    const login = await agent.post('/api/v1/auth/verify-otp').set('X-Auth-Transport', 'cookie').send({ phone, otp: '000000' });
    const csrf = login.body.data.csrfToken;

    // Cookie present (agent replays it) but NO X-CSRF-Token header → rejected.
    const missing = await agent
      .post('/api/v1/auth/refresh')
      .set('X-Auth-Transport', 'cookie')
      .send({});
    expect(missing.status).toBe(403);

    // Wrong token → rejected.
    const wrong = await agent
      .post('/api/v1/auth/refresh')
      .set('X-Auth-Transport', 'cookie')
      .set('X-CSRF-Token', 'not-the-real-token')
      .send({});
    expect(wrong.status).toBe(403);

    // Correct token → allowed.
    const ok = await agent
      .post('/api/v1/auth/refresh')
      .set('X-Auth-Transport', 'cookie')
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(ok.status).toBe(200);
  });

  test('mobile mutations (Bearer, no cookie) are exempt from CSRF', async () => {
    // Sanity: the bearer-token path must not require a CSRF token, or the whole
    // mobile app + test suite would break.
    const phone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const reg = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '000000' });
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId: reg.body.data.user.id, refreshToken: reg.body.data.refreshToken });
    expect(res.status).toBe(200); // no CSRF token sent, still works
  });

  test('mobile (no transport header) still receives body tokens, no cookie', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone, otp: '000000' });

    expect(res.status).toBe(201);
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('Server-side session timeout', () => {
  async function login() {
    // Unique 10-digit Indian mobile (starts 9) so sessions don't collide.
    const phone = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const reg = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '000000' });
    return { userId: reg.body.data.user.id, refreshToken: reg.body.data.refreshToken };
  }

  test('active session within both windows refreshes normally', async () => {
    const { userId, refreshToken } = await login();
    const res = await request(app).post('/api/v1/auth/refresh').send({ userId, refreshToken });
    expect(res.status).toBe(200);
  });

  test('idle timeout: a session idle past the window cannot refresh', async () => {
    const { userId, refreshToken } = await login();
    // Simulate inactivity: the sliding idle window has lapsed.
    await prisma.refreshToken.updateMany({
      where: { userId },
      data:  { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post('/api/v1/auth/refresh').send({ userId, refreshToken });
    expect(res.status).toBe(401);
  });

  test('absolute timeout: a session older than the cap cannot refresh (even if active)', async () => {
    const { userId, refreshToken } = await login();
    // Session started before the absolute cap, but expiresAt is still in the
    // future (NOT idle) — only the absolute timeout should reject it.
    const longAgo = new Date(Date.now() - (ENV.SESSION_ABSOLUTE_TIMEOUT_DAYS + 1) * 86_400_000);
    await prisma.refreshToken.updateMany({
      where: { userId },
      data:  { sessionStartedAt: longAgo },
    });

    const res = await request(app).post('/api/v1/auth/refresh').send({ userId, refreshToken });
    expect(res.status).toBe(401);
  });

  test('session start is preserved across rotation (absolute cap stays anchored)', async () => {
    const { userId, refreshToken } = await login();
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ userId, refreshToken });
    expect(r1.status).toBe(200);

    // The rotated successor must inherit the original session start.
    const rows = await prisma.refreshToken.findMany({
      where:  { userId },
      select: { sessionStartedAt: true },
    });
    const starts = new Set(rows.map((r) => r.sessionStartedAt?.toISOString()));
    expect(starts.size).toBe(1);
  });
});

describe('Concurrent session limit', () => {
  test('logging in beyond the cap evicts the oldest session', async () => {
    const phone = `9${String(Date.now()).slice(-9)}`;
    const cap = ENV.MAX_CONCURRENT_SESSIONS;

    // Log in cap+1 times → cap+1 sessions; the oldest must be evicted.
    const refreshTokens = [];
    let userId;
    for (let i = 0; i < cap + 1; i++) {
      // Each login needs a fresh OTP; reset the per-phone send limiter so the
      // loop isn't throttled (simulates logins spread over time).
      resetRateLimitStore();
      await request(app).post('/api/v1/auth/send-otp').send({ phone });
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phone, otp: '000000' });
      expect(res.status).toBe(201);
      refreshTokens.push(res.body.data.refreshToken);
      userId = res.body.data.user.id;
    }

    // Oldest session (first login) was evicted → its refresh token is dead.
    const oldest = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken: refreshTokens[0] });
    expect(oldest.status).toBe(401);

    // The newest session still refreshes fine.
    const newest = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ userId, refreshToken: refreshTokens[refreshTokens.length - 1] });
    expect(newest.status).toBe(200);

    // Exactly `cap` active sessions remain.
    const active = await prisma.refreshToken.count({
      where: { userId, rotatedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(active).toBe(cap);
  }, 30000);
});

describe('Authentication audit log', () => {
  const randPhone = () => `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;

  test('successful login is audited with actor, time, and outcome', async () => {
    const phone = randPhone();
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const reg = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '000000' });
    const userId = reg.body.data.user.id;

    const rows = await prisma.auditLog.findMany({
      where: { userId, action: 'AUTH_LOGIN', entity: 'Auth' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].userId).toBe(userId);                    // actor
    expect(rows[0].createdAt).toBeInstanceOf(Date);         // time
    expect(JSON.parse(rows[0].metadata).outcome).toBe('success'); // outcome
  });

  test('OTP failure is audited (anonymous actor, masked phone, no raw number)', async () => {
    const phone = randPhone();
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '111111' }); // wrong

    const masked = '*'.repeat(phone.length - 4) + phone.slice(-4);
    const rows = await prisma.auditLog.findMany({
      where: { action: 'AUTH_OTP_FAILURE', entity: 'Auth' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const mine = rows.find((r) => JSON.parse(r.metadata || '{}').phone === masked);

    expect(mine).toBeDefined();
    expect(mine.userId).toBe('anonymous');
    expect(JSON.parse(mine.metadata).outcome).toBe('failure');
    expect(mine.metadata).not.toContain(phone); // raw number never stored
  });

  test('logout is audited', async () => {
    const phone = randPhone();
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const reg = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '000000' });
    const { accessToken, refreshToken, user } = reg.body.data;

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    const rows = await prisma.auditLog.findMany({ where: { userId: user.id, action: 'AUTH_LOGOUT' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test('token rotation (refresh) is audited', async () => {
    const phone = randPhone();
    await request(app).post('/api/v1/auth/send-otp').send({ phone });
    const reg = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '000000' });
    const { refreshToken, user } = reg.body.data;

    await request(app).post('/api/v1/auth/refresh').send({ userId: user.id, refreshToken });

    const rows = await prisma.auditLog.findMany({ where: { userId: user.id, action: 'AUTH_TOKEN_REFRESH' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
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
