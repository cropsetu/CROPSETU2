/**
 * AuthContext — handles OTP auth, token storage, and user state.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform, AppState } from 'react-native';
import api, { saveTokens, clearTokens, getAccessToken, getUserId } from '../services/api';
import { setLastActiveAt, getLastActiveAt, isSessionIdleExpired } from '../utils/storage';
import { SESSION_IDLE_TIMEOUT_MS } from '../constants/config';
import { solveProofOfWork } from '../utils/proofOfWork';
import { resetSocket } from '../services/socket';
import { isDefinitiveAuthFailure } from '../services/authFailure';
import { registerForPushNotifications, forgetPushRegistration } from '../services/pushRegistration';

const AuthContext = createContext(null);

// How often to re-check idle while the app is open, and how often to persist the
// activity stamp (throttled so frequent navigation doesn't hammer SecureStore).
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const ACTIVITY_PERSIST_THROTTLE_MS = 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  // In-memory last-activity time (authoritative for interval checks) + a
  // throttle marker so we only persist roughly once a minute.
  const lastActiveRef  = useRef(Date.now());
  const lastPersistRef = useRef(0);

  // Record user activity. Updates the in-memory clock immediately and persists
  // it (throttled, or forced on key transitions like login/foreground).
  const markActivity = useCallback((force = false) => {
    const now = Date.now();
    lastActiveRef.current = now;
    if (force || now - lastPersistRef.current > ACTIVITY_PERSIST_THROTTLE_MS) {
      lastPersistRef.current = now;
      setLastActiveAt(now).catch(() => {});
    }
  }, []);

  // Defined here (before the idle-enforcement callbacks that call it) so those
  // callbacks can list it in their deps without a temporal-dead-zone error.
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    resetSocket();
    // Forget the memo so the NEXT person to log in on this device re-POSTs the
    // token and claims it. The token belongs to the device, but the row maps it
    // to a user — without this, their pushes would keep arriving against the
    // previous user's row. The server's upsert reassigns userId on conflict,
    // which handles it, but only if the token is actually sent again.
    forgetPushRegistration();
    await clearTokens();
    setUser(null);
    setIsLoggedIn(false);
  }, []);

  // Log out if idle past the timeout. Uses the most recent of the in-memory and
  // persisted stamps (persisted survives an app restart). Returns true if it
  // logged the user out.
  const enforceIdleTimeout = useCallback(async () => {
    let last = lastActiveRef.current;
    try {
      const persisted = await getLastActiveAt();
      if (persisted != null) last = Math.max(last, persisted);
    } catch { /* fall back to in-memory */ }

    if (Date.now() - last > SESSION_IDLE_TIMEOUT_MS) {
      await logout();
      return true;
    }
    return false;
  }, [logout]);

  // Check for existing session on mount.
  // On web the access token lives only in memory (gone after a reload), but the
  // refresh token persists in an httpOnly cookie — so we still attempt
  // /users/me: the request 401s with no token and the api interceptor silently
  // refreshes from the cookie, restoring the session securely across reloads.
  // On native we require a stored access token before hitting the API.
  useEffect(() => {
    (async () => {
      try {
        // Idle gate BEFORE restoring: if the last recorded activity is older than
        // the idle window, force a clean logout instead of resurrecting a stale
        // session that would otherwise linger until the first 401.
        if (await isSessionIdleExpired()) {
          await clearTokens(); // also drops the idle stamp
          setLoading(false);
          return;
        }

        const token = await getAccessToken();
        if (token || Platform.OS === 'web') {
          const { data } = await api.get('/users/me');
          setUser(data.data);
          setIsLoggedIn(true);
          markActivity(true); // start a fresh idle clock on restore
          // Register on RESTORE as well as on login. A returning farmer opens the
          // app with a stored session and never touches verifyOtp, so without
          // this only brand-new logins would ever have a push token — which is
          // almost nobody after the first week. Also the natural place to pick up
          // a token Expo rotated while the app was closed.
          registerForPushNotifications();
        }
      } catch (err) {
        // Same rule as performRefresh: only a definitive rejection ends the
        // session. A cold start with no usable signal is routine in a field, and
        // clearing here on any error meant an app-open on a dead cell logged the
        // farmer out permanently — the one failure a farmer cannot recover from
        // without re-verifying a phone number.
        //
        // On a transport failure we keep the tokens and simply do not restore
        // the session for this launch. The user sees Login, but the next launch
        // with signal — or the next successful request — picks the session back
        // up instead of demanding a new OTP.
        if (err?.sessionExpired || isDefinitiveAuthFailure(err)) {
          await clearTokens();
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [markActivity]);

  // While logged in: re-check idle on a timer and whenever the app returns to the
  // foreground (catches "backgrounded / phone locked for days then reopened").
  useEffect(() => {
    if (!isLoggedIn) return;

    const interval = setInterval(() => { enforceIdleTimeout(); }, IDLE_CHECK_INTERVAL_MS);

    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        const loggedOut = await enforceIdleTimeout();
        if (!loggedOut) markActivity(true);
      } else {
        // Going to background/inactive: flush the latest activity time so a long
        // background (or an app kill) is measured from real last-use.
        setLastActiveAt(lastActiveRef.current).catch(() => {});
      }
    });

    return () => { clearInterval(interval); sub.remove(); };
  }, [isLoggedIn, enforceIdleTimeout, markActivity]);

  // All callbacks are memoised with stable identities. Without this, every
  // AuthProvider render creates new function references; consumers that list
  // these in effect deps (e.g. ProfileScreen's useFocusEffect → refreshUser)
  // would re-run on every render, and refreshUser → setUser → render forms an
  // infinite request loop. useCallback + useMemo break that cycle.
  const sendOtp = useCallback(async (phone) => {
    try {
      const { data } = await api.post('/auth/send-otp', { phone });
      return data;
    } catch (err) {
      // Under suspicion the server replies 428 with a proof-of-work challenge.
      // Solve it transparently and retry once — legit users just wait ~a second.
      const pow = err?.response?.status === 428 && err.response.data?.error?.details?.proofOfWork;
      if (!pow) throw err;
      const solution = await solveProofOfWork(pow);
      if (!solution) throw err; // couldn't solve in budget → surface original error
      const { data } = await api.post('/auth/send-otp', { phone }, {
        headers: { 'x-otp-pow': JSON.stringify(solution) },
      });
      return data;
    }
  }, []);

  const verifyOtp = useCallback(async (phone, otp) => {
    const { data } = await api.post('/auth/verify-otp', { phone, otp });
    if (data.data?.accessToken) {
      await saveTokens({
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
        userId: data.data.user?.id,
      });
      setUser(data.data.user);
      setIsLoggedIn(true);
      markActivity(true); // start the idle clock at login
      // Fire-and-forget on purpose: registration needs a permission prompt and a
      // network round trip, and neither should stand between a farmer and their
      // home screen. It never throws — see pushRegistration.js.
      registerForPushNotifications();
    }
    return data;
  }, [markActivity]);

  const updateUser = useCallback((updates) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/users/me');
      setUser(data.data);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ user, isLoggedIn, loading, sendOtp, verifyOtp, logout, updateUser, refreshUser, markActivity }),
    [user, isLoggedIn, loading, sendOtp, verifyOtp, logout, updateUser, refreshUser, markActivity]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
