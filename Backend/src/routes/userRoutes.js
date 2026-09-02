// ─── User Routes ─────────────────────────────────────────────────────────────
// All endpoints require valid JWT authentication header.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { getVault, addHolding, seedStarterHoldings } = require('../controllers/userController');

// All user routes are protected by requireAuth
router.use(requireAuth);

router.get('/vault', getVault);
router.post('/vault', addHolding);
router.post('/seed-starter', seedStarterHoldings);

module.exports = router;

