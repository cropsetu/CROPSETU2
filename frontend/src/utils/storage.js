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
 */
import { Platform } from 'react-native';
import { SESSION_TIMEOUT_MS, STORAGE_KEYS } from '../constants/config';

let _SecureStore = null;
function getSecureStore() {
  if (!_SecureStore) _SecureStore = require('expo-secure-store');
  return _SecureStore;
}

// Web-only, in-memory, non-persistent. Cleared on reload (by design).
const memStore = new Map();

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
