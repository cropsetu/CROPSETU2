/**
 * AuthContext — handles OTP auth, token storage, and user state.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import api, { saveTokens, clearTokens, getAccessToken, getUserId } from '../services/api';
import { resetSocket } from '../services/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount.
  // On web the access token lives only in memory (gone after a reload), but the
  // refresh token persists in an httpOnly cookie — so we still attempt
  // /users/me: the request 401s with no token and the api interceptor silently
  // refreshes from the cookie, restoring the session securely across reloads.
  // On native we require a stored access token before hitting the API.
  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        if (token || Platform.OS === 'web') {
          const { data } = await api.get('/users/me');
          setUser(data.data);
          setIsLoggedIn(true);
        }
      } catch {
        await clearTokens();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // All callbacks are memoised with stable identities. Without this, every
  // AuthProvider render creates new function references; consumers that list
  // these in effect deps (e.g. ProfileScreen's useFocusEffect → refreshUser)
  // would re-run on every render, and refreshUser → setUser → render forms an
  // infinite request loop. useCallback + useMemo break that cycle.
  const sendOtp = useCallback(async (phone) => {
    const { data } = await api.post('/auth/send-otp', { phone });
    return data;
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
    }
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    resetSocket();
    await clearTokens();
    setUser(null);
    setIsLoggedIn(false);
  }, []);

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
    () => ({ user, isLoggedIn, loading, sendOtp, verifyOtp, logout, updateUser, refreshUser }),
    [user, isLoggedIn, loading, sendOtp, verifyOtp, logout, updateUser, refreshUser]
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
