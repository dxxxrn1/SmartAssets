// ─── Auth Routes ─────────────────────────────────────────────────────────────
const express = require('express');

const {
  register,
  login,
  walletLogin,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/wallet-login', walletLogin);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;