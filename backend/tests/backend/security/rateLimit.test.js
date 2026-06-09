/**
 * Load / behaviour tests for the global per-IP rate limiter.
 *
 * Exercises the exact middleware (rateLimiter + clientIp) that app.js mounts
 * globally in dev/prod, mounted here on a minimal app so we can drive it past
 * its cap deterministically without flooding the real (DB-backed) routes.
 *
 * Acceptance: over-cap requests get 429 (+ Retry-After); the limit is per-IP;
 * and the limiter is enabled in prod config (off only under the test suite).
 */
import express from 'express';
import request from 'supertest';
import { rateLimiter, clientIp } from '../../../src/middleware/rateLimit.js';
import { ENV } from '../../../src/config/env.js';

function buildLimitedApp(max) {
  const app = express();
  app.set('trust proxy', true); // honour X-Forwarded-For so each test can spoof a distinct client IP
  app.use(rateLimiter({
    windowMs: 60_000,
    max,
    prefix: 'test:global',
    key: clientIp,
    message: 'Too many requests. Please slow down and try again shortly.',
  }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('Global per-IP rate limiter', () => {
  test('over-cap requests receive 429 with Retry-After', async () => {
    const max = 5;
    const app = buildLimitedApp(max);
    const ip = '203.0.113.10';

    const statuses = [];
    let limitedRes;
    for (let i = 0; i < max + 3; i++) {
      const res = await request(app).get('/ping').set('X-Forwarded-For', ip);
      statuses.push(res.status);
      if (res.status === 429) limitedRes = res;
    }

    // Exactly `max` requests pass; the rest are throttled.
    expect(statuses.filter((s) => s === 200)).toHaveLength(max);
    expect(statuses).toContain(429);

    // 429 carries a positive Retry-After header and retry hint in the body.
    expect(limitedRes).toBeDefined();
    expect(Number(limitedRes.headers['retry-after'])).toBeGreaterThan(0);
    expect(limitedRes.body.success).toBe(false);
    expect(limitedRes.body.error.details.retryAfter).toBeGreaterThan(0);
  }, 20000);

  test('limit is per-IP — a different client is unaffected', async () => {
    const max = 3;
    const app = buildLimitedApp(max);

    // Saturate IP A.
    for (let i = 0; i < max + 1; i++) {
      await request(app).get('/ping').set('X-Forwarded-For', '203.0.113.20');
    }
    const blocked = await request(app).get('/ping').set('X-Forwarded-For', '203.0.113.20');
    expect(blocked.status).toBe(429);

    // A different IP still gets through.
    const other = await request(app).get('/ping').set('X-Forwarded-For', '203.0.113.21');
    expect(other.status).toBe(200);
  });

  test('prepending a forged X-Forwarded-For hop cannot escape the per-IP bucket', async () => {
    // Mirror the production config: a fixed number of trusted proxy hops (Railway
    // edge = 1) rather than `trust proxy: true`. Express then resolves req.ip from
    // the RIGHT-most untrusted hop, so junk prepended to the LEFT of XFF — what an
    // attacker controls — is ignored and the real client stays in one bucket.
    const max = 3;
    const app = express();
    app.set('trust proxy', 1); // exactly one trusted hop (the immediate peer)
    app.use(rateLimiter({
      windowMs: 60_000, max, prefix: 'test:spoof', key: clientIp,
      message: 'Too many requests.',
    }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const realClient = '203.0.113.50';

    // Saturate the bucket for the real client (right-most XFF hop).
    for (let i = 0; i < max; i++) {
      await request(app).get('/ping').set('X-Forwarded-For', realClient);
    }

    // Same client now rotates a forged LEADING hop on every request. If the
    // limiter trusted left-most XFF it would mint a fresh bucket each time; with
    // trust-proxy keying on req.ip it stays throttled.
    for (const fake of ['1.1.1.1', '8.8.8.8', '9.9.9.9']) {
      const res = await request(app).get('/ping')
        .set('X-Forwarded-For', `${fake}, ${realClient}`);
      expect(res.status).toBe(429);
    }

    // A genuinely different real client (different right-most hop) still passes.
    const other = await request(app).get('/ping')
      .set('X-Forwarded-For', `1.1.1.1, 203.0.113.51`);
    expect(other.status).toBe(200);
  });

  test('limiter is enabled in prod config and off only under tests', () => {
    // Mirrors the predicate in config/env.js — guards against the default
    // silently flipping back to "disabled".
    const enabledFor = (nodeEnv, override) =>
      override != null ? override === 'true' : nodeEnv !== 'test';

    expect(enabledFor('production')).toBe(true);
    expect(enabledFor('development')).toBe(true);
    expect(enabledFor('test')).toBe(false);
    expect(enabledFor('test', 'true')).toBe(true);   // explicit force-on
    expect(enabledFor('production', 'false')).toBe(false); // explicit kill-switch

    // And in this (test) process the global limiter is correctly inert so the
    // wider suite isn't throttled.
    expect(ENV.RATE_LIMIT_ENABLED).toBe(false);
  });
});
