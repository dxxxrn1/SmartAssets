// ─── Payment Routes ──────────────────────────────────────────────────────────
// Endpoints for rates, Stripe PaymentIntent creation, and multi-rail payment processing.

const express = require('express');
const router = express.Router();
const { requireAuth, requireVerified } = require('../middlewares/authMiddleware');
const {
  getRates,
  createIntent,
  processPayment,
  getShareRedemptionQuote,
  requestShareRedemption,
  cancelShareRedemption,
  getUserRedemptions,
  settleShareRedemption,
} = require('../controllers/paymentController');

// Public exchange rates, escrow details, and Stripe config
router.get('/rates', getRates);

// Create a Stripe PaymentIntent (strictly requires authentication + approved 3-doc KYC)
router.post('/create-intent', requireAuth, requireVerified, createIntent);

// Protected payment processing (card, bank, wallet - strictly requires authentication + approved 3-doc KYC)
router.post('/process', requireAuth, requireVerified, processPayment);

// Share Redemption / Liquidity Exit routes (strictly server-authoritative, KYC verified)
router.get('/investments/share-redemption-quote', requireAuth, getShareRedemptionQuote);
router.post('/investments/sell-shares', requireAuth, requireVerified, requestShareRedemption);
router.post('/investments/cancel-sell-request/:id', requireAuth, cancelShareRedemption);
router.get('/investments/my-redemptions', requireAuth, getUserRedemptions);
router.post('/investments/settle-sell-request/:id', requireAuth, settleShareRedemption);

module.exports = router;

