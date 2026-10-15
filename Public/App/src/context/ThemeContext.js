// ─── Theme Context ────────────────────────────────────────────────────────
// Manages global dark/light theme state, persisting to AsyncStorage so the user's
// theme preference is preserved across reloads and offline sessions.

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColors } from '../constants/theme';
import { getTheme, saveTheme } from '../services/storage';

const ThemeContext = createContext({
  isDark: false,
  toggleTheme: () => {},
  setIsDark: () => {},
  colors: {},
  themeLoaded: false,
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDarkState] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);

  // Restore saved theme on startup
  useEffect(() => {
    let isMounted = true;
    getTheme(false).then((savedTheme) => {
      if (isMounted) {
        setIsDarkState(Boolean(savedTheme));
        setThemeLoaded(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const setIsDark = useCallback((value) => {
    const nextVal = typeof value === 'function' ? value(isDark) : Boolean(value);
    setIsDarkState(nextVal);
    saveTheme(nextVal);
  }, [isDark]);

  const toggleTheme = useCallback(() => {
    setIsDarkState((prev) => {
      const next = !prev;
      saveTheme(next);
      return next;
    });
  }, []);

  const colors = useColors(isDark);

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        setIsDark,
        toggleTheme,
        colors,
        themeLoaded,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
