/**
 * Behaviour tests for the per-user write limiters on the farm + crop-cycle
 * routes — the limiters that were previously no-op passthroughs
 * (`const writeLimit = (_req,_res,next) => next() // rate limit disabled`).
 *
 * These mirror the exact rateLimiter() configs in farm.routes.js and
 * farmCropCycle.routes.js: the Redis-backed sliding window (with in-memory
 * fallback, exercised here) keyed on the authenticated user id. Driven on a
 * minimal app so the cap can be exceeded deterministically without the
 * DB-backed routes.
 *
 * Acceptance: excess writes return 429 with Retry-After; the budget is
 * per-user (a second user is unaffected) — i.e. the shared store throttles
 * consistently rather than letting writes through unbounded.
 */
import express from 'express';
import request from 'supertest';
import { rateLimiter, resetRateLimitStore } from '../../../src/middleware/rateLimit.js';

// Same config objects the real routes use (kept in sync with the route files).
const FARM_WRITE  = { windowMs: 15 * 60 * 1000, max: 40,  prefix: 'farm:write' };
const CYCLE_WRITE = { windowMs: 15 * 60 * 1000, max: 120, prefix: 'cycle:write' };

// Minimal app that fakes auth (req.user from header) and applies the limiter
// exactly as the route does: keyed on user id, IP fallback.
function buildApp(cfg) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] || 'u1' }; next(); });
  app.use(rateLimiter({ ...cfg, key: (req) => req.user?.id || req.ip }));
  app.post('/write', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('farm + crop-cycle per-user write limiter', () => {
  beforeEach(() => resetRateLimitStore());

  test('farm writes past the cap return 429 (+ Retry-After)', async () => {
    const app = buildApp(FARM_WRITE);
    const statuses = [];
    let limited;
    for (let i = 0; i < FARM_WRITE.max + 2; i++) {
      const res = await request(app).post('/write').send({ farmName: `Plot ${i}` });
      statuses.push(res.status);
      if (res.status === 429) limited = res;
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(FARM_WRITE.max); // first MAX pass
    expect(statuses).toContain(429);                                        // excess throttled
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.success).toBe(false);
  }, 20000);

  test('farm-write budget is per-user — a different user is unaffected', async () => {
    const app = buildApp(FARM_WRITE);
    for (let i = 0; i < FARM_WRITE.max; i++) {
      await request(app).post('/write').set('x-user', 'userA').send({ farmName: `A${i}` });
    }
    const blockedA = await request(app).post('/write').set('x-user', 'userA').send({ farmName: 'A-extra' });
    expect(blockedA.status).toBe(429);

    const userB = await request(app).post('/write').set('x-user', 'userB').send({ farmName: 'B1' });
    expect(userB.status).toBe(200);
  }, 20000);

  test('crop-cycle writes past the cap return 429', async () => {
    const app = buildApp(CYCLE_WRITE);
    let limited;
    for (let i = 0; i < CYCLE_WRITE.max + 1; i++) {
      const res = await request(app).post('/write').send({ productName: `Urea ${i}` });
      if (res.status === 429) limited = res;
    }
    expect(limited).toBeDefined();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  }, 30000);
});
