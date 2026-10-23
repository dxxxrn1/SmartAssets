// ─── SmartAssets Auth Routes ─────────────────────────────────────────────────
const express = require('express');

const {
  register,
  login,
  walletLogin,
  logout,
  sessionTimeout,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/wallet-login', walletLogin);
router.post('/logout', logout);
router.post('/session-timeout', sessionTimeout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
