// ─── SmartAssets Public Upload Routes (Cloudinary) ───────────────────────────
// Issues short-lived Cloudinary upload signatures and handles authenticated
// public media uploads for marketplace photos, avatars, certificates, and 3D models.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const {
  ALLOWED_FOLDERS,
  generateSignedUploadParams,
  uploadPublicMedia,
} = require('../utils/cloudinary');

/**
 * POST /api/uploads/sign
 * Returns short-lived signed Cloudinary upload parameters for client-direct upload.
 */
router.post('/sign', requireAuth, (req, res) => {
  try {
    const folder = req.body.folder || 'assets';
    if (!ALLOWED_FOLDERS.includes(folder)) {
      return res.status(400).json({
        success: false,
        error: `Invalid folder "${folder}". Allowed: ${ALLOWED_FOLDERS.join(', ')}`,
      });
    }

    const signed = generateSignedUploadParams(folder, req.user.id);
    return res.status(200).json({
      success: true,
      ...signed,
    });
  } catch (err) {
    console.error('[UploadRoutes] Sign error:', err.message);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to generate upload signature.',
    });
  }
});

/**
 * POST /api/uploads/public
 * Uploads a base64 data URI directly to Cloudinary via backend and returns secure_url.
 */
router.post('/public', requireAuth, async (req, res) => {
  try {
    const { file, fileData, base64, folder = 'assets' } = req.body;
    const payload = file || fileData || base64;

    if (!payload) {
      return res.status(400).json({
        success: false,
        error: 'file (base64 data URI) is required.',
      });
    }

    if (!ALLOWED_FOLDERS.includes(folder)) {
      return res.status(400).json({
        success: false,
        error: `Invalid folder "${folder}". Allowed: ${ALLOWED_FOLDERS.join(', ')}`,
      });
    }

    const secureUrl = await uploadPublicMedia(payload, folder, {
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      url: secureUrl,
      secure_url: secureUrl,
      folder: `smartassets/${folder}/${req.user.id}`,
    });
  } catch (err) {
    console.error('[UploadRoutes] Public upload error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to upload media to Cloudinary.',
    });
  }
});

module.exports = router;
