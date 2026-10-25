// ─── Payment Routes ──────────────────────────────────────────────────────────
// Endpoints for rates, Stripe PaymentIntent creation, and multi-rail payment processing.

const express = require('express');
const router = express.Router();
const { requireAuth, requireVerified } = require('../middlewares/authMiddleware');
const { getRates, createIntent, processPayment } = require('../controllers/paymentController');

// Public exchange rates, escrow details, and Stripe config
router.get('/rates', getRates);

// Create a Stripe PaymentIntent (strictly requires authentication + approved 3-doc KYC)
router.post('/create-intent', requireAuth, requireVerified, createIntent);

// Protected payment processing (card, bank, wallet - strictly requires authentication + approved 3-doc KYC)
router.post('/process', requireAuth, requireVerified, processPayment);

module.exports = router;
