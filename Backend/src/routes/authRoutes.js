// ─── SmartAssets Auth Routes ─────────────────────────────────────────────────
const express = require('express');

const {
  register,
  login,
  walletLogin,
  getWalletNonce,
  linkWallet,
  unlinkWallet,
  completeWalletProfile,
  logout,
  sessionTimeout,
  forgotPassword,
  resetPassword,
  verifySession,
} = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');
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
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/logout', logout);
router.post('/session-timeout', sessionTimeout);
router.get('/session', verifySession);

// ── Web3 MetaMask Cryptographic Challenge-Response Routes ────────────────────
router.post('/wallet/nonce', authLimiter, getWalletNonce);
router.post('/wallet/link', requireAuth, linkWallet);
router.post('/wallet/login', authLimiter, walletLogin);
router.post('/wallet/unlink', requireAuth, unlinkWallet);
router.post('/wallet/complete-profile', authLimiter, completeWalletProfile);

// Legacy alias
router.post('/wallet-login', authLimiter, walletLogin);

module.exports = router;
