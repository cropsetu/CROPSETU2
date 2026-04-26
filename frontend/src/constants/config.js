/**
 * config.js — centralised runtime configuration (Farmer / Buyer App)
 *
 * THIRD-PARTY API KEYS: never place real keys in this file.
 * Keys in the compiled bundle are extractable by decompiling the APK/IPA.
 */

import { Platform } from 'react-native';

// LAN IP of the dev machine — used when running on a *physical* device over Wi-Fi.
// Android *emulator* reaches the host via the magic address 10.0.2.2.
// iOS simulator reaches the host via localhost.
const DEV_LAN_IP = '192.168.1.2';

const DEV_HOST =
  Platform.OS === 'web'     ? 'localhost' :
  Platform.OS === 'android' ? '10.0.2.2'  :   // Android emulator → host loopback
                              'localhost';     // iOS simulator

// Prod URL can be overridden per-build via EAS env (EXPO_PUBLIC_API_BASE_URL in eas.json).
// Default falls back to the production Railway deployment.
const PROD_API = process.env.EXPO_PUBLIC_API_BASE_URL
  || 'https://cropsetu-backend-production.up.railway.app/api/v1';
const PROD_SOCKET = process.env.EXPO_PUBLIC_SOCKET_URL
  || 'wss://cropsetu-backend-production.up.railway.app';

export const API_BASE_URL = __DEV__ ? `http://${DEV_HOST}:3001/api/v1` : PROD_API;
export const SOCKET_URL   = __DEV__ ? `http://${DEV_HOST}:3001`       : PROD_SOCKET;

// ── Input / upload limits ──────────────────────────────────────────────────
export const MAX_MESSAGE_LENGTH   = 2000;
export const MAX_UPLOAD_BYTES     = 15 * 1024 * 1024; // 15 MB (images compressed client-side)
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

// ── OTP / auth limits ──────────────────────────────────────────────────────
export const OTP_RESEND_COOLDOWN_SEC = 30;
export const OTP_MAX_ATTEMPTS        = 5;

// ── Storage keys ───────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  ACCESS_TOKEN:   'fm_access_token',
  REFRESH_TOKEN:  'fm_refresh_token',
  USER_ID:        'fm_user_id',
  TOKEN_SAVED_AT: 'fm_token_saved_at',
};

/**
 * Maximum session age (ms) before the client forces a re-login.
 * 30 days — matches the server-side refresh token expiry.
 */
export const SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
