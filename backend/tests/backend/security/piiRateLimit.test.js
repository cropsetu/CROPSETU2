/**
 * Behaviour tests for the dedicated per-user SENSITIVE-PII update limiter.
 *
 * Mirrors how user.routes.js configures `piiUpdateLimit`: the rateLimiter
 * middleware keyed on the user id, but only counting requests that actually
 * carry a sensitive-PII field (isSensitivePiiUpdate). Driven on a minimal app
 * so we can exceed the cap deterministically without the DB-backed routes.
 *
 * Acceptance: excess PII updates return 429; benign (non-PII) edits are not
 * counted; the budget is per-user.
 */
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { rateLimiter, resetRateLimitStore } from '../../../src/middleware/rateLimit.js';
import { isSensitivePiiUpdate, SENSITIVE_PII_FIELDS } from '../../../src/constants/pii.js';

const MAX = 5;

// Build a minimal app that fakes auth (req.user from header) and applies the
// same PII limiter config the real route uses.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] || 'u1' }; next(); });
  app.use(rateLimiter({
    windowMs: 60_000,
    max: MAX,
    prefix: 'test:pii',
    message: 'Too many updates to sensitive details.',
    key: (req) => (req.user?.id && isSensitivePiiUpdate(req.body) ? req.user.id : null),
  }));
  app.put('/me', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('isSensitivePiiUpdate', () => {
  test('detects a real sensitive-PII change', () => {
    expect(isSensitivePiiUpdate({ aadharNumber: '123456789012' })).toBe(true);
    expect(isSensitivePiiUpdate({ bankAccountNumber: '00011122233' })).toBe(true);
    expect(isSensitivePiiUpdate({ gstNumber: '27ABCDE1234F1Z5' })).toBe(true);
  });

  test('ignores absent / empty values', () => {
    expect(isSensitivePiiUpdate({ name: 'Asha' })).toBe(false);
    expect(isSensitivePiiUpdate({ aadharNumber: '' })).toBe(false);
    expect(isSensitivePiiUpdate({ panNumber: null })).toBe(false);
    expect(isSensitivePiiUpdate({})).toBe(false);
    expect(isSensitivePiiUpdate(undefined)).toBe(false);
  });

  test('covers the documented sensitive fields', () => {
    expect(SENSITIVE_PII_FIELDS).toEqual(
      expect.arrayContaining(['aadharNumber', 'panNumber', 'bankAccountNumber', 'gstNumber', 'dateOfBirth']),
    );
  });
});

describe('per-user sensitive-PII rate limit', () => {
  beforeEach(() => resetRateLimitStore());

  test('excess PII updates return 429 (+ Retry-After)', async () => {
    const app = buildApp();
    const statuses = [];
    let limited;
    for (let i = 0; i < MAX + 2; i++) {
      const res = await request(app).put('/me').send({ aadharNumber: '123456789012' });
      statuses.push(res.status);
      if (res.status === 429) limited = res;
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(MAX); // first MAX pass
    expect(statuses).toContain(429);                              // excess throttled
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.success).toBe(false);
  }, 20000);

  test('benign (non-PII) edits are NOT counted by the PII limiter', async () => {
    const app = buildApp();
    // Far exceed the cap with name-only edits → all pass (limiter skips them).
    for (let i = 0; i < MAX + 5; i++) {
      const res = await request(app).put('/me').send({ name: `Asha ${i}` });
      expect(res.status).toBe(200);
    }
    // A PII update still has its full budget afterwards.
    const pii = await request(app).put('/me').send({ panNumber: 'ABCDE1234F' });
    expect(pii.status).toBe(200);
  });

  test('budget is per-user — a different user is unaffected', async () => {
    const app = buildApp();
    for (let i = 0; i < MAX + 1; i++) {
      await request(app).put('/me').set('x-user', 'userA').send({ aadharNumber: '123456789012' });
    }
    const blockedA = await request(app).put('/me').set('x-user', 'userA').send({ aadharNumber: '123456789012' });
    expect(blockedA.status).toBe(429);

    const userB = await request(app).put('/me').set('x-user', 'userB').send({ aadharNumber: '999999999999' });
    expect(userB.status).toBe(200);
  });
});
