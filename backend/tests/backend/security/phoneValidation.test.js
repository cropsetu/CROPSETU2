/**
 * Shared phone-validation tests (FE-12 backend half).
 *
 * Acceptance: valid Indian mobiles pass (in any real-world format) and invalids
 * are rejected — consistently, from one shared validator, with normalization to
 * the canonical 10-digit form that the DB + MSG91 expect.
 */
import express from 'express';
import request from 'supertest';
import { validate } from '../../../src/middleware/validate.js';
import { normalizeIndianMobile, isValidIndianMobile, indianMobileBody } from '../../../src/utils/phone.js';

const VALID_FORMATS = [
  '9876543210',
  '+919876543210',
  '919876543210',
  '09876543210',
  '98765 43210',
  '+91 98765-43210',
  '  9876543210  ',
];

const INVALID = [
  '1234567890',     // starts with 1 — not a mobile
  '5876543210',     // starts with 5 — not a mobile
  '98765',          // too short
  '98765432101',    // too long
  '+14155552671',   // valid US number, not Indian
  'abcdefghij',
  '',
  '   ',
  null,
  undefined,
];

describe('normalizeIndianMobile', () => {
  test('every accepted format normalizes to the same 10-digit number', () => {
    for (const v of VALID_FORMATS) {
      expect(normalizeIndianMobile(v)).toBe('9876543210');
    }
  });

  test('invalid / foreign / malformed inputs return null', () => {
    for (const v of INVALID) {
      expect(normalizeIndianMobile(v)).toBeNull();
    }
  });

  test('isValidIndianMobile mirrors normalize', () => {
    expect(isValidIndianMobile('+91 98765 43210')).toBe(true);
    expect(isValidIndianMobile('1234567890')).toBe(false);
  });
});

describe('indianMobileBody (express-validator chain)', () => {
  function appFor(field = 'phone') {
    const app = express();
    app.use(express.json());
    app.post('/t', indianMobileBody(field), validate, (req, res) => res.json({ value: req.body[field] }));
    return app;
  }

  test('accepts every valid format AND normalizes req.body to 10 digits', async () => {
    const app = appFor();
    for (const v of VALID_FORMATS) {
      const res = await request(app).post('/t').send({ phone: v });
      expect(res.status).toBe(200);
      expect(res.body.value).toBe('9876543210'); // downstream + DB see the canonical form
    }
  });

  test('rejects invalid numbers with 400', async () => {
    const app = appFor();
    for (const v of ['1234567890', '5876543210', '98765', '+14155552671', 'abc', '']) {
      const res = await request(app).post('/t').send({ phone: v });
      expect(res.status).toBe(400);
    }
  });

  test('custom field name + a fresh chain per call (no shared state)', async () => {
    const app = appFor('newPhone');
    expect((await request(app).post('/t').send({ newPhone: '+919876543210' })).status).toBe(200);
    expect((await request(app).post('/t').send({ newPhone: '111' })).status).toBe(400);
  });
});
