const express = require('express');
const router = express.Router();
const supabase = require('../connection/supabaseClient');
const { requireAuth, verifyAdminToken } = require('../middlewares/authMiddleware');
const { uploadVerificationDocument, getVerificationStatus } = require('../controllers/userController');
const { getDocumentSignedUrlForUser } = require('../services/complianceService');

// Dual-auth middleware: accepts standard Supabase Auth JWTs (mobile) OR HMAC admin tokens (admin console)
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const admin = verifyAdminToken(token);
    if (admin && admin.role === 'admin') {
      req.user = {
        id: admin.sub || 'admin-console',
        email: admin.email || 'admin@smartassets.co.za',
        role: 'admin',
      };
      req.admin = req.user;
      return next();
    }
  }
  return requireAuth(req, res, next);
});

router.post('/documents', uploadVerificationDocument);
router.get('/status', getVerificationStatus);

// Owner-only (or admin) on-demand signed link. Admin role comes from the database, NOT user_metadata.
router.get('/documents/:id/url', async (req, res) => {
  try {
    let isAdmin = req.user?.role === 'admin' || req.admin?.role === 'admin';
    if (!isAdmin && req.user?.id) {
      const { data: p } = await supabase.from('profiles').select('role').eq('id', req.user.id).single();
      isAdmin = p?.role === 'admin';
    }
    const result = await getDocumentSignedUrlForUser(req.params.id, req.user.id, isAdmin, req);
    if (!result || !result.url) return res.status(404).json({ success: false, error: 'Document not found' });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[KYC] url error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not generate document URL' });
  }
});

module.exports = router;
