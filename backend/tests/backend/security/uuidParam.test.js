/**
 * UUID path-param validation tests.
 *
 * Acceptance for this finding: non-UUID id params return 400 (before any DB
 * access), instead of leaking a Prisma "malformed uuid" 500 or inviting
 * enumeration/timing probes. Mirrors how routers wire the guard:
 *   router.param('id', uuidParamGuard)
 */
import express from 'express';
import request from 'supertest';
import { uuidParamGuard } from '../../../src/middleware/uuidParams.js';

function appWithGuard() {
  const router = express.Router();
  router.param('id', uuidParamGuard);
  router.param('userId', uuidParamGuard);
  let handlerRan = false;
  router.get('/items/:id', (_req, res) => { handlerRan = true; res.json({ ok: true }); });
  router.get('/u/:userId/:id', (_req, res) => { handlerRan = true; res.json({ ok: true }); });
  const app = express();
  app.use(router);
  app.locals.didHandlerRun = () => handlerRan;
  return app;
}

const VALID = '11111111-1111-4111-8111-111111111111';

describe('uuidParamGuard via router.param', () => {
  test('non-UUID id → 400, handler never runs', async () => {
    const app = appWithGuard();
    const res = await request(app).get('/items/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/Invalid id/);
    expect(app.locals.didHandlerRun()).toBe(false);
  });

  test('SQL-ish / oversized junk id → 400 (no DB hit)', async () => {
    const app = appWithGuard();
    for (const bad of ["1 OR 1=1", "%", "a".repeat(500), "00000000", "123"]) {
      const res = await request(app).get(`/items/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
  });

  test('valid UUID → passes through to the handler (200)', async () => {
    const app = appWithGuard();
    const res = await request(app).get(`/items/${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('uppercase UUID is accepted (case-insensitive)', async () => {
    const app = appWithGuard();
    const res = await request(app).get(`/items/${VALID.toUpperCase()}`);
    expect(res.status).toBe(200);
  });

  test('multiple guarded params: the first invalid one fails with 400', async () => {
    const app = appWithGuard();
    // userId valid, id invalid → 400
    expect((await request(app).get(`/u/${VALID}/nope`)).status).toBe(400);
    // userId invalid → 400 regardless of id
    expect((await request(app).get(`/u/bad/${VALID}`)).status).toBe(400);
    // both valid → 200
    expect((await request(app).get(`/u/${VALID}/${VALID}`)).status).toBe(200);
  });
});
