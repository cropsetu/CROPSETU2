/**
 * Platform-aware secure storage.
 *
 * Native (iOS / Android)
 *   expo-secure-store → iOS Keychain / Android Keystore (AES-256 encrypted)
 *
 * Web (development only)
 *   sessionStorage is used instead of localStorage.
 *   sessionStorage is scoped to the browser tab and is automatically cleared
 *   when the tab closes, reducing the window of exposure compared to
 *   localStorage which persists indefinitely.
 *
 *   ⚠️  WARNING: sessionStorage is still plain-text and accessible to any JS
 *   running on the same origin.  Do NOT deploy the web build to production
 *   without a proper secure-cookie / httpOnly-token solution.
 */
import { Platform } from 'react-native';
import { SESSION_TIMEOUT_MS, STORAGE_KEYS } from '../constants/config';

// Lazy-load SecureStore so it never imports on web
let _SecureStore = null;
function getSecureStore() {
  if (!_SecureStore) _SecureStore = require('expo-secure-store');
  return _SecureStore;
}

export async function setItem(key, value) {
  if (Platform.OS === 'web') {
    if (!__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[storage] sessionStorage used in production web — tokens are not secure. Use httpOnly cookies.');
    }
    sessionStorage.setItem(key, value);            // tab-scoped, not persistent
    return;
  }
  await getSecureStore().setItemAsync(key, String(value));
}

export async function getItem(key) {
  if (Platform.OS === 'web') {
    if (!__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[storage] sessionStorage used in production web — tokens are not secure. Use httpOnly cookies.');
    }
    return sessionStorage.getItem(key) ?? null;
  }
  return getSecureStore().getItemAsync(key);
}

export async function deleteItem(key) {
  if (Platform.OS === 'web') {
    sessionStorage.removeItem(key);
    return;
  }
  await getSecureStore().deleteItemAsync(key);
}

/**
 * Returns true if the stored session has exceeded SESSION_TIMEOUT_MS.
 * This is a client-side best-effort check; the server is always authoritative.
 */
export async function isTokenStale() {
  const raw = await getItem(STORAGE_KEYS.TOKEN_SAVED_AT);
  if (!raw) return true;
  return Date.now() - Number(raw) > SESSION_TIMEOUT_MS;
}
