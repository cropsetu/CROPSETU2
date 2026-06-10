/**
 * Circuit breaker for external API calls.
 *
 * A failing downstream (an AI provider, Razorpay, Sarvam, FastAPI…) is worse than
 * a fast error: every request piles up waiting on the slow/dead dependency,
 * holding sockets, event-loop callbacks and DB connections until the whole API
 * degrades. A circuit breaker caps that blast radius — once a dependency looks
 * unhealthy the breaker "opens" and subsequent calls fail FAST (or hit a
 * fallback) instead of hammering it, then probes for recovery.
 *
 * States:
 *   CLOSED     → calls flow; failures are tallied over a rolling window.
 *   OPEN       → calls short-circuit immediately for `resetTimeoutMs`.
 *   HALF_OPEN  → one trial call is allowed; success closes the circuit, failure
 *                re-opens it (giving the dependency more time).
 *
 * Trip condition: at least `volumeThreshold` calls in the window AND a failure
 * rate ≥ `failureThreshold`. The volume floor stops a single early failure from
 * tripping the breaker.
 *
 * IMPORTANT — only DEPENDENCY failures should count. A 4xx business response
 * (402 spend-cap, 404, 400 validation) means the dependency is healthy; it just
 * said no. Pass `isFailure` so those don't trip the breaker — only 5xx, timeouts
 * and network errors do. The default counts every thrown error.
 *
 * The breaker also enforces a per-call `timeoutMs` backstop: if `fn` doesn't
 * settle in time the call rejects with a CircuitTimeoutError (counted as a
 * failure). The underlying request may still finish in the background — pass a
 * real AbortSignal in `fn` where the client supports it for true cancellation.
 *
 * In-process by design (per-instance health view). State is held in a module
 * registry so every call site for a given dependency shares one breaker.
 */
import logger from '../utils/logger.js';

export const CIRCUIT_STATES = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' });

/** Thrown when a call is short-circuited because the breaker is open. */
export class CircuitOpenError extends Error {
  constructor(name) {
    super(`Circuit "${name}" is open — dependency is unhealthy, failing fast`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.status = 503; // Service Unavailable — callers can treat like a 5xx
    this.circuitOpen = true;
  }
}

/** Thrown when a call exceeds the breaker's timeout backstop. */
export class CircuitTimeoutError extends Error {
  constructor(name, ms) {
    super(`Circuit "${name}" timed out after ${ms}ms`);
    this.name = 'CircuitTimeoutError';
    this.code = 'CIRCUIT_TIMEOUT';
    this.status = 504; // Gateway Timeout
    this.circuitTimeout = true;
  }
}

export class CircuitBreaker {
  /**
   * @param {string} name
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=10000]        per-call timeout backstop
   * @param {number} [opts.failureThreshold=0.5]   failure rate (0–1) that trips
   * @param {number} [opts.volumeThreshold=5]      min calls in window before tripping
   * @param {number} [opts.rollingWindowMs=30000]  window over which calls are tallied
   * @param {number} [opts.resetTimeoutMs=30000]   how long OPEN lasts before a trial
   * @param {() => number} [opts.now]              clock (injectable for tests)
   * @param {(s:string,p:string)=>void} [opts.onStateChange]
   */
  constructor(name, {
    timeoutMs = 10_000,
    failureThreshold = 0.5,
    volumeThreshold = 5,
    rollingWindowMs = 30_000,
    resetTimeoutMs = 30_000,
    now = () => Date.now(),
    onStateChange = null,
  } = {}) {
    this.name = name;
    this.timeoutMs = timeoutMs;
    this.failureThreshold = failureThreshold;
    this.volumeThreshold = volumeThreshold;
    this.rollingWindowMs = rollingWindowMs;
    this.resetTimeoutMs = resetTimeoutMs;
    this._now = now;
    this._onStateChange = onStateChange;

    this._state = CIRCUIT_STATES.CLOSED;
    this._events = [];        // [{ t, ok }] within the rolling window
    this._openedAt = 0;       // when we last entered OPEN
    this._trialInFlight = false; // a HALF_OPEN probe is running
  }

  get state() {
    return this._state;
  }

  /** Snapshot for metrics/observability. */
  stats() {
    this._prune(this._now());
    const total = this._events.length;
    const failures = this._events.reduce((n, e) => n + (e.ok ? 0 : 1), 0);
    return {
      name: this.name,
      state: this._state,
      total,
      failures,
      failureRate: total ? failures / total : 0,
    };
  }

