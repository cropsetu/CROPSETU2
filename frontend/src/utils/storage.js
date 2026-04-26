/**
 * Secure storage — Farmer App
 *
 * Uses expo-secure-store (iOS Keychain / Android Keystore) for all
 * sensitive values (tokens, user IDs).
 */
import { Platform } from 'react-native';
import { SESSION_TIMEOUT_MS, STORAGE_KEYS } from '../constants/config';

let _SecureStore = null;
function getSecureStore() {
  if (!_SecureStore) _SecureStore = require('expo-secure-store');
  return _SecureStore;
}

export async function setItem(key, value) {
  if (Platform.OS === 'web') {
    sessionStorage.setItem(key, String(value));
    return;
  }
  await getSecureStore().setItemAsync(key, String(value));
}

export async function getItem(key) {
  if (Platform.OS === 'web') {
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

/** Returns true if the stored session has exceeded SESSION_TIMEOUT_MS. */
export async function isTokenStale() {
  const raw = await getItem(STORAGE_KEYS.TOKEN_SAVED_AT);
  if (!raw) return true;
  return Date.now() - Number(raw) > SESSION_TIMEOUT_MS;
}
