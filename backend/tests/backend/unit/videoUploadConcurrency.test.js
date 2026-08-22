/**
 * The video upload in-flight guard.
 *
 * multer uses memoryStorage, so each in-flight upload holds the whole file in
 * this process — up to 100 MB, with a transient ~2x while concat-stream joins
 * the chunks. Measured locally: five concurrent 99 MB uploads took the process
 * from 85 MB RSS to 1,073 MB. The hourly rate limiter in front does not help;
 * it is a per-user COUNTER, so twenty requests in the same second are all
 * admitted.
 *
 * These are Buffers, so they live in external/ArrayBuffer memory rather than the
 * V8 old space — --max-old-space-size would never see it coming, and the failure
 * mode is the container OOM-killing the replica, taking every other in-flight
 * request and every Socket.IO connection with it.
 *
 * The guard is tested here rather than through HTTP because its entire risk is
 * counter DRIFT on abnormal exits. If a decrement is ever missed the ceiling
 * ratchets down until the route is permanently 503; if one fires twice the
 * counter goes negative and the ceiling silently disappears. Driving those paths
 * by racing real uploads would be slow and flaky; driving them against a fake
 * response is exact.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { videoInFlightGuard, videoInFlightCount } from '../../../src/routes/upload.routes.js';
import { ENV } from '../../../src/config/env.js';

const CEILING = ENV.UPLOAD_VIDEO_MAX_INFLIGHT;

// A response that behaves like the real one for the parts the guard touches:
// it is an EventEmitter, and 'close' is what Node fires on EVERY exit.
function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.req = { id: 'test' };
  return res;
}

// Every admitted request is tracked so afterEach can release it. The counter is
// module state in the route, so a test that leaks an open request would make the
// NEXT test start above zero — which is exactly the drift these tests exist to
// detect, and would make them lie about where it came from.
const open = [];

/** Admit one request; returns { res, admitted }. */
function admit() {
  const res = fakeRes();
  let admitted = false;
  videoInFlightGuard({}, res, () => { admitted = true; });
  if (admitted) open.push(res);
  return { res, admitted };
}

afterEach(() => {
  open.splice(0).forEach((r) => r.emit('close'));
  expect(videoInFlightCount()).toBe(0);
});

describe('video in-flight guard', () => {
  it('admits up to the ceiling and sheds beyond it', () => {
    for (let i = 0; i < CEILING; i++) expect(admit().admitted).toBe(true);
    expect(videoInFlightCount()).toBe(CEILING);

    const over = admit();
    expect(over.admitted).toBe(false);
    expect(over.res.statusCode).toBe(503);
    expect(over.res.headers['Retry-After']).toBe('10');
  });

  it('sheds rather than queues', () => {
    // A queued request keeps its socket open, which would turn a memory problem
    // into a connection problem. The shed must be immediate and terminal.
    for (let i = 0; i < CEILING; i++) admit();
    const over = admit();
    expect(over.res.body?.success).toBe(false);
    expect(over.admitted).toBe(false);   // next() never called — nothing is waiting
  });

  it('does not count a shed request against the ceiling', () => {
    // If the shed path incremented, the route would wedge itself shut under load
    // — the failure would look exactly like the problem it was added to prevent.
    for (let i = 0; i < CEILING; i++) admit();
    admit(); admit(); admit();                 // three sheds
    expect(videoInFlightCount()).toBe(CEILING);
    open.splice(0).forEach((r) => r.emit('close'));
    expect(videoInFlightCount()).toBe(0);
    expect(admit().admitted).toBe(true);       // capacity fully restored
  });

  it('decrements on a client abort, not only on a clean finish', () => {
    // The case a naive res.on('finish') implementation misses entirely, and the
    // one a farmer on a dropping mobile connection generates all day.
    const a = admit();
    expect(videoInFlightCount()).toBe(1);
    open.splice(0);                             // hand ownership to this test
    a.res.emit('close');                        // aborted: no 'finish' ever fires
    expect(videoInFlightCount()).toBe(0);
  });

  it('cannot be driven negative by a double close', () => {
    // 'close' firing twice would make the counter negative and permanently widen
    // the ceiling — a silent removal of the protection. `once` prevents it.
    const a = admit();
    open.splice(0);
    a.res.emit('close');
    a.res.emit('close');
    a.res.emit('close');
    expect(videoInFlightCount()).toBe(0);
  });

  it('returns to exactly zero after a full cycle, repeatedly', () => {
    // The invariant that catches drift: not "roughly balanced" but exact, over
    // many cycles. A leak of one per N requests is what ratchets the route shut.
    for (let cycle = 0; cycle < 20; cycle++) {
      for (let i = 0; i < CEILING; i++) admit();
      admit();                                  // one shed each cycle
      open.splice(0).forEach((r) => r.emit('close'));
      expect(videoInFlightCount()).toBe(0);
    }
  });
});
