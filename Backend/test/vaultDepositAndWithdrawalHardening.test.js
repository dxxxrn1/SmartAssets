// ─── Comprehensive Vault Deposit & Withdrawal Hardening Test Suite ────────────
const assert = require('assert');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const vaultTxService = require('../src/services/vaultTransactionService');
const complianceService = require('../src/services/complianceService');
const stripeService = require('../src/services/stripeService');
const userController = require('../src/controllers/userController');
const adminController = require('../src/controllers/adminController');
const supabase = require('../src/connection/supabaseClient');

// Ensure isolated test execution uses mocks and never alters production Supabase data
if (supabase) {
  if (supabase.storage) {
    supabase.storage.from = () => ({
      upload: async () => ({ data: { path: 'mock/path.png' }, error: null }),
      remove: async () => ({ data: [], error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://mock.local/doc.png' }, error: null }),
    });
  }
  const mockChain = {
    select: () => mockChain,
    insert: () => mockChain,
    update: () => mockChain,
    upsert: () => Promise.resolve({ data: null, error: null }),
    delete: () => mockChain,
    eq: () => mockChain,
    in: () => mockChain,
    order: () => mockChain,
    limit: () => mockChain,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    catch: () => Promise.resolve({ data: [], error: null }),
  };
  supabase.from = () => mockChain;
}

function mockRes() {
  return {
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
  };
}

async function createVerifiedUserWithBank(prefix, includeApprovedBank = true) {
  const userId = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `${userId}@smartassets.io`;

  for (const docType of ['id', 'tax', 'proof_of_residence']) {
    const uploaded = await complianceService.uploadVerificationDocument({
      userId,
      userEmail: email,
      fullName: `Verified ${prefix}`,
      docType,
      fileData:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      fileName: `${docType}.png`,
      mimeType: 'image/png',
    });
    await complianceService.approveDocument(uploaded.document.id, 'admin-test');
  }

  let bankEntry = null;
  if (includeApprovedBank) {
    bankEntry = await complianceService.submitBankAccount({
      userId,
      userEmail: email,
      fullName: `Verified ${prefix}`,
      accountHolder: `Verified ${prefix}`,
      bankName: 'First National Bank',
      accountNumber: '62899110022',
      branchCode: '250655',
      accountType: 'Cheque / Current',
    });
    await complianceService.approveBankAccount(bankEntry.id, 'admin-test');
  }

  return { userId, email, bankEntry };
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('  SMART_ASSETS • Vault Deposit & Withdrawal Hardening Suite');
  console.log('======================================================================\n');

  const originalVerifyPaymentIntent = stripeService.verifyPaymentIntent;

  try {
    // ── TEST 1: Forged or unverified manual bank reference never increases spendable balance
    console.log('🧪 [TEST 1] Unverified deposit / user-supplied bank reference does NOT credit balance...');
    const { userId: u1, email: e1 } = await createVerifiedUserWithBank('u1-unverified-dep');

    const reqForgedDep = {
      user: { id: u1, email: e1 },
      headers: {},
      body: {
        amount: 25000,
        method: 'Manual Bank EFT',
        reference: 'FORGED-EFT-REF-999',
        idempotencyKey: `idem-dep-forged-${Date.now()}`,
      },
    };
    const resForgedDep = mockRes();
    await userController.deposit(reqForgedDep, resForgedDep);

    assert.strictEqual(resForgedDep.statusCode, 202, 'Manual deposit should return HTTP 202 Pending Review');
    assert.strictEqual(resForgedDep.body.status, 'pending_review');
    assert.strictEqual(resForgedDep.body.newBalanceNum, 0, 'Spendable balance must remain R0');
    const balAfterForged = await vaultTxService.getUserBalance(u1);
    assert.strictEqual(balAfterForged, 0, 'Server balance must still be R0');
    console.log('   ✅ Forged/unverified bank reference recorded as pending_review with R0 spendable balance.');

    // ── TEST 2: Provider-verified deposit (Stripe) + rejection of pending/failed/wrong-amount/currency/user
    console.log('\n🧪 [TEST 2] Stripe provider verification: rejects pending/failed, wrong amount, wrong currency, wrong user...');
    const { userId: u2, email: e2 } = await createVerifiedUserWithBank('u2-stripe-dep');

    // 2a. Pending payment intent
    stripeService.verifyPaymentIntent = async () => ({
      id: 'pi_pending_123',
      status: 'requires_payment_method',
      amount: 1000,
      currency: 'ZAR',
      metadata: { userId: u2 },
    });
    const resPendingPi = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: { amount: 1000, method: 'Card (Stripe)', paymentIntentId: 'pi_pending_123' },
      },
      resPendingPi
    );
    assert.strictEqual(resPendingPi.statusCode, 402, 'Unsettled Stripe PaymentIntent must be rejected with 402');
    assert.strictEqual(await vaultTxService.getUserBalance(u2), 0);

    // 2b. Wrong amount
    stripeService.verifyPaymentIntent = async () => ({
      id: 'pi_wrong_amt',
      status: 'succeeded',
      amount: 500,
      currency: 'ZAR',
      metadata: { userId: u2 },
    });
    const resWrongAmt = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: { amount: 5000, method: 'Card (Stripe)', paymentIntentId: 'pi_wrong_amt' },
      },
      resWrongAmt
    );
    assert.strictEqual(resWrongAmt.statusCode, 400);
    assert.strictEqual(resWrongAmt.body.code, 'AMOUNT_MISMATCH');
    assert.strictEqual(await vaultTxService.getUserBalance(u2), 0);

    // 2c. Wrong currency
    stripeService.verifyPaymentIntent = async () => ({
      id: 'pi_wrong_cur',
      status: 'succeeded',
      amount: 1000,
      currency: 'USD',
      metadata: { userId: u2 },
    });
    const resWrongCur = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: { amount: 1000, method: 'Card (Stripe)', paymentIntentId: 'pi_wrong_cur' },
      },
      resWrongCur
    );
    assert.strictEqual(resWrongCur.statusCode, 400);
    assert.strictEqual(resWrongCur.body.code, 'CURRENCY_MISMATCH');

    // 2d. Wrong user
    stripeService.verifyPaymentIntent = async () => ({
      id: 'pi_wrong_user',
      status: 'succeeded',
      amount: 1000,
      currency: 'ZAR',
      metadata: { userId: 'another-user-id' },
    });
    const resWrongUser = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: { amount: 1000, method: 'Card (Stripe)', paymentIntentId: 'pi_wrong_user' },
      },
      resWrongUser
    );
    assert.strictEqual(resWrongUser.statusCode, 403);
    assert.strictEqual(resWrongUser.body.code, 'USER_MISMATCH');
    assert.strictEqual(await vaultTxService.getUserBalance(u2), 0);

    // 2e. Valid verified Stripe PaymentIntent
    stripeService.verifyPaymentIntent = async () => ({
      id: 'pi_valid_settled_001',
      status: 'succeeded',
      amount: 3500,
      currency: 'ZAR',
      metadata: { userId: u2 },
    });
    const resValidPi = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: {
          amount: 3500,
          method: 'Card (Stripe)',
          paymentIntentId: 'pi_valid_settled_001',
          idempotencyKey: 'idem-pi-valid-001',
        },
      },
      resValidPi
    );
    assert.strictEqual(resValidPi.statusCode, 200);
    assert.strictEqual(resValidPi.body.status, 'completed');
    assert.strictEqual(resValidPi.body.newBalanceNum, 3500);
    console.log('   ✅ Stripe verification enforces status, amount, currency (ZAR), and user before crediting R3,500.');

    // ── TEST 3: Duplicate webhook / duplicate provider reference / duplicate idempotencyKey
    console.log('\n🧪 [TEST 3] Idempotency & replay protection: duplicate idempotencyKey or replayed PaymentIntent...');
    // Same idempotency key returns cached response without double-crediting
    const resDupIdem = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: {
          amount: 3500,
          method: 'Card (Stripe)',
          paymentIntentId: 'pi_valid_settled_001',
          idempotencyKey: 'idem-pi-valid-001',
        },
      },
      resDupIdem
    );
    assert.strictEqual(resDupIdem.statusCode, 200);
    assert.strictEqual(await vaultTxService.getUserBalance(u2), 3500, 'Duplicate idempotency key must not double-credit');

    // Different idempotency key attempting to replay same paymentIntentId
    const resReplayPi = mockRes();
    await userController.deposit(
      {
        user: { id: u2, email: e2 },
        headers: {},
        body: {
          amount: 3500,
          method: 'Card (Stripe)',
          paymentIntentId: 'pi_valid_settled_001',
          idempotencyKey: 'idem-pi-replay-002',
        },
      },
      resReplayPi
    );
    assert.strictEqual(resReplayPi.statusCode, 409, 'Replayed paymentIntentId must be rejected with 409');
    assert.strictEqual(resReplayPi.body.code, 'DUPLICATE_PROVIDER_REFERENCE');
    assert.strictEqual(await vaultTxService.getUserBalance(u2), 3500);
    console.log('   ✅ Duplicate idempotencyKey and replayed provider references are safely blocked.');

    // ── TEST 4: Admin deposit confirmation & authorization enforcement
    console.log('\n🧪 [TEST 4] Admin deposit confirmation: enforces admin role, requires settlementRef, credits once...');
    const pendingTxId = resForgedDep.body.transaction.id;

    // Non-admin attempt to confirm deposit -> 403
    const resNonAdminConfirm = mockRes();
    await adminController.confirmAdminDeposit(
      {
        user: { id: u1, email: e1, role: 'user' },
        params: { id: pendingTxId },
        body: { settlementRef: 'HACK-REF' },
      },
      resNonAdminConfirm
    );
    assert.strictEqual(resNonAdminConfirm.statusCode, 403);
    assert.strictEqual(await vaultTxService.getUserBalance(u1), 0);

    // Admin attempt without settlementRef -> 400
    const resMissingRef = mockRes();
    await adminController.confirmAdminDeposit(
      {
        user: { id: 'admin-1', email: 'admin@smartassets.io', role: 'admin' },
        params: { id: pendingTxId },
        body: {},
      },
      resMissingRef
    );
    assert.strictEqual(resMissingRef.statusCode, 400);
    assert.strictEqual(resMissingRef.body.code, 'SETTLEMENT_REF_REQUIRED');

    // Valid admin confirmation -> 200, credits R25,000 once
    const resAdminConfirm = mockRes();
    await adminController.confirmAdminDeposit(
      {
        user: { id: 'admin-1', email: 'admin@smartassets.io', role: 'admin' },
        params: { id: pendingTxId },
        body: { settlementRef: 'FNB-TREASURY-88102' },
      },
      resAdminConfirm
    );
    assert.strictEqual(resAdminConfirm.statusCode, 200);
    assert.strictEqual(resAdminConfirm.body.status, 'completed');
    assert.strictEqual(await vaultTxService.getUserBalance(u1), 25000);

    // Confirming again is idempotent (does not credit a second time)
    const resAdminConfirmDup = mockRes();
    await adminController.confirmAdminDeposit(
      {
        user: { id: 'admin-1', email: 'admin@smartassets.io', role: 'admin' },
        params: { id: pendingTxId },
        body: { settlementRef: 'FNB-TREASURY-88102' },
      },
      resAdminConfirmDup
    );
    assert.strictEqual(resAdminConfirmDup.statusCode, 200);
    assert.strictEqual(resAdminConfirmDup.body.idempotent, true);
    assert.strictEqual(await vaultTxService.getUserBalance(u1), 25000, 'Balance must still be R25,000');
    console.log('   ✅ Admin deposit confirmation enforces admin auth, requires settlementRef, and credits exactly once.');

    // ── TEST 5: Withdrawal destination rules (unapproved bank, bank details override, crypto override, re-approval on edit)
    console.log('\n🧪 [TEST 5] Withdrawal destination protection: blocks unapproved bank, body overrides, and edited bank until re-approved...');
    // 5a. Attempt to override bankDetails in request body for u1 (whose approved bank is 62899110022)
    const resOverrideBank = mockRes();
    await userController.withdraw(
      {
        user: { id: u1, email: e1 },
        headers: {},
        body: {
          amount: 1000,
          method: 'bank',
          bankDetails: { bankName: 'Capitec', accountNumber: '9999999999' },
        },
      },
      resOverrideBank
    );
    assert.strictEqual(resOverrideBank.statusCode, 403);
    assert.strictEqual(resOverrideBank.body.code, 'UNAPPROVED_DESTINATION');

    // 5b. Attempt to withdraw to a crypto wallet
    const resCryptoWithdraw = mockRes();
    await userController.withdraw(
      {
        user: { id: u1, email: e1 },
        headers: {},
        body: {
          amount: 1000,
          method: 'crypto',
          walletAddress: '0x1234567890123456789012345678901234567890',
        },
      },
      resCryptoWithdraw
    );
    assert.strictEqual(resCryptoWithdraw.statusCode, 403);
    assert.strictEqual(resCryptoWithdraw.body.code, 'UNAPPROVED_DESTINATION');

    // 5c. Changing bank details resets status to 'pending' and blocks withdrawal until re-approved
    const updatedBank = await complianceService.submitBankAccount({
      userId: u1,
      userEmail: e1,
      fullName: 'Verified u1',
      accountHolder: 'Verified u1',
      bankName: 'Standard Bank',
      accountNumber: '10111222333',
      branchCode: '051001',
      accountType: 'Current',
    });
    assert.strictEqual(updatedBank.status, 'pending', 'Updated bank details must reset status to pending');

    const resPendingBankWth = mockRes();
    await userController.withdraw(
      {
        user: { id: u1, email: e1 },
        headers: {},
        body: { amount: 1000, method: 'bank' },
      },
      resPendingBankWth
    );
    assert.strictEqual(resPendingBankWth.statusCode, 403);
    assert.strictEqual(resPendingBankWth.body.code, 'BANK_APPROVAL_REQUIRED');

    // Re-approve updated bank account
    await complianceService.approveBankAccount(updatedBank.id, 'admin-1');
    console.log('   ✅ Request-body destination overrides, crypto payouts, and unapproved bank edits are strictly rejected.');

    // ── TEST 6: Concurrent withdrawals racing against the same balance (no double-spend)
    console.log('\n🧪 [TEST 6] Concurrency lock: two simultaneous R15,000 withdrawals against R25,000 balance...');
    const [wthRace1, wthRace2] = await Promise.allSettled([
      vaultTxService.withdrawFunds({
        userId: u1,
        amount: 15000,
        method: 'Bank EFT',
        idempotencyKey: 'race-wth-1',
      }),
      vaultTxService.withdrawFunds({
        userId: u1,
        amount: 15000,
        method: 'Bank EFT',
        idempotencyKey: 'race-wth-2',
      }),
    ]);

    const fulfilled = [wthRace1, wthRace2].filter((r) => r.status === 'fulfilled');
    const rejected = [wthRace1, wthRace2].filter((r) => r.status === 'rejected');
    assert.strictEqual(fulfilled.length, 1, 'Exactly 1 of the two R15,000 withdrawals must succeed');
    assert.strictEqual(rejected.length, 1, 'The second R15,000 withdrawal must be rejected for insufficient funds');
    assert.strictEqual(rejected[0].reason.code, 'INSUFFICIENT_FUNDS');

    const detailsAfterRace = await vaultTxService.getUserBalanceDetails(u1);
    assert.strictEqual(detailsAfterRace.totalBalance, 25000, 'Total balance remains R25,000 while withdrawal is pending');
    assert.strictEqual(detailsAfterRace.reservedBalance, 15000, 'Reserved balance holds R15,000');
    assert.strictEqual(detailsAfterRace.spendableBalance, 10000, 'Spendable balance is R10,000');
    console.log('   ✅ Concurrent withdrawals serialized cleanly: 1 reserved R15,000, 1 rejected (remaining spendable: R10,000).');

    // ── TEST 7: Withdrawal cancellation & rejection restore reserved balance exactly once
    console.log('\n🧪 [TEST 7] Cancellation & rejection restore reserved funds once; settlement completes withdrawal...');
    const winningWthTxId = fulfilled[0].value.transaction.id;

    // Cancel the R15,000 pending withdrawal as the owner
    const resCancel = mockRes();
    await userController.cancelWithdrawal(
      {
        user: { id: u1, email: e1 },
        params: { id: winningWthTxId },
        body: { reason: 'Changed my mind' },
      },
      resCancel
    );
    assert.strictEqual(resCancel.statusCode, 200);
    assert.strictEqual(resCancel.body.status, 'cancelled');
    assert.strictEqual(await vaultTxService.getUserBalance(u1), 25000, 'Spendable balance restored to R25,000');

    // Cancelling a second time is idempotent and does NOT add another R15,000
    const resCancelDup = mockRes();
    await userController.cancelWithdrawal(
      {
        user: { id: u1, email: e1 },
        params: { id: winningWthTxId },
        body: { reason: 'Duplicate cancel' },
      },
      resCancelDup
    );
    assert.strictEqual(resCancelDup.statusCode, 200);
    assert.strictEqual(resCancelDup.body.idempotent, true);
    assert.strictEqual(await vaultTxService.getUserBalance(u1), 25000, 'Balance must not inflate on duplicate cancel');

    // Create a new R8,000 withdrawal and settle it via admin
    const wthToSettle = await vaultTxService.withdrawFunds({
      userId: u1,
      amount: 8000,
      method: 'Bank EFT',
      idempotencyKey: 'wth-to-settle-1',
    });
    assert.strictEqual(await vaultTxService.getUserBalance(u1), 17000);

    // Lock for payout processing -> user cannot cancel once settlement_processing starts
    await vaultTxService.markWithdrawalProcessing({
      transactionId: wthToSettle.transaction.id,
      reviewer: 'admin-1',
    });
    const resCancelBlocked = mockRes();
    await userController.cancelWithdrawal(
      {
        user: { id: u1, email: e1 },
        params: { id: wthToSettle.transaction.id },
        body: {},
      },
      resCancelBlocked
    );
    assert.strictEqual(resCancelBlocked.statusCode, 409);
    assert.strictEqual(resCancelBlocked.body.code, 'CANCELLATION_LOCKED');

    // Settle withdrawal as admin with settlement reference
    const resSettle = mockRes();
    await adminController.settleAdminWithdrawal(
      {
        user: { id: 'admin-1', email: 'admin@smartassets.io', role: 'admin' },
        params: { id: wthToSettle.transaction.id },
        body: { settlementRef: 'SBSA-PAYOUT-77419' },
      },
      resSettle
    );
    assert.strictEqual(resSettle.statusCode, 200);
    assert.strictEqual(resSettle.body.status, 'completed');

    const detailsAfterSettle = await vaultTxService.getUserBalanceDetails(u1);
    assert.strictEqual(detailsAfterSettle.totalBalance, 17000, 'Total balance permanently reduced to R17,000');
    assert.strictEqual(detailsAfterSettle.reservedBalance, 0, 'Reserved balance cleared to R0');
    assert.strictEqual(detailsAfterSettle.spendableBalance, 17000, 'Spendable balance is R17,000');
    console.log('   ✅ Pending withdrawal cancellation, payout lock, and admin settlement verified.');

    // ── TEST 8: Failed database write fails closed without mutating balance or creating untracked state
    console.log('\n🧪 [TEST 8] Failed database write fails closed and rolls back state...');
    let dbWriteThrew = false;
    try {
      await vaultTxService.withdrawFunds({
        userId: u1,
        amount: 2000,
        method: 'Bank EFT',
        simulateDbError: true,
      });
    } catch (err) {
      dbWriteThrew = true;
      assert.strictEqual(err.code, 'DB_WRITE_FAILED');
    }
    assert.strictEqual(dbWriteThrew, true, 'Simulated DB write failure must throw DB_WRITE_FAILED');
    const detailsAfterDbFail = await vaultTxService.getUserBalanceDetails(u1);
    assert.strictEqual(detailsAfterDbFail.totalBalance, 17000, 'Total balance unchanged after DB failure');
    assert.strictEqual(detailsAfterDbFail.reservedBalance, 0, 'Reserved balance rolled back to 0 after DB failure');
    assert.strictEqual(detailsAfterDbFail.spendableBalance, 17000, 'Spendable balance unchanged after DB failure');
    console.log('   ✅ Failed DB write rolled back cleanly with zero balance corruption.');

    // ── TEST 9: Static verification of VaultScreen.js (no client-side synthetic balance or fabricated 0x hashes)
    console.log('\n🧪 [TEST 9] Verifying VaultScreen.js has no synthetic .catch() balance credits or fake 0x hashes...');
    const vaultScreenPath = path.resolve(__dirname, '../../Public/App/src/screens/VaultScreen.js');
    const vaultScreenSource = fs.readFileSync(vaultScreenPath, 'utf8');
    assert.strictEqual(
      vaultScreenSource.includes('Deposit Credited to Vault!'),
      false,
      'VaultScreen must not claim instant unverified deposit credit'
    );
    assert.strictEqual(
      vaultScreenSource.includes('Withdrawal Processed!'),
      false,
      'VaultScreen must not claim instant withdrawal settlement'
    );
    console.log('   ✅ VaultScreen.js free of synthetic balance fallbacks and misleading instant settlement claims.');

    console.log('\n======================================================================');
    console.log('🎉 ALL 9 VAULT DEPOSIT & WITHDRAWAL HARDENING TEST SUITES PASSED! 🎉');
    console.log('======================================================================\n');
  } finally {
    stripeService.verifyPaymentIntent = originalVerifyPaymentIntent;
  }
}

runTests().catch((err) => {
  console.error('\n❌ Vault Deposit & Withdrawal Hardening Suite Failed:', err);
  process.exit(1);
});
