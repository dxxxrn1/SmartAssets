// ─── SmartAssets Admin Routes ────────────────────────────────────────────────
// Zero-migration administration endpoints for managing marketplace assets,
// escrow custody workflows, support resolution desks, and compliance operations.

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

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
router.get('/users', adminController.getAdminUsers);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.post('/users/:id/suspend', adminController.updateUserStatus);

// Chronological Activity Ledger
router.get('/activity', adminController.getAdminActivity);

// Verification & Compliance Reviews (Live Queue + Approvals/Rejections)
router.get('/verifications', adminController.getAdminVerifications);
router.post('/verifications/:id/approve', adminController.approveKyc);
router.post('/verifications/:id/reject', adminController.rejectKyc);

module.exports = router;
