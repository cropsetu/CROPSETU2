/**
 * Secure storage — Farmer App
 *
 * Native (iOS/Android): expo-secure-store (Keychain / Keystore) for all
 * sensitive values (tokens, user IDs).
 *
 * Web: an in-memory store — NOT sessionStorage/localStorage. Web Storage is
 * readable by any injected/XSS script and persists to disk; keeping the
 * (short-lived) access token in a JS variable that never touches Web Storage
 * is the hardened SPA pattern. The refresh token is never handled by JS at
 * all on web — it lives in an httpOnly cookie set by the API, and auth
 * survives reload via a silent cookie-based refresh (see services/api.js).
 *
 * Upgrade safety: an older web build may have persisted tokens to Web Storage.
 * scrubLegacyWebTokenStorage() runs once at module load to purge any such
 * leftovers, so "tokens absent from JS-readable storage" also holds for users
 * upgrading from that build — not just fresh installs.
 */
import { Platform } from 'react-native';
import { SESSION_TIMEOUT_MS, SESSION_IDLE_TIMEOUT_MS, STORAGE_KEYS } from '../constants/config';

let _SecureStore = null;
function getSecureStore() {
  if (!_SecureStore) _SecureStore = require('expo-secure-store');
  return _SecureStore;
}

// Web-only, in-memory, non-persistent. Cleared on reload (by design).
const memStore = new Map();

/**
 * Web only: remove any auth tokens a PRIOR build may have written to
 * localStorage/sessionStorage. Current builds never put tokens there, so this
 * is a no-op on fresh installs — it exists purely to scrub legacy leftovers and
 * keep them out of JS-readable storage. Safe to call repeatedly.
 */
export function scrubLegacyWebTokenStorage() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const keys = Object.values(STORAGE_KEYS);
  for (const store of [window.localStorage, window.sessionStorage]) {
    if (!store) continue;
    for (const key of keys) {
      try { store.removeItem(key); } catch { /* storage blocked (private mode) */ }
    }
  }
}

// Purge legacy Web Storage tokens as early as possible — this module is pulled
// in by services/api.js before any auth read happens.
scrubLegacyWebTokenStorage();

export async function setItem(key, value) {
  if (Platform.OS === 'web') {
    memStore.set(key, String(value));
    return;
  }
  await getSecureStore().setItemAsync(key, String(value));
}

export async function getItem(key) {
  if (Platform.OS === 'web') {
    return memStore.has(key) ? memStore.get(key) : null;
  }
  return getSecureStore().getItemAsync(key);
}

export async function deleteItem(key) {
  if (Platform.OS === 'web') {
    memStore.delete(key);
    return;
  }
  await getSecureStore().deleteItemAsync(key);
}

/** Returns true if the stored session has exceeded SESSION_TIMEOUT_MS. */
export async function isTokenStale() {
  const raw = await getItem(STORAGE_KEYS.TOKEN_SAVED_AT);
  if (!raw) return true;
  return Date.now() - Number(raw) > SESSION_TIMEOUT_MS;
}

// ── Inactivity (idle) tracking ────────────────────────────────────────────────
// Records when the user was last active so the client can proactively log out an
// idle session instead of waiting for the server to 401. Persisted via the same
// store as tokens (SecureStore on native; in-memory on web — web re-auths via
// the refresh cookie on reload, so its idle clock is per-session by design).

/** Stamp the last-activity time (defaults to now). */
export async function setLastActiveAt(ts = Date.now()) {
  await setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(ts));
}

/** Last recorded activity time in ms, or null if never recorded. */
export async function getLastActiveAt() {
  const raw = await getItem(STORAGE_KEYS.LAST_ACTIVE_AT);
  return raw ? Number(raw) : null;
}

/**
 * True when the last recorded activity is older than the idle window. Returns
 * false when there's no record yet (a brand-new/never-stamped session), so a
 * fresh login is never treated as already-expired.
 */
export async function isSessionIdleExpired() {
  const last = await getLastActiveAt();
  if (last == null) return false;
  return Date.now() - last > SESSION_IDLE_TIMEOUT_MS;
}
