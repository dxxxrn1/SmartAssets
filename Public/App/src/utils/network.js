// ─── Network Connectivity Utility ─────────────────────────────────────────────
// Detects online/offline status reliably across Web and Mobile.

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
 * Verifies if device has general internet access.
 */
export async function checkInternetConnection() {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    if (!navigator.onLine) return false;
  }

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
    // Lightweight HTTP 204 ping to test real internet access without pinging a local IP
    await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      signal: controller?.signal,
    });
    if (timeoutId) clearTimeout(timeoutId);
    return true;
  } catch {
    // If public ping is blocked or times out, assume device is online if navigator hasn't reported offline
    return true;
  }
}
