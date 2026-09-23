// ─── User Routes ─────────────────────────────────────────────────────────────
// All endpoints require valid JWT authentication header.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const {
  getVault,
  addHolding,
  seedStarterHoldings,
  getProfile,
  updateProfile,
  deleteAccount,
  deposit,
  withdraw,
  getTransactions,
  lodgeSupport,
  getSupportTickets,
} = require('../controllers/userController');

// All user routes are protected by requireAuth
router.use(requireAuth);

router.get('/vault', getVault);
router.post('/vault', addHolding);
router.post('/seed-starter', seedStarterHoldings);

// Vault Balance, Deposits & Withdrawals
router.post('/deposit', deposit);
router.post('/withdraw', withdraw);
router.get('/transactions', getTransactions);

// Profile & Account Management
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.delete('/account', deleteAccount);

// Support Inquiries
router.post('/support', lodgeSupport);
router.get('/support', getSupportTickets);

module.exports = router;

