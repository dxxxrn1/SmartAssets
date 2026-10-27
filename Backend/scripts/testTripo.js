// ─── Test Script: Tripo API Key & Balance Verification ────────────────────────
// Checks that TRIPO_API_KEY is configured and authenticated with Tripo v3 API.
// IMPORTANT: Does NOT print or leak the API key to terminal output or logs.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { checkCreditBalance } = require('../src/services/tripoService');

async function testTripo() {
  console.log('\n======================================================');
  console.log('       SMARTASSETS • Tripo 3D API Verification        ');
  console.log('======================================================\n');

  const rawKey = (process.env.TRIPO_API_KEY || process.env.TRIPO_SECRETE_KEY || '').trim();

  if (!rawKey) {
    console.error('❌ FAILED: TRIPO_API_KEY is missing.');
    console.error('   Please add TRIPO_API_KEY to Backend/.env\n');
    process.exit(1);
  }

  // Safe visual hint without printing the actual key
  const maskedKey = rawKey.length > 8 
    ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` 
    : '****';
  console.log(`🔑 API Key Found: [${maskedKey}] (Length: ${rawKey.length} chars)`);
  console.log('🌐 Contacting Tripo OpenAPI v3 (https://openapi.tripo3d.ai/v3/account/balance)...');

  try {
    const balanceInfo = await checkCreditBalance();

    console.log('\n✅ AUTHENTICATION SUCCESSFUL!');
    console.log('------------------------------------------------------');
    console.log(`💰 Available Balance: ${balanceInfo.balance.toFixed(2)} credits`);
    console.log(`❄️  Frozen Balance:    ${balanceInfo.frozen.toFixed(2)} credits`);
    console.log('------------------------------------------------------');

    if (balanceInfo.balance <= 0) {
      console.log('\n⚠️  NOTICE: Your credit balance is currently 0.00.');
      console.log('   To generate new 3D models via the API, purchase credits at:');
      console.log('   👉 https://platform.tripo3d.ai/billing\n');
    } else {
      console.log('\n🚀 Your account is funded and ready for 3D model generation!\n');
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ VERIFICATION FAILED:');
    console.error(`   ${err.message}\n`);
    process.exit(1);
  }
}

testTripo();
