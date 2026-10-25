// ─── Escrow Routes ───────────────────────────────────────────────────────────
// Endpoints for escrow deposits, status tracking, release, and buyer refund.

const express = require('express');
const router = express.Router();
const { requireAuth, requireVerified } = require('../middlewares/authMiddleware');
const {
  createEscrow,
  getEscrowOrder,
  getMyEscrows,
  progressEscrow,
  releaseEscrow,
  refundEscrow,
} = require('../controllers/escrowController');

// Escrow financial transactions strictly require authentication + approved 3-doc KYC
router.post('/create', requireAuth, requireVerified, createEscrow);
router.get('/order/:orderId', getEscrowOrder);
router.get('/my-orders', requireAuth, getMyEscrows);
router.post('/progress', requireAuth, progressEscrow);
router.post('/release', requireAuth, requireVerified, releaseEscrow);
router.post('/refund', requireAuth, requireVerified, refundEscrow);

module.exports = router;

