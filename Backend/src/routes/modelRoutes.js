// ─── 3D Model API Routes ───────────────────────────────────────────────────────
// Mounts endpoints for generating AI 3D models and polling task completion.

const express = require('express');
const router = express.Router();
const modelController = require('../controllers/modelController');
const { requireAuth } = require('../middlewares/authMiddleware');

// POST /api/models/generate - Initiates 3D generation for a listing (requires seller or admin auth)
router.post('/generate', requireAuth, modelController.generateModel);

// GET /api/models/status/:listingId - Retrieves model status (polls Tripo & optimizes GLB on success)
router.get('/status/:listingId', modelController.getModelStatus);

// GET /api/models/balance - Admin check for Tripo API credit balance
router.get('/balance', requireAuth, modelController.getBalance);

module.exports = router;
