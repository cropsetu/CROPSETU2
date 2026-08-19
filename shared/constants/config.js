/**
 * config.js — centralised runtime configuration (Farmer / Buyer App)
 *
 * THIRD-PARTY API KEYS: never place real keys in this file.
 * Keys in the compiled bundle are extractable by decompiling the APK/IPA.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Host the device used to reach the Metro dev server, e.g. "192.168.1.14:8081"
// on a physical phone over Wi-Fi, "10.0.2.2:8081" in the Android emulator,
// "localhost:8081" on a simulator. Whatever it is, it is by definition routable
// from the device back to this machine — so it's also the right host for the
// backend on :3001. Deriving it means NO LAN IP is ever hardcoded and nothing
// breaks on the next DHCP lease. Empty in a production build (no dev server).
const METRO_HOST = (
  Constants.expoConfig?.hostUri ||
  Constants.expoGoConfig?.debuggerHost ||
  Constants.manifest2?.extra?.expoGo?.debuggerHost ||
  Constants.manifest?.debuggerHost ||
  ''
).split('/')[0].split(':')[0];

// Web always talks to the backend over the browser's own origin host. Native
// prefers the derived Metro host, falling back to the emulator loopback alias
// (Android) / localhost (iOS sim) if Expo didn't expose one.
const DEV_HOST =
  Platform.OS === 'web' ? 'localhost' :
  METRO_HOST || (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');

// Prod URL can be overridden per-build via EAS env (EXPO_PUBLIC_API_BASE_URL in eas.json).
// Default falls back to the production Railway deployment.
const PROD_API = process.env.EXPO_PUBLIC_API_BASE_URL
  || 'https://cropsetu2-production.up.railway.app/api/v1';
const PROD_SOCKET = process.env.EXPO_PUBLIC_SOCKET_URL
  || 'wss://cropsetu2-production.up.railway.app';

// Resolution order:
//   1. EXPO_PUBLIC_API_BASE_URL — set in frontend/.env or eas.json. Wins
//      everywhere (dev, Expo Go, native build, web). Leave it EMPTY for local
//      dev; use it to point at a tunnel or the Railway prod URL.
//   2. __DEV__ default — `http://<DEV_HOST>:3001` on the dev machine.
//      Note: DEV_HOST=10.0.2.2 only works in the Android *emulator*. On a
//      physical device or in Expo Go, set EXPO_PUBLIC_API_BASE_URL instead.
//   3. PROD default — the Railway production URL hardcoded in PROD_API.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL
  || (__DEV__ ? `http://${DEV_HOST}:3001/api/v1` : PROD_API);
export const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL
  || (__DEV__ ? `http://${DEV_HOST}:3001` : PROD_SOCKET);

// ── OTP / auth limits ──────────────────────────────────────────────────────
export const OTP_MAX_ATTEMPTS        = 5;

// ── Storage keys ───────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  ACCESS_TOKEN:   'fm_access_token',
  REFRESH_TOKEN:  'fm_refresh_token',
  USER_ID:        'fm_user_id',
  TOKEN_SAVED_AT: 'fm_token_saved_at',
  LAST_ACTIVE_AT: 'fm_last_active_at',
};

/**
 * Inactivity window (ms): if the user is idle longer than this, the client
 * proactively logs out instead of waiting for the next request to 401.
 * 7 days — matches the server's SESSION_IDLE_TIMEOUT_DAYS (sliding refresh-token
 * idle expiry), so the client logs out exactly when the server would reject.
 */
export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
