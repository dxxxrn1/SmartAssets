// ─── SmartAssets Admin Routes ────────────────────────────────────────────────
// Administration endpoints for managing marketplace assets, escrow custody workflows,
// support resolution desks, 3-document KYC verification, and bank account approvals.

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middlewares/authMiddleware');
const {
  adminLoginLimiter,
  adminLoginIpLimiter,
  adminActionLimiter,
} = require('../middlewares/rateLimiterMiddleware');

/**
 * Middleware: adminGatekeeper
 * Applies the exact same authoritative profile recheck and fail-closed policy as requireAdmin.
 * Ensures consistent enforcement across all admin console routes.
 */
async function adminGatekeeper(req, res, next) {
  return requireAdmin(req, res, next);
}

// ── Admin Authentication Routes ──────────────────────────────────────────────
router.post('/auth/login', adminLoginIpLimiter, adminLoginLimiter, adminController.adminLogin);
router.post('/login', adminLoginIpLimiter, adminLoginLimiter, adminController.adminLogin);
router.get('/auth/me', requireAdmin, adminController.getAdminMe);
router.post('/auth/logout', adminController.adminLogout);

// Apply adminGatekeeper to all subsequent admin routes
router.use(adminGatekeeper);

// Platform Overview KPIs & Health Diagnostics
router.get('/overview', adminController.getAdminOverview);
router.get('/health', adminController.getAdminHealth);

// Asset Moderation Desk
router.get('/assets', adminController.getAdminAssets);
router.patch('/assets/:id/status', adminActionLimiter, adminController.updateAssetStatus);

// Escrow Custody & Disputes Console
router.get('/escrows', adminController.getAdminEscrows);
router.post('/escrows/:id/action', adminActionLimiter, adminController.handleEscrowAction);

// Support Ticket Management
router.get('/tickets', adminController.getAdminTickets);
router.patch('/tickets/:id', adminActionLimiter, adminController.updateAdminTicket);

// User Directory & Profile Operations
router.get('/users/online', adminController.getAdminOnlineUsers);
router.get('/users', adminController.getAdminUsers);
router.patch('/users/:id/status', adminActionLimiter, adminController.updateUserStatus);
router.post('/users/:id/suspend', adminActionLimiter, adminController.updateUserStatus);

// Chronological Activity Ledger
router.get('/activity', adminController.getAdminActivity);

// Verification & Compliance Reviews (Granular 3-Document + Full Dossier Queue)
router.get('/verifications', adminController.getAdminVerifications);
router.post('/verifications/:id/approve', adminActionLimiter, adminController.approveKyc);
router.post('/verifications/:id/reject', adminActionLimiter, adminController.rejectKyc);

// Individual KYC Document Approval & Rejection (`id`, `tax`, `proof_of_residence`)
router.post('/documents/:id/approve', adminActionLimiter, adminController.approveAdminDocument);
router.post('/documents/:id/reject', adminActionLimiter, adminController.rejectAdminDocument);

// Bank Account Approval & Rejection Desk
router.get('/bank-accounts', adminController.getAdminBankAccounts);
router.post('/bank-accounts/:id/approve', adminActionLimiter, adminController.approveAdminBankAccount);
router.post('/bank-accounts/:id/reject', adminActionLimiter, adminController.rejectAdminBankAccount);

// Treasury Vault Deposit & Withdrawal Reconciliation Desk
router.get('/vault-transactions', adminController.getAdminVaultTransactions);
router.post('/deposits/:id/confirm', adminActionLimiter, adminController.confirmAdminDeposit);
router.post('/deposits/:id/reject', adminActionLimiter, adminController.rejectAdminDeposit);
router.post('/withdrawals/:id/settle', adminActionLimiter, adminController.settleAdminWithdrawal);
router.post('/withdrawals/:id/reject', adminActionLimiter, adminController.rejectAdminWithdrawal);

module.exports = router;
