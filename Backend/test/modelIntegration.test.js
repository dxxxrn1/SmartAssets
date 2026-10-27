// ─── Test: 3D Model Generation & Optimization Integration ──────────────────────
const assert = require('assert');
const { NodeIO, Document } = require('@gltf-transform/core');
const { checkCreditBalance } = require('../src/services/tripoService');
const { optimizeGlbBuffer, getTriangleCount } = require('../src/services/modelOptimizer');
const modelController = require('../src/controllers/modelController');

async function runTests() {
  console.log('\n======================================================');
  console.log('       SMARTASSETS • 3D Model Integration Tests       ');
  console.log('======================================================\n');

  // Test 1: Tripo API Credit Balance Check
  console.log('🧪 [TEST 1] Testing Tripo v3 Credit Balance Check...');
  try {
    const balance = await checkCreditBalance();
    console.log('   Balance output:', balance);
    assert(typeof balance.balance === 'number', 'Balance should be a number');
    assert(typeof balance.frozen === 'number', 'Frozen should be a number');
    console.log('   ✅ checkCreditBalance verified against Tripo OpenAPI v3 successfully!');
  } catch (err) {
    console.error('   ❌ Test 1 failed:', err.message);
    throw err;
  }

  // Test 2: @gltf-transform Pipeline & Uncompressed Buffer Integrity
  console.log('\n🧪 [TEST 2] Testing @gltf-transform optimization pipeline...');
  try {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const position = doc
      .createAccessor()
      .setBuffer(buffer)
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1]));
    const prim = doc.createPrimitive().setAttribute('POSITION', position);
    const mesh = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setMesh(mesh);
    doc.createScene().addChild(node);

    const initialTriangles = getTriangleCount(doc);
    assert.strictEqual(initialTriangles, 2, 'Should count 2 initial triangles');

    const io = new NodeIO();
    const testGlbBuffer = Buffer.from(await io.writeBinary(doc));

    const result = await optimizeGlbBuffer(testGlbBuffer, false);
    console.log(`   Optimized size: ${result.sizeBytes} bytes, triangles: ${result.triangleCount}`);
    assert(result.sizeBytes > 0, 'Optimized GLB should have non-zero size');
    assert(result.sizeBytes < 5 * 1024 * 1024, 'Optimized GLB must be under 5MB');
    assert(result.triangleCount >= 0, 'Triangle count should be valid');
    console.log('   ✅ @gltf-transform pipeline (dedup, prune, texture 1024 max) executed cleanly!');
  } catch (err) {
    console.error('   ❌ Test 2 failed:', err.message);
    throw err;
  }

  // Test 3: Endpoint Request Validation
  console.log('\n🧪 [TEST 3] Testing generateModel validation (missing listingId)...');
  let resStatus = 0;
  let resJson = null;
  const mockRes = {
    status: (code) => {
      resStatus = code;
      return mockRes;
    },
    json: (data) => {
      resJson = data;
      return mockRes;
    },
  };

  await modelController.generateModel({ body: {}, user: { id: 'test-user' } }, mockRes);
  assert.strictEqual(resStatus, 400, 'Should reject missing listingId with status 400');
  assert.strictEqual(resJson?.success, false, 'Should return success: false');
  console.log('   ✅ Missing listingId correctly returned 400 Bad Request!');

  // Test 4: Status for non-existent listing
  console.log('\n🧪 [TEST 4] Testing getModelStatus for uninitiated listing...');
  let statusResJson = null;
  const mockStatusRes = {
    status: () => mockStatusRes,
    json: (data) => {
      statusResJson = data;
      return mockStatusRes;
    },
  };
  await modelController.getModelStatus({ params: { listingId: '00000000-0000-0000-0000-000000000000' } }, mockStatusRes);
  assert.strictEqual(statusResJson?.status, 'none', 'Should report status: none for uninitiated listing');
  console.log('   ✅ Non-existent listing correctly reported status: none!');

  console.log('\n🎉 ALL 3D MODEL INTEGRATION TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Tests failed:', err);
  process.exit(1);
});
