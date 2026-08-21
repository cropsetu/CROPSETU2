/**
 * Per-route socket inactivity timeouts (claude.md §46).
 *
 * The default socket timeout is 30 s, which is right for ordinary CRUD and
 * wrong for any route where the client is legitimately idle for longer while
 * the server works. Those routes raise it per-prefix in app.js.
 *
 * This is worth pinning because the failure is invisible in every obvious way:
 * nothing errors server-side, no test 500s, and the client sees a plain network
 * error it will happily retry. It shows up only as duplicate work and a bill.
 *
 * The upload case: both rental screens set their OWN axios timeout to 120 s to
 * post a video. The 30 s server timeout survives the upload itself (bytes keep
 * arriving, and it is an INACTIVITY timeout) and then fires during the window
 * where the client socket is legitimately idle — after multer has buffered the
 * file and while Express streams it to Cloudinary. The connection dies at 30 s,
 * the farmer retries and sends the whole video again, and the first copy still
 * lands in Cloudinary as an orphan nothing references.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import request from 'supertest';
import { getApp, cleanupTestData } from '../../fixtures/setup.js';
import { ENV } from '../../../src/config/env.js';

let app;
// Highest timeout applied to the request socket, per path.
const applied = new Map();
let restore;

beforeAll(async () => {
  app = await getApp();
  // Record what socketTimeout() actually sets, rather than reading app._router
  // internals — this asserts the middleware RAN for the path, which is the
  // property that matters and the one a mount-order change would break.
  const orig = http.IncomingMessage.prototype.setTimeout;
  http.IncomingMessage.prototype.setTimeout = function patched(ms, cb) {
    // originalUrl, not url: app.use(path, fn) strips the mount prefix from
    // req.url before the middleware sees it, so inside the /upload handler
    // req.url is just '/video'.
    const key = this.originalUrl || this.url;
    applied.set(key, Math.max(applied.get(key) ?? 0, ms));
    return orig.call(this, ms, cb);
  };
  restore = () => { http.IncomingMessage.prototype.setTimeout = orig; };
});

afterAll(async () => { restore?.(); await cleanupTestData(); });

describe('socket timeout by route', () => {
  it('raises the upload window past the 120 s the rental screens ask for', async () => {
    // Unauthenticated: 401 is fine. The timeout middleware is mounted by path
    // prefix and runs before auth, which is exactly the point — the window has
    // to be open before any of the slow work starts.
    await request(app).post('/api/v1/upload/video');
    expect(applied.get('/api/v1/upload/video')).toBe(ENV.UPLOAD_SOCKET_TIMEOUT_MS);
    expect(ENV.UPLOAD_SOCKET_TIMEOUT_MS).toBeGreaterThan(120_000);
  });

  it('covers image upload too, not just video', async () => {
    await request(app).post('/api/v1/upload/image');
    expect(applied.get('/api/v1/upload/image')).toBe(ENV.UPLOAD_SOCKET_TIMEOUT_MS);
  });

  it('still raises the AI windows', async () => {
    await request(app).post('/api/v1/ai/chat');
    expect(applied.get('/api/v1/ai/chat')).toBe(ENV.AI_CHAT_SOCKET_TIMEOUT_MS);
  });

  it('leaves ordinary routes on the default, so Slowloris protection stays on', async () => {
    // The whole reason this is per-prefix. If a future refactor raises it
    // globally, the 30 s default that keeps stuck connections from piling up
    // disappears everywhere and nothing else would notice.
    await request(app).get('/api/v1/agristore/categories');
    expect(applied.get('/api/v1/agristore/categories')).toBeUndefined();
  });

  it('the server window is ABOVE the client window, so the client gives up first', async () => {
    // Ordering matters: whoever times out first owns the retry. If the server
    // goes first the client gets an abrupt socket error mid-work; if the client
    // goes first it can decide, and the server finishes or fails on its own
    // terms. Both AI and upload follow this.
    expect(ENV.UPLOAD_SOCKET_TIMEOUT_MS).toBeGreaterThan(120_000); // screens' axios timeout
    expect(ENV.AI_CHAT_SOCKET_TIMEOUT_MS).toBeGreaterThan(125_000); // aiApi's chat budget
  });
});
