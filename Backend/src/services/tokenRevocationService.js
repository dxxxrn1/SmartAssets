// ─── Token Revocation Service ────────────────────────────────────────────────
// Durable, multi-instance session revocation storage for SmartAssets.
//
// Invariants:
// 1. NEVER persists raw bearer tokens — stores only SHA-256 cryptographic hashes.
// 2. Persists revocations to the durable database store (public.revoked_tokens)
//    so revocations survive server restarts and apply across server instances.
// 3. Fails closed: if the durable revocation store is unavailable, protected
//    operations are denied access.
// 4. Automatically records expiration and cleans up expired revocation entries.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const supabase = require('../connection/supabaseClient');

const LOCAL_STORE_FILE = path.resolve(__dirname, '../data/revoked_tokens.json');

function readLocalFileStore() {
  try {
    if (!fs.existsSync(LOCAL_STORE_FILE)) return new Map();
    const content = fs.readFileSync(LOCAL_STORE_FILE, 'utf8');
    const records = JSON.parse(content);
    const map = new Map();
    const now = Date.now();
    for (const [hash, entry] of Object.entries(records)) {
      if (entry && entry.expires_at) {
        const expMs = new Date(entry.expires_at).getTime();
        if (now < expMs) {
          map.set(hash, entry);
        }
      }
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

function writeLocalFileStore(hash, record) {
  try {
    const dir = path.dirname(LOCAL_STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = readLocalFileStore();
    current.set(hash, record);
    const obj = {};
    for (const [k, v] of current.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.warn('⚠️ [RevocationStore] Failed writing to local file store:', err.message);
  }
}

class RevocationStoreError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'RevocationStoreError';
    this.code = 'REVOCATION_STORE_UNAVAILABLE';
    this.originalError = originalError;
  }
}

// In-memory hot-path cache for fast lookups (hash -> expiresAtMs)
const localCache = new Map();

// Test-override store adapter (for simulating store outages or isolated memory stores)
let customStoreAdapter = null;

/**
 * Computes a deterministic SHA-256 hash of a bearer token.
 * Raw tokens must never be written to durable storage or logs.
 * @param {string} token
 * @returns {string} 64-hex-character digest
 */
function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('hashToken: token string is required');
  }
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Safely extracts expiration timestamp from a JWT payload without verifying signature.
 * @param {string} token
 * @returns {Date|null}
 */
function extractTokenExpiry(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload && typeof payload.exp === 'number') {
      return new Date(payload.exp * 1000);
    }
  } catch (_) {}
  return null;
}

/**
 * Durably revokes an access token (e.g. on logout, suspension, or inactivity timeout).
 * Persists the token's cryptographic hash and expiration to the database.
 *
 * @param {string} token - Raw bearer token to revoke
 * @param {object} [options]
 * @param {string} [options.userId] - User ID if known
 * @param {string} [options.tokenType] - 'admin' | 'user'
 * @param {string} [options.reason] - Revocation reason for audit trail
 * @param {Date} [options.expiresAt] - Optional explicit expiry Date
 * @returns {Promise<{ success: boolean, tokenHash: string }>}
 */
async function revokeToken(token, options = {}) {
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'Invalid token' };
  }

  const tokenHash = hashToken(token);
  const now = Date.now();

  // Determine expiration: explicit, token exp claim, or default 24h
  let expiresAt = options.expiresAt;
  if (!expiresAt || !(expiresAt instanceof Date) || isNaN(expiresAt.getTime())) {
    expiresAt = extractTokenExpiry(token) || new Date(now + 24 * 60 * 60 * 1000);
  }

  // Update in-memory hot cache immediately
  localCache.set(tokenHash, expiresAt.getTime());

  // If a custom store adapter is active (e.g. during test overrides)
  if (customStoreAdapter) {
    await customStoreAdapter.insert({
      token_hash: tokenHash,
      user_id: options.userId || null,
      token_type: options.tokenType || 'admin',
      reason: options.reason || 'logout',
      expires_at: expiresAt.toISOString(),
      revoked_at: new Date(now).toISOString(),
    });
    return { success: true, tokenHash };
  }

  // Persist to durable database table
  try {
    const { error } = await supabase.from('revoked_tokens').upsert(
      {
        token_hash: tokenHash,
        user_id: options.userId || null,
        token_type: options.tokenType || 'admin',
        reason: options.reason || 'logout',
        expires_at: expiresAt.toISOString(),
        revoked_at: new Date(now).toISOString(),
      },
      { onConflict: 'token_hash' }
    );

    if (error) {
      if (error.code === 'PGRST205' && process.env.NODE_ENV !== 'production') {
        writeLocalFileStore(tokenHash, {
          token_hash: tokenHash,
          user_id: options.userId || null,
          token_type: options.tokenType || 'admin',
          reason: options.reason || 'logout',
          expires_at: expiresAt.toISOString(),
          revoked_at: new Date(now).toISOString(),
        });
        return { success: true, tokenHash };
      }

      console.error('🚨 [RevocationStore] Failed to persist token revocation:', error.message);
      // If table does not exist or DB failure, throw so caller knows store is compromised
      throw new RevocationStoreError(`Failed to persist token revocation: ${error.message}`, error);
    }

    return { success: true, tokenHash };
  } catch (err) {
    if (err instanceof RevocationStoreError) throw err;
    console.error('🚨 [RevocationStore] Database write exception:', err.message);
    throw new RevocationStoreError(`Durable revocation write failed: ${err.message}`, err);
  }
}

