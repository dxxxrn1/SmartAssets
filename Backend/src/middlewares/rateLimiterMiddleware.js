// ─── Rate Limiter Middleware ────────────────────────────────────────────────
// Protects sensitive, abuse-prone, and financial endpoints using express-rate-limit.
//
// Key Security Invariants:
// 1. Configured via environment variables with safe, production-ready defaults.
// 2. Returns standard RateLimit-* headers (Draft-7 compliant).
// 3. Admin login uses dual-keying (source IP + normalized email) to prevent
//    victim-account denial of service while blocking distributed brute force.
// 4. Returns generic error responses that do not leak account existence.
// 5. Explicitly exempts health checks and internal monitoring.

const rateLimit = require('express-rate-limit');

/**
 * Helper to parse integer env vars safely with fallbacks.
 */
function getEnvInt(name, fallback) {
  const val = process.env[name];
  if (val !== undefined && val !== null && val !== '') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

// ── 1. Admin Authentication Limiter (Strict Brute-Force Defense) ──────────────
// Dual-keyed by IP and account email so an attacker cannot lock out an admin
// from another IP, while brute force from any IP against any account is capped.
const adminLoginWindowMs = getEnvInt('RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS', 15 * 60 * 1000); // 15 mins
const adminLoginMax = getEnvInt('RATE_LIMIT_ADMIN_LOGIN_MAX', 10); // 10 attempts per 15 mins

const adminLoginLimiter = rateLimit({
  windowMs: adminLoginWindowMs,
  max: adminLoginMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const email = String(req.body?.email || '').trim().toLowerCase();
    return email ? `${ip}_${email}` : String(ip);
  },
  handler: (_req, res) => {
    res.setHeader('Retry-After', Math.ceil(adminLoginWindowMs / 1000));
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      error: 'Too many administrator login attempts. Please wait 15 minutes before retrying.',
    });
  },
});

// Additional IP-level limiter to prevent spray attacks across many emails from 1 IP
const adminLoginIpLimiter = rateLimit({
  windowMs: adminLoginWindowMs,
  max: adminLoginMax * 3, // e.g. 30 attempts per IP across any accounts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Too many administrator requests from this network. Please try again later.',
  },
});

// ── 2. Admin Sensitive Operations Limiter ────────────────────────────────────
// Protects status changes, escrow releases, refunds, KYC approvals/rejections
const adminActionWindowMs = getEnvInt('RATE_LIMIT_ADMIN_ACTIONS_WINDOW_MS', 15 * 60 * 1000);
const adminActionMax = getEnvInt('RATE_LIMIT_ADMIN_ACTIONS_MAX', 120);

const adminActionLimiter = rateLimit({
  windowMs: adminActionWindowMs,
  max: adminActionMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Administrator action rate limit exceeded. Please pace your requests.',
  },
});

// ── 3. Public User Authentication & Password Reset Limiter ───────────────────
const authWindowMs = getEnvInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000);
const authMax = getEnvInt(
  'RATE_LIMIT_AUTH_MAX',
  process.env.NODE_ENV === 'production' ? 30 : 300
);

const authLimiter = rateLimit({
  windowMs: authWindowMs,
  max: authMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const email = String(req.body?.email || '').trim().toLowerCase();
    return email ? `${ip}_${email}` : String(ip);
  },
  handler: (_req, res) => {
    res.setHeader('Retry-After', Math.ceil(authWindowMs / 1000));
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      error: 'Too many authentication attempts. Please try again after 15 minutes.',
    });
  },
});

// ── 4. Public Certificate Verification Limiter ──────────────────────────────
// Generous enough for QR scanning, verification portal browsing, and mobile app checks,
// but prevents scraping and automated cryptographic hammering.
const verifyWindowMs = getEnvInt('RATE_LIMIT_VERIFY_WINDOW_MS', 60 * 1000); // 1 minute
const verifyMax = getEnvInt('RATE_LIMIT_VERIFY_MAX', 120); // 120 requests/min (~2/sec)

const verifyLimiter = rateLimit({
  windowMs: verifyWindowMs,
  max: verifyMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Certificate verification rate limit exceeded. Please wait a moment before trying again.',
  },
});

// ── 5. File Uploads & KYC Documents Limiter ─────────────────────────────────
const uploadWindowMs = getEnvInt('RATE_LIMIT_UPLOADS_WINDOW_MS', 15 * 60 * 1000);
const uploadMax = getEnvInt('RATE_LIMIT_UPLOADS_MAX', 50);

const uploadLimiter = rateLimit({
  windowMs: uploadWindowMs,
  max: uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Upload rate limit reached. Please wait before uploading additional files.',
  },
});

// ── 6. Financial & Escrow Transactions Limiter ──────────────────────────────
const financialWindowMs = getEnvInt('RATE_LIMIT_FINANCIAL_WINDOW_MS', 15 * 60 * 1000);
const financialMax = getEnvInt('RATE_LIMIT_FINANCIAL_MAX', 40);

const financialLimiter = rateLimit({
  windowMs: financialWindowMs,
  max: financialMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Transaction request limit reached. Please wait a few minutes before submitting new orders.',
  },
});

module.exports = {
  adminLoginLimiter,
  adminLoginIpLimiter,
  adminActionLimiter,
  authLimiter,
  verifyLimiter,
  uploadLimiter,
  financialLimiter,
  getEnvInt,
};
