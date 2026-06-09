/**
 * Tests for the Redis-down behaviour of the security-critical AI cost limiter
 * (middleware/redisRateLimit.js) and the explicit health snapshot
 * (config/redis.js — CACHE-9).
 *
 * Under the test suite Redis is never connected (lazyConnect, no .connect()), so
 * redis.status is not 'ready' — i.e. these tests run in the exact "Redis
 * unavailable" state the production fix targets.
 *
 * Acceptance: with failClosed the limiter REJECTS (503) when Redis is down rather
 * than silently allowing unlimited requests; without it, it fails open. The health
 * snapshot reports the connection as unhealthy with a usable status.
 */
import express from 'express';
import request from 'supertest';
import { redisRateLimit } from '../../../src/middleware/redisRateLimit.js';
import { getRedisHealth, isRedisHealthy } from '../../../src/config/redis.js';

function buildApp(opts) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
  app.post('/ai', redisRateLimit(opts), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('redisRateLimit — Redis unavailable', () => {
  test('failClosed: true → rejects with 503 + Retry-After (no silent allow)', async () => {
    const app = buildApp({ prefix: 'test:ai', failClosed: true });
    const res = await request(app).post('/ai').send({});
    expect(res.status).toBe(503);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.success).toBe(false);
  });

  test('failClosed: false → fails open (request proceeds)', async () => {
    const app = buildApp({ prefix: 'test:ai', failClosed: false });
    const res = await request(app).post('/ai').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('getRedisHealth (CACHE-9)', () => {
  test('reports an unhealthy snapshot with a usable shape when Redis is down', () => {
    const h = getRedisHealth();
    expect(h.healthy).toBe(false);
    expect(isRedisHealthy()).toBe(false);
    expect(typeof h.status).toBe('string');     // ioredis connection status string
    expect(h).toHaveProperty('downSince');
    expect(h).toHaveProperty('lastError');
    expect(h).toHaveProperty('everReady');
  });
});
