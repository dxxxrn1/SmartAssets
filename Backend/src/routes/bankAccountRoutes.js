// ─── SmartAssets Bank Account Routes ─────────────────────────────────────────
// Handles user bank account submissions and status checks for withdrawals.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const {
  submitBankAccount,
  getBankAccount,
} = require('../controllers/userController');

router.use(requireAuth);

// POST /bank-accounts (submit bank account details for admin approval)
router.post('/', submitBankAccount);

// GET /bank-accounts (get current user's bank account status)
router.get('/', getBankAccount);

module.exports = router;
