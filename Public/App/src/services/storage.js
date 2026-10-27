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

const CACHE_KEY_SET = new Set([
  STORAGE_KEYS.VAULT_CACHE,
  STORAGE_KEYS.MARKET_CACHE,
  '@smartassets_cached_assets',
  '@smartassets_cached_vault',
  '@smartassets_personal_collection',
  '@smartassets_co_owned_assets',
]);

/**
 * Strip multi-megabyte base64 data URIs from cache objects before writing to
 * browser localStorage (which has a strict 5MB origin quota).
 */
export function sanitizeForStorage(val) {
  if (!val) return val;
  if (typeof val === 'string') {
    if (val.startsWith('data:image/') && val.length > 2000) {
      return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeForStorage);
  }
  if (typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val)) {
      out[k] = sanitizeForStorage(val[k]);
    }
    return out;
  }
  return val;
}

/**
 * Evict oversized or base64-bloated cache entries from Web localStorage on startup
 * or when QuotaExceededError occurs, ensuring auth sessions always have room.
 */
export function pruneBloatedWebStorage(aggressive = false) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        if (
          k === '@smartassets_session' ||
          k === STORAGE_KEYS.AUTH_USER ||
          k === STORAGE_KEYS.AUTH_TOKEN ||
          k === STORAGE_KEYS.THEME_DARK
        ) {
          continue;
        }
        const raw = window.localStorage.getItem(k);
        if (
          aggressive ||
          (CACHE_KEY_SET.has(k) && raw && (raw.length > 150000 || raw.includes('data:image/')))
        ) {
          window.localStorage.removeItem(k);
        } else if (raw && (raw.length > 250000 || raw.includes('data:image/'))) {
          window.localStorage.removeItem(k);
        }
      }
    } catch (_) {}
  }
}

// Run once on module initialization to clear any legacy 5MB quota bloat in browser
pruneBloatedWebStorage(false);

/**
 * Safely store an item
 */
export async function setItem(key, value) {
  const safeVal = CACHE_KEY_SET.has(key) ? sanitizeForStorage(value) : value;
  const serialized = JSON.stringify(safeVal);
  memoryStore.set(key, serialized);

  if (Platform.OS === 'web' && CACHE_KEY_SET.has(key) && serialized.length > 350000) {
    return;
  }

  try {
    await AsyncStorage.setItem(key, serialized);
  } catch (err) {
    pruneBloatedWebStorage(true);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, serialized);
      } catch (_) {}
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
  } catch (_) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        const localRaw = window.localStorage.getItem(key);
        if (localRaw !== null && localRaw !== undefined) {
          return JSON.parse(localRaw);
        }
      } catch (_) {}
    }
  }
  const memRaw = memoryStore.get(key);
  if (memRaw !== undefined) {
    try {
      return JSON.parse(memRaw);
    } catch (_) {}
  }
  return defaultValue;
}

/**
 * Safely remove an item
 */
export async function removeItem(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch (_) {}
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
