// ─── Theme Context ────────────────────────────────────────────────────────────
// Persists Dark/Light mode preferences across sessions and offline state using AsyncStorage.

import React, { createContext, useContext, useState, useEffect } from 'react';
import storage, { STORAGE_KEYS } from '../utils/storage';
import { useColors } from '../constants/theme';

const ThemeContext = createContext({
  isDark: false,
  setIsDark: () => {},
  toggleTheme: () => {},
  colors: {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDarkState] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);

  // Load persisted theme preference on app start
  useEffect(() => {
    async function loadSavedTheme() {
      try {
        const savedTheme = await storage.getItem(STORAGE_KEYS.THEME);
        if (savedTheme !== null) {
          setIsDarkState(savedTheme === 'true' || savedTheme === true);
        }
      } catch (err) {
        console.warn('[ThemeContext] Error loading saved theme:', err.message);
      } finally {
        setThemeLoaded(true);
      }
    }
    loadSavedTheme();
  }, []);

  const setIsDark = async (value) => {
    setIsDarkState(value);
    await storage.setItem(STORAGE_KEYS.THEME, String(value));
  };

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDarkState(next);
    await storage.setItem(STORAGE_KEYS.THEME, String(next));
  };

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
