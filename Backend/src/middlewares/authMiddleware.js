// ─── Authentication Middleware ───────────────────────────────────────────────
// Validates Supabase JWT access tokens from the Authorization header,
// enforces cryptographic token expiration, checks against revoked session tokens,
// enforces compliance suspension locks, and provides server-side KYC, Bank Approval,
// and Admin role enforcement middlewares.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const complianceService = require('../services/complianceService');
const presenceService = require('../services/presenceService');

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

    // Enforce compliance account suspension lock
    const compliance = complianceService.getUserCompliance(user.id, user.email);
    if (compliance && compliance.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Please contact support.');
    }

    req.user = user;
    req.compliance = compliance;
    req.token = token;

    try {
      presenceService.recordActivity(user.id, {
        email: user.email,
        fullName: user.user_metadata?.full_name || user.user_metadata?.name || '',
        role: user.role || 'user',
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent'],
        endpoint: req.originalUrl,
      });
    } catch (_) {}

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
          const compliance = complianceService.getUserCompliance(user.id, user.email);
          req.user = user;
          req.compliance = compliance;
          req.token = token;
        }
      }
    }
  } catch (_) {
    // Proceed unauthenticated if token lookup fails
  }
  next();
}

// ─── Admin Session Token Helpers (Hardened PKI & Secret Management) ──────────
const MIN_ADMIN_JWT_SECRET_LENGTH = 32;
const ADMIN_JWT_ISSUER = 'smartassets-admin-authority';
const ADMIN_JWT_AUDIENCE = 'smartassets-admin-portal';

const PROHIBITED_ADMIN_SECRETS = new Set([
  'smartassets-admin-hmac-secret-2026',
  'secret',
  'admin-secret',
  'password',
  '12345678901234567890123456789012',
  'smartassets-wallet-verified-token-secret-32chars',
]);

/**
 * Validates and retrieves the server-side ADMIN_JWT_SECRET.
 * Strict fail-closed rules:
 * - Must be present in process.env.ADMIN_JWT_SECRET.
 * - Must be at least 32 characters in length (256-bit security).
 * - Must not match known default or prohibited values.
 * - Must not reuse the Supabase service role key.
 * - Never falls back to a development default or client-accessible secret.
 * @returns {string}
 */
function getValidatedAdminSecret() {
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV !== 'test') {
    try {
      const path = require('path');
      require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), override: true });
      require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: true });
    } catch (_) {}
  }
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || typeof secret !== 'string') {
    const err = new Error(
      'ADMIN_AUTH_CONFIG_ERROR: ADMIN_JWT_SECRET is not configured in server environment.'
    );
    err.code = 'ADMIN_AUTH_CONFIG_ERROR';
    throw err;
  }
  const clean = secret.trim();
  if (clean.length < MIN_ADMIN_JWT_SECRET_LENGTH) {
    const err = new Error(
      `ADMIN_AUTH_CONFIG_ERROR: ADMIN_JWT_SECRET is too weak (${clean.length} chars). Minimum required is ${MIN_ADMIN_JWT_SECRET_LENGTH} characters.`
    );
    err.code = 'ADMIN_AUTH_CONFIG_ERROR';
    throw err;
  }
  if (PROHIBITED_ADMIN_SECRETS.has(clean.toLowerCase())) {
    const err = new Error(
      'ADMIN_AUTH_CONFIG_ERROR: ADMIN_JWT_SECRET matches a prohibited or default value.'
    );
    err.code = 'ADMIN_AUTH_CONFIG_ERROR';
    throw err;
  }
  if (
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    clean === process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  ) {
    const err = new Error(
      'ADMIN_AUTH_CONFIG_ERROR: ADMIN_JWT_SECRET must not reuse the Supabase service role key.'
    );
    err.code = 'ADMIN_AUTH_CONFIG_ERROR';
    throw err;
  }
  return clean;
}

/**
 * Validates admin auth configuration at server startup.
 * Logs a clear warning or throws if in production.
 */
function validateAdminAuthConfig() {
  try {
    getValidatedAdminSecret();
    console.log('🔒 [Security] Administrator authentication configuration validated (ADMIN_JWT_SECRET length >= 32 chars).');
    return { valid: true };
  } catch (err) {
    const msg = `[Security Error] ${err.message}`;
    if (process.env.NODE_ENV === 'production') {
      console.error(`🚨 ${msg}`);
      throw err;
    } else {
      console.warn(`⚠️ ${msg} Administrator authentication is disabled (fail-closed) until configured.`);
      return { valid: false, error: err.message };
    }
  }
}

