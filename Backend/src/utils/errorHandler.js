// ─── Centralized Error Response Helper ───────────────────────────────────────
// Standardises all API error responses into a consistent JSON shape.

/**
 * Send a standardised error response.
 * @param {import('express').Response} res
 * @param {number} statusCode  HTTP status (400, 401, 409, 500, …)
 * @param {string} message     Human-readable error message
 */
function sendError(res, statusCode, message) {
  return res.status(statusCode).json({
    success: false,
    error: message,
  });
}

module.exports = { sendError };

