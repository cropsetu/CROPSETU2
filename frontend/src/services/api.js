/**
 * FarmEasy API Client
 * - `api`    : default 15-s timeout, used for all CRUD / chat / fast endpoints.
 * - `aiApi`  : 120-s timeout, used only for long AI scan / pipeline calls.
 * Both share the same auth + refresh + safe-error interceptors.
 */
import axios from 'axios';
import { Platform } from 'react-native';
import { setItem, getItem, deleteItem } from '../utils/storage';
import { API_BASE_URL, STORAGE_KEYS } from '../constants/config';

// On web, opt into cookie-based refresh transport: the server keeps the refresh
// token in an httpOnly cookie and never returns it in the body.
const IS_WEB = Platform.OS === 'web';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF double-submit token. The server sets a (JS-readable) `csrf` cookie; we
// echo it in X-CSRF-Token on mutating requests. Reading it from the cookie (not
// memory) means it survives a reload, so the silent cookie-refresh still passes.
function getCsrfToken() {
  if (!IS_WEB || typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── Token helpers ─────────────────────────────────────────────────────────────
export async function saveTokens({ accessToken, refreshToken, userId }) {
  const ops = [
    setItem(STORAGE_KEYS.ACCESS_TOKEN,  accessToken),
    setItem(STORAGE_KEYS.TOKEN_SAVED_AT, String(Date.now())),
  ];
  // On web the refresh token is undefined here (it's in the httpOnly cookie),
  // so there's nothing to persist. Only store what we actually received.
  if (refreshToken != null) ops.push(setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken));
  if (userId != null)       ops.push(setItem(STORAGE_KEYS.USER_ID, userId));
  await Promise.all(ops);
}

export async function clearTokens() {
  await Promise.all([
    deleteItem(STORAGE_KEYS.ACCESS_TOKEN),
    deleteItem(STORAGE_KEYS.REFRESH_TOKEN),
    deleteItem(STORAGE_KEYS.USER_ID),
    deleteItem(STORAGE_KEYS.TOKEN_SAVED_AT),
  ]);
}

export const getAccessToken  = () => getItem(STORAGE_KEYS.ACCESS_TOKEN);
export const getRefreshToken = () => getItem(STORAGE_KEYS.REFRESH_TOKEN);
export const getUserId       = () => getItem(STORAGE_KEYS.USER_ID);

// ── Safe error message ────────────────────────────────────────────────────────
// Never forward raw server error strings to the UI — they may contain stack
// traces, SQL snippets, or internal paths. Map to generic user-facing messages.
export function safeErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return null;
  if (error.code === 'ECONNABORTED') return 'Request timed out. Please check your connection.';
  if (error.message === 'Network Error')  return 'No internet connection. Please try again.';
  const status = error.response?.status;
  if (status === 400) return 'Invalid request. Please check your details and try again.';
  if (status === 401) return 'Session expired. Please log in again.';
  if (status === 402) return error.response?.data?.error?.message || 'Insufficient credits.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 409) return 'A conflict occurred. Please refresh and try again.';
  if (status === 422) return 'Some details look invalid. Please review and try again.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 503) return 'Service temporarily unavailable. Please try again shortly.';
  if (status >= 500)  return 'Server error. Please try again later.';
  return fallback;
}

// ── Axios instances ───────────────────────────────────────────────────────────
const baseConfig = {
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    // Web: tell the API to use the httpOnly refresh cookie instead of body tokens.
    ...(IS_WEB ? { 'X-Auth-Transport': 'cookie' } : {}),
  },
  // Web: send/receive the httpOnly refresh cookie (cross-origin requires this).
  withCredentials: IS_WEB,
  // Accept 2xx + 3xx. Browsers can revalidate via If-None-Match and surface a
  // raw 304 to JS (depends on cache mode); the default 200-299-only policy
  // would reject that and break perfectly-good cached data.
  validateStatus: (status) => status >= 200 && status < 400,
};

// Default: snappy. For everything except AI scan / orchestrator pipelines.
const api   = axios.create({ ...baseConfig, timeout: 15_000  });