/**
 * Checks whether a token has been revoked.
 * Queries local hot cache, then the durable database store.
 *
 * FAIL-CLOSED: If the durable revocation store is unreachable and the token is not
 * in local cache, this throws RevocationStoreError so protected actions fail closed.
 *
 * @param {string} token - Raw bearer token
 * @returns {Promise<boolean>} True if revoked, false if valid
 * @throws {RevocationStoreError} When revocation store is unavailable
 */
async function isTokenRevoked(token) {
  if (!token || typeof token !== 'string') {
    return true; // Malformed token treated as invalid
  }

  const tokenHash = hashToken(token);
  const now = Date.now();

  // 1. Check in-memory hot-path cache
  const cachedExpiry = localCache.get(tokenHash);
  if (cachedExpiry !== undefined) {
    if (now < cachedExpiry) {
      return true; // Confirmed revoked in cache
    }
    // Expired from blacklist, clean cache entry
    localCache.delete(tokenHash);
  }

  // 2. Custom store adapter check (tests or fallback)
  if (customStoreAdapter) {
    try {
      const isRev = await customStoreAdapter.isRevoked(tokenHash);
      if (isRev) {
        localCache.set(tokenHash, now + 60 * 1000);
      }
      return Boolean(isRev);
    } catch (adapterErr) {
      throw new RevocationStoreError(`Revocation adapter error: ${adapterErr.message}`, adapterErr);
    }
  }

  // 3. Query durable database store
  try {
    const { data, error } = await supabase
      .from('revoked_tokens')
      .select('id, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) {
      // In non-production, if the migration hasn't been run yet in Supabase (PGRST205 schema cache not found),
      // fallback to durable local file store so revocations survive restarts without blocking local dev.
      if (error.code === 'PGRST205' && process.env.NODE_ENV !== 'production') {
        const fileStore = readLocalFileStore();
        const entry = fileStore.get(tokenHash);
        if (entry) {
          const expMs = new Date(entry.expires_at).getTime();
          if (now < expMs) {
            localCache.set(tokenHash, expMs);
            return true;
          }
        }
        return false;
      }

      console.error('🚨 [RevocationStore] Database query error checking revocation:', error.message);
      throw new RevocationStoreError(
        `Revocation store error: ${error.message}`,
        error
      );
    }

    if (!data) {
      return false; // Token hash is not in revoked list
    }

    // Verify token is still within its revocation window
    const expiresAt = new Date(data.expires_at).getTime();
    if (now < expiresAt) {
      localCache.set(tokenHash, expiresAt);
      return true;
    }

    return false;
  } catch (err) {
    if (err instanceof RevocationStoreError) throw err;
    console.error('🚨 [RevocationStore] Database lookup exception:', err.message);
    throw new RevocationStoreError(`Durable revocation lookup failed: ${err.message}`, err);
  }
}

/**
 * Synchronous revocation check against local hot-cache for legacy middleware callers.
 * Note: Asynchronous isTokenRevoked() should always be preferred for protected endpoints.
 * @param {string} token
 * @returns {boolean}
 */
function isTokenRevokedSync(token) {
  if (!token || typeof token !== 'string') return true;
  try {
    const tokenHash = hashToken(token);
    const cachedExpiry = localCache.get(tokenHash);
    if (cachedExpiry !== undefined && Date.now() < cachedExpiry) {
      return true;
    }
    return false;
  } catch (_) {
    return true;
  }
}

/**
 * Cleans up expired entries from the durable database store and local cache.
 * @returns {Promise<number>} Number of deleted records (if supported)
 */
async function cleanExpiredRevocations() {
  const now = Date.now();
  // Clean local cache
  for (const [hash, exp] of localCache.entries()) {
    if (now >= exp) {
      localCache.delete(hash);
    }
  }

  if (customStoreAdapter && typeof customStoreAdapter.cleanExpired === 'function') {
    return await customStoreAdapter.cleanExpired();
  }

  // Also clean local file store if present
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const current = readLocalFileStore();
      const obj = {};
      for (const [k, v] of current.entries()) {
        if (v && v.expires_at && new Date(v.expires_at).getTime() > now) {
          obj[k] = v;
        }
      }
      fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    }
  } catch (_) {}

  try {
    const nowIso = new Date(now).toISOString();
    const { data, error } = await supabase
      .from('revoked_tokens')
      .delete()
      .lt('expires_at', nowIso)
      .select('id');

    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn('⚠️ [RevocationStore] Cleanup warning:', error.message);
      }
      return 0;
    }
    return data ? data.length : 0;
  } catch (err) {
    console.warn('⚠️ [RevocationStore] Cleanup exception:', err.message);
    return 0;
  }
}

// Background cleanup job runs every 1 hour (unref'd to not hold open process)
const cleanupInterval = setInterval(() => {
  cleanExpiredRevocations().catch(() => {});
}, 60 * 60 * 1000);
if (cleanupInterval.unref) cleanupInterval.unref();

// Testing / diagnostics helpers
function _clearLocalCache() {
  localCache.clear();
}

function _setCustomStore(adapter) {
  customStoreAdapter = adapter;
}

function _getLocalCacheSize() {
  return localCache.size;
}

module.exports = {
  hashToken,
  revokeToken,
  isTokenRevoked,
  isTokenRevokedSync,
  cleanExpiredRevocations,
  RevocationStoreError,
  _clearLocalCache,
  _setCustomStore,
  _getLocalCacheSize,
};
