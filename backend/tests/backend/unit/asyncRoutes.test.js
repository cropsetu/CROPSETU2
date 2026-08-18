/**
 * Express 4 async-rejection safety net.
 *
 * The bug being fixed is not "an error was logged badly" — it is that the
 * request NEVER GETS AN ANSWER. Express 4 discards a handler's return value, so
 * a rejected promise leaves the socket open with no status line written. The app
 * shows a spinner until axios times out; nothing 5xx-shaped ever reaches
 * monitoring, so the failure is invisible on both ends.
 *
 * These tests assert the two properties that make the patch safe to leave in:
 * a rejection produces a real response, and nothing else changes behaviour.
 */
import express from 'express';
import request from 'supertest';
import { installAsyncRouteSafety } from '../../../src/middleware/asyncRoutes.js';

/**
 * Routes are registered BEFORE install() on purpose. app.js calls the installer
 * as a statement, but ESM hoists every route module's evaluation above it — so
 * in production the layers always exist first. A test that installed first would
 * pass while the real app stayed broken.
 */
function buildApp(register) {
  const router = express.Router();
  register(router);
  installAsyncRouteSafety();

  const app = express();
  app.use(router);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('async route safety', () => {
  test('a handler that rejects answers 500 instead of hanging', async () => {
    const app = buildApp((r) => {
      r.get('/boom', async () => { throw new Error('db down'); });
    });

    // .timeout() is the real assertion: before the patch this never resolved.
    const res = await request(app).get('/boom').timeout(3000);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db down');
  });

  test('a rejected promise returned without throwing is caught too', async () => {
    const app = buildApp((r) => {
      r.get('/reject', () => Promise.reject(new Error('P2022')));
    });

    const res = await request(app).get('/reject').timeout(3000);
    expect(res.status).toBe(500);
  });

  test('handlers with their own try/catch are untouched', async () => {
    const app = buildApp((r) => {
      r.get('/caught', async (req, res) => {
        try { throw new Error('inner'); } catch { res.status(400).json({ handled: true }); }
      });
    });

    const res = await request(app).get('/caught');
    expect(res.status).toBe(400);
    expect(res.body.handled).toBe(true);
  });

  test('successful async handlers still respond normally', async () => {
    const app = buildApp((r) => {
      r.get('/ok', async (req, res) => res.json({ ok: true }));
    });

    const res = await request(app).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('synchronous middleware and next() chains are unaffected', async () => {
    const app = buildApp((r) => {
      r.use((req, res, next) => { req.marked = true; next(); });
      r.get('/sync', (req, res) => res.json({ marked: req.marked === true }));
    });

    const res = await request(app).get('/sync');
    expect(res.body.marked).toBe(true);
  });

  test('a rejection AFTER the response does not double-write headers', async () => {
    const app = buildApp((r) => {
      r.get('/late', async (req, res) => {
        res.json({ ok: true });
        throw new Error('post-response failure');
      });
    });

    // Express would emit ERR_HTTP_HEADERS_SENT if next(err) ran here.
    const res = await request(app).get('/late').timeout(3000);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('arity is preserved so 4-arg error middleware still routes as error middleware', async () => {
    // If the wrapper reported length 3, Express would dispatch this as ordinary
    // middleware and the error path would break app-wide.
    const app = buildApp((r) => {
      r.get('/boom', async () => { throw new Error('x'); });
      r.use((err, req, res, _next) => res.status(418).json({ viaErrorMw: true }));
    });

    const res = await request(app).get('/boom').timeout(3000);
    expect(res.status).toBe(418);
    expect(res.body.viaErrorMw).toBe(true);
  });

  test('installing twice is a no-op (no double next(err))', () => {
    installAsyncRouteSafety();
    expect(installAsyncRouteSafety()).toBe(false);
  });
});