// AI: long-running. Crop scan can take 30–90 s on the 5-agent pipeline,
// and up to 120 s when the cascade-into-ensemble flow escalates (Gemini
// Pro + Claude Sonnet voted in parallel, then reconciled). Express now
// polls the FastAPI async job queue for up to 180 s server-side; this
// timeout sits above that so the mobile request doesn't abort before
// Express has a chance to return the result.
//
// TODO: switch to mobile-side polling of /ai/scan/{job_id} so we don't
// need long-lived HTTP connections from the device at all.
const aiApi = axios.create({ ...baseConfig, timeout: 200_000 });

// ── Shared interceptors ───────────────────────────────────────────────────────
function attachInterceptors(instance) {
  // For multipart/form-data, the platform's networking layer must set the
  // Content-Type itself so it includes the correct boundary parameter:
  //   - Native (RN OkHttp/NSURLSession): set to 'multipart/form-data' and
  //     the layer rewrites it with the boundary.
  //   - Web (browser XHR/fetch): DELETE Content-Type entirely; the browser
  //     refuses to add the boundary if we already specified the header.
  instance.interceptors.request.use((config) => {
    if (config.data instanceof FormData) {
      if (Platform.OS === 'web') {
        if (typeof config.headers?.delete === 'function') config.headers.delete('Content-Type');
        else delete config.headers['Content-Type'];
      } else {
        if (typeof config.headers?.set === 'function') {
          config.headers.set('Content-Type', 'multipart/form-data');
        } else {
          config.headers['Content-Type'] = 'multipart/form-data';
        }
      }
    }
    return config;
  });

  // Attach access token (+ CSRF token on web mutations) to every request.
  instance.interceptors.request.use(async (config) => {
    const token = await getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;

    // Web: echo the CSRF cookie on state-changing requests (double-submit).
    if (IS_WEB && MUTATING.has((config.method || 'get').toUpperCase())) {
      const csrf = getCsrfToken();
      if (csrf) config.headers['X-CSRF-Token'] = csrf;
    }
    return config;
  });

  // Auto-refresh on 401 + attach userMessage on every error.
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config;

      if (error.response?.status === 401 && original && !original._retry) {
        return refreshAndRetry(instance, original).catch((err) => {
          err.userMessage = safeErrorMessage(err);
          return Promise.reject(err);
        });
      }

      error.userMessage = safeErrorMessage(error);
      return Promise.reject(error);
    }
  );
}

// ── Refresh-on-401 (shared queue across both instances) ──────────────────────
let isRefreshing = false;
let failedQueue  = [];

function processQueue(error, token = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
}

async function refreshAndRetry(instance, original) {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    }).then((token) => {
      original.headers.Authorization = `Bearer ${token}`;
      return instance(original);
    });
  }

  original._retry = true;
  isRefreshing    = true;

  try {
    let data;

    if (IS_WEB) {
      // Refresh token rides in the httpOnly cookie — send nothing readable.
      // Plain axios (not the intercepted instance) to avoid loops, so set the
      // CSRF header here too (read from the cookie → survives reload).
      const csrf = getCsrfToken();
      ({ data } = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { 'X-Auth-Transport': 'cookie', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        },
      ));
    } else {
      const [refreshToken, userId] = await Promise.all([
        getRefreshToken(),
        getUserId(),
      ]);
      if (!refreshToken || !userId) throw new Error('No refresh token');
      ({ data } = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { userId, refreshToken },
      ));
    }

    await saveTokens({
      accessToken:  data.data.accessToken,
      refreshToken: data.data.refreshToken, // undefined on web (cookie) → not stored
      userId:       IS_WEB ? undefined : await getUserId(),
    });

    processQueue(null, data.data.accessToken);
    original.headers.Authorization = `Bearer ${data.data.accessToken}`;
    return instance(original);
  } catch (err) {
    processQueue(err, null);
    await clearTokens();
    return Promise.reject(Object.assign(err, { sessionExpired: true }));
  } finally {
    isRefreshing = false;
  }
}

attachInterceptors(api);
attachInterceptors(aiApi);

export { aiApi };
export default api;
