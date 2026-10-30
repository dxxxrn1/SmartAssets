// ─── Vault Transaction Integration Tests ─────────────────────────────────────
const assert = require('assert');
const vaultTxService = require('../src/services/vaultTransactionService');
const complianceService = require('../src/services/complianceService');

async function runTests() {
  console.log('\n🧪 [TEST 1] Testing getUserBalance...');
  const testUserId = 'test-vault-user-' + Date.now();
  const initialBal = await vaultTxService.getUserBalance(testUserId);
  assert.ok(typeof initialBal === 'number', 'Balance should be a number');
  console.log(`   ✅ User initial balance: ${vaultTxService.formatZar(initialBal)}`);

  console.log('\n🧪 [TEST 2] Testing depositFunds (Pending Review -> Admin Confirmed)...');
  const depositAmt = 5000;
  const pendingDep = await vaultTxService.depositFunds({
    userId: testUserId,
    amount: depositAmt,
    method: 'Manual Bank EFT',
    reference: 'REF-DEP-TEST-001',
    notes: 'Unit test deposit',
  });

  assert.strictEqual(pendingDep.status, 'pending_review', 'Manual deposit must start in pending_review');
  assert.strictEqual(pendingDep.newBalanceNum, initialBal, 'Spendable balance must NOT increase before confirmation');
  assert.strictEqual(pendingDep.transaction.type, 'deposit', 'Transaction type should be deposit');
  assert.ok(pendingDep.transaction.id.startsWith('TXN-DEP-'), 'Transaction ID should start with TXN-DEP-');

  const confirmedDep = await vaultTxService.confirmDeposit({
    transactionId: pendingDep.transaction.id,
    reviewer: 'admin-treasury',
    settlementRef: 'BANK-SETTLED-001',
  });

  assert.strictEqual(confirmedDep.status, 'completed', 'Confirmed deposit must be completed');
  assert.strictEqual(confirmedDep.newBalanceNum, initialBal + depositAmt, 'Balance should increase by deposit amount after confirmation');
  console.log(`   ✅ Deposit confirmed! New spendable balance: ${confirmedDep.newBalanceFormatted}`);

  console.log('\n🧪 [TEST 3] Testing withdrawFunds within balance (to Approved Bank Account)...');
  const bankEntry = await complianceService.submitBankAccount({
    userId: testUserId,
    userEmail: `${testUserId}@smartassets.io`,
    fullName: 'Vault Integration Tester',
    accountHolder: 'Vault Integration Tester',
    bankName: 'Standard Bank',
    accountNumber: '1234567890',
    branchCode: '051001',
    accountType: 'Cheque / Current',
  });
  await complianceService.approveBankAccount(bankEntry.id, 'admin-treasury');

  const withdrawAmt = 2000;
  const wthResult = await vaultTxService.withdrawFunds({
    userId: testUserId,
    amount: withdrawAmt,
    method: 'Bank EFT',
    notes: 'Unit test withdrawal',
  });

  assert.strictEqual(wthResult.status, 'pending_review', 'Withdrawal request must start in pending_review');
  assert.strictEqual(wthResult.newBalanceNum, initialBal + depositAmt - withdrawAmt, 'Spendable balance should decrease immediately via reservation');
  assert.strictEqual(wthResult.reservedBalanceNum, withdrawAmt, 'Reserved balance should hold the pending withdrawal');
  assert.strictEqual(wthResult.transaction.type, 'withdraw', 'Transaction type should be withdraw');
  assert.ok(wthResult.transaction.id.startsWith('TXN-WTH-'), 'Transaction ID should start with TXN-WTH-');

  const settledWth = await vaultTxService.settleWithdrawal({
    transactionId: wthResult.transaction.id,
    reviewer: 'admin-treasury',
    settlementRef: 'EFT-PAYOUT-001',
  });
  assert.strictEqual(settledWth.status, 'completed', 'Settled withdrawal must be completed');
  assert.strictEqual(settledWth.reservedBalanceNum, 0, 'Reserved balance must be cleared after settlement');
  assert.strictEqual(settledWth.newBalanceNum, initialBal + depositAmt - withdrawAmt, 'Spendable balance remains accurate after settlement');
  console.log(`   ✅ Withdrawal reserved and settled! New spendable balance: ${settledWth.newBalanceFormatted}`);

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

