// ─── SmartAssets User Routes ─────────────────────────────────────────────────
// All endpoints require valid JWT authentication header.
// Deposits require `requireVerified` (all 3 KYC documents approved).
// Withdrawals require `requireVerified` + `requireApprovedBank` (approved bank account).

const express = require('express');
const router = express.Router();
const {
  requireAuth,
  requireVerified,
  requireApprovedBank,
} = require('../middlewares/authMiddleware');
const {
  getVault,
  addHolding,
  seedStarterHoldings,
  getProfile,
  updateProfile,
  deleteAccount,
  deposit,
  withdraw,
  cancelWithdrawal,
  getTransactions,
  lodgeSupport,
  getSupportTickets,
  getAnalytics,
  submitKyc,
  getKycStatus,
  uploadVerificationDocument,
  getVerificationStatus,
  submitBankAccount,
  getBankAccount,
  getNotificationPreferences,
  updateNotificationPreferences,
} = require('../controllers/userController');

// All user routes are protected by requireAuth
router.use(requireAuth);

router.get('/vault', getVault);
router.post('/vault', addHolding);
router.post('/seed-starter', seedStarterHoldings);

// Vault Balance, Deposits & Withdrawals (server-side KYC + Bank Account enforcement)
router.post('/deposit', requireVerified, requireApprovedBank, deposit);
router.post('/withdraw', requireVerified, requireApprovedBank, withdraw);
router.post('/withdraw/:id/cancel', cancelWithdrawal);
router.get('/transactions', getTransactions);

// Profile & Account Management
router.get('/profile', getProfile);
router.get('/analytics', getAnalytics);
router.put('/profile', updateProfile);
router.delete('/account', deleteAccount);
router.get('/notifications/preferences', getNotificationPreferences);
router.put('/notifications/preferences', updateNotificationPreferences);

// FICA / KYC Compliance Submission & Status (both granular 3-doc and full dossier endpoints)
router.post('/kyc-submit', submitKyc);
router.get('/kyc-status', getKycStatus);
router.post('/verification/documents', uploadVerificationDocument);
router.get('/verification/status', getVerificationStatus);
router.post('/bank-accounts', submitBankAccount);
router.get('/bank-accounts', getBankAccount);

// Support Inquiries
router.post('/support', lodgeSupport);
router.get('/support', getSupportTickets);

// Presence & Inactivity Heartbeat (automatically records online presence in requireAuth)
router.get('/heartbeat', (req, res) => res.json({ success: true, online: true, serverTime: new Date().toISOString() }));
router.post('/heartbeat', (req, res) => res.json({ success: true, online: true, serverTime: new Date().toISOString() }));

module.exports = router;
