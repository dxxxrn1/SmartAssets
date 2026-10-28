// ─── Asset Routes ────────────────────────────────────────────────────────────
// Public & protected endpoints for marketplace assets and provenance history.

const express = require('express');
const router = express.Router();
const { requireAuth, optionalAuth, requireVerified } = require('../middlewares/authMiddleware');
const {
  getAssets,
  getAssetById,
  getAssetHealthReport,
  createAsset,
  verifyAssetUpload,
  getMarketOracle,
  scanAndKnow,
} = require('../controllers/assetController');

// Public routes
router.get('/', getAssets);
router.get('/market-oracle', getMarketOracle);
router.get('/:id/health-report', getAssetHealthReport);
router.get('/:id', getAssetById);

// Unified Scan & Know (uses optionalAuth so user_holdings are checked when logged in, and still works in demo/web sessions)
router.post('/scan-and-know', optionalAuth, scanAndKnow);

// Protected routes (requires registered user login; listing an asset requires verified account)
router.post('/verify-upload', requireAuth, verifyAssetUpload);
router.post('/', requireAuth, requireVerified, createAsset);

module.exports = router;
