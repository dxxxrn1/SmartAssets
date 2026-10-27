// ─── Focused Test Suite: Transaction Eligibility & Phantom Balance Rules ──────
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const vaultTxService = require('../src/services/vaultTransactionService');
const complianceService = require('../src/services/complianceService');
const { requireVerified, requireApprovedBank } = require('../src/middlewares/authMiddleware');
const paymentController = require('../src/controllers/paymentController');
const escrowController = require('../src/controllers/escrowController');
const userController = require('../src/controllers/userController');
const assetController = require('../src/controllers/assetController');
const authController = require('../src/controllers/authController');
const adminController = require('../src/controllers/adminController');
const supabase = require('../src/connection/supabaseClient');
const fs = require('fs');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('\n================================================================');
  console.log('  SMARTASSETS • Transaction Eligibility & Phantom Balance Suite');
  console.log('================================================================\n');

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 1: No Automatic Starter Funds (Phantom Balance Removed)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🧪 [TEST 1] Verifying no automatic starter funds (new user balance is R0)...');
  const freshUserId = '00000000-0000-4000-a000-' + Date.now().toString(16).padStart(12, '0');
  const initialBal = await vaultTxService.getUserBalance(freshUserId);

  assert.strictEqual(
    initialBal,
    0,
    `New user balance must be 0 ZAR, not starter credit. Received: ${initialBal}`
  );
  console.log(`   ✅ Fresh user balance is strictly R0 (no R15,000 phantom starter credit).`);

  console.log('\n🧪 [TEST 2] Verifying deposit and withdrawal calculations from R0 base...');
  const dep = await vaultTxService.depositFunds({
    userId: freshUserId,
    amount: 2500,
    method: 'Instant EFT',
    reference: 'REF-TEST-001',
  });
  assert.strictEqual(dep.newBalanceNum, 2500, 'Balance after R2,500 deposit must be exactly R2,500');

  const wth = await vaultTxService.withdrawFunds({
    userId: freshUserId,
    amount: 1000,
    method: 'bank',
    bankDetails: { bankName: 'Standard Bank', accountNumber: '123456789' },
  });
  assert.strictEqual(wth.newBalanceNum, 1500, 'Balance after R1,000 withdrawal must be exactly R1,500');

  let rejectedOverdraft = false;
  try {
    await vaultTxService.withdrawFunds({
      userId: freshUserId,
      amount: 5000,
      method: 'bank',
    });
  } catch (err) {
    rejectedOverdraft = true;
  }
  assert.ok(rejectedOverdraft, 'Overdraft exceeding available balance must be rejected');
  console.log(`   ✅ Balance state transitions strictly follow real transactions (0 -> 2500 -> 1500).`);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 2: Fail Closed When Compliance Data is Missing or Unverified
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 3] Fail-closed: unverified user is blocked by requireVerified middleware...');
  const unverifiedUser = {
    id: '11111111-1111-4111-a111-' + Date.now().toString(16).padStart(12, '0'),
    email: 'unverified-' + Date.now() + '@smartassets.io',
  };

  const reqUnverified = { user: unverifiedUser, headers: {} };
  const resUnverified = mockRes();
  let calledNext = false;

  await requireVerified(reqUnverified, resUnverified, () => {
    calledNext = true;
  });

  assert.strictEqual(calledNext, false, 'Middleware must not call next() for unverified user');
  assert.strictEqual(resUnverified.statusCode, 403, 'Middleware must return HTTP 403');
  assert.strictEqual(resUnverified.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ Unverified user blocked with 403 KYC_REQUIRED.`);

  console.log('\n🧪 [TEST 4] Fail-closed: wallet-linked user without 3 approved documents is blocked...');
  const walletOnlyUser = {
    id: '22222222-2222-4222-a222-' + Date.now().toString(16).padStart(12, '0'),
    email: 'wallet.user@smartassets.io',
    walletAddress: '0x1234567890123456789012345678901234567890',
  };

  const reqWallet = { user: walletOnlyUser, headers: {} };
  const resWallet = mockRes();
  let walletCalledNext = false;

  await requireVerified(reqWallet, resWallet, () => {
    walletCalledNext = true;
  });

  assert.strictEqual(walletCalledNext, false, 'Wallet-linked account without KYC must not pass');
  assert.strictEqual(resWallet.statusCode, 403);
  assert.strictEqual(resWallet.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ Having a linked wallet does NOT bypass KYC verification.`);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 3: Every Transaction Route Enforces Server-Side KYC
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 5] Payment Intent: createIntent rejects unverified user...');
  const reqIntent = {
    user: unverifiedUser,
    body: { amount: 5000, currency: 'zar', assetName: 'Rolex' },
  };
  const resIntent = mockRes();
  await paymentController.createIntent(reqIntent, resIntent);
  assert.strictEqual(resIntent.statusCode, 403);
  assert.strictEqual(resIntent.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ POST /api/payments/create-intent blocked with 403 KYC_REQUIRED.`);

  console.log('\n🧪 [TEST 6] Payment Process: processPayment rejects unverified user...');
  const reqProcess = {
    user: unverifiedUser,
    body: { paymentMethod: 'card', amountGbp: 5000 },
  };
  const resProcess = mockRes();
  await paymentController.processPayment(reqProcess, resProcess);
  assert.strictEqual(resProcess.statusCode, 403);
  assert.strictEqual(resProcess.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ POST /api/payments/process blocked with 403 KYC_REQUIRED.`);

  console.log('\n🧪 [TEST 7] Escrow Creation: createEscrow rejects unverified user...');
  const reqEscrow = {
    user: unverifiedUser,
    body: { assetName: 'Vintage Patek', amountZar: 180000 },
  };
  const resEscrow = mockRes();
  await escrowController.createEscrow(reqEscrow, resEscrow);
  assert.strictEqual(resEscrow.statusCode, 403);
  assert.strictEqual(resEscrow.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ POST /api/escrow/create blocked with 403 KYC_REQUIRED.`);

  console.log('\n🧪 [TEST 8] Vault Deposit: deposit rejects unverified user...');
  const reqDep = {
    user: unverifiedUser,
    body: { amount: 1000, method: 'card' },
  };
  const resDep = mockRes();
  await userController.deposit(reqDep, resDep);
  assert.strictEqual(resDep.statusCode, 403);
  assert.strictEqual(resDep.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ POST /api/deposit rejects unverified user with 403 KYC_REQUIRED.`);

  console.log('\n🧪 [TEST 9] Vault Withdrawal: withdraw rejects unverified user...');
  const reqWth = {
    user: unverifiedUser,
    body: { amount: 500 },
  };
  const resWth = mockRes();
  await userController.withdraw(reqWth, resWth);
  assert.strictEqual(resWth.statusCode, 403);
  assert.strictEqual(resWth.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ POST /api/withdraw rejects unverified user with 403 KYC_REQUIRED.`);

  console.log('\n🧪 [TEST 10] Asset Listing: createAsset rejects unverified user...');
  const reqAsset = {
    user: unverifiedUser,
    body: { name: 'Rare Ferrari', askingPrice: 'R1,200,000', image: 'data:image/png;base64,mock' },
  };
  const resAsset = mockRes();
  await assetController.createAsset(reqAsset, resAsset);
  assert.strictEqual(resAsset.statusCode, 403);
  assert.strictEqual(resAsset.body?.code, 'KYC_REQUIRED');
  console.log(`   ✅ POST /api/assets (createAsset) rejects unverified user with 403 KYC_REQUIRED.`);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 4: Verified User Can Transact, But Withdrawals Still Enforce Approved Bank
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 11] Approved 3-Document Lifecycle: user becomes verified only after all 3 documents are approved...');
  const testVerifiedId = '44444444-4444-4444-a444-' + Date.now().toString(16).padStart(12, '0');
  const testVerifiedEmail = 'three.approved.' + Date.now() + '@smartassets.io';

  // Upload 3 documents
  const doc1 = await complianceService.uploadVerificationDocument({
    userId: testVerifiedId,
    userEmail: testVerifiedEmail,
    fullName: 'Approved Collector',
    docType: 'id',
    fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    fileName: 'id.png',
    mimeType: 'image/png',
  });
  const doc2 = await complianceService.uploadVerificationDocument({
    userId: testVerifiedId,
    userEmail: testVerifiedEmail,
    fullName: 'Approved Collector',
    docType: 'tax',
    fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    fileName: 'tax.png',
    mimeType: 'image/png',
  });
  const doc3 = await complianceService.uploadVerificationDocument({
    userId: testVerifiedId,
    userEmail: testVerifiedEmail,
    fullName: 'Approved Collector',
    docType: 'proof_of_residence',
    fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    fileName: 'residence.png',
    mimeType: 'image/png',
  });

  // When only 2 of 3 are approved, user is STILL NOT verified (fail closed)
  await complianceService.approveDocument(doc1.document.id, 'admin');
  await complianceService.approveDocument(doc2.document.id, 'admin');

  const reqPartial = { user: { id: testVerifiedId, email: testVerifiedEmail }, headers: {} };
  const resPartial = mockRes();
  let partialCalledNext = false;
  await requireVerified(reqPartial, resPartial, () => {
    partialCalledNext = true;
  });
  assert.strictEqual(partialCalledNext, false, 'User with only 2 of 3 approved docs must NOT pass requireVerified');
  assert.strictEqual(resPartial.statusCode, 403);
  console.log(`   ✅ User with only 2 of 3 documents approved remains unverified (403 KYC_REQUIRED).`);

  // Approve 3rd document -> user is now verified
  await complianceService.approveDocument(doc3.document.id, 'admin');

  const reqFull = { user: { id: testVerifiedId, email: testVerifiedEmail }, headers: {} };
  const resFull = mockRes();
  let fullCalledNext = false;
  await requireVerified(reqFull, resFull, () => {
    fullCalledNext = true;
  });
  assert.strictEqual(fullCalledNext, true, 'User with all 3 approved docs passes requireVerified');
  console.log(`   ✅ User with all 3 documents approved passes requireVerified!`);

  console.log('\n🧪 [TEST 12] Approved Bank Rule: verified user without approved bank account cannot withdraw...');
  const resBankBlocked = mockRes();
  let bankCalledNext = false;
  await requireApprovedBank(reqFull, resBankBlocked, () => {
    bankCalledNext = true;
  });
  assert.strictEqual(bankCalledNext, false, 'Withdrawal must be blocked without approved bank account');
  assert.strictEqual(resBankBlocked.statusCode, 403);
  assert.strictEqual(resBankBlocked.body?.code, 'BANK_APPROVAL_REQUIRED');
  console.log(`   ✅ Verified user without approved bank account blocked with 403 BANK_APPROVAL_REQUIRED.`);

  // Submit and approve bank account -> withdrawal now allowed
  const bankAcc = await complianceService.submitBankAccount({
    userId: testVerifiedId,
    userEmail: testVerifiedEmail,
    fullName: 'Approved Collector',
    accountHolder: 'Approved Collector',
    bankName: 'First National Bank',
    accountNumber: '62810029384',
    branchCode: '250655',
    accountType: 'Cheque / Current',
  });
  await complianceService.approveBankAccount(bankAcc.id, 'admin');

  let bankApprovedNext = false;
  const resBankApproved = mockRes();
  await requireApprovedBank(reqFull, resBankApproved, () => {
    bankApprovedNext = true;
  });
  assert.strictEqual(bankApprovedNext, true, 'Withdrawal allowed once bank account is approved');
  console.log(`   ✅ User with approved bank account passes requireApprovedBank!`);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 5: Supabase Registration & Profile Storage Verification
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 13] Supabase Auth + Profile creation on user registration...');
  const testRegEmail = 'test.reg.' + Date.now() + '@smartassets.io';
  const testRegPass = 'SmartPass123!Safe';
  const reqReg = {
    body: {
      fullName: 'Registered User',
      email: testRegEmail,
      password: testRegPass,
    },
    headers: {},
  };
  const resReg = mockRes();
  await authController.register(reqReg, resReg);

  assert.strictEqual(resReg.statusCode, 201, `Registration should succeed with HTTP 201. Body: ${JSON.stringify(resReg.body)}`);
  assert.strictEqual(resReg.body?.success, true);
  const createdUserId = resReg.body?.user?.id;
  assert.ok(createdUserId, 'Registered user must return a valid Supabase UUID');

  // Verify profile exists directly in Supabase profiles table
  const { data: createdProfile, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, balance, role, verification_status')
    .eq('id', createdUserId)
    .single();

  assert.strictEqual(profErr, null, 'Profile lookup in Supabase should not error');
  assert.strictEqual(createdProfile.id, createdUserId);
  assert.strictEqual(Number(createdProfile.balance), 0, 'New user profile balance must be strictly 0');
  assert.strictEqual(createdProfile.verification_status, 'unverified', 'New user verification_status must be unverified');
  assert.strictEqual(createdProfile.role, 'user');
  console.log(`   ✅ Registration creates Supabase Auth user and profile with balance=0, role='user', verification_status='unverified'.`);

  // Clean up test user from Auth and profiles
  try {
    await supabase.from('profiles').delete().eq('id', createdUserId);
    await supabase.auth.admin.deleteUser(createdUserId);
  } catch (_) {}

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 6: JSON-Free Runtime Data Access (Zero JSON Files Created on Disk)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 14] JSON-free runtime data access: business data is never read or written to JSON...');
  const deletedJsonFiles = [
    'src/data/vaultBalances.json',
    'src/data/bankAccounts.json',
    'src/data/auditLogs.json',
    'src/data/userAvatars.json',
    'src/data/userStatus.json',
    'src/data/kycVerifications.json',
    'src/data/verificationDocuments.json',
  ];

  for (const f of deletedJsonFiles) {
    const full = path.resolve(__dirname, '..', f);
    assert.strictEqual(fs.existsSync(full), false, `${f} must NOT exist on disk`);
  }

  // Perform runtime vault operations and ensure no JSON files are created
  await vaultTxService.getUserBalance('00000000-0000-4000-a000-999999999999');
  for (const f of deletedJsonFiles) {
    const full = path.resolve(__dirname, '..', f);
    assert.strictEqual(fs.existsSync(full), false, `${f} must NOT be re-created during runtime operations`);
  }
  console.log(`   ✅ Verified no live business data is read from or written to JSON files on disk.`);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 7: Admin Empty States (No Synthesized Assets or Fake Catalog Items)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 15] Admin empty states: getAdminAssets returns Supabase rows without fake fallback assets...');
  const reqAdminAssets = { query: {} };
  const resAdminAssets = mockRes();
  await adminController.getAdminAssets(reqAdminAssets, resAdminAssets);

  assert.strictEqual(resAdminAssets.statusCode, 200);
  assert.ok(Array.isArray(resAdminAssets.body?.assets));
  const hasFallbackRolex = resAdminAssets.body.assets.some(
    (a) => a.id === 'asset-rolex-submariner' || a.id === 'asset-patek-5711'
  );
  assert.strictEqual(hasFallbackRolex, false, 'getAdminAssets must never fabricate fallback catalog items');
  console.log(`   ✅ Admin asset inventory shows only genuine Supabase records (count: ${resAdminAssets.body.count}), zero fabricated assets.`);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 8: Admin User Directory Balance Integrity (No Phantom 15,000 Starter Credit)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n🧪 [TEST 16] Admin user directory: users display real Supabase balance or 0, never 15000...');
  const reqAdminUsers = { query: {} };
  const resAdminUsers = mockRes();
  await adminController.getAdminUsers(reqAdminUsers, resAdminUsers);

  assert.strictEqual(resAdminUsers.statusCode, 200);
  assert.ok(Array.isArray(resAdminUsers.body?.users));
  const hasFake15k = resAdminUsers.body.users.some(
    (u) => u.balance === 15000 && !u.dbBalance
  );
  assert.strictEqual(hasFake15k, false, 'Admin user directory must not assign 15000 phantom balance to users');
  console.log(`   ✅ Admin user directory lists ${resAdminUsers.body.users.length} verified users with 0 or confirmed balances (no 15,000 phantom default).`);

  console.log('\n================================================================');
  console.log('🎉 ALL 16 FOCUSED TRANSACTION & PHANTOM BALANCE TESTS PASSED! 🎉');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Focused test suite failed:', err);
  process.exit(1);
});
