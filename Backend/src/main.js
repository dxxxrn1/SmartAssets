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
const fs = require('fs');
const path = require('path');
const supabase = require('./connection/supabaseClient');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { validateProductionConfig } = require('./config/productionValidation');
// Validate production environment and critical secrets at server boot
validateProductionConfig();

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
const certificateRoutes = require('./routes/certificateRoutes');
const {
  requireAuth,
  requireVerified,
  requireApprovedBank,
  validateAdminAuthConfig,
} = require('./middlewares/authMiddleware');
const { createAsset } = require('./controllers/assetController');
const { deposit, withdraw } = require('./controllers/userController');
const { securityHeaders, sqlInjectionProtection } = require('./middlewares/securityMiddleware');
const rateLimit = require('express-rate-limit');

// Validate administrator authentication configuration at server startup
validateAdminAuthConfig();

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

// ── Proxy Trust Configuration (Configured narrowly for actual deployment host) ─
const trustProxyVal = process.env.TRUST_PROXY;
if (trustProxyVal === 'true' || trustProxyVal === '1') {
  app.set('trust proxy', 1);
} else if (trustProxyVal === 'false' || trustProxyVal === '0') {
  app.set('trust proxy', false);
} else if (trustProxyVal && !isNaN(parseInt(trustProxyVal, 10))) {
  app.set('trust proxy', parseInt(trustProxyVal, 10));
} else if (trustProxyVal) {
  app.set('trust proxy', trustProxyVal.split(',').map((s) => s.trim()));
} else {
  // Safe default: 1 reverse proxy hop (Render, Railway, Heroku, Cloudflare)
  app.set('trust proxy', 1);
}

// ── Security Hardening (Global Helmet + Restricted CSP + Security Headers) ─────
app.disable('x-powered-by');
const isProduction = process.env.NODE_ENV === 'production';
const enforceHsts = isProduction && (process.env.ENFORCE_HSTS === 'true' || process.env.HTTPS === 'true');

if (typeof helmet === 'function') {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Required for inline scripts in admin console and public verification page
            'https://cdn.jsdelivr.net',
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'", // Required for styled admin console and verification cards
            'https://fonts.googleapis.com',
          ],
          fontSrc: [
            "'self'",
            'https://fonts.gstatic.com',
            'data:',
          ],
          imgSrc: [
            "'self'",
            'data:',
            'blob:',
            'https:', // Cloudinary, Unsplash, external verifiable product media
          ],
          connectSrc: [
            "'self'",
            'https:',
            'wss:',
            'ws:',
          ],
          frameAncestors: ["'none'"], // Strict clickjacking defense
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: enforceHsts
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      frameguard: { action: 'deny' },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );
}
app.use(securityHeaders);

// ── CORS Configuration (Strict Production Origins + Explicit Dev Origins) ─────
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const explicitDevOrigins = [
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
      // Allow requests with no origin (mobile app native fetch, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Configured production origins take priority
      if (configuredOrigins.includes(origin)) {
        return callback(null, true);
      }

      // In non-production, allow explicit local dev origins and local network prefixes for Expo testing
      if (!isProduction) {
        if (
          explicitDevOrigins.includes(origin) ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('http://10.') ||
          origin.startsWith('http://192.168.')
        ) {
          return callback(null, true);
        }
      }

      // Deny unconfigured origins cleanly without exposing Access-Control-Allow-Origin
      return callback(null, false);
    },
    credentials: true,
  })
);

// ── Body Parser Limits (15MB for media/doc uploads, 1MB for standard routes) ──
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

// ── Rate Limiter Imports ──────────────────────────────────────────────────────
const {
  authLimiter,
  verifyLimiter,
  uploadLimiter,
  financialLimiter,
} = require('./middlewares/rateLimiterMiddleware');

// ── Rate Limiting for Sensitive Endpoints ─────────────────────────────────────
app.use('/api/auth', authLimiter);
app.use('/api/uploads', uploadLimiter);
app.use('/api/certificates', verifyLimiter);
app.use('/certificates', verifyLimiter);
app.use('/verify/:id', verifyLimiter);
app.use('/api/payments', financialLimiter);
app.use('/payments', financialLimiter);
app.use('/api/escrow', financialLimiter);
app.use('/escrow', financialLimiter);

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

// Gated KYC storage: requires valid JWT and restricts access strictly to owner or admin.
// Streams directly from private Supabase Storage ('verification-docs') without depending on local disk.
app.use('/uploads/kyc', (req, res, next) => {
  if (req.query?.token && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  next();
}, requireAuth, async (req, res) => {
  const file = req.path.replace(/^\//, '');
  const userId = req.user.id;
  const isOwner = file.startsWith(userId) || file.startsWith(String(userId).replace(/-/g, '_'));

  let isAdmin = req.user.role === 'admin' || (req.user.user_metadata?.role === 'admin');
  if (!isAdmin && req.user?.id) {
    try {
      const { data: p } = await supabase.from('profiles').select('role').eq('id', req.user.id).single();
      isAdmin = p?.role === 'admin';
    } catch (_) {}
  }

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Access denied: You are not authorized to view this compliance document.' });
  }

  // 1. Attempt to stream from private Supabase Storage bucket 'verification-docs'
  try {
    const { data, error } = await supabase.storage.from('verification-docs').download(file);
    if (!error && data) {
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mime = data.type || (file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      return res.send(buffer);
    }
  } catch (storageErr) {
    console.warn(`⚠️ [KYC Storage] Supabase download error for ${file}:`, storageErr.message);
  }

  // 2. Fallback to local disk (offline development/testing only)
  const localFile = path.resolve(__dirname, '../uploads/kyc', file);
  if (fs.existsSync(localFile)) {
    return res.sendFile(localFile);
  }

  return res.status(404).json({ success: false, error: 'Compliance document not found.' });
});

app.use('/uploads', express.static(path.resolve(__dirname, '../uploads/assets')));
app.use('/admin', express.static(path.resolve(__dirname, '../public/admin')));
app.use('/verify', express.static(path.resolve(__dirname, '../public/verify')));
app.get('/verify/:id', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/verify/index.html'));
});

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
app.use('/api/certificates', certificateRoutes);
app.use('/certificates', certificateRoutes);
app.get('/verify/keys', (req, res) => res.redirect('/api/certificates/keys'));

// ── Verification & Bank Account Routes (both /api/... and root /... paths) ──
app.use('/api/verification', verificationRoutes);
app.use('/verification', verificationRoutes);
app.use('/api/bank-accounts', bankAccountRoutes);
app.use('/bank-accounts', bankAccountRoutes);

// ── Direct Protected Action Routes (Server-Side KYC + Bank Account Enforcement) ─
app.post('/api/list-item', requireAuth, requireVerified, createAsset);
app.post('/list-item', requireAuth, requireVerified, createAsset);
app.post('/api/deposit', financialLimiter, requireAuth, requireVerified, requireApprovedBank, deposit);
app.post('/deposit', financialLimiter, requireAuth, requireVerified, requireApprovedBank, deposit);
app.post('/api/withdraw', financialLimiter, requireAuth, requireVerified, requireApprovedBank, withdraw);
app.post('/withdraw', financialLimiter, requireAuth, requireVerified, requireApprovedBank, withdraw);

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
