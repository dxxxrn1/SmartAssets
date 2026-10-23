// ─── Auth Routes ─────────────────────────────────────────────────────────────
const express = require('express');

const {
  register,
  login,
  walletLogin,
  forgotPassword,
  resetPassword,
  logout,
  verifySession,
} = require('../controllers/authController');
const { rateLimiter } = require('../middlewares/securityMiddleware');

const router = express.Router();

// Sensitive endpoint rate limiting: max 30 requests per minute per IP
const authLimiter = rateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'Too many authentication attempts. Please try again in 1 minute.',
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/wallet-login', authLimiter, walletLogin);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/logout', logout);
router.get('/session', verifySession);

module.exports = router;