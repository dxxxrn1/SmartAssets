// ─── SmartAssets User Presence & Online Tracking Service ─────────────────────
// Real-time user presence tracking for the SmartAssets Operations & Admin Dashboard.
// Tracks active collector sessions across Mobile App (Expo) and Web, calculates online/idle/offline
// states with high-precision time windows, and persists state to userPresence.json.

const fs = require('fs');
const path = require('path');

const PRESENCE_FILE = path.resolve(__dirname, '../data/userPresence.json');

// Presence windows (in milliseconds)
const ONLINE_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes = Online
const IDLE_WINDOW_MS = 15 * 60 * 1000;    // 5 - 15 minutes = Away / Idle

// In-memory cache for fast, zero-overhead lookups
let presenceCache = new Map();

/**
 * Loads persisted presence data from disk into the cache.
 */
function loadPresenceFromDisk() {
  try {
    if (fs.existsSync(PRESENCE_FILE)) {
      const raw = fs.readFileSync(PRESENCE_FILE, 'utf8');
      if (raw && raw.trim()) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          data.forEach((entry) => {
            if (entry && typeof entry.userId === 'string') {
              presenceCache.set(entry.userId, entry);
            }
          });
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [presenceService] Failed to read userPresence.json:', err.message);
  }
}

let saveTimer = null;

/**
 * Persists in-memory presence data to disk only when content changes.
 */
function savePresenceToDisk() {
  try {
    const list = Array.from(presenceCache.values());
    const json = JSON.stringify(list, null, 2);
    if (fs.existsSync(PRESENCE_FILE)) {
      try {
        const current = fs.readFileSync(PRESENCE_FILE, 'utf8');
        if (current.trim() === json.trim()) return; // Content unchanged, avoid touching disk / triggering watchers
      } catch (_) {}
    }
    fs.writeFileSync(PRESENCE_FILE, json, 'utf8');
  } catch (err) {
    console.warn('⚠️ [presenceService] Failed to write userPresence.json:', err.message);
  }
}

/**
 * Debounced persistence helper (max once every 30 seconds).
 */
function scheduleSaveToDisk() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePresenceToDisk();
  }, 30000);
}

// Initial load
loadPresenceFromDisk();

/**
 * Computes current active presence status based on elapsed time.
 * @param {object} entry
 * @returns {'online'|'idle'|'offline'}
 */
function computeStatus(entry) {
  if (!entry) return 'offline';
  if (entry.status === 'offline') return 'offline';
  const now = Date.now();
  const lastTs = entry.lastTimestamp || (entry.lastSeen ? new Date(entry.lastSeen).getTime() : 0);
  const diff = now - lastTs;

  if (diff <= ONLINE_WINDOW_MS) return 'online';
  if (diff <= IDLE_WINDOW_MS) return 'idle';
  return 'offline';
}

/**
 * Formats relative timestamp for human readability.
 * @param {number|string} timestamp
 * @returns {string}
 */
function formatLastSeen(timestamp) {
  if (!timestamp) return 'Never';
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);

  if (diffSec < 15) return 'Active just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Normalizes client type from User-Agent or headers.
 * @param {string} userAgent
 * @returns {'Mobile App'|'Web Portal'|'Admin Console'|'API Client'}
 */
function detectClientType(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  if (ua.includes('smartassets-admin') || ua.includes('admin')) return 'Admin Console';
  if (ua.includes('okhttp') || ua.includes('cfnetwork') || ua.includes('expo') || ua.includes('mobile')) return 'Mobile App';
  if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) return 'Web Portal';
  return 'API Client';
}

/**
 * Records activity for a user (called upon request, login, or heartbeat).
 * @param {string} userId
 * @param {object} metadata
 */
function recordActivity(userId, metadata = {}) {
  if (typeof userId === 'object' && userId !== null) {
    metadata = userId;
    userId = metadata.userId || metadata.id;
  }
  if (!userId) return;
  const now = Date.now();
  const existing = presenceCache.get(userId) || {};

  const entry = {
    userId,
    email: metadata.email || existing.email || '—',
    fullName: metadata.fullName || metadata.name || existing.fullName || 'Collector',
    role: metadata.role || existing.role || 'user',
    lastSeen: new Date(now).toISOString(),
    lastTimestamp: now,
    status: 'online',
    ip: metadata.ip || existing.ip || '127.0.0.1',
    device: metadata.userAgent || existing.device || 'SmartAssets Client',
    clientType: metadata.clientType || detectClientType(metadata.userAgent),
    lastEndpoint: metadata.endpoint || existing.lastEndpoint || '/',
    connectedSince: existing.connectedSince && computeStatus(existing) === 'online' ? existing.connectedSince : new Date(now).toISOString(),
  };

  presenceCache.set(userId, entry);
  scheduleSaveToDisk();
  return entry;
}

