// ─── Admin Routes ────────────────────────────────────────────────────────────
// Zero-migration administration endpoints for managing marketplace assets,
// escrow custody workflows, and support resolution desks.

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

// Chronological Activity Ledger
router.get('/activity', adminController.getAdminActivity);

// Verification & Compliance Reviews (Demonstration Queue)
router.get('/verifications', adminController.getAdminVerifications);

module.exports = router;

