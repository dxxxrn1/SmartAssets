// ─── Authentication Middleware ───────────────────────────────────────────────
// Validates Supabase JWT access tokens from the Authorization header.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Unauthorized: No access token provided.');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return sendError(res, 401, 'Unauthorized: Invalid token format.');
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return sendError(res, 401, 'Unauthorized: Session expired or invalid token.');
    }

    req.user = user;
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
      if (token) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          req.user = user;
        }
      }
    }
  } catch (_) {
    // Proceed unauthenticated if token lookup fails
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
