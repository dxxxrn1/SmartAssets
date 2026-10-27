// ─── Escrow Routes ───────────────────────────────────────────────────────────
// Endpoints for escrow deposits, status tracking, release, dispute, and buyer refund.

const express = require('express');
const router = express.Router();
const { requireAuth, requireVerified } = require('../middlewares/authMiddleware');
const {
  createEscrow,
  getEscrowOrder,
  getMyEscrows,
  getSellerEscrows,
  progressEscrow,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
} = require('../controllers/escrowController');

// Escrow financial transactions strictly require authentication + approved 3-doc KYC
router.post('/create', requireAuth, requireVerified, createEscrow);

// Querying order requires authentication and role verification (buyer, seller, or admin)
router.get('/order/:orderId', requireAuth, getEscrowOrder);

// User and seller active escrow lists
router.get('/my-orders', requireAuth, getMyEscrows);
router.get('/seller-orders', requireAuth, getSellerEscrows);

// Escrow progression, dispute, release, and refund
router.post('/progress', requireAuth, progressEscrow);
router.post('/release', requireAuth, requireVerified, releaseEscrow);
router.post('/refund', requireAuth, requireVerified, refundEscrow);
router.post('/dispute', requireAuth, disputeEscrow);

module.exports = router;