// Deprecated empty allowlist for backwards-compatibility imports.
// Authoritative role assignment is exclusively governed by public.profiles.role = 'admin'.
const CONFIGURED_ADMIN_EMAILS = Object.freeze(new Set());

/**
 * Generates an HMAC-SHA256 admin session token.
 * Payload strictly encodes immutable identity, role, issuer, audience, and 12-hour expiry.
 * @param {object} adminPayload - { id, email, fullName }
 * @returns {string} Signed JWT
 */
function createAdminToken(adminPayload) {
  if (!adminPayload || typeof adminPayload !== 'object') {
    throw new Error('createAdminToken: admin payload object is required.');
  }
  if (!adminPayload.id || !adminPayload.email) {
    throw new Error('createAdminToken: admin id and email are required.');
  }

  const secret = getValidatedAdminSecret();

  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      sub: String(adminPayload.id),
      email: String(adminPayload.email).toLowerCase(),
      fullName: adminPayload.fullName || 'Administrator',
      role: 'admin',
      iss: ADMIN_JWT_ISSUER,
      aud: ADMIN_JWT_AUDIENCE,
      iat: nowSec,
      exp: nowSec + 12 * 60 * 60, // 12 hours
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Cryptographically verifies an admin session token.
 * Strictly verifies signature with constant-time equality, algorithm, issuer, audience, role, and expiry.
 * Fails closed on any error, missing configuration, tampering, or revocation.
 * @param {string} token
 * @returns {object|null} Decoded payload if valid; null otherwise
 */
function verifyAdminToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    if (isTokenRevoked(token)) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const secret = getValidatedAdminSecret();

    const crypto = require('crypto');
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    // Constant-time comparison to protect against timing attacks
    const sigBuf = Buffer.from(parts[2]);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    // Verify header algorithm
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    // Verify payload claims
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== 'number' || nowSec >= payload.exp) {
      return null; // Expired
    }
    if (typeof payload.iat === 'number' && payload.iat > nowSec + 60) {
      return null; // Future-dated token
    }
    if (payload.iss !== ADMIN_JWT_ISSUER || payload.aud !== ADMIN_JWT_AUDIENCE) {
      return null; // Issuer / audience mismatch
    }
    if (payload.role !== 'admin') {
      return null; // Role tampering
    }
    if (!payload.sub || !payload.email) {
      return null;
    }

    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * Authoritatively verifies whether a Supabase user has `profiles.role === 'admin'`.
 * Strictly queries the durable database profiles record.
 * Never trusts client-supplied user_metadata, app_metadata, email allowlists, or unverified claims.
 * @param {object} user - Supabase auth user object
 * @returns {Promise<boolean>}
 */
async function isUserAdmin(user) {
  if (!user || !user.id) return false;
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !profile) {
      return false;
    }
    return profile.role === 'admin';
  } catch (_) {
    return false;
  }
}

/**
 * Middleware: requireVerified
 * Checks `profiles.verification_status === 'verified'` (and hybrid compliance store),
 * otherwise returns HTTP 403.
 */
async function requireVerified(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Unauthorized: Authentication required.', 'NO_TOKEN');
    }

    const userId = req.user.id;
    const userEmail = req.user.email;

    // 1. Check hybrid compliance bundle (checks both individual 3-doc rule & dossier status)
    let bundle = null;
    try {
      bundle = await complianceService.getVerificationStatusBundle(userId, userEmail);
    } catch (bundleErr) {
      console.warn('⚠️ [requireVerified] Error reading compliance bundle:', bundleErr.message);
      // Fail closed: bundle remains null
    }
    let isVerified = Boolean(bundle && bundle.verification_status === 'verified');

    // 2. Also check Supabase `profiles.verification_status` directly if not yet verified in local store
    if (!isVerified) {
      try {
        const { data: profile, error: dbError } = await supabase
          .from('profiles')
          .select('verification_status')
          .eq('id', userId)
          .maybeSingle();

        if (dbError) {
          console.warn('⚠️ [requireVerified] DB error checking profile verification_status:', dbError.message);
          // Fail closed: database lookup error must never count as verified
        } else if (profile && profile.verification_status === 'verified') {
          isVerified = true;
        }
      } catch (err) {
        console.warn('⚠️ [requireVerified] Exception checking profile verification_status:', err.message);
        // Fail closed
      }
    }

    if (!isVerified) {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        verification_status: bundle?.verification_status || 'unverified',
        error:
          'Account verification required. You must upload and get all 3 verification documents (ID Document, Tax Document, and Proof of Residence) approved by an admin before performing this action.',
      });
    }

    req.verificationBundle = bundle;
    next();
  } catch (err) {
    console.error('requireVerified middleware error:', err);
    return res.status(403).json({
      success: false,
      code: 'KYC_REQUIRED',
      error: 'Account verification required. Failed to verify account compliance status.',
    });
  }
}

