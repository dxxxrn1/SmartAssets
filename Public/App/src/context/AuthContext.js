// ─── Authentication Context & Financial-Grade Inactivity Manager ─────────────
// Provides global authentication state, user session persistence via AsyncStorage,
// compliance status synchronization, strict 5-minute inactivity auto-logout,
// background app-lock enforcement, and auth actions.

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import {
  loginUser,
  registerUser,
  loginWithWalletApi,
  getUserProfileApi,
  logoutUserApi,
  logoutSessionApi,
  logSessionTimeoutApi,
  setUnauthorizedHandler,
} from '../services/api';
import storage, { STORAGE_KEYS } from '../utils/storage';

// ── Financial Security Policy Constants ─────────────────────────────────────
// Mandatory PCI-DSS / NIST standard for financial and asset custody platforms:
// Max idle / inactivity time: 5 minutes (300,000 ms)
export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
// Grace warning window before forced logout: 30 seconds
export const INACTIVITY_WARNING_MS = 30 * 1000;
// Idle checking cadence: every 3 seconds
const CHECK_CADENCE_MS = 3 * 1000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [sessionNotice, setSessionNotice] = useState(null);

  // Security notification states
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(null);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(30);

  // High-precision activity & state refs
  const lastActiveRef = useRef(Date.now());
  const backgroundTimestampRef = useRef(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const userRef = useRef(user);
  userRef.current = user;

  // Clear notice on manual navigation or acknowledgment
  const clearSessionNotice = useCallback(() => {
    setSessionNotice(null);
    setSessionExpiredMessage(null);
  }, []);

  const clearSessionExpiredMessage = useCallback(() => {
    setSessionExpiredMessage(null);
    setSessionNotice(null);
  }, []);

  // ── Record User Activity (resets 5-minute idle countdown) ───────────────────
  const lastPersistRef = useRef(0);
  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActiveRef.current = now;

    // Dismiss warning banner if active
    setInactivityWarning(false);

    // Throttle writing last_active to storage to at most once every 10 seconds
    if (now - lastPersistRef.current > 10 * 1000) {
      lastPersistRef.current = now;
      storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now)).catch(() => {});
    }
  }, []);

  // Alias for compatibility with components calling resetInactivityTimer
  const resetInactivityTimer = recordActivity;

  // ── Force Logout Due to Inactivity or Session Termination ───────────────────
  const handleInactivityLogout = useCallback(
    async (
      reason = 'Your session timed out after 5 minutes of inactivity for your financial security.'
    ) => {
      console.warn(`🔒 [AuthContext] Inactivity auto-logout triggered: ${reason}`);

      const currentToken = tokenRef.current;
      const currentUser = userRef.current;

      setUser(null);
      setToken(null);
      setInactivityWarning(false);
      setSessionExpiredMessage(reason);
      setSessionNotice(reason);

      try {
        await storage.removeItem(STORAGE_KEYS.SESSION);
        await storage.removeItem(STORAGE_KEYS.LAST_ACTIVE_AT);
        await storage.setItem(STORAGE_KEYS.SESSION_EXPIRED_MESSAGE, reason);
      } catch (err) {
        console.warn('[AuthContext] Error clearing storage on timeout:', err.message);
      }

      // Log event to backend audit ledger & revoke JWT server-side
      if (currentUser) {
        logSessionTimeoutApi(currentUser.email, currentUser.id).catch(() => {});
      }
      if (currentToken) {
        logoutUserApi(currentToken).catch(() => {});
      }
    },
    []
  );

  // Register global 401 unauthenticated interceptor
  useEffect(() => {
    setUnauthorizedHandler((errorMsg) => {
      if (userRef.current || tokenRef.current) {
        handleInactivityLogout(
          errorMsg || 'Session expired or invalidated. Please sign in again.'
        );
      }
    });
  }, [handleInactivityLogout]);

  // ── Session Boot Restoration with Inactivity Check ─────────────────────────
  useEffect(() => {
    async function restoreSession() {
      try {
        const pendingMsg = await storage.getItem(STORAGE_KEYS.SESSION_EXPIRED_MESSAGE);
        if (pendingMsg) {
          setSessionExpiredMessage(pendingMsg);
          setSessionNotice(pendingMsg);
          await storage.removeItem(STORAGE_KEYS.SESSION_EXPIRED_MESSAGE);
        }

        const savedSession = await storage.getJSON(STORAGE_KEYS.SESSION);
        const lastActiveStr = await storage.getItem(STORAGE_KEYS.LAST_ACTIVE_AT);

        if (savedSession && savedSession.user && savedSession.token) {
          const now = Date.now();
          const lastActive = lastActiveStr
            ? Number(lastActiveStr)
            : savedSession.lastActiveAt || now;
          const elapsed = now - lastActive;

          // If away longer than 5 minutes, reject restoration immediately!
          if (elapsed >= INACTIVITY_TIMEOUT_MS) {
            console.warn(
              `🔒 [AuthContext] Boot session rejected: elapsed ${Math.round(elapsed / 1000)}s >= ${INACTIVITY_TIMEOUT_MS / 1000}s limit.`
            );
            await storage.removeItem(STORAGE_KEYS.SESSION);
            await storage.removeItem(STORAGE_KEYS.LAST_ACTIVE_AT);
            const msg =
              'Your session timed out after 5 minutes of inactivity for your financial security. Please sign in again.';
            setSessionExpiredMessage(msg);
            setSessionNotice(msg);
            setUser(null);
            setToken(null);
            return;
          }

          try {
            const profileRes = await getUserProfileApi(savedSession.token);
            const enrichedUser = {
              ...savedSession.user,
              ...(profileRes?.profile || {}),
            };
            setUser(enrichedUser);
            setToken(savedSession.token);
            lastActiveRef.current = now;
            await storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now));
          } catch (valErr) {
            const msg = valErr?.message || '';
            if (
              msg.includes('Unauthorized') ||
              msg.includes('Session expired') ||
              msg.includes('invalid token') ||
              valErr.status === 401
            ) {
              console.warn('[AuthContext] Stored session rejected by server. Prompting login.');
              await storage.removeItem(STORAGE_KEYS.SESSION);
              await storage.removeItem(STORAGE_KEYS.LAST_ACTIVE_AT);
              setSessionExpiredMessage('Your session has expired. Please sign in again.');
              setUser(null);
              setToken(null);
            } else if (msg.includes('Suspended')) {
              const suspMsg = 'Account Suspended by Compliance. Please contact support.';
              setSessionNotice(suspMsg);
              setSessionExpiredMessage(suspMsg);
              await storage.removeItem(STORAGE_KEYS.SESSION);
              setUser(null);
              setToken(null);
            } else {
              // Retain session if offline / temporary network blip
              setUser(savedSession.user);
              setToken(savedSession.token);
              lastActiveRef.current = now;
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

  // ── Foreground Idle Checking Loop (Active Countdown) ──────────────────────
  useEffect(() => {
    if (!user || !token) {
      setInactivityWarning(false);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActiveRef.current;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        handleInactivityLogout(
          'Your session timed out after 5 minutes of inactivity for your financial security.'
        );
      } else if (elapsed >= INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS) {
        const remaining = Math.max(1, Math.ceil((INACTIVITY_TIMEOUT_MS - elapsed) / 1000));
        setInactivityWarning(true);
        setSecondsRemaining(remaining);
      } else {
        if (inactivityWarning) {
          setInactivityWarning(false);
        }
      }
    }, CHECK_CADENCE_MS);

    return () => clearInterval(interval);
  }, [user, token, handleInactivityLogout, inactivityWarning]);

  // ── Mobile AppState & Web Visibility Change Listener ───────────────────────
  useEffect(() => {
    if (!user || !token) return;

    // 1. React Native AppState listener (iOS / Android)
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const now = Date.now();
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        backgroundTimestampRef.current = now;
        storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now)).catch(() => {});
      } else if (nextAppState === 'active') {
        const bgTime = backgroundTimestampRef.current;
        if (bgTime) {
          const awayTime = now - bgTime;
          if (awayTime >= INACTIVITY_TIMEOUT_MS) {
            handleInactivityLogout(
              'Your session timed out while the app was in the background (> 5 minutes) for your financial security.'
            );
            return;
          }
        }
        recordActivity();
      }
    });

    // 2. Web visibility and interaction listeners (React Native Web)
    let handleVisibilityChange = null;
    let handleWebActivity = null;

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      let webHiddenTimestamp = null;
      handleVisibilityChange = () => {
        const now = Date.now();
        if (document.hidden) {
          webHiddenTimestamp = now;
          storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now)).catch(() => {});
        } else {
          if (webHiddenTimestamp && now - webHiddenTimestamp >= INACTIVITY_TIMEOUT_MS) {
            handleInactivityLogout(
              'Your session timed out while the tab was hidden (> 5 minutes) for your financial security.'
            );
            return;
          }
          recordActivity();
        }
      };

      handleWebActivity = () => {
        recordActivity();
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('pointerdown', handleWebActivity, { passive: true });
      window.addEventListener('keydown', handleWebActivity, { passive: true });
      window.addEventListener('scroll', handleWebActivity, { passive: true });
    }

    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        if (handleVisibilityChange) document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (handleWebActivity) {
          window.removeEventListener('pointerdown', handleWebActivity);
          window.removeEventListener('keydown', handleWebActivity);
          window.removeEventListener('scroll', handleWebActivity);
        }
      }
    };
  }, [user, token, handleInactivityLogout, recordActivity]);

  // ── Authentication Actions ─────────────────────────────────────────────────

  const login = async (email, password) => {
    setLoading(true);
    setSessionNotice(null);
    setSessionExpiredMessage(null);
    try {
      const response = await loginUser({ email, password });
      const nextUser = response.user;
      const nextToken = response.session?.access_token || response.token;
      const now = Date.now();

      setUser(nextUser);
      setToken(nextToken);
      setSessionExpiredMessage(null);
      setInactivityWarning(false);
      lastActiveRef.current = now;

      await storage.setJSON(STORAGE_KEYS.SESSION, {
        user: nextUser,
        token: nextToken,
        lastActiveAt: now,
      });
      await storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now));
      return response;
    } finally {
      setLoading(false);
    }
  };

  const loginWithWallet = async (walletAddress) => {
    setLoading(true);
    setSessionNotice(null);
    setSessionExpiredMessage(null);
    try {
      const response = await loginWithWalletApi(walletAddress);
      const nextUser = response.user;
      const nextToken = response.session?.access_token || response.token;
      const now = Date.now();

      setUser(nextUser);
      setToken(nextToken);
      setSessionExpiredMessage(null);
      setInactivityWarning(false);
      lastActiveRef.current = now;

      await storage.setJSON(STORAGE_KEYS.SESSION, {
        user: nextUser,
        token: nextToken,
        lastActiveAt: now,
      });
      await storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now));
      return response;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email, password, fullName) => {
    setLoading(true);
    setSessionNotice(null);
    setSessionExpiredMessage(null);
    try {
      const response = await registerUser({ email, password, fullName });
      if (response?.user && response?.session?.access_token) {
        const nextUser = response.user;
        const nextToken = response.session.access_token;
        const now = Date.now();

        setUser(nextUser);
        setToken(nextToken);
        setSessionExpiredMessage(null);
        setInactivityWarning(false);
        lastActiveRef.current = now;

        await storage.setJSON(STORAGE_KEYS.SESSION, {
          user: nextUser,
          token: nextToken,
          lastActiveAt: now,
        });
        await storage.setItem(STORAGE_KEYS.LAST_ACTIVE_AT, String(now));
      }
      return response;
    } finally {
      setLoading(false);
    }
  };

  const logout = async (reason = 'user') => {
    const currentToken = token;
    const currentEmail = user?.email;

    if (reason === 'inactivity') {
      logSessionTimeoutApi(currentEmail, user?.id).catch(() => {});
      const msg = 'Session expired due to 5 minutes of inactivity.';
      setSessionNotice(msg);
      setSessionExpiredMessage(msg);
    } else {
      logoutSessionApi(currentToken, currentEmail).catch(() => {});
      setSessionNotice(null);
      setSessionExpiredMessage(null);
    }

    setUser(null);
    setToken(null);
    setInactivityWarning(false);

    try {
      await storage.removeItem(STORAGE_KEYS.SESSION);
      await storage.removeItem(STORAGE_KEYS.LAST_ACTIVE_AT);
      await storage.removeItem(STORAGE_KEYS.SESSION_EXPIRED_MESSAGE);
    } catch (e) {
      console.warn('[AuthContext] Error clearing session from storage:', e.message);
    }

    if (currentToken) {
      logoutUserApi(currentToken).catch(() => {});
    }
  };

  const updateUser = async (updates) => {
    setUser((prev) => {
      const next = prev ? { ...prev, ...updates } : updates;
      storage.setJSON(STORAGE_KEYS.SESSION, {
        user: next,
        token,
        lastActiveAt: lastActiveRef.current,
      });
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
        sessionExpiredMessage,
        clearSessionExpiredMessage,
        inactivityWarning,
        secondsRemaining,
        recordActivity,
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
