/**
 * Max-length enforcement tests for free-text fields.
 *
 * Acceptance for this finding: over-length inputs are rejected (400). The maxLen
 * builder produces express-validator chains; we mount them + the shared validate
 * middleware on a minimal app (no DB/auth) and assert the boundary behaviour.
 */
import express from 'express';
import request from 'supertest';
import { validate } from '../../../src/middleware/validate.js';
import { maxLen } from '../../../src/middleware/textLength.js';

function appFor(limits) {
  const app = express();
  app.use(express.json());
  app.post('/t', maxLen(limits), validate, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('maxLen — free-text length caps', () => {
  const app = appFor({ name: 150, description: 5000 });

  test('over-length field → 400', async () => {
    const res = await request(app).post('/t').send({ name: 'x'.repeat(151) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/name must be at most 150 characters/);
  });

  test('value exactly at the cap → 200', async () => {
    const res = await request(app).post('/t').send({ name: 'x'.repeat(150) });
    expect(res.status).toBe(200);
  });

  test('long description over its own (larger) cap → 400', async () => {
    const res = await request(app).post('/t').send({ description: 'd'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/description must be at most 5000 characters/);
  });

  test('absent / empty fields are allowed (cap is a ceiling, not a requirement)', async () => {
    expect((await request(app).post('/t').send({})).status).toBe(200);
    expect((await request(app).post('/t').send({ name: '' })).status).toBe(200);
  });

  test('normal-sized values pass', async () => {
    const res = await request(app).post('/t').send({ name: 'Mahindra Tractor', description: 'Good condition, 2019 model.' });
    expect(res.status).toBe(200);
  });

  test('a ~100KB single field is rejected before it can bloat storage', async () => {
    const res = await request(app).post('/t').send({ description: 'A'.repeat(100_000) });
    expect(res.status).toBe(400);
  });
});
