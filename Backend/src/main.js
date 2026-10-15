// ─── SmartAssets Backend — Express Server ─────────────────────────────────────
// Entry point: sets up Express with CORS, JSON parsing, and mounts API routes.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const assetRoutes = require('./routes/assetRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const escrowRoutes = require('./routes/escrowRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());                   // Allow requests from the Expo dev client
app.use(express.json({ limit: '50mb' })); // Parse JSON request bodies (allows large base64 image uploads)
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Static Files (Uploaded Avatars & Assets) ─────────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/escrow', escrowRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
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
app.listen(PORT, () => {
  console.log(`\n🚀 SmartAssets API running at http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Auth routes:   POST /api/auth/register`);
  console.log(`                  POST /api/auth/login`);
  console.log(`                  POST /api/auth/wallet-login`);
  console.log(`   User routes:   GET  /api/user/vault`);
  console.log(`                  POST /api/user/vault`);
  console.log(`   Asset routes:  GET  /api/assets`);
  console.log(`                  GET  /api/assets/:id`);
  console.log(`                  POST /api/assets\n`);
});
