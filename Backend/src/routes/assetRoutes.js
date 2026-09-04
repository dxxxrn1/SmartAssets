// ─── Asset Routes ────────────────────────────────────────────────────────────
// Public & protected endpoints for marketplace assets and provenance history.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { getAssets, getAssetById, createAsset } = require('../controllers/assetController');

// Public routes
router.get('/', getAssets);
router.get('/:id', getAssetById);

// Protected routes (requires registered user login)
router.post('/', requireAuth, createAsset);

module.exports = router;

