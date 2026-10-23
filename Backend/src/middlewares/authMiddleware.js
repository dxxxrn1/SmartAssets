// ─── Authentication Middleware ───────────────────────────────────────────────
// Validates Supabase JWT access tokens from the Authorization header,
// enforces cryptographic token expiration, and checks against revoked session tokens.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

// In-memory revoked token set (stores token hash -> expiration timestamp)
const revokedTokens = new Map();

// Periodically clean up expired revoked tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [tokenHash, expiresAt] of revokedTokens.entries()) {
    if (now >= expiresAt) {
      revokedTokens.delete(tokenHash);
    }
  }
}, 10 * 60 * 1000).unref();

function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Revokes an access token upon explicit logout or inactivity timeout.
 * @param {string} token
 */
function revokeToken(token) {
  if (!token || typeof token !== 'string') return;
  const hash = hashToken(token);
  // Default keep in blacklist for 24 hours (or until token expiry)
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  revokedTokens.set(hash, expiresAt);
}

/**
 * Checks if a token has been revoked.
 * @param {string} token
 * @returns {boolean}
 */
function isTokenRevoked(token) {
  if (!token || typeof token !== 'string') return true;
  const hash = hashToken(token);
  return revokedTokens.has(hash);
}

/**
 * Safely parses the unverified payload of a JWT to check client-side exp claim.
 * @param {string} token
 * @returns {object|null}
 */
function parseJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch (_) {
    return null;
  }
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Unauthorized: No access token provided.', 'NO_TOKEN');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return sendError(res, 401, 'Unauthorized: Invalid token format.', 'INVALID_TOKEN');
    }

    // 1. Check if token was explicitly revoked (e.g. from logout or inactivity timeout)
    if (isTokenRevoked(token)) {
      return sendError(
        res,
        401,
        'Unauthorized: This session has been terminated. Please log in again.',
        'SESSION_REVOKED'
      );
    }

    // 2. Check token expiration claim if available
    const payload = parseJwtPayload(token);
    if (payload && payload.exp && typeof payload.exp === 'number') {
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (nowInSeconds >= payload.exp) {
        return sendError(
          res,
          401,
          'Unauthorized: Session has expired. Please log in again.',
          'SESSION_EXPIRED'
        );
      }
    }

    // 3. Verify token authenticity with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return sendError(
        res,
        401,
        'Unauthorized: Session expired or invalid token.',
        'SESSION_EXPIRED'
      );
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return sendError(res, 500, 'Internal authentication verification error.');
  }
}

async function optionalAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token && !isTokenRevoked(token)) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          req.user = user;
          req.token = token;
        }
      }
    }
  } catch (_) {
    // Proceed unauthenticated if token lookup fails
  }
  next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  revokeToken,
  isTokenRevoked,
  parseJwtPayload,
};
