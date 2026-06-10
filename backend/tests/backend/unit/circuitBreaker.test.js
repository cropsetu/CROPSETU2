/**
 * Circuit breaker for external API calls.
 *
 * Acceptance: a failing dependency trips the breaker and recovers. We drive an
 * injectable clock so the OPEN → HALF_OPEN → CLOSED lifecycle is deterministic.
 */
import { jest } from '@jest/globals';
import {
  CircuitBreaker, CircuitOpenError, CircuitTimeoutError, CIRCUIT_STATES,
  getBreaker, breakerStates, _resetBreakers,
} from '../../../src/resilience/circuitBreaker.js';

// A breaker with a controllable clock.
function makeBreaker(overrides = {}) {
  const clock = { t: 1_000_000 };
  const breaker = new CircuitBreaker('test-dep', {
    timeoutMs: 50,
    failureThreshold: 0.5,
    volumeThreshold: 4,
    rollingWindowMs: 10_000,
    resetTimeoutMs: 5_000,
    now: () => clock.t,
    ...overrides,
  });
  return { breaker, clock };
}

const fail = () => Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
const ok = () => Promise.resolve('value');

describe('CircuitBreaker lifecycle', () => {
  it('passes calls through while CLOSED and healthy', async () => {
    const { breaker } = makeBreaker();
    await expect(breaker.execute(ok)).resolves.toBe('value');
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('trips OPEN once the failure rate crosses the threshold at volume', async () => {
    const { breaker } = makeBreaker();
    // 4 calls (volumeThreshold), all failing → 100% > 50% → trips.
    for (let i = 0; i < 4; i++) await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);
  });

  it('does NOT trip before the volume threshold is reached', async () => {
    const { breaker } = makeBreaker({ volumeThreshold: 10 });
    for (let i = 0; i < 5; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED); // only 5 < 10 calls
  });

  it('short-circuits FAST while OPEN (does not call fn)', async () => {
    const { breaker } = makeBreaker();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    const spy = jest.fn(ok);
    await expect(breaker.execute(spy)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled(); // the dependency is not even touched
  });

  it('recovers: OPEN → HALF_OPEN after resetTimeout → CLOSED on a successful probe', async () => {
    const { breaker, clock } = makeBreaker();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);

    clock.t += 5_000; // resetTimeout elapses → next call is a HALF_OPEN trial
    await expect(breaker.execute(ok)).resolves.toBe('value');
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED); // probe succeeded → recovered
  });

  it('re-opens if the HALF_OPEN probe also fails', async () => {
    const { breaker, clock } = makeBreaker();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    clock.t += 5_000;
    await expect(breaker.execute(fail)).rejects.toThrow('boom'); // probe fails
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);

    // Still open immediately after — a second probe isn't allowed yet.
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('only allows ONE concurrent probe in HALF_OPEN', async () => {
    const { breaker, clock } = makeBreaker();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    clock.t += 5_000;
    let release;
    const slow = () => new Promise((res) => { release = () => res('ok'); });
    const trial = breaker.execute(slow);        // occupies the single probe slot
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError); // 2nd is rejected
    release();
    await expect(trial).resolves.toBe('ok');
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
  });
});

describe('isFailure classifier', () => {
  it('does not trip on healthy-but-rejected (4xx) responses', async () => {
    const { breaker } = makeBreaker();
    const notFound = () => Promise.reject(Object.assign(new Error('nope'), { status: 404 }));
    const isFailure = (err) => !err.status || err.status >= 500;
    // Many 4xx in a row: errors still propagate, but the breaker stays closed.
    for (let i = 0; i < 10; i++) {
      await expect(breaker.execute(notFound, { isFailure })).rejects.toThrow('nope');
    }
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('trips on 5xx but not on interleaved 4xx', async () => {
    const { breaker } = makeBreaker({ volumeThreshold: 4, failureThreshold: 0.5 });
    const isFailure = (err) => !err.status || err.status >= 500;
    const e = (s) => () => Promise.reject(Object.assign(new Error(String(s)), { status: s }));
    await expect(breaker.execute(e(500), { isFailure })).rejects.toThrow();
    await expect(breaker.execute(e(400), { isFailure })).rejects.toThrow(); // healthy
    await expect(breaker.execute(e(500), { isFailure })).rejects.toThrow();
    await expect(breaker.execute(e(503), { isFailure })).rejects.toThrow();
    // window: 4 calls, 3 real failures (≥50%) → trips
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);
  });
});

describe('timeout backstop', () => {
  it('rejects a hanging call with CircuitTimeoutError and counts it as a failure', async () => {
    const breaker = new CircuitBreaker('slow-dep', { timeoutMs: 20, volumeThreshold: 1, failureThreshold: 1, now: () => 0 });
    const hang = () => new Promise(() => {}); // never settles
    await expect(breaker.execute(hang)).rejects.toBeInstanceOf(CircuitTimeoutError);
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN); // counted → tripped
  });
});

describe('fallback', () => {
  it('invokes the fallback instead of throwing when open', async () => {
    const { breaker } = makeBreaker();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(fail)).rejects.toThrow();
    const res = await breaker.execute(ok, { fallback: (err) => `fallback:${err.code}` });
    expect(res).toBe('fallback:CIRCUIT_OPEN');
  });
});

describe('registry', () => {
  beforeEach(() => _resetBreakers());

  it('returns the same breaker for a given name', () => {
    const a = getBreaker('dep-x', { timeoutMs: 1000 });
    const b = getBreaker('dep-x');
    expect(a).toBe(b);
  });

  it('reports state for every registered breaker', async () => {
    getBreaker('dep-y');
    const states = breakerStates();
    expect(states.find((s) => s.name === 'dep-y')).toMatchObject({ state: 'closed' });
  });
});
