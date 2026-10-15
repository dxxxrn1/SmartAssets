// ─── Vault Transaction Integration Tests ─────────────────────────────────────
const assert = require('assert');
const vaultTxService = require('../src/services/vaultTransactionService');

async function runTests() {
  console.log('\n🧪 [TEST 1] Testing getUserBalance...');
  const testUserId = 'test-vault-user-' + Date.now();
  const initialBal = await vaultTxService.getUserBalance(testUserId);
  assert.ok(typeof initialBal === 'number', 'Balance should be a number');
  console.log(`   ✅ User initial balance: ${vaultTxService.formatZar(initialBal)}`);

  console.log('\n🧪 [TEST 2] Testing depositFunds...');
  const depositAmt = 5000;
  const depResult = await vaultTxService.depositFunds({
    userId: testUserId,
    amount: depositAmt,
    method: 'Instant EFT',
    reference: 'REF-DEP-TEST-001',
    notes: 'Unit test deposit',
  });

  assert.strictEqual(depResult.newBalanceNum, initialBal + depositAmt, 'Balance should increase by deposit amount');
  assert.strictEqual(depResult.transaction.type, 'deposit', 'Transaction type should be deposit');
  assert.ok(depResult.transaction.id.startsWith('TXN-DEP-'), 'Transaction ID should start with TXN-DEP-');
  console.log(`   ✅ Deposit succeeded! New balance: ${depResult.newBalanceFormatted}`);

  console.log('\n🧪 [TEST 3] Testing withdrawFunds within balance...');
  const withdrawAmt = 2000;
  const wthResult = await vaultTxService.withdrawFunds({
    userId: testUserId,
    amount: withdrawAmt,
    method: 'Bank EFT',
    bankDetails: { bankName: 'Standard Bank', accountNumber: '1234567890' },
    notes: 'Unit test withdrawal',
  });

  assert.strictEqual(wthResult.newBalanceNum, initialBal + depositAmt - withdrawAmt, 'Balance should decrease by withdrawal amount');
  assert.strictEqual(wthResult.transaction.type, 'withdraw', 'Transaction type should be withdraw');
  assert.ok(wthResult.transaction.id.startsWith('TXN-WTH-'), 'Transaction ID should start with TXN-WTH-');
  console.log(`   ✅ Withdrawal succeeded! New balance: ${wthResult.newBalanceFormatted}`);

  console.log('\n🧪 [TEST 4] Testing withdrawFunds exceeding balance (Should reject)...');
  const excessAmt = 999999999;
  let rejected = false;
  try {
    await vaultTxService.withdrawFunds({
      userId: testUserId,
      amount: excessAmt,
      method: 'Bank EFT',
    });
  } catch (err) {
    rejected = true;
    console.log(`   ✅ Correctly rejected: ${err.message}`);
  }
  assert.ok(rejected, 'Withdrawal exceeding available balance must be rejected');

  console.log('\n🧪 [TEST 5] Testing getUserTransactions history...');
  const txHistory = vaultTxService.getUserTransactions(testUserId);
  assert.strictEqual(txHistory.length, 2, 'Should have 2 transactions (1 deposit + 1 withdrawal)');
  assert.strictEqual(txHistory[0].type, 'withdraw', 'Newest transaction should be first');
  assert.strictEqual(txHistory[1].type, 'deposit', 'Oldest transaction should be second');
  console.log(`   ✅ Transaction history verified (${txHistory.length} records)`);

  console.log('\n🎉 ALL 5 VAULT TRANSACTION TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Vault test failed:', err);
  process.exit(1);
});