  _setState(next) {
    if (this._state === next) return;
    const prev = this._state;
    this._state = next;
    logger.warn('[Circuit] %s %s → %s', this.name, prev, next);
    if (this._onStateChange) {
      try { this._onStateChange(next, prev); } catch { /* never let a listener break the breaker */ }
    }
  }

  _prune(now) {
    const cutoff = now - this.rollingWindowMs;
    if (this._events.length && this._events[0].t <= cutoff) {
      this._events = this._events.filter((e) => e.t > cutoff);
    }
  }

  _record(ok, now) {
    this._events.push({ t: now, ok });
    this._prune(now);
  }

  _shouldTrip() {
    const total = this._events.length;
    if (total < this.volumeThreshold) return false;
    const failures = this._events.reduce((n, e) => n + (e.ok ? 0 : 1), 0);
    return failures / total >= this.failureThreshold;
  }

  /** Move OPEN → HALF_OPEN once the reset window has elapsed. */
  _maybeHalfOpen(now) {
    if (this._state === CIRCUIT_STATES.OPEN && now - this._openedAt >= this.resetTimeoutMs) {
      this._setState(CIRCUIT_STATES.HALF_OPEN);
      this._trialInFlight = false;
    }
  }

  _open(now) {
    this._openedAt = now;
    this._setState(CIRCUIT_STATES.OPEN);
  }

  _close() {
    this._events = [];
    this._trialInFlight = false;
    this._setState(CIRCUIT_STATES.CLOSED);
  }

  /**
   * Run `fn` through the breaker.
   * @param {() => Promise<any>} fn
   * @param {object} [opts]
   * @param {(err:any) => any} [opts.fallback]   called (with the error) instead of throwing
   * @param {(err:any) => boolean} [opts.isFailure]  does this error indicate dependency ill-health?
   * @param {number} [opts.timeoutMs]            override the breaker's default timeout
   */
  async execute(fn, { fallback, isFailure = () => true, timeoutMs = this.timeoutMs } = {}) {
    const now = this._now();
    this._maybeHalfOpen(now);

    // Short-circuit while OPEN, or while a HALF_OPEN trial is already probing.
    if (this._state === CIRCUIT_STATES.OPEN
        || (this._state === CIRCUIT_STATES.HALF_OPEN && this._trialInFlight)) {
      const err = new CircuitOpenError(this.name);
      if (fallback) return fallback(err);
      throw err;
    }

    const isTrial = this._state === CIRCUIT_STATES.HALF_OPEN;
    if (isTrial) this._trialInFlight = true;

    try {
      const result = await this._withTimeout(fn, timeoutMs);
      this._onSuccess(isTrial);
      return result;
    } catch (err) {
      const counts = err instanceof CircuitTimeoutError ? true : isFailure(err);
      this._onError(isTrial, counts);
      if (fallback) return fallback(err);
      throw err;
    }
  }

  _onSuccess(isTrial) {
    const now = this._now();
    if (isTrial) { this._close(); return; }  // probe succeeded → recovered
    this._record(true, now);
  }

  _onError(isTrial, counts) {
    const now = this._now();
    if (isTrial) {
      // Probe outcome decides recovery. A non-dependency error (4xx) means the
      // dependency is actually healthy, so close; a real failure re-opens.
      if (counts) this._open(now);
      else this._close();
      return;
    }
    // CLOSED path: a healthy-but-rejected (4xx) response counts as a success for
    // circuit health; only real failures move us toward tripping.
    this._record(!!(!counts), now);
    if (counts && this._shouldTrip()) this._open(now);
  }

  _withTimeout(fn, ms) {
    if (!ms || ms <= 0) return Promise.resolve().then(fn);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new CircuitTimeoutError(this.name, ms));
      }, ms);
      if (typeof timer.unref === 'function') timer.unref();
      Promise.resolve()
        .then(fn)
        .then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
        .catch((e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    });
  }
}

// ── Registry ────────────────────────────────────────────────────────────────
// One breaker per dependency name, shared across every call site for it.
const _registry = new Map();

/** Get (or lazily create) the breaker for a dependency. */
export function getBreaker(name, opts) {
  let b = _registry.get(name);
  if (!b) {
    b = new CircuitBreaker(name, opts);
    _registry.set(name, b);
  }
  return b;
}

/** Snapshot of every breaker's state — for /readyz or metrics. */
export function breakerStates() {
  return [..._registry.values()].map((b) => b.stats());
}

/** Test helper: drop all registered breakers. */
export function _resetBreakers() {
  _registry.clear();
}
