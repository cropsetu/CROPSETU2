import request from 'supertest';
import app from '../../../src/app.js';

describe('Telemetry — client error ingest', () => {
  test('204 — accepts a well-formed crash report (anonymous)', async () => {
    const res = await request(app)
      .post('/api/v1/telemetry/client-error')
      .send({
        name: 'TypeError',
        message: 'Cannot read properties of undefined (reading "x")',
        stack: 'TypeError: ...\n  at Component',
        componentStack: '\n    in Foo\n    in Bar',
        fatal: true,
        platform: 'android 34',
        appVersion: '1.0.0',
        context: { source: 'errorBoundary' },
      });

    expect(res.status).toBe(204);
  });

  test('400 — rejects a report with no message', async () => {
    const res = await request(app)
      .post('/api/v1/telemetry/client-error')
      .send({ name: 'Error' });

    expect(res.status).toBe(400);
  });
});
