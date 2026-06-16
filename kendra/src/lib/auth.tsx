/**
 * Kendra portal authentication — phone OTP → JWT (cookie refresh).
 *
 * Login reuses the unchanged backend OTP flow (/auth/send-otp, /auth/verify-otp),
 * exactly like the admin SPA. Unlike admin, there is NO role gate at login: ANY
 * authenticated user may sign in — a brand-new account starts as FARMER and
 * becomes a SELLER (Kendra) only after completing /kendra/register. The server
 * still authorises every API call. On reload the session is recovered via the
 * httpOnly refresh cookie; an idle-timeout auto-logs-out.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiPost, decodeJwt, getAccessToken, onSessionLost, performRefresh, setAccessToken } from './api';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min of inactivity → auto-logout

export interface KendraUser {
  id: string;
  role: string;
  name?: string | null;
  phone?: string | null;
}

type Status = 'loading' | 'unauthed' | 'authed';

interface AuthState {
  status: Status;
  user: KendraUser | null;
  sendOtp: (phone: string) => Promise<{ devOtp?: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
  /** Re-mint the access token from the refresh cookie (picks up a role change). */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function userFromToken(): KendraUser | null {
  const token = getAccessToken();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.sub) return null;
  return { id: payload.sub, role: payload.role || 'FARMER' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<KendraUser | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);

  const logout = useMemo(
    () => async (_reason?: string) => {
      try { await apiPost('/auth/logout'); } catch { /* best-effort */ }
      setAccessToken(null);
      setUser(null);
      setStatus('unauthed');
    },
    [],
  );

  const refreshSession = useMemo(
    () => async () => {
      await performRefresh();
      const u = userFromToken();
      if (u) setUser(u);
    },
    [],
  );

  // Recover the session on first load via the refresh cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await performRefresh();
        const u = userFromToken();
        if (cancelled) return;
        if (u) { setUser(u); setStatus('authed'); }
        else { setAccessToken(null); setStatus('unauthed'); }
      } catch {
        if (!cancelled) setStatus('unauthed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // React to a hard session loss surfaced by the axios refresh interceptor.
  useEffect(() => onSessionLost(() => { setUser(null); setStatus('unauthed'); }), []);

  // Idle-timeout auto-logout (only while authenticated).
  useEffect(() => {
    if (status !== 'authed') return;
    const reset = () => {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => { void logout('idle'); }, IDLE_TIMEOUT_MS);
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [status, logout]);

  const sendOtp = async (phone: string) => {
    // In dev (no SMS provider) the backend returns devOtp so the login screen can
    // show / auto-fill it. It is absent in production (guarded server-side).
    return apiPost<{ sessionId: string; devOtp?: string }>('/auth/send-otp', { phone });
  };

  const verifyOtp = async (phone: string, otp: string) => {
    const data = await apiPost<{ accessToken: string; csrfToken?: string; user: KendraUser }>('/auth/verify-otp', { phone, otp });
    setAccessToken(data.accessToken);
    const role = data.user?.role || decodeJwt(data.accessToken)?.role || 'FARMER';
    setUser({ id: data.user.id, role, name: data.user.name, phone: data.user.phone });
    setStatus('authed');
  };

  const value: AuthState = { status, user, sendOtp, verifyOtp, logout, refreshSession };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
