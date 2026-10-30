// ─── SmartAssets Auth Routes ─────────────────────────────────────────────────
const express = require('express');

const {
  register,
  verifyEmail,
  resendVerificationCode,
  login,
  walletLogin,
  getWalletNonce,
  linkWallet,
  unlinkWallet,
  registerWallet,
  completeWalletProfile,
  logout,
  sessionTimeout,
  forgotPassword,
  verifyRecoveryCode,
  resetPassword,
  verifySession,
} = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { rateLimiter } = require('../middlewares/securityMiddleware');

const router = express.Router();

// General authentication rate limiter: 30 requests per 15 minutes per IP
const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 30,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// Sensitive OTP verification rate limiter: strictly 10 attempts per 15 minutes to block brute-force attacks
const otpVerifyLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many verification attempts. Please try again in 15 minutes.',
});

// OTP code resend rate limiter: max 5 requests per 15 minutes to prevent email spamming
const otpResendLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many resend attempts. Please wait before requesting another code.',
});

// Dedicated password recovery request limiter: max 5 requests per 15 minutes
const forgotPasswordLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many password reset requests. Please try again in 15 minutes.',
});

// Dedicated password reset execution limiter: max 5 attempts per 15 minutes
const resetPasswordLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many password reset attempts. Please try again in 15 minutes.',
});

// ── Email/Password Authentication & Verification ─────────────────────────────
router.post('/register', authLimiter, register);
router.post('/verify-email', otpVerifyLimiter, verifyEmail);
router.post('/resend-code', otpResendLimiter, resendVerificationCode);
router.post('/login', authLimiter, login);

// ── Password Recovery & Reset Flow ───────────────────────────────────────────
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/verify-recovery-code', otpVerifyLimiter, verifyRecoveryCode);
router.post('/reset-password', resetPasswordLimiter, resetPassword);

// ── Session & Logout ─────────────────────────────────────────────────────────
router.post('/logout', logout);
router.post('/session-timeout', sessionTimeout);
router.get('/session', verifySession);

// ── Web3 MetaMask Cryptographic Challenge-Response Routes ────────────────────
router.post('/wallet/nonce', authLimiter, getWalletNonce);
router.post('/wallet/link', requireAuth, linkWallet);
router.post('/wallet/login', authLimiter, walletLogin);
router.post('/wallet/unlink', requireAuth, unlinkWallet);
router.post('/wallet/register', authLimiter, registerWallet);
router.post('/wallet/complete-profile', authLimiter, completeWalletProfile);

// Legacy alias
router.post('/wallet-login', authLimiter, walletLogin);

module.exports = router;
