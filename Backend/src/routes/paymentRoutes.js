// ─── Payment Routes ──────────────────────────────────────────────────────────
// Endpoints for rates, Stripe PaymentIntent creation, and multi-rail payment processing.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { getRates, createIntent, processPayment } = require('../controllers/paymentController');

// Public exchange rates, escrow details, and Stripe config
router.get('/rates', getRates);

// Create a Stripe PaymentIntent (returns clientSecret for frontend confirmation)
router.post('/create-intent', requireAuth, createIntent);

// Protected payment processing (card, bank, wallet)
router.post('/process', requireAuth, processPayment);

module.exports = router;
