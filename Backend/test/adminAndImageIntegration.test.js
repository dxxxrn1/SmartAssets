// ─── Test: Admin Endpoints & Image Resiliency ────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { saveBase64Image, normalizeImageUrl, UPLOADS_DIR } = require('../src/utils/imageHandler');
const escrowService = require('../src/services/escrowService');
const supportService = require('../src/services/supportService');
const adminController = require('../src/controllers/adminController');

async function runTests() {
  console.log('\n🧪 [TEST 1] Testing saveBase64Image with mock Base64 data URI...');
  const mockBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  
  const savedUrl = saveBase64Image(mockBase64, 'test_asset');
  console.log('   Saved URL path:', savedUrl);
  assert(savedUrl.startsWith('/uploads/assets/test_asset_'), 'Should save file to /uploads/assets/ with prefix');
  
  const fileName = path.basename(savedUrl);
  const fullFilePath = path.join(UPLOADS_DIR, fileName);
  assert(fs.existsSync(fullFilePath), 'File should exist on disk');
  const stats = fs.statSync(fullFilePath);
  assert(stats.size > 0, 'Saved file should have non-zero size');
  // Clean up test file
  fs.unlinkSync(fullFilePath);
  console.log('   ✅ saveBase64Image saved and validated file cleanly!');

  console.log('\n🧪 [TEST 2] Testing normalizeImageUrl with dynamic caller host...');
  const mockReq = {
    protocol: 'http',
    get: (header) => (header === 'host' ? '10.10.0.63:5000' : null),
  };
  const normalized = normalizeImageUrl('/uploads/assets/asset_12345.jpg', mockReq);
  console.log('   Normalized URL:', normalized);
  assert.strictEqual(normalized, 'http://10.10.0.63:5000/uploads/assets/asset_12345.jpg');

  const staleIpNormalized = normalizeImageUrl('http://10.250.193.0:5000/uploads/assets/asset_old.jpg', mockReq);
  console.log('   Stale IP Normalized:', staleIpNormalized);
  assert.strictEqual(staleIpNormalized, 'http://10.10.0.63:5000/uploads/assets/asset_old.jpg');

  const externalUrl = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800';
  const externalNormalized = normalizeImageUrl(externalUrl, mockReq);
  assert.strictEqual(externalNormalized, externalUrl, 'External Unsplash URLs should be untouched');
  console.log('   ✅ normalizeImageUrl dynamically resolved host and preserved external URLs!');

  console.log('\n🧪 [TEST 3] Testing Escrow Service Base64 Automatic Ingestion Defense...');
  const escrowOrder = await escrowService.createEscrowOrder({
    orderId: 'ORD-TEST-IMG-' + Date.now(),
    buyerId: 'test-buyer-image',
    assetName: 'Defensive Image Asset',
    assetImage: mockBase64,
    amountZar: 12000,
  });
  console.log('   Escrow assetImage stored:', escrowOrder.assetImage);
  assert(!escrowOrder.assetImage.startsWith('data:image/'), 'Escrow order should NOT store raw base64');
  assert(escrowOrder.assetImage.includes('/uploads/assets/ord_ORD-TEST-IMG-'), 'Escrow order should store disk path');
  // Clean up order image file
  const escrowFileName = path.basename(escrowOrder.assetImage);
  const escrowFilePath = path.join(UPLOADS_DIR, escrowFileName);
  if (fs.existsSync(escrowFilePath)) fs.unlinkSync(escrowFilePath);
  console.log('   ✅ Escrow order sanitized base64 image on creation!');

  console.log('\n🧪 [TEST 4] Testing Admin Overview KPI calculation...');
  const mockRes = {
    json: (payload) => {
      mockRes.data = payload;
      return mockRes;
    },
    status: () => mockRes,
  };
  await adminController.getAdminOverview(mockReq, mockRes);
  assert(mockRes.data.success === true, 'Admin overview should succeed');
  assert(typeof mockRes.data.overview.escrows.total === 'number', 'Escrows count should be number');
  assert(typeof mockRes.data.overview.tickets.total === 'number', 'Tickets count should be number');
  console.log('   Admin KPIs:', JSON.stringify(mockRes.data.overview.escrows));
  console.log('   ✅ Admin overview computed safely with zero DB migrations!');

  console.log('\n🎉 ALL ADMIN & IMAGE RESILIENCY TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
