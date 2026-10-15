// ─── Network Connectivity Utility ─────────────────────────────────────────────
// Detects online/offline status reliably across Web and Mobile.

import { API_BASE_URL } from '../services/api';

/**
 * Synchronous check for browser online state.
 */
export function isOnlineSync() {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    return navigator.onLine;
  }
  return true;
}

/**
 * Asynchronous internet connectivity check.
 * Verifies both device connectivity and backend accessibility.
 */
export async function checkInternetConnection() {
  // 1. Fast check via navigator
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    if (!navigator.onLine) return false;
  }

  // 2. Fast ping to health endpoint with 2.5s timeout
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 2500) : null;

    const res = await fetch(`${API_BASE_URL.replace('/api', '')}/api/health`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller?.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);
    return res.ok;
  } catch {
    // If backend or network fails
    return false;
  }
}
