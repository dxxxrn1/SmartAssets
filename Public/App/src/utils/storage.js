// ─── Unified Storage Utility ──────────────────────────────────────────────────
// Cross-platform persistence wrapper around AsyncStorage with web localStorage
// and in-memory fallback. Protects against 5MB Web localStorage QuotaExceededError.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { pruneBloatedWebStorage, sanitizeForStorage } from '../services/storage';

export const STORAGE_KEYS = {
  SESSION: '@smartassets_session',
  THEME: '@smartassets_theme',
  MARKET_ASSETS: '@smartassets_cached_assets',
  VAULT: '@smartassets_cached_vault',
  USER_PROFILE: '@smartassets_cached_profile',
  PERSONAL_COLLECTION: '@smartassets_personal_collection',
  CO_OWNED_ASSETS: '@smartassets_co_owned_assets',
  ESCROW_CASH: '@smartassets_escrow_cash',
  VAULT_ACTIVITY_LOG: '@smartassets_vault_activity_log',
  LAST_ACTIVE_AT: '@smartassets_last_active_at',
  SESSION_EXPIRED_MESSAGE: '@smartassets_session_expired_msg',
  NOTIFICATION_PREFERENCES: '@smartassets_notification_preferences',
};

const memoryFallback = new Map();

const CACHE_KEY_SET = new Set([
  STORAGE_KEYS.MARKET_ASSETS,
  STORAGE_KEYS.VAULT,
  STORAGE_KEYS.PERSONAL_COLLECTION,
  STORAGE_KEYS.CO_OWNED_ASSETS,
]);

const storage = {
  async getItem(key) {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null && value !== undefined) return value;
    } catch (_) {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        try {
          const val = window.localStorage.getItem(key);
          if (val !== null && val !== undefined) return val;
        } catch {}
      }
    }
    if (memoryFallback.has(key)) {
      return memoryFallback.get(key);
    }
    return null;
  },

  async setItem(key, value) {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    memoryFallback.set(key, strValue);

    if (Platform.OS === 'web' && CACHE_KEY_SET.has(key) && strValue.length > 350000) {
      return;
    }

    try {
      await AsyncStorage.setItem(key, strValue);
    } catch (_) {
      pruneBloatedWebStorage(true);
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(key, strValue);
        } catch {}
      }
    }
  },

  async removeItem(key) {
    memoryFallback.delete(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch (_) {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem(key);
        } catch {}
      }
    }
  },

  async getJSON(key, defaultValue = null) {
    try {
      const raw = await this.getItem(key);
      if (!raw) return defaultValue;
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  },

  async setJSON(key, value) {
    try {
      const safeVal = CACHE_KEY_SET.has(key) ? sanitizeForStorage(value) : value;
      await this.setItem(key, JSON.stringify(safeVal));
    } catch (_) {}
  },
};

export default storage;
