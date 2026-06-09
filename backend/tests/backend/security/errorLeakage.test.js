/**
 * Error-leakage tests for sendServerError (info-disclosure hardening).
 *
 * Acceptance: client error responses carry NO internal detail (stack, Prisma/SQL
 * text, upstream payloads). The real error is logged server-side; the client only
 * sees a generic message — unless the error was deliberately marked `expose:true`
 * (a curated, client-safe business error), mirroring the global error handler's
 * convention in app.js.
 */
import express from 'express';
import request from 'supertest';
import { sendServerError } from '../../../src/utils/response.js';

// Mount a route that throws `err` and is caught by sendServerError(fallback).
function appThrowing(err, fallback, status) {
  const app = express();
  app.get('/t', (req, res) => sendServerError(res, err, fallback, status));
  return app;
}

const INTERNAL = 'Invalid `prisma.user.create()`: connect ECONNREFUSED 10.0.0.5:5432\n    at /app/node_modules/@prisma/client/runtime/library.js:123';

describe('sendServerError — no internal detail reaches the client', () => {
  test('unexposed internal error → generic message, never the internal text', async () => {
    const err = new Error(INTERNAL);
    const res = await request(appThrowing(err, 'Checkout failed. Please try again.')).get('/t');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Checkout failed. Please try again.');
    // The raw internals must not appear anywhere in the serialized response.
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('prisma');
    expect(blob).not.toContain('ECONNREFUSED');
    expect(blob).not.toContain('node_modules');
    expect(blob).not.toMatch(/\bat \//); // no stack frames
  });

  test('falls back to a default generic message when none provided', async () => {
    const res = await request(appThrowing(new Error(INTERNAL))).get('/t');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  test('derives status from err.statusCode but still hides the message', async () => {
    const err = Object.assign(new Error(INTERNAL), { statusCode: 503 });
    const res = await request(appThrowing(err, 'Service unavailable.')).get('/t');
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe('Service unavailable.');
    expect(JSON.stringify(res.body)).not.toContain('prisma');
  });

  test('explicit statusCode arg overrides err.status', async () => {
    const err = Object.assign(new Error(INTERNAL), { status: 502 });
    const res = await request(appThrowing(err, 'Nope', 400)).get('/t');
    expect(res.status).toBe(400);
  });

  test('expose:true business error DOES surface its curated message', async () => {
    const err = Object.assign(new Error('Insufficient stock for Tomato'), { statusCode: 400, expose: true });
    const res = await request(appThrowing(err, 'Checkout failed.')).get('/t');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Insufficient stock for Tomato');
  });

  test('expose must be strictly true — a truthy non-true value stays generic', async () => {
    const err = Object.assign(new Error(INTERNAL), { expose: 1 });
    const res = await request(appThrowing(err, 'Generic only.')).get('/t');
    expect(res.body.error.message).toBe('Generic only.');
  });
});
