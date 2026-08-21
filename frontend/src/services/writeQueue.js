/**
 * writeQueue.js — resilient wrapper for mutating farm/cycle API calls.
 *
 * Wraps a write with retry + exponential backoff and drives a global sync
 * status the SyncBadge subscribes to.
 *
 * ── Idempotency: why the key is minted HERE ─────────────────────────────────
 *
 * This file used to claim that "api.js attaches an Idempotency-Key that
 * survives retries, so a retry never double-applies". It did not. api.js mints
 * the key in a REQUEST INTERCEPTOR, guarded by `!config.headers[...]` — that
 * guard makes the key survive a retransmission of the SAME config object,
 * which is what the 401-refresh replay does. A withWrite retry is not that: it
 * calls `fn()` again, building a brand-new request from scratch, so the
 * interceptor saw no existing header and minted a fresh key.
 *
 * The result was the exact failure the comment promised was impossible. A
 * farmer on a village connection taps "Save farm"; the POST reaches the server
 * and commits; the response never makes it back; axios times out; withWrite
 * retries with a NEW key; the backend sees an unrelated request and creates a
 * SECOND farm. The retry that existed to survive a bad network was the thing
 * duplicating their data.
 *
 * So the key belongs to the logical write, not to the HTTP attempt. withWrite
 * mints one up front and hands it to every attempt as an axios config. The
 * interceptor's existing guard then leaves it alone, and all attempts arrive
 * under one key that the backend's idempotency middleware can dedupe.
 *
 * Scope (this milestone): in-memory retry + live status. A durable on-disk
 * mutation queue that replays across cold starts is deferred to the full
 * offline-first phase.
 */
import { useEffect, useState } from 'react';

let state = { status: 'synced', pending: 0, lastError: null };
const subs = new Set();

const emit = () => { for (const cb of subs) { try { cb(state); } catch {} } };
const set = (patch) => { state = { ...state, ...patch }; emit(); };

function subscribeSync(cb) { subs.add(cb); cb(state); return () => subs.delete(cb); }
function getSyncState() { return state; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same generator shape as api.js: randomUUID where the runtime has it, and a
// time+random fallback for older Android JSC builds that do not.
function newIdemKey() {
  try { if (global.crypto?.randomUUID) return global.crypto.randomUUID(); } catch {}
  return 'wq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
const isNetwork = (e) => !e?.response;                       // axios: no response → offline/timeout
const isRetryable = (e) => isNetwork(e) || (e?.response?.status >= 500);

/**
 * Backoff for attempt n: 400/800/1600ms, plus up to 50% random jitter.
 *
 * The jitter is not cosmetic. A tower coming back after an outage releases
 * every phone under it at once; without jitter each one retries on the same
 * 400ms grid and they arrive as a synchronised wave, which is how a recovering
 * backend gets knocked over a second time. claude.md §46 asks for exactly this.
 */
function backoffMs(attempt) {
  const base = 400 * Math.pow(2, attempt);
  return base + Math.random() * base * 0.5;
}

/**
 * Run a mutating API call with up to `retries` attempts on network/5xx errors,
 * updating the sync badge throughout.
 *
 * `fn` receives an axios config carrying this write's Idempotency-Key and MUST
 * forward it to the request, or retries will double-apply — see the header.
 *
 *     withWrite((cfg) => farmApi.createFarm(data, cfg), { label: 'createFarm' })
 */
export async function withWrite(fn, { label = 'write', retries = 3 } = {}) {
  // One key for the whole write, not one per attempt.
  const idemConfig = { headers: { 'Idempotency-Key': newIdemKey() } };

  // A caller that ignores the argument silently loses duplicate protection and
  // nothing at runtime would say so — the request still succeeds, it just
  // succeeds twice on a flaky connection. Catching it in development is the
  // only place this contract can be enforced.
  const DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
  if (DEV && fn.length === 0 && retries > 1) {
    console.warn(
      `[writeQueue] ${label}: the callback ignores its config argument, so each `
      + 'retry will carry a different Idempotency-Key and may double-apply. '
      + 'Use withWrite((cfg) => api.post(url, body, cfg)).',
    );
  }

  set({ status: 'syncing', pending: state.pending + 1 });
  let attempt = 0;
  let lastErr;
  while (attempt < retries) {
    try {
      const res = await fn(idemConfig);
      const pending = Math.max(0, state.pending - 1);
      set({ status: pending > 0 ? 'syncing' : 'synced', pending, lastError: null });
      return res;
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === retries - 1) break;
      await sleep(backoffMs(attempt));
      attempt += 1;
    }
  }
  const pending = Math.max(0, state.pending - 1);
  set({
    status: isNetwork(lastErr) ? 'offline' : 'error',
    pending,
    lastError: lastErr?.userMessage || lastErr?.message || 'Could not sync',
  });
  throw lastErr;
}

/** React hook → live sync state for the SyncBadge. */
export function useSyncStatus() {
  const [s, setS] = useState(getSyncState());
  useEffect(() => subscribeSync(setS), []);
  return s;
}
