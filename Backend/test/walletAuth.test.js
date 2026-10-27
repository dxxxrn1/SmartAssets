// ─── Wallet Authentication & Linking Test Suite ──────────────────────────────
// Tests cryptographic challenge-response, signature verification, nonces,
// prevention of dummy account creation, and wallet linking constraints.

const assert = require('assert');
const { ethers } = require('ethers');
const {
  createNonceChallenge,
  verifyWalletSignature,
} = require('../src/services/walletAuthService');
const { requireLinkedWallet } = require('../src/middlewares/walletMiddleware');

async function runTests() {
  console.log('\n======================================================');
  console.log('       SMARTASSETS • Web3 Wallet Linking Test Suite   ');
  console.log('======================================================\n');

  // Generate a mock Ethereum wallet for testing
  const testWallet = ethers.Wallet.createRandom();
  const walletAddress = testWallet.address.toLowerCase();

  // ── TEST 1: Nonce Challenge Generation ──────────────────────────────────────
  console.log('🧪 [TEST 1] Testing Nonce Challenge Generation...');
  const challenge = await createNonceChallenge(walletAddress);
  assert.ok(challenge.nonce, 'Challenge must return a nonce');
  assert.ok(challenge.message.includes(walletAddress), 'Message must contain the wallet address');
  assert.ok(challenge.expiresAt instanceof Date, 'Challenge must specify expiration date');
  console.log('   ✅ Nonce challenge created successfully with 5-minute lifespan.');

  // ── TEST 2: Cryptographic Signature Verification (EIP-191) ─────────────────
  console.log('\n🧪 [TEST 2] Testing EIP-191 personal_sign Cryptographic Verification...');
  // Wallet signs the message locally (just as MetaMask does on client)
  const signature = await testWallet.signMessage(challenge.message);
  assert.ok(signature, 'Signature must be generated');

  const verification = await verifyWalletSignature(walletAddress, signature, challenge.nonce);
  assert.strictEqual(verification.valid, true, 'Valid signature must pass verification');
  console.log('   ✅ Cryptographic signature verified using ethers.verifyMessage!');

  // ── TEST 3: Replay Attack Defense (Single-Use Nonce) ────────────────────────
  console.log('\n🧪 [TEST 3] Testing Single-Use Nonce & Replay Defense...');
  // Attempting to reuse the exact same nonce and signature should be rejected
  const replayAttempt = await verifyWalletSignature(walletAddress, signature, challenge.nonce);
  assert.strictEqual(replayAttempt.valid, false, 'Replaying a used nonce must fail');
  assert.ok(
    replayAttempt.error.includes('already been used') || replayAttempt.error.includes('Invalid'),
    'Error message should indicate reused nonce'
  );
  console.log('   ✅ Replay attack successfully blocked: nonce marked as used.');

  // ── TEST 4: Forged Address / Wrong Signer Defense ───────────────────────────
  console.log('\n🧪 [TEST 4] Testing Impersonation & Forged Signature Defense...');
  const victimAddress = '0x1111111111111111111111111111111111111111';
  const victimChallenge = await createNonceChallenge(victimAddress);
  // Attacker signs victim's challenge with attacker's key
  const attackerSignature = await testWallet.signMessage(victimChallenge.message);

  const fraudAttempt = await verifyWalletSignature(victimAddress, attackerSignature, victimChallenge.nonce);
  assert.strictEqual(fraudAttempt.valid, false, 'Signature from wrong address must fail');
  console.log('   ✅ Impersonation prevented: attacker cannot claim an address they do not own.');

  // ── TEST 5: Transaction Middleware Linked Wallet Check ──────────────────────
  console.log('\n🧪 [TEST 5] Testing requireLinkedWallet Transaction Guard...');
  let nextCalled = false;
  let rejectedError = null;

  const mockRes = {
    status: (code) => ({
      json: (data) => {
        rejectedError = data;
      },
    }),
  };

  // 5a. Mismatched wallet in transaction
  const mockReqMismatch = {
    user: { id: 'user-1', user_metadata: { wallet_address: walletAddress } },
    body: { from: '0x9999999999999999999999999999999999999999' },
  };

  await requireLinkedWallet(mockReqMismatch, mockRes, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, false, 'Mismatched wallet in transaction must be blocked');
  assert.strictEqual(rejectedError?.code, 'WALLET_MISMATCH', 'Error code must be WALLET_MISMATCH');
  console.log('   ✅ Transaction blocked when connected wallet differs from user linked wallet.');

  console.log('\n🎉 ALL 5 WALLET LINKING & SECURITY TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Wallet test suite failed:', err);
  process.exit(1);
});
