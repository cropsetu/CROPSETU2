/**
 * CORS preflight caching test.
 *
 * Acceptance: a CORS preflight (OPTIONS) response carries Access-Control-Max-Age
 * set to the configured duration, so browsers cache it and skip the extra
 * round-trip on subsequent cross-origin requests. Exercises the exact `cors`
 * options app.js mounts, on a minimal app so no DB/auth is needed.
 */
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { ENV } from '../../../src/config/env.js';

function appFor(maxAge) {
  const app = express();
  app.use(cors({ origin: 'https://admin.cropsetu.com', credentials: true, maxAge }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

const preflight = (app, origin = 'https://admin.cropsetu.com') =>
  request(app)
    .options('/ping')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'GET');

describe('CORS preflight caching', () => {
  test('preflight response sets Access-Control-Max-Age to the configured value', async () => {
    const res = await preflight(appFor(600));
    expect(res.status).toBeLessThan(300); // 204/200 — preflight handled
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  test('the value tracks ENV.CORS_MAX_AGE (what app.js passes)', async () => {
    const res = await preflight(appFor(ENV.CORS_MAX_AGE));
    expect(res.headers['access-control-max-age']).toBe(String(ENV.CORS_MAX_AGE));
  });

  test('ENV default is a positive, browser-sane cache duration', () => {
    expect(Number.isInteger(ENV.CORS_MAX_AGE)).toBe(true);
    expect(ENV.CORS_MAX_AGE).toBeGreaterThan(0);
    expect(ENV.CORS_MAX_AGE).toBeLessThanOrEqual(86400); // within browser caps
  });

  test('maxAge: 0 emits "0" → browsers do not cache the preflight (kill switch)', async () => {
    const res = await preflight(appFor(0));
    expect(res.headers['access-control-max-age']).toBe('0');
  });
});
