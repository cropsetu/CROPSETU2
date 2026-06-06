/**
 * writeQueue.js — resilient wrapper for mutating farm/cycle API calls.
 *
 * Wraps a write with retry + exponential backoff and drives a global sync
 * status the SyncBadge subscribes to. Server writes are idempotent (api.js
 * attaches an Idempotency-Key that survives retries + the 401-replay), so a
 * retry never double-applies.
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

export function subscribeSync(cb) { subs.add(cb); cb(state); return () => subs.delete(cb); }
export function getSyncState() { return state; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNetwork = (e) => !e?.response;                       // axios: no response → offline/timeout
const isRetryable = (e) => isNetwork(e) || (e?.response?.status >= 500);

/**
 * Run a mutating API call with up to `retries` attempts (400/800/1600ms
 * backoff) on network/5xx errors, updating the sync badge throughout.
 */
export async function withWrite(fn, { label = 'write', retries = 3 } = {}) {
  set({ status: 'syncing', pending: state.pending + 1 });
  let attempt = 0;
  let lastErr;
  while (attempt < retries) {
    try {
      const res = await fn();
      const pending = Math.max(0, state.pending - 1);
      set({ status: pending > 0 ? 'syncing' : 'synced', pending, lastError: null });
      return res;
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === retries - 1) break;
      await sleep(400 * Math.pow(2, attempt));
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

/** Clear an error/offline status back to synced (e.g. after a manual retry). */
export function clearSyncError() {
  if (state.pending === 0) set({ status: 'synced', lastError: null });
}

/** React hook → live sync state for the SyncBadge. */
export function useSyncStatus() {
  const [s, setS] = useState(getSyncState());
  useEffect(() => subscribeSync(setS), []);
  return s;
}
