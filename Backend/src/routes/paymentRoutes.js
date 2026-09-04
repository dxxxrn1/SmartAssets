// ─── Payment Routes ──────────────────────────────────────────────────────────
// Endpoints for rates and multi-rail payment processing.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { getRates, processPayment } = require('../controllers/paymentController');

// Public exchange rates and escrow details
router.get('/rates', getRates);

// Protected payment processing
router.post('/process', requireAuth, processPayment);

module.exports = router;

