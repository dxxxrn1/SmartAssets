// ─── Unified Storage Utility ──────────────────────────────────────────────────
// Cross-platform persistence wrapper around AsyncStorage with web localStorage fallback.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

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
};

const storage = {
  async getItem(key) {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null) return value;
    } catch (e) {
      // Fallback for web if AsyncStorage has an issue
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        try {
          return window.localStorage.getItem(key);
        } catch {}
      }
    }
    return null;
  },

  async setItem(key, value) {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      await AsyncStorage.setItem(key, strValue);
    } catch (e) {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(key, strValue);
        } catch {}
      }
    }
  },

  async removeItem(key) {
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
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
      await this.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`[storage] Failed to setJSON for ${key}:`, e.message);
    }
  },
};

export default storage;
