/**
 * Input-validation tests for the route schemas added across the previously
 * unvalidated routes (injection / query-bloat hardening).
 *
 * Each route file exports its express-validator rule arrays. We mount the REAL
 * rules + the shared `validate` middleware on a minimal app (no auth/DB needed)
 * and assert the acceptance criterion: invalid payloads are rejected with 400,
 * valid payloads pass through. This exercises the exact chains the routers use.
 */
import express from 'express';
import request from 'supertest';
import { validate } from '../../../src/middleware/validate.js';

import { createTaskRules } from '../../../src/routes/planner.routes.js';
import { listReportsRules, pincodeQueryRules } from '../../../src/routes/cropdisease.routes.js';
import { soilManualRules } from '../../../src/routes/soil.routes.js';
import { createAlertRules } from '../../../src/routes/mandi.routes.js';
import { calculateInputsRules } from '../../../src/routes/inputs.routes.js';
import { generateCalendarRules } from '../../../src/routes/calendar.routes.js';
import { searchCropsRules } from '../../../src/routes/crops.routes.js';
import { logRules } from '../../../src/routes/irrigation.routes.js';

// Build a tiny app that runs `rules` → validate → 200 handler for one method.
function appFor(rules, method = 'post') {
  const app = express();
  app.use(express.json());
  app[method]('/t', rules, validate, (_req, res) => res.json({ ok: true }));
  return app;
}

const send = (app, method, { body, query } = {}) => {
  let r = request(app)[method]('/t');
  if (query) r = r.query(query);
  if (body) r = r.send(body);
  return r;
};

describe('Route input validation — invalid payloads rejected with 400', () => {
  describe('planner POST /tasks (createTaskRules)', () => {
    const app = appFor(createTaskRules, 'post');
    test('missing title → 400', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato' } })).status).toBe(400);
    });
    test('over-length title → 400', async () => {
      expect((await send(app, 'post', { body: { title: 'x'.repeat(201) } })).status).toBe(400);
    });
    test('non-hex color → 400', async () => {
      expect((await send(app, 'post', { body: { title: 'Water', color: 'red' } })).status).toBe(400);
    });
    test('bad scheduledFor date → 400', async () => {
      expect((await send(app, 'post', { body: { title: 'Water', scheduledFor: 'not-a-date' } })).status).toBe(400);
    });
    test('valid minimal body → 200', async () => {
      expect((await send(app, 'post', { body: { title: 'Water the field' } })).status).toBe(200);
    });
  });

  describe('cropdisease GET /reports (listReportsRules) — query-bloat guard', () => {
    const app = appFor(listReportsRules, 'get');
    test('limit far over cap → 400', async () => {
      expect((await send(app, 'get', { query: { limit: '1000000' } })).status).toBe(400);
    });
    test('page=0 → 400', async () => {
      expect((await send(app, 'get', { query: { page: '0' } })).status).toBe(400);
    });
    test('no params (defaults) → 200', async () => {
      expect((await send(app, 'get', {})).status).toBe(200);
    });
    test('valid bounded params → 200', async () => {
      expect((await send(app, 'get', { query: { page: '2', limit: '25' } })).status).toBe(200);
    });
  });

  describe('cropdisease pincode query (pincodeQueryRules)', () => {
    const app = appFor(pincodeQueryRules, 'get');
    test('short pincode → 400', async () => {
      expect((await send(app, 'get', { query: { pincode: '123' } })).status).toBe(400);
    });
    test('non-numeric pincode → 400', async () => {
      expect((await send(app, 'get', { query: { pincode: 'abcdef' } })).status).toBe(400);
    });
    test('valid 6-digit pincode → 200', async () => {
      expect((await send(app, 'get', { query: { pincode: '413704' } })).status).toBe(200);
    });
  });

  describe('soil POST /manual (soilManualRules) — numeric type/range', () => {
    const app = appFor(soilManualRules, 'post');
    test('non-numeric ph → 400', async () => {
      expect((await send(app, 'post', { body: { ph: 'abc' } })).status).toBe(400);
    });
    test('nitrogen above sane max → 400', async () => {
      expect((await send(app, 'post', { body: { nitrogen: 1e9 } })).status).toBe(400);
    });
    test('valid soil params → 200', async () => {
      expect((await send(app, 'post', { body: { ph: 6.8, nitrogen: 320 } })).status).toBe(200);
    });
  });

  describe('mandi POST /alerts (createAlertRules)', () => {
    const app = appFor(createAlertRules, 'post');
    test('missing targetPrice + condition → 400', async () => {
      expect((await send(app, 'post', { body: { commodity: 'Onion' } })).status).toBe(400);
    });
    test('invalid condition enum → 400', async () => {
      expect((await send(app, 'post', { body: { commodity: 'Onion', targetPrice: 25, condition: 'equal' } })).status).toBe(400);
    });
    test('negative targetPrice → 400', async () => {
      expect((await send(app, 'post', { body: { commodity: 'Onion', targetPrice: -5, condition: 'above' } })).status).toBe(400);
    });
    test('valid alert → 200', async () => {
      expect((await send(app, 'post', { body: { commodity: 'Onion', targetPrice: 25, condition: 'above' } })).status).toBe(200);
    });
  });

  describe('inputs POST /calculate (calculateInputsRules)', () => {
    const app = appFor(calculateInputsRules, 'post');
    test('missing area → 400', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato' } })).status).toBe(400);
    });
    test('non-positive area → 400', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato', area: -1 } })).status).toBe(400);
    });
    test('valid calculate → 200', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato', area: 2, unit: 'acre' } })).status).toBe(200);
    });
  });

  describe('calendar POST /generate (generateCalendarRules)', () => {
    const app = appFor(generateCalendarRules, 'post');
    test('missing sowingDate → 400', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato' } })).status).toBe(400);
    });
    test('invalid season enum → 400', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato', sowingDate: '2025-07-01', season: 'summer' } })).status).toBe(400);
    });
    test('valid generate → 200', async () => {
      expect((await send(app, 'post', { body: { crop: 'Tomato', sowingDate: '2025-07-01' } })).status).toBe(200);
    });
  });

  describe('crops GET /search (searchCropsRules)', () => {
    const app = appFor(searchCropsRules, 'get');
    test('too-short query → 400', async () => {
      expect((await send(app, 'get', { query: { q: 'a' } })).status).toBe(400);
    });
    test('valid query → 200', async () => {
      expect((await send(app, 'get', { query: { q: 'soy' } })).status).toBe(200);
    });
  });

  describe('irrigation POST /log (logRules)', () => {
    const app = appFor(logRules, 'post');
    test('invalid farmerAction enum → 400', async () => {
      expect((await send(app, 'post', { body: { logId: 'abc', farmerAction: 'maybe' } })).status).toBe(400);
    });
    test('missing logId → 400', async () => {
      expect((await send(app, 'post', { body: { farmerAction: 'irrigated' } })).status).toBe(400);
    });
    test('valid log → 200', async () => {
      expect((await send(app, 'post', { body: { logId: 'abc', farmerAction: 'irrigated' } })).status).toBe(200);
    });
  });
});
