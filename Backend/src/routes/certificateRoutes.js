// ─── Certificate Routes ───────────────────────────────────────────────────────
// Exposes certificate retrieval, public key distribution, server-side issuance,
// revocation, and independent verification endpoints.

const express = require('express');
const router = express.Router();
const certificateController = require('../controllers/certificateController');
const { requireAdmin } = require('../middlewares/authMiddleware');
const { adminActionLimiter } = require('../middlewares/rateLimiterMiddleware');

// Public verification keys (JWKS / PEM)
router.get('/keys', certificateController.getPublicKeys);

// Full verifiable certificate dossier
router.get('/:assetId', certificateController.getCertificate);

// Independent verification of any submitted payload & signature
router.post('/verify-payload', certificateController.verifyPayload);

// Authorized server-side issuance & revocation (Admin / Compliance)
router.post('/:assetId/issue', requireAdmin, adminActionLimiter, certificateController.issueCertificate);
router.post('/:assetId/revoke', requireAdmin, adminActionLimiter, certificateController.revokeCertificate);

module.exports = router;