/**
 * Middleware: requireApprovedBank
 * Checks that the user has at least one `bank_accounts` row with `status = 'approved'`,
 * otherwise returns HTTP 403.
 */
async function requireApprovedBank(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Unauthorized: Authentication required.', 'NO_TOKEN');
    }

    const userId = req.user.id;
    const userEmail = req.user.email;

    let hasApprovedBank = false;
    let bankRecord = complianceService.getUserBankAccount(userId, userEmail);

    if (bankRecord && bankRecord.status === 'approved') {
      hasApprovedBank = true;
    }

    // Also query Supabase `bank_accounts` table
    if (!hasApprovedBank) {
      try {
        const { data: sbBank } = await supabase
          .from('bank_accounts')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'approved')
          .limit(1)
          .maybeSingle();
        if (sbBank && sbBank.status === 'approved') {
          hasApprovedBank = true;
          bankRecord = sbBank;
        }
      } catch (_) {}
    }

    if (!hasApprovedBank) {
      return res.status(403).json({
        success: false,
        code: 'BANK_APPROVAL_REQUIRED',
        bank_status: bankRecord?.status || 'not_submitted',
        error:
          'Approved bank account required. Please submit your bank details and wait for admin approval before withdrawing funds.',
      });
    }

    req.approvedBankAccount = bankRecord;
    next();
  } catch (err) {
    console.error('requireApprovedBank middleware error:', err);
    return res.status(403).json({
      success: false,
      code: 'BANK_APPROVAL_REQUIRED',
      error: 'Approved bank account required. Failed to verify bank approval status.',
    });
  }
}

/**
 * Middleware: requireAdmin
 * Checks `profiles.role === 'admin'` (or verified admin session token), else returns 403.
 */
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'ADMIN_AUTH_REQUIRED',
        error: 'Access denied. Admin authentication token is required.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token || isTokenRevoked(token)) {
      return res.status(401).json({
        success: false,
        code: 'ADMIN_SESSION_INVALID',
        error: 'Access denied. Admin session is invalid or expired.',
      });
    }

    // 1. Check HMAC-signed admin session token from POST /api/admin/auth/login
    const adminPayload = verifyAdminToken(token);
    if (adminPayload && adminPayload.role === 'admin') {
      req.admin = {
        id: adminPayload.sub,
        email: adminPayload.email,
        fullName: adminPayload.fullName || 'Compliance Admin',
        role: 'admin',
      };
      req.user = req.admin;
      try {
        presenceService.recordActivity(req.admin.id, {
          email: req.admin.email,
          fullName: req.admin.fullName,
          role: 'admin',
          ip: req.ip || req.connection?.remoteAddress,
          userAgent: req.headers['user-agent'],
          clientType: 'Admin Console',
          endpoint: req.originalUrl,
        });
      } catch (_) {}
      return next();
    }

    // 2. Otherwise validate Supabase JWT and check `profiles.role === 'admin'`
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({
        success: false,
        code: 'ADMIN_SESSION_EXPIRED',
        error: 'Access denied. Invalid or expired session token.',
      });
    }

    const adminAllowed = await isUserAdmin(user);
    if (!adminAllowed) {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_REQUIRED',
        error: 'Access denied. Admin privileges required (profiles.role must be "admin").',
      });
    }

    req.admin = {
      id: user.id,
      email: user.email,
      fullName: user.user_metadata?.full_name || 'Compliance Admin',
      role: 'admin',
    };
    req.user = user;
    try {
      presenceService.recordActivity(req.admin.id, {
        email: req.admin.email,
        fullName: req.admin.fullName,
        role: 'admin',
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent'],
        clientType: 'Admin Console',
        endpoint: req.originalUrl,
      });
    } catch (_) {}
    return next();
  } catch (err) {
    console.error('requireAdmin middleware error:', err);
    return sendError(res, 500, 'Internal admin authorization error.');
  }
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireVerified,
  requireApprovedBank,
  requireAdmin,
  createAdminToken,
  verifyAdminToken,
  getValidatedAdminSecret,
  validateAdminAuthConfig,
  MIN_ADMIN_JWT_SECRET_LENGTH,
  isUserAdmin,
  CONFIGURED_ADMIN_EMAILS,
  revokeToken,
  isTokenRevoked,
  parseJwtPayload,
};
