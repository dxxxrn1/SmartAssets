// ─── Auth Routes ─────────────────────────────────────────────────────────────
// POST /api/auth/register      — Create a new user account
// POST /api/auth/login         — Sign in with email + password
// POST /api/auth/wallet-login  — Sign in / register via MetaMask wallet
// POST /api/auth/forgot-password — Send a password reset email

const express = require('express');

const {
  register,
  login,
  walletLogin,
  forgotPassword,
} = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/wallet-login', walletLogin);
router.post('/forgot-password', forgotPassword);

module.exports = router;