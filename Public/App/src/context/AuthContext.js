// ─── Authentication Context ──────────────────────────────────────────────────
// Provides global authentication state, session persistence via AsyncStorage,
// compliance status synchronization, and 5-minute inactivity auto-logout security hardening.

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  loginUser,
  registerUser,
  loginWithWalletApi,
  getUserProfileApi,
  logoutSessionApi,
  logSessionTimeoutApi,
} from '../services/api';
import storage, { STORAGE_KEYS } from '../utils/storage';

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (300,000 ms)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [sessionNotice, setSessionNotice] = useState(null);

  const inactivityTimerRef = useRef(null);
  const userRef = useRef(null);
  const tokenRef = useRef(null);

  // Keep refs in sync for timer callback
  userRef.current = user;
  tokenRef.current = token;

  // Clear notice on manual navigation or acknowledgment
  const clearSessionNotice = useCallback(() => {
    setSessionNotice(null);
  }, []);

  // ── Auto-Logout Execution ──
  const handleInactivityLogout = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser) return;

    console.warn('🔒 [AuthContext] 5 minutes of inactivity elapsed. Terminating session.');
    
    // Log event to backend audit ledger
    logSessionTimeoutApi(currentUser.email, currentUser.id).catch(() => {});

    setUser(null);
    setToken(null);
    setSessionNotice('Session expired due to 5 minutes of inactivity.');

    try {
      await storage.removeItem(STORAGE_KEYS.SESSION);
    } catch (e) {
      console.warn('[AuthContext] Error clearing session from storage:', e.message);
    }
  }, []);

  // ── Activity Reset Listener ──
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    // Only arm timer if a session is currently active
    if (userRef.current) {
      inactivityTimerRef.current = setTimeout(() => {
        handleInactivityLogout();
      }, INACTIVITY_TIMEOUT_MS);
    }
  }, [handleInactivityLogout]);

  // Set up Web global activity listeners
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleWebActivity = () => {
        resetInactivityTimer();
      };

      const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
      events.forEach((evt) => window.addEventListener(evt, handleWebActivity, { passive: true }));

      return () => {
        events.forEach((evt) => window.removeEventListener(evt, handleWebActivity));
      };
    }
  }, [resetInactivityTimer]);

  // Arm/disarm timer when authentication state changes
  useEffect(() => {
    if (user) {
      resetInactivityTimer();
    } else {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    }
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [user, resetInactivityTimer]);

  // Restore authenticated session from AsyncStorage on app boot / page refresh
  useEffect(() => {
    async function restoreSession() {
      try {
        const savedSession = await storage.getJSON(STORAGE_KEYS.SESSION);
        if (savedSession && savedSession.user && savedSession.token) {
          try {
            const profileRes = await getUserProfileApi(savedSession.token);
            const enrichedUser = {
              ...savedSession.user,
              ...(profileRes?.profile || {}),
            };
            setUser(enrichedUser);
            setToken(savedSession.token);
          } catch (valErr) {
            const msg = valErr?.message || '';
            if (
              msg.includes('Unauthorized') ||
              msg.includes('Session expired') ||
              msg.includes('invalid token')
            ) {
              console.warn('[AuthContext] Stored session expired or invalid. Prompting login.');
              await storage.removeItem(STORAGE_KEYS.SESSION);
              setUser(null);
              setToken(null);
            } else if (msg.includes('Suspended')) {
              setSessionNotice('Account Suspended by Compliance. Please contact support.');
              await storage.removeItem(STORAGE_KEYS.SESSION);
              setUser(null);
              setToken(null);
            } else {
              // Retain session if offline / temporary network issue
              setUser(savedSession.user);
              setToken(savedSession.token);
            }
          }
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
    setSessionNotice(null);
    try {
      const response = await loginUser({ email, password });
      const nextUser = response.user;
      const nextToken = response.session?.access_token || response.token;

      setUser(nextUser);
      setToken(nextToken);

      // Persist session to AsyncStorage
      await storage.setJSON(STORAGE_KEYS.SESSION, { user: nextUser, token: nextToken });
      resetInactivityTimer();
      return response;
    } finally {
      setLoading(false);
    }
  };

  const loginWithWallet = async (walletAddress) => {
    setLoading(true);
    setSessionNotice(null);
    try {
      const response = await loginWithWalletApi(walletAddress);
      const nextUser = response.user;
      const nextToken = response.session?.access_token || response.token;

      setUser(nextUser);
      setToken(nextToken);

      // Persist session to AsyncStorage
      await storage.setJSON(STORAGE_KEYS.SESSION, { user: nextUser, token: nextToken });
      resetInactivityTimer();
      return response;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email, password, fullName) => {
    setLoading(true);
    setSessionNotice(null);
    try {
      const response = await registerUser({ email, password, fullName });
      if (response?.user && response?.session?.access_token) {
        const nextUser = response.user;
        const nextToken = response.session.access_token;
        setUser(nextUser);
        setToken(nextToken);
        await storage.setJSON(STORAGE_KEYS.SESSION, { user: nextUser, token: nextToken });
        resetInactivityTimer();
      }
      return response;
    } finally {
      setLoading(false);
    }
  };

  const logout = async (reason = 'user') => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    const currentToken = token;
    const currentEmail = user?.email;

    if (reason === 'inactivity') {
      logSessionTimeoutApi(currentEmail, user?.id).catch(() => {});
      setSessionNotice('Session expired due to 5 minutes of inactivity.');
    } else {
      logoutSessionApi(currentToken, currentEmail).catch(() => {});
      setSessionNotice(null);
    }

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
        sessionNotice,
        clearSessionNotice,
        resetInactivityTimer,
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
