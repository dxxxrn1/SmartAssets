// ─── Escrow Routes ───────────────────────────────────────────────────────────
// Endpoints for escrow deposits, status tracking, release, and buyer refund.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const {
  createEscrow,
  getEscrowOrder,
  releaseEscrow,
  refundEscrow,
} = require('../controllers/escrowController');

router.post('/create', requireAuth, createEscrow);
router.get('/order/:orderId', getEscrowOrder);
router.post('/release', requireAuth, releaseEscrow);
router.post('/refund', requireAuth, refundEscrow);

module.exports = router;

