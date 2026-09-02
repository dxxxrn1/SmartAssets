// ─── Auth Routes ─────────────────────────────────────────────────────────────
// POST /api/auth/register      — Create a new user account
// POST /api/auth/login         — Sign in with email + password
// POST /api/auth/wallet-login  — Sign in / register via MetaMask wallet

const express = require('express');
const router = express.Router();
const { register, login, walletLogin } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/wallet-login', walletLogin);

module.exports = router;
