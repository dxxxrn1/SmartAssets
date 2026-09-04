// ─── SmartAssets Backend — Express Server ─────────────────────────────────────
// Entry point: sets up Express with CORS, JSON parsing, and mounts API routes.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const assetRoutes = require('./routes/assetRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());                   // Allow requests from the Expo dev client
app.use(express.json({ limit: '15mb' })); // Parse JSON request bodies (allows base64 image uploads)

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/assets', assetRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
