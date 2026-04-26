/**
 * AuthContext — handles OTP auth, token storage, and user state.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import api, { saveTokens, clearTokens, getAccessToken, getUserId } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        if (token) {
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

  const sendOtp = async (phone) => {
    const { data } = await api.post('/auth/send-otp', { phone });
    return data;
  };

  const verifyOtp = async (phone, otp) => {
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
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    await clearTokens();
    setUser(null);
    setIsLoggedIn(false);
  };

  const updateUser = (updates) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const refreshUser = async () => {
    try {
      const { data } = await api.get('/users/me');
      setUser(data.data);
    } catch {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoggedIn, loading, sendOtp, verifyOtp, logout, updateUser, refreshUser }}
    >
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
