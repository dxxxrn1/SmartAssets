// ─── Avatar Database Integration Test Suite ────────────────────────────────
const assert = require('assert');
const avatarService = require('../src/services/avatarService');

async function runTests() {
  console.log('\n🧪 [TEST 1] Testing avatarService database save and retrieval with Base64...');
  const testUserId = 'test-user-avatar-' + Date.now();
  // Simple 1x1 transparent PNG as base64
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  const savedResult = await avatarService.saveUserAvatar(testUserId, sampleBase64);
  assert.ok(savedResult, 'saveUserAvatar should return saved avatar data');
  assert.ok(
    savedResult === sampleBase64 || savedResult.startsWith('http'),
    'Saved avatar should be the input base64 or uploaded Cloudinary URL'
  );
  console.log('   ✅ Avatar successfully saved to database');

  const retrievedAvatar = await avatarService.getUserAvatar(testUserId);
  assert.strictEqual(retrievedAvatar, savedResult, 'Retrieved avatar from DB should match stored avatar');
  console.log('   ✅ Avatar successfully retrieved from database (profiles table)');

  console.log('\n🧪 [TEST 2] Testing avatar cleanup upon deleteUserAvatar...');
  await avatarService.deleteUserAvatar(testUserId);
  const deletedAvatar = await avatarService.getUserAvatar(testUserId);
  assert.strictEqual(deletedAvatar, null, 'Deleted avatar in DB should return null');
  console.log('   ✅ Avatar deleted cleanly from database');

  console.log('\n🎉 ALL AVATAR DATABASE PERSISTENCE TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Avatar DB Test failed:', err);
  process.exit(1);
});
