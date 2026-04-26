/**
 * FarmEasy API Client
 * Centralised axios instance with auto token injection + refresh.
 */
import axios from 'axios';
import { setItem, getItem, deleteItem } from '../utils/storage';
import { API_BASE_URL, STORAGE_KEYS } from '../constants/config';

// ── Token helpers ─────────────────────────────────────────────────────────────
export async function saveTokens({ accessToken, refreshToken, userId }) {
  await Promise.all([
    setItem(STORAGE_KEYS.ACCESS_TOKEN,  accessToken),
    setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken),
    setItem(STORAGE_KEYS.USER_ID,       userId),
    setItem(STORAGE_KEYS.TOKEN_SAVED_AT, String(Date.now())),
  ]);
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
// traces, SQL snippets, or internal paths.  Map to generic user-facing messages.
export function safeErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  const status = error.response?.status;
  if (status === 400) return 'Invalid request. Please check your details and try again.';
  if (status === 401) return 'Session expired. Please log in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 409) return 'A conflict occurred. Please refresh and try again.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500)  return 'Server error. Please try again later.';
  return fallback;
}

// ── Axios instance ────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000, // 2 min — scan requests take ~15s on Railway; 15s default was aborting them
  headers: { 'Content-Type': 'application/json' },
});

// Strip Content-Type for multipart/form-data so React Native's native
// networking (OkHttp) can set the correct multipart/form-data; boundary=...
// header automatically.
//
// WHY the extra deletes: Axios 0.x merges defaults.headers.post and
// defaults.headers.common into config.headers before interceptors run.
// Deleting only the top-level key leaves the post-method sub-object intact,
// and dispatchRequest re-applies Content-Type: application/json from there.
// We must delete from every level to fully prevent that from happening.
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    // Axios 1.x uses an AxiosHeaders class with a .delete() method.
    if (typeof config.headers?.delete === 'function') {
      config.headers.delete('Content-Type');
    } else {
      // Axios 0.x — headers is a plain object; delete from all levels.
      delete config.headers['Content-Type'];
      ['common', 'post', 'put', 'patch'].forEach((method) => {
        if (config.headers[method]) delete config.headers[method]['Content-Type'];
      });
    }
  }
  return config;
});

// Attach access token to every request
api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
let isRefreshing = false;
let failedQueue  = [];

function processQueue(error, token = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing    = true;

    try {
      const [refreshToken, userId] = await Promise.all([
        getRefreshToken(),
        getUserId(),
      ]);

      if (!refreshToken || !userId) throw new Error('No refresh token');

      // Use a plain axios call (not the intercepted instance) to avoid loops.
      // userId is required by this backend; remove it if your server identifies
      // the user from the refresh token alone.
      const { data } = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { userId, refreshToken },
      );

      await saveTokens({
        accessToken:  data.data.accessToken,
        refreshToken: data.data.refreshToken,
        userId,
      });

      processQueue(null, data.data.accessToken);
      original.headers.Authorization = `Bearer ${data.data.accessToken}`;
      return api(original);
    } catch (err) {
      processQueue(err, null);
      await clearTokens();
      return Promise.reject({ ...err, sessionExpired: true });
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
