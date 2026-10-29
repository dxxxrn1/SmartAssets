// ─── Security & SQL Injection Protection Middleware ──────────────────────────
// Hardens Express against SQL Injection, PostgREST Filter Injection,
// Brute Force attacks, Clickjacking, and Header-based Vulnerabilities.

const crypto = require('crypto');

// ── 1. SQL Injection Signatures & Detection ─────────────────────────────────
// Comprehensive patterns targeting standard SQL, PostgreSQL, and PostgREST injection vectors.
const SQLI_PATTERNS = [
  // Union-based injection
  /(\b(UNION(\s+ALL)?)\s+SELECT\b)/i,
  // Tautology / Boolean bypass: e.g. ' OR 1=1 --, ' OR 'a'='a, 1' OR '1'='1
  /('\s*OR\s*('?[0-9a-z_]+'?)\s*=\s*('?[0-9a-z_]+'?))/i,
  /(\bOR\b\s+1\s*=\s*1)/i,
  /(\bAND\b\s+1\s*=\s*2)/i,
  /('\s*OR\s*1\s*=\s*1)/i,
  // Destructive / DDL injection commands
  /(;\s*(DROP|ALTER|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE)\s+)/i,
  // Time-based blind SQLi: pg_sleep, sleep, waitfor delay, benchmark
  /(\b(pg_sleep|sleep)\s*\(\s*\d+\s*\))/i,
  /(\bWAITFOR\s+DELAY\b)/i,
  /(\bBENCHMARK\s*\(\s*\d+\s*,)/i,
  // System catalog & schema enumeration
  /(\b(information_schema|sys\.tables|pg_catalog|pg_user|pg_shadow)\b)/i,
  // Execution wrappers
  /(\b(EXEC|EXECUTE|xp_cmdshell)\s*\()/i,
  // Quote escape followed by comment truncation (e.g. admin' -- or ' /*)
  /('\s*(--|\/\*|#))/,
  // Inline comment injection sequences followed by SQL keywords
  /(--\s*[\r\n]|\/\*[\s\S]*?\*\/)/,
];

/**
 * Recursively scans an object, array, or string for SQL injection patterns.
 * @param {*} value - The input to inspect.
 * @param {string} path - Breadcrumb path for logging.
 * @returns {{ isSafe: boolean, offendingValue?: string, matchedPattern?: string, path?: string }}
 */
function inspectValueForSqlInjection(value, path = '') {
  if (value === null || value === undefined) {
    return { isSafe: true };
  }

  if (typeof value === 'string') {
    // Check against SQLi signatures
    for (const pattern of SQLI_PATTERNS) {
      if (pattern.test(value)) {
        return {
          isSafe: false,
          offendingValue: value.length > 100 ? `${value.substring(0, 100)}...` : value,
          matchedPattern: pattern.toString(),
          path,
        };
      }
    }
    return { isSafe: true };
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = inspectValueForSqlInjection(value[i], `${path}[${i}]`);
      if (!result.isSafe) return result;
    }
    return { isSafe: true };
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      // Check keys for injection as well
      for (const pattern of SQLI_PATTERNS) {
        if (pattern.test(k)) {
          return {
            isSafe: false,
            offendingValue: k,
            matchedPattern: pattern.toString(),
            path: `${path}.${k}`,
          };
        }
      }
      const result = inspectValueForSqlInjection(v, `${path}.${k}`);
      if (!result.isSafe) return result;
    }
  }

  return { isSafe: true };
}

/**
 * Global SQL Injection Prevention Middleware.
 * Scans req.query, req.body, and req.params before routes process them.
 */
function sqlInjectionProtection(req, res, next) {
  // 1. Inspect URL Query Parameters
  const queryCheck = inspectValueForSqlInjection(req.query, 'query');
  if (!queryCheck.isSafe) {
    console.warn(`🛡️ [Security Alert] SQL Injection attempt blocked in req.query:`, {
      ip: req.ip || req.socket?.remoteAddress,
      method: req.method,
      url: req.originalUrl,
      path: queryCheck.path,
      offending: queryCheck.offendingValue,
    });
    return res.status(400).json({
      success: false,
      error: 'Security rejection: Suspicious query parameter pattern detected.',
      code: 'SQLI_DETECTED',
    });
  }

  // 2. Inspect URL Route Parameters
  const paramsCheck = inspectValueForSqlInjection(req.params, 'params');
  if (!paramsCheck.isSafe) {
    console.warn(`🛡️ [Security Alert] SQL Injection attempt blocked in req.params:`, {
      ip: req.ip || req.socket?.remoteAddress,
      method: req.method,
      url: req.originalUrl,
      path: paramsCheck.path,
      offending: paramsCheck.offendingValue,
    });
    return res.status(400).json({
      success: false,
      error: 'Security rejection: Suspicious route parameter pattern detected.',
      code: 'SQLI_DETECTED',
    });
  }

  // 3. Inspect JSON Body (skip large base64 image strings if already structured)
  if (req.body && typeof req.body === 'object') {
    const bodyCheck = inspectValueForSqlInjection(req.body, 'body');
    if (!bodyCheck.isSafe) {
      console.warn(`🛡️ [Security Alert] SQL Injection attempt blocked in req.body:`, {
        ip: req.ip || req.socket?.remoteAddress,
        method: req.method,
        url: req.originalUrl,
        path: bodyCheck.path,
        offending: bodyCheck.offendingValue,
      });
      return res.status(400).json({
        success: false,
        error: 'Security rejection: Suspicious request payload pattern detected.',
        code: 'SQLI_DETECTED',
      });
    }
  }

  next();
}

// ── 2. PostgREST Filter Sanitization Helper ─────────────────────────────────
/**
 * Sanitizes input strings destined for Supabase / PostgREST .or() or .filter() queries.
 * Strips PostgREST AST control characters (,, (, ), ., :, quotes, backslashes)
 * to prevent clause escaping and filter injection.
 * @param {string} input
 * @param {number} maxLength
 * @returns {string} Sanitized string safe for query construction.
 */
function sanitizePostgrestFilter(input, maxLength = 60) {
  if (!input || typeof input !== 'string') return '';
  // Strip control characters, quotes, commas, parentheses, colons, dots, semicolons, and operator keywords
  let clean = input
    .replace(/[(),;:"'\\%\0\r\n\t]/g, ' ')
    // Strip PostgREST operator injection tokens: eq., neq., gt., gte., lt., lte., like., ilike., in., is., not.
    .replace(/\b(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not|cs|cd|ov|sl|sr|nxr|nxl|adj)\./gi, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength).trim();
  }
  return clean;
}

// ── 3. UUID Validator Middleware ────────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Middleware factory to enforce valid UUID or alphanumeric format on specified route parameters.
 * Prevents PostgreSQL type error crashes (e.g. 22P02: invalid input syntax for type uuid).
 * @param {string[]} paramNames - List of parameter names to validate (e.g. ['id', 'assetId'])
 */
function validateIdParams(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const val = req.params[name];
      if (val) {
        if (!UUID_REGEX.test(val) && !SAFE_ID_REGEX.test(val)) {
          return res.status(400).json({
            success: false,
            error: `Invalid identifier format for parameter '${name}'. Must be a valid UUID or alphanumeric string.`,
            code: 'INVALID_IDENTIFIER',
          });
        }
      }
    }
    next();
  };
}

// ── 4. Financial-Grade Security Headers ──────────────────────────────────────
/**
 * Applies OWASP-recommended HTTP security headers to all responses.
 */
function securityHeaders(req, res, next) {
  // Remove Express fingerprinting
  res.removeHeader('X-Powered-By');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent Clickjacking on sensitive financial actions
  res.setHeader('X-Frame-Options', 'DENY');

  // Modern Cross-Site Scripting (XSS) filter
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Enforce HTTPS HSTS only when production HTTPS is terminated
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.ENFORCE_HSTS === 'true' || process.env.HTTPS === 'true')
  ) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Cross-Origin Resource Policy
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  // Permissions Policy (Least privilege for fintech/compliance dashboard)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  next();
}

// ── 5. Sliding-Window Rate Limiter ──────────────────────────────────────────
/**
 * In-memory sliding-window rate limiter to protect authentication and financial endpoints
 * against brute-force attacks and credential stuffing.
 * @param {{ windowMs: number, maxRequests: number, message?: string }} options
 */
function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // default 1 minute
  const maxRequests = options.maxRequests || 30;  // default 30 requests / window
  const message = options.message || 'Too many requests. Please try again shortly.';
  const hits = new Map();

  // Periodically clean up stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, records] of hits.entries()) {
      const valid = records.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, valid);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-ip';
    const now = Date.now();
    const timestamps = hits.get(ip) || [];

    const activeTimestamps = timestamps.filter((t) => now - t < windowMs);

    if (activeTimestamps.length >= maxRequests) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    activeTimestamps.push(now);
    hits.set(ip, activeTimestamps);
    next();
  };
}

module.exports = {
  sqlInjectionProtection,
  sanitizePostgrestFilter,
  validateIdParams,
  securityHeaders,
  rateLimiter,
  inspectValueForSqlInjection,
};
