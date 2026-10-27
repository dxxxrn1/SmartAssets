// ─── SmartAssets Backend — Express Server ─────────────────────────────────────
// Entry point: sets up Express with Helmet security, CORS, JSON parsing, and mounts API routes.
const express = require('express');
const cors = require('cors');
let helmet;
try {
  helmet = require('helmet');
} catch (_) {
  console.warn('⚠️ [Helmet] helmet package not found. Using custom securityHeaders middleware.');
}
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const assetRoutes = require('./routes/assetRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const escrowRoutes = require('./routes/escrowRoutes');
const adminRoutes = require('./routes/adminRoutes');
const modelRoutes = require('./routes/modelRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const bankAccountRoutes = require('./routes/bankAccountRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const {
  requireAuth,
  requireVerified,
  requireApprovedBank,
} = require('./middlewares/authMiddleware');
const { createAsset } = require('./controllers/assetController');
const { deposit, withdraw } = require('./controllers/userController');
const { securityHeaders, sqlInjectionProtection } = require('./middlewares/securityMiddleware');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Timing Middleware (Terminal Latency Logs) ─────────────────────────────────
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    console.log(`⏱️ [${req.method}] ${req.originalUrl} ${res.statusCode} (${Date.now() - t}ms)`);
  });
  next();
});

// Trust proxy header for Render / cloud deployments
app.set('trust proxy', 1);

// ── Security Hardening (Helmet + Security Headers) ───────────────────────────
app.disable('x-powered-by');
if (typeof helmet === 'function') {
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: false, // Ensure admin console scripts & images load unblocked
    })
  );
}
app.use(securityHeaders);

// ── CORS Configuration (Explicitly supporting Live Server :5500 & Expo) ────────
const allowedOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  'http://127.0.0.1:19006',
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://10.') ||
        origin.startsWith('http://192.168.')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

// ── Body Parser Limits (15MB for large media/doc uploads, 1MB for all standard routes) ──
const uploadJson = express.json({ limit: '15mb' });
const uploadUrlencoded = express.urlencoded({ limit: '15mb', extended: true });

[
  '/api/uploads',
  '/api/verification',
  '/verification',
  '/api/assets',
  '/api/user',
  '/api/users',
  '/api/list-item',
  '/list-item',
].forEach((p) => {
  app.use(p, uploadJson);
  app.use(p, uploadUrlencoded);
});

// Default strict 1MB body limit for standard unauthenticated/auth routes
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// ── Rate Limiting for Authentication Endpoints ─────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
});
app.use('/api/auth', authLimiter);

// ── SQL Injection Protection (Skips image upload routes to avoid CPU regex lags) ──
app.use((req, res, next) => {
  const p = req.originalUrl || req.url;
  if (
    p.startsWith('/api/uploads') ||
    p.startsWith('/api/verification/documents') ||
    p.startsWith('/verification/documents')
  ) {
    return next();
  }
  return sqlInjectionProtection(req, res, next);
});

// ── Static Files (Uploaded Avatars, Assets & Admin Console) ───────────────────
// ── Static Files (Public Assets vs Protected KYC Documents) ──────────────────
app.use('/uploads/assets', express.static(path.resolve(__dirname, '../uploads/assets')));
app.use('/uploads/avatars', express.static(path.resolve(__dirname, '../uploads/avatars')));

// Gated KYC storage: requires valid JWT and restricts access strictly to owner or admin
app.use('/uploads/kyc', (req, res, next) => {
  if (req.query?.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  next();
}, requireAuth, (req, res, next) => {
  const file = req.path.replace(/^\//, '');
  const userId = req.user.id;
  const isOwner = file.startsWith(userId) || file.startsWith(String(userId).replace(/-/g, '_'));
  const isAdmin = req.user.role === 'admin' || (req.user.user_metadata?.role === 'admin');
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Access denied: You are not authorized to view this compliance document.' });
  }
  next();
}, express.static(path.resolve(__dirname, '../uploads/kyc')));

app.use('/uploads', express.static(path.resolve(__dirname, '../uploads/assets')));
app.use('/admin', express.static(path.resolve(__dirname, '../public/admin')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/users', userRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/payments', paymentRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/escrow', escrowRoutes);
app.use('/api/admin', adminRoutes);
app.use('/admin', adminRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/uploads', uploadRoutes);

// ── Verification & Bank Account Routes (both /api/... and root /... paths) ──
app.use('/api/verification', verificationRoutes);
app.use('/verification', verificationRoutes);
app.use('/api/bank-accounts', bankAccountRoutes);
app.use('/bank-accounts', bankAccountRoutes);

// ── Direct Protected Action Routes (Server-Side KYC + Bank Account Enforcement) ─
app.post('/api/list-item', requireAuth, requireVerified, createAsset);
app.post('/list-item', requireAuth, requireVerified, createAsset);
app.post('/api/deposit', requireAuth, requireVerified, deposit);
app.post('/deposit', requireAuth, requireVerified, deposit);
app.post('/api/withdraw', requireAuth, requireVerified, requireApprovedBank, withdraw);
app.post('/withdraw', requireAuth, requireVerified, requireApprovedBank, withdraw);

// ── Health check & Root Admin Redirect ───────────────────────────────────────
app.get('/', (_req, res) => {
  res.redirect('/admin');
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global Error Handler (catches payload-too-large, JSON parse errors, etc.) ─
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request body too large. Try a smaller image.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON in request body.' });
  }
  console.error('Unhandled server error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── Start server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 SmartAssets API running at http://localhost:${PORT}`);
    console.log(`   Admin Login:   http://localhost:${PORT}/admin/login.html`);
    console.log(`   Admin Console: http://localhost:${PORT}/admin`);
    console.log(`   Admin API:     http://localhost:${PORT}/api/admin/overview`);
    console.log(`   Health check:  http://localhost:${PORT}/api/health`);
    console.log(`   Auth routes:   POST /api/auth/register`);
    console.log(`                  POST /api/auth/login`);
    console.log(`                  POST /api/auth/wallet-login`);
    console.log(`   KYC routes:    POST /api/verification/documents`);
    console.log(`                  GET  /api/verification/status`);
    console.log(`                  POST /api/bank-accounts`);
    console.log(`   Asset routes:  GET  /api/assets`);
    console.log(`                  POST /api/assets (requireAuth + requireVerified)\n`);
  });
}

module.exports = app;