/**
 * Marks a user as explicitly offline (e.g. on logout or timeout).
 * @param {string} userId
 * @param {string} reason
 */
function setUserOffline(userId, reason = 'logout') {
  if (!userId) return;
  const existing = presenceCache.get(userId);
  if (existing) {
    existing.status = 'offline';
    existing.lastSeen = new Date().toISOString();
    existing.lastTimestamp = Date.now();
    existing.offlineReason = reason;
    presenceCache.set(userId, existing);
    savePresenceToDisk();
  }
}

/**
 * Retrieves the presence object for a specific user.
 * @param {string} userId
 * @returns {object}
 */
function getUserPresence(userId) {
  const entry = presenceCache.get(userId);
  if (!entry) {
    return {
      userId,
      isOnline: false,
      status: 'offline',
      lastSeen: null,
      lastSeenText: 'Never',
      clientType: '—',
    };
  }

  const status = computeStatus(entry);
  return {
    ...entry,
    isOnline: status === 'online',
    isIdle: status === 'idle',
    status,
    lastSeenText: formatLastSeen(entry.lastTimestamp),
  };
}

/**
 * Returns all currently online users.
 * @returns {Array<object>}
 */
function getOnlineUsers() {
  const result = [];
  for (const entry of presenceCache.values()) {
    if (computeStatus(entry) === 'online') {
      result.push({
        ...entry,
        isOnline: true,
        status: 'online',
        lastSeenText: formatLastSeen(entry.lastTimestamp),
      });
    }
  }
  return result;
}

/**
 * Returns all currently idle users.
 * @returns {Array<object>}
 */
function getIdleUsers() {
  const result = [];
  for (const entry of presenceCache.values()) {
    if (computeStatus(entry) === 'idle') {
      result.push({
        ...entry,
        isOnline: false,
        isIdle: true,
        status: 'idle',
        lastSeenText: formatLastSeen(entry.lastTimestamp),
      });
    }
  }
  return result;
}

/**
 * Builds high-level presence overview combining cached presence with database users.
 * @param {Array<object>} registeredUsers
 * @returns {object}
 */
function getPresenceOverview(registeredUsers = []) {
  const onlineUsers = getOnlineUsers();
  const idleUsers = getIdleUsers();

  // Map known online users with rich database attributes (avatar, balance, kyc)
  const registeredMap = new Map();
  registeredUsers.forEach((u) => {
    if (u && u.id) registeredMap.set(u.id, u);
  });

  const enrichedOnlineList = onlineUsers.map((ou) => {
    const reg = registeredMap.get(ou.userId) || {};
    return {
      userId: ou.userId,
      fullName: reg.fullName || ou.fullName || 'Collector',
      email: reg.email || ou.email || '—',
      role: reg.role || ou.role || 'user',
      avatarUrl: reg.avatarUrl || null,
      balance: reg.balance || 0,
      kycStatus: reg.kycStatus || 'unverified',
      clientType: ou.clientType || 'Mobile App',
      lastEndpoint: ou.lastEndpoint || '/',
      connectedSince: ou.connectedSince || ou.lastSeen,
      lastSeenText: ou.lastSeenText,
      ip: ou.ip || '127.0.0.1',
      status: 'online',
    };
  });

  const total = registeredUsers.length || presenceCache.size;
  const onlineCount = onlineUsers.length;
  const idleCount = idleUsers.length;
  const offlineCount = Math.max(0, total - onlineCount - idleCount);

  return {
    total,
    onlineCount,
    idleCount,
    offlineCount,
    onlineUsers: enrichedOnlineList,
  };
}

module.exports = {
  recordActivity,
  setUserOffline,
  getUserPresence,
  getOnlineUsers,
  getIdleUsers,
  getPresenceOverview,
  formatLastSeen,
  computeStatus,
};
