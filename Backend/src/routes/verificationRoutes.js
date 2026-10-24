// ─── SmartAssets Verification Routes ─────────────────────────────────────────
// Handles individual KYC document uploads (ID, Tax, Proof of Residence)
// and verification status queries.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const {
  uploadVerificationDocument,
  getVerificationStatus,
} = require('../controllers/userController');

router.use(requireAuth);

// POST /verification/documents (upload a doc: id | tax | proof_of_residence)
router.post('/documents', uploadVerificationDocument);

// GET /verification/status (returns the user's 3 document slots + overall status + bank status)
router.get('/status', getVerificationStatus);

module.exports = router;
