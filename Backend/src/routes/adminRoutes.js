// ─── SmartAssets Admin Routes ────────────────────────────────────────────────
// Administration endpoints for managing marketplace assets, escrow custody workflows,
// support resolution desks, 3-document KYC verification, and bank account approvals.

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin, isUserAdmin, verifyAdminToken, isTokenRevoked } = require('../middlewares/authMiddleware');
const supabase = require('../connection/supabaseClient');

/**
 * Middleware: blocks any authenticated non-admin user (`profiles.role !== 'admin'`) with 403,
 * and attaches `req.admin` when a valid admin token is present.
 */
async function adminGatekeeper(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (!token || isTokenRevoked(token)) {
        return res.status(401).json({
          success: false,
          code: 'ADMIN_SESSION_INVALID',
          error: 'Access denied. Admin session is invalid or expired.',
        });
      }

      const adminPayload = verifyAdminToken(token);
      if (adminPayload && adminPayload.role === 'admin') {
        req.admin = {
          id: adminPayload.sub,
          email: adminPayload.email,
          fullName: adminPayload.fullName || 'Compliance Admin',
          role: 'admin',
        };
        req.user = req.admin;
        return next();
      }

      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({
          success: false,
          code: 'ADMIN_SESSION_EXPIRED',
          error: 'Access denied. Invalid or expired session token.',
        });
      }

      const allowed = await isUserAdmin(user);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          code: 'ADMIN_REQUIRED',
          error: 'Access denied. Admin privileges required (profiles.role must be "admin").',
        });
      }

      req.admin = {
        id: user.id,
        email: user.email,
        fullName: user.user_metadata?.full_name || 'Compliance Admin',
        role: 'admin',
      };
      req.user = user;
      return next();
    }

    return res.status(401).json({
      success: false,
      code: 'ADMIN_AUTH_REQUIRED',
      error: 'Access denied. Administrator authentication token is required.',
    });
  } catch (err) {
    console.error('adminGatekeeper error:', err);
    return res.status(500).json({ success: false, error: 'Admin authorization check failed.' });
  }
}

// ── Admin Authentication Routes ──────────────────────────────────────────────
router.post('/auth/login', adminController.adminLogin);
router.post('/login', adminController.adminLogin);
router.get('/auth/me', requireAdmin, adminController.getAdminMe);
router.post('/auth/logout', adminController.adminLogout);

// Apply adminGatekeeper to all subsequent admin routes
router.use(adminGatekeeper);

// Platform Overview KPIs & Health Diagnostics
router.get('/overview', adminController.getAdminOverview);
router.get('/health', adminController.getAdminHealth);

// Asset Moderation Desk
router.get('/assets', adminController.getAdminAssets);
router.patch('/assets/:id/status', adminController.updateAssetStatus);

// Escrow Custody & Disputes Console
router.get('/escrows', adminController.getAdminEscrows);
router.post('/escrows/:id/action', adminController.handleEscrowAction);

// Support Ticket Management
router.get('/tickets', adminController.getAdminTickets);
router.patch('/tickets/:id', adminController.updateAdminTicket);

// User Directory & Profile Operations
router.get('/users/online', adminController.getAdminOnlineUsers);
router.get('/users', adminController.getAdminUsers);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.post('/users/:id/suspend', adminController.updateUserStatus);

// Chronological Activity Ledger
router.get('/activity', adminController.getAdminActivity);

// Verification & Compliance Reviews (Granular 3-Document + Full Dossier Queue)
router.get('/verifications', adminController.getAdminVerifications);
router.post('/verifications/:id/approve', adminController.approveKyc);
router.post('/verifications/:id/reject', adminController.rejectKyc);

// Individual KYC Document Approval & Rejection (`id`, `tax`, `proof_of_residence`)
router.post('/documents/:id/approve', adminController.approveAdminDocument);
router.post('/documents/:id/reject', adminController.rejectAdminDocument);

// Bank Account Approval & Rejection Desk
router.get('/bank-accounts', adminController.getAdminBankAccounts);
router.post('/bank-accounts/:id/approve', adminController.approveAdminBankAccount);
router.post('/bank-accounts/:id/reject', adminController.rejectAdminBankAccount);

module.exports = router;
