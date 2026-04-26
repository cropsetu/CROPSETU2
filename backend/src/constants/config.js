/**
 * config.js — centralised runtime configuration
 *
 * HOW TO USE IN DEVELOPMENT
 * ─────────────────────────
 * Change DEV_LAN_IP to the LAN address of the machine running the backend.
 *
 * HOW TO USE IN PRODUCTION
 * ─────────────────────────
 * Set the two PROD_* constants to your real HTTPS/WSS endpoints.
 * Never ship HTTP or raw IP addresses in a production build.
 *
 * THIRD-PARTY API KEYS
 * ─────────────────────
 * Do NOT place real API keys in this file (or any client file).
 * Keys compiled into the app bundle can be extracted by anyone who
 * decompiles the APK / IPA.  Instead, call a thin backend route that
 * calls the third-party API server-side and returns only the data you need.
 */

// ── Backend address ────────────────────────────────────────────────────────
import { Platform } from 'react-native';

const DEV_LAN_IP = '10.0.2.2'; // Android emulator alias for Mac localhost

// Web builds run in the browser on the same machine as the dev server,
// so localhost is always reachable.  Mobile devices need the LAN IP.
export const API_BASE_URL = __DEV__
  ? Platform.OS === 'web'
    ? 'http://localhost:3001/api/v1'
    : `http://${DEV_LAN_IP}:3001/api/v1`
  : 'https://resilient-vision-production-e784.up.railway.app/api/v1';

export const SOCKET_URL = __DEV__
  ? Platform.OS === 'web'
    ? 'http://localhost:3001'
    : `http://${DEV_LAN_IP}:3001`
  : 'wss://resilient-vision-production-e784.up.railway.app';

// ── Input / upload limits ──────────────────────────────────────────────────
/** Maximum chat message length (characters). Enforced client + server. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Maximum profile photo upload size (bytes). 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Allowed image MIME types for file uploads. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/** Allowed image extensions (lower-case). Used as a second-layer client check. */
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

// ── OTP / auth limits ──────────────────────────────────────────────────────
/** Minimum seconds the user must wait before requesting a new OTP. */
export const OTP_RESEND_COOLDOWN_SEC = 30;

/** Maximum OTP verification attempts per session before the flow is blocked. */
export const OTP_MAX_ATTEMPTS = 5;

// ── Storage keys ───────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  ACCESS_TOKEN:  'farmeasy_access_token',
  REFRESH_TOKEN: 'farmeasy_refresh_token',
  USER_ID:       'farmeasy_user_id',
  TOKEN_SAVED_AT: 'farmeasy_token_saved_at',
};

/**
 * Maximum session age (ms) before the client forces a re-login.
 * 30 days — matches the server-side refresh token expiry.
 * This is NOT the access token TTL (that's 15 minutes, set server-side).
 */
export const SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
