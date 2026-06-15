/**
 * Admin API client.
 *
 * Mirrors the mobile app's web transport (frontend/src/services/api.js):
 *   - access token kept IN MEMORY (never localStorage — survives no XSS exfil);
 *   - refresh token rides an httpOnly cookie (server-set), never touched by JS;
 *   - CSRF double-submit: the server sets a JS-readable `csrf` cookie, we echo it
 *     in X-CSRF-Token on every mutating request;
 *   - on 401 we run ONE deduped refresh (POST /auth/refresh) and retry the call;
 *   - on hard refresh failure the session is cleared and listeners are notified.
 *
 * withCredentials + X-Auth-Transport: cookie tell the backend to use the cookie
 * refresh transport (same contract the mobile web build uses).
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── In-memory access token + session listeners ───────────────────────────────
let accessToken: string | null = null;
type Listener = () => void;
const sessionLostListeners = new Set<Listener>();

export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }
export function onSessionLost(fn: Listener) { sessionLostListeners.add(fn); return () => { sessionLostListeners.delete(fn); }; }
function notifySessionLost() { sessionLostListeners.forEach((fn) => fn()); }

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Decode a JWT payload without verifying (we only need id/role/exp locally). */
export function decodeJwt(token: string): { sub?: string; role?: string; tv?: number; exp?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Axios instance ────────────────────────────────────────────────────────────
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json', 'X-Auth-Transport': 'cookie' },
  withCredentials: true,
  timeout: 30_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
  if (MUTATING.has((config.method || 'get').toUpperCase())) {
    const csrf = getCsrfToken();
    if (csrf) config.headers.set('X-CSRF-Token', csrf);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    // Don't try to refresh the refresh call itself, or already-retried requests.
    if (status === 401 && original && !original._retry && !String(original.url || '').includes('/auth/refresh')) {
      original._retry = true;
      try {
        const token = await performRefresh();
        original.headers.set('Authorization', `Bearer ${token}`);
        return api(original);
      } catch (err) {
        notifySessionLost();
        return Promise.reject(err);
      }
    }
    return Promise.reject(error);
  },
);

// ── Deduped refresh (cookie transport) ───────────────────────────────────────
let refreshing: Promise<string> | null = null;

export function performRefresh(): Promise<string> {
  if (refreshing) return refreshing;
  const csrf = getCsrfToken();
  refreshing = axios
    .post<{ data: { accessToken: string; csrfToken?: string } }>(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true, headers: { 'X-Auth-Transport': 'cookie', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } },
    )
    .then((res) => {
      const token = res.data.data.accessToken;
      setAccessToken(token);
      return token;
    })
    .catch((err) => {
      setAccessToken(null);
      throw err;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ── Envelope helpers ──────────────────────────────────────────────────────────
export interface ApiMeta { hasMore?: boolean; nextCursor?: string | null; count?: number }
export interface Envelope<T> { success: boolean; data: T; meta?: ApiMeta }

export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<{ data: T; meta?: ApiMeta }> {
  const res = await api.get<Envelope<T>>(url, { params });
  return { data: res.data.data, meta: res.data.meta };
}
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<Envelope<T>>(url, body);
  return res.data.data;
}
export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<Envelope<T>>(url, body);
  return res.data.data;
}
export async function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.delete<Envelope<T>>(url, { data: body });
  return res.data.data;
}

/**
 * Download a binary/CSV endpoint (bypasses the JSON envelope). Streams the
 * response as a Blob and triggers a browser save with the server's filename
 * (from Content-Disposition) or `fallbackName`.
 */
export async function apiDownload(url: string, params: Record<string, unknown> | undefined, fallbackName: string): Promise<void> {
  const res = await api.get(url, { params, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] || '');
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackName;
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/** Upload a single file (multipart/form-data) and return the parsed envelope data. */
export async function apiUpload<T>(url: string, file: File, fieldName = 'file'): Promise<T> {
  const fd = new FormData();
  fd.append(fieldName, file);
  // Clear the JSON default Content-Type so the browser sets multipart/form-data
  // WITH the required boundary (axios serialises FormData natively).
  const res = await api.post<Envelope<T>>(url, fd, {
    headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
  });
  return res.data.data;
}

/** Map an axios error to a safe, user-facing message. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const serverMsg = e?.response?.data?.error?.message;
  if (typeof serverMsg === 'string' && serverMsg) return serverMsg;
  const status = e?.response?.status;
  if (status === 401) return 'Session expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Please slow down.';
  if (e?.code === 'ECONNABORTED') return 'Request timed out. Please try again.';
  if (e?.message === 'Network Error') return 'Cannot reach the server.';
  return fallback;
}
