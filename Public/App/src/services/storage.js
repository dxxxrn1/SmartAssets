// ─── SmartAssets Storage Service ──────────────────────────────────────────
// Resilient AsyncStorage wrapper with safe web localStorage & in-memory fallback.
// Handles auth session persistence, theme preference, and offline cache for vault & market.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEYS = {
  AUTH_USER: '@smartassets_auth_user',
  AUTH_TOKEN: '@smartassets_auth_token',
  THEME_DARK: '@smartassets_theme_is_dark',
  VAULT_CACHE: '@smartassets_vault_cache',
  MARKET_CACHE: '@smartassets_market_cache',
  USER_PROFILE: '@smartassets_user_profile',
};

// Fallback in-memory map for environments where AsyncStorage / localStorage fails
const memoryStore = new Map();

/**
 * Safely store an item
 */
export async function setItem(key, value) {
  const serialized = JSON.stringify(value);
  try {
    await AsyncStorage.setItem(key, serialized);
  } catch (err) {
    console.warn(`[Storage] AsyncStorage.setItem failed for ${key}, falling back:`, err);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, serialized);
      } catch (localErr) {
        memoryStore.set(key, serialized);
      }
    } else {
      memoryStore.set(key, serialized);
    }
  }
}

/**
 * Safely retrieve an item
 */
export async function getItem(key, defaultValue = null) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw !== null && raw !== undefined) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`[Storage] AsyncStorage.getItem failed for ${key}, checking fallback:`, err);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        const localRaw = window.localStorage.getItem(key);
        if (localRaw !== null && localRaw !== undefined) {
          return JSON.parse(localRaw);
        }
      } catch (_) {}
    }
    const memRaw = memoryStore.get(key);
    if (memRaw !== undefined) {
      try {
        return JSON.parse(memRaw);
      } catch (_) {}
    }
  }
  return defaultValue;
}

/**
 * Safely remove an item
 */
export async function removeItem(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.warn(`[Storage] AsyncStorage.removeItem failed for ${key}:`, err);
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch (_) {}
  }
  memoryStore.delete(key);
}

// ── Auth Persistence Helpers ────────────────────────────────────────────────

export async function saveAuthSession(user, token) {
  if (!user && !token) {
    await clearAuthSession();
    return;
  }
  await Promise.all([
    setItem(STORAGE_KEYS.AUTH_USER, user),
    setItem(STORAGE_KEYS.AUTH_TOKEN, token),
  ]);
}

export async function getAuthSession() {
  const [user, token] = await Promise.all([
    getItem(STORAGE_KEYS.AUTH_USER, null),
    getItem(STORAGE_KEYS.AUTH_TOKEN, null),
  ]);
  return { user, token };
}

export async function clearAuthSession() {
  await Promise.all([
    removeItem(STORAGE_KEYS.AUTH_USER),
    removeItem(STORAGE_KEYS.AUTH_TOKEN),
  ]);
}

// ── Theme Persistence Helpers ───────────────────────────────────────────────

export async function saveTheme(isDark) {
  await setItem(STORAGE_KEYS.THEME_DARK, Boolean(isDark));
}

export async function getTheme(defaultIsDark = false) {
  return await getItem(STORAGE_KEYS.THEME_DARK, defaultIsDark);
}

// ── Vault & Market Offline Cache Helpers ────────────────────────────────────

export async function saveVaultCache(vaultData) {
  if (!vaultData) return;
  await setItem(STORAGE_KEYS.VAULT_CACHE, {
    ...vaultData,
    cachedAt: Date.now(),
  });
}

export async function getVaultCache() {
  return await getItem(STORAGE_KEYS.VAULT_CACHE, null);
}

export async function saveMarketAssetsCache(assets) {
  if (!assets || !Array.isArray(assets)) return;
  await setItem(STORAGE_KEYS.MARKET_CACHE, {
    assets,
    cachedAt: Date.now(),
  });
}

export async function getMarketAssetsCache() {
  const cached = await getItem(STORAGE_KEYS.MARKET_CACHE, null);
  return cached?.assets || null;
}

export async function saveUserProfile(profile) {
  if (!profile) return;
  await setItem(STORAGE_KEYS.USER_PROFILE, profile);
}

export async function getUserProfile() {
  return await getItem(STORAGE_KEYS.USER_PROFILE, null);
}

export { STORAGE_KEYS };
