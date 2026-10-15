// ─── Authentication Context ──────────────────────────────────────────────────
// Provides global authentication state, user session persistence via AsyncStorage, and auth actions.

import React, { createContext, useContext, useState, useEffect } from 'react';
import { loginUser, registerUser, loginWithWalletApi } from '../services/api';
import storage, { STORAGE_KEYS } from '../utils/storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);

  // Restore authenticated session from AsyncStorage on app boot / page refresh
  useEffect(() => {
    async function restoreSession() {
      try {
        const savedSession = await storage.getJSON(STORAGE_KEYS.SESSION);
        if (savedSession && savedSession.user && savedSession.token) {
          setUser(savedSession.user);
          setToken(savedSession.token);
        }
      } catch (err) {
        console.warn('[AuthContext] Error restoring session:', err.message);
      } finally {
        setSessionRestored(true);
      }
    }

    restoreSession();
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const response = await loginUser({ email, password });
      const nextUser = response.user;
      const nextToken = response.session?.access_token || response.token;

      setUser(nextUser);
      setToken(nextToken);

      // Persist session to AsyncStorage
      await storage.setJSON(STORAGE_KEYS.SESSION, { user: nextUser, token: nextToken });
      return response;
    } finally {
      setLoading(false);
    }
  };

  const loginWithWallet = async (walletAddress) => {
    setLoading(true);
    try {
      const response = await loginWithWalletApi(walletAddress);
      const nextUser = response.user;
      const nextToken = response.session?.access_token || response.token;

      setUser(nextUser);
      setToken(nextToken);

      // Persist session to AsyncStorage
      await storage.setJSON(STORAGE_KEYS.SESSION, { user: nextUser, token: nextToken });
      return response;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email, password, fullName) => {
    setLoading(true);
    try {
      const response = await registerUser({ email, password, fullName });
      if (response?.user && response?.session?.access_token) {
        const nextUser = response.user;
        const nextToken = response.session.access_token;
        setUser(nextUser);
        setToken(nextToken);
        await storage.setJSON(STORAGE_KEYS.SESSION, { user: nextUser, token: nextToken });
      }
      return response;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setUser(null);
    setToken(null);
    try {
      await storage.removeItem(STORAGE_KEYS.SESSION);
    } catch (e) {
      console.warn('[AuthContext] Error clearing session from storage:', e.message);
    }
  };

  const updateUser = async (updates) => {
    setUser((prev) => {
      const next = prev ? { ...prev, ...updates } : updates;
      storage.setJSON(STORAGE_KEYS.SESSION, { user: next, token });
      return next;
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        loading,
        sessionRestored,
        login,
        loginWithWallet,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
