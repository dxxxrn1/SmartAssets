// ─── Authentication Context ──────────────────────────────────────────────────
// Provides global authentication state, user session persistence via AsyncStorage,
// and auth actions. Prevents users from being kicked out on browser refresh or reload.

import React, { createContext, useContext, useState, useEffect } from 'react';
import { loginUser, registerUser, loginWithWalletApi } from '../services/api';
import { saveAuthSession, getAuthSession, clearAuthSession } from '../services/storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Restore authenticated session from AsyncStorage on startup / page refresh
  useEffect(() => {
    let isMounted = true;
    async function restoreSession() {
      try {
        const { user: savedUser, token: savedToken } = await getAuthSession();
        if (isMounted && savedUser && savedToken) {
          setUser(savedUser);
          setToken(savedToken);
        }
      } catch (err) {
        console.warn('[AuthContext] Failed to restore session from AsyncStorage:', err);
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    }

    restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const response = await loginUser({ email, password });
      const loggedUser = response.user;
      const accessToken = response.session?.access_token || response.token;

      setUser(loggedUser);
      setToken(accessToken);
      await saveAuthSession(loggedUser, accessToken);

      return response;
    } finally {
      setLoading(false);
    }
  };

  const loginWithWallet = async (walletAddress) => {
    setLoading(true);
    try {
      const response = await loginWithWalletApi(walletAddress);
      const loggedUser = response.user;
      const accessToken = response.session?.access_token || response.token;

      setUser(loggedUser);
      setToken(accessToken);
      await saveAuthSession(loggedUser, accessToken);

      return response;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email, password, fullName) => {
    setLoading(true);
    try {
      const response = await registerUser({ email, password, fullName });
      // If register returns session immediately, persist it
      if (response?.user && response?.session?.access_token) {
        setUser(response.user);
        setToken(response.session.access_token);
        await saveAuthSession(response.user, response.session.access_token);
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
      await clearAuthSession();
    } catch (err) {
      console.warn('[AuthContext] Failed to clear session:', err);
    }
  };

  const updateUser = (updates) => {
    setUser((prev) => {
      const updated = prev ? { ...prev, ...updates } : updates;
      if (token) {
        saveAuthSession(updated, token).catch(() => {});
      }
      return updated;
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        loading,
        isInitializing,
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
