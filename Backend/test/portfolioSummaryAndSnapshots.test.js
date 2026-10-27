// ─── Portfolio Summary & Snapshots Integration Tests ─────────────────────────
const assert = require('assert');
const portfolioSnapshotService = require('../src/services/portfolioSnapshotService');
const { isHoldingVerified } = require('../src/utils/holdingVerification');

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING PORTFOLIO SUMMARY & SNAPSHOTS TEST SUITE');
  console.log('======================================================\n');

  // Clear memory cache before starting
  portfolioSnapshotService.clearMemoryCache();

  // ── TEST 1: Empty Holdings Behavior ─────────────────────────────────────────
  console.log('🧪 [TEST 1] Empty holdings handling...');
  const emptyItems = [];
  const emptyCategories = new Set(
    emptyItems.map((i) => (i.category ? String(i.category).trim() : '')).filter((c) => c.length > 0)
  );
  const categoriesCountEmpty = emptyItems.length === 0 ? 0 : emptyCategories.size;
  const verifiedCountEmpty = emptyItems.filter(isHoldingVerified).length;
  const verifiedPctEmpty = emptyItems.length === 0 ? null : Math.round((verifiedCountEmpty / emptyItems.length) * 100);

  assert.strictEqual(categoriesCountEmpty, 0, 'Empty holdings must return 0 categories');
  assert.strictEqual(verifiedPctEmpty, null, 'Empty holdings must return null verifiedPct (not 100%)');
  console.log('   ✅ Empty holdings correctly yield 0 categories and null verifiedPct.');

  // ── TEST 2: Distinct Categories Count ───────────────────────────────────────
  console.log('\n🧪 [TEST 2] Distinct categories count calculation...');
  const mixedItems = [
    { name: 'Rolex Daytona', category: 'Watches', price_num: 250000 },
    { name: 'Patek Philippe', category: 'Watches', price_num: 450000 },
    { name: 'Oil on Canvas', category: 'Fine Art', price_num: 120000 },
    { name: 'Porsche 911', category: 'Luxury Cars', price_num: 1500000 },
    { name: 'Empty Cat Item', category: '   ', price_num: 5000 },
    { name: 'Null Cat Item', category: null, price_num: 10000 },
  ];

  const uniqueCats = new Set(
    mixedItems
      .map((i) => (i.category ? String(i.category).trim() : ''))
      .filter((c) => c.length > 0)
  );
  assert.strictEqual(uniqueCats.size, 3, 'Should have exactly 3 distinct categories (Watches, Fine Art, Luxury Cars)');
  assert.ok(uniqueCats.has('Watches'), 'Should include Watches');
  assert.ok(uniqueCats.has('Fine Art'), 'Should include Fine Art');
  assert.ok(uniqueCats.has('Luxury Cars'), 'Should include Luxury Cars');
  console.log('   ✅ Exactly 3 distinct non-empty categories extracted correctly.');

  // ── TEST 3: Authoritative Verification Status ──────────────────────────────
  console.log('\n🧪 [TEST 3] Authoritative verification rules...');
  const testHoldings = [
    { name: 'Asset 1', verified: true },                                                        // verified = true
    { name: 'Asset 2', is_verified: true },                                                     // is_verified = true
    { name: 'Asset 3', verification_status: 'verified' },                                       // explicit status
    { name: 'Asset 4', status: 'certified' },                                                   // certified status
    { name: 'Asset 5', gain: '+5.0%<!--meta:{"verified":true}-->' },                            // meta verified
    { name: 'Asset 6', gain: '+2.0%<!--meta:{"txHash":"0x8f7a1c9e8d3b2a1f0e4c6b8d2a1f"}-->' },    // authentic on-chain tx
    { name: 'Asset 7', verified: false },                                                       // explicit false
    { name: 'Asset 8', verification_status: 'unverified' },                                     // explicit unverified
    { name: 'Asset 9', verification_status: 'pending' },                                        // pending
    { name: 'Asset 10', gain: '+0.0%<!--meta:{"hashDisplay":"0x71c...9a"}-->' },                 // placeholder hash
    { name: 'Asset 11', price_num: 1000 },                                                      // unverified default
  ];

  const verifiedResults = testHoldings.map((h) => ({ name: h.name, verified: isHoldingVerified(h) }));
  const verifiedCount = verifiedResults.filter((r) => r.verified).length;
  const unverifiedCount = verifiedResults.filter((r) => !r.verified).length;

  assert.strictEqual(verifiedCount, 6, 'First 6 items must be verified');
  assert.strictEqual(unverifiedCount, 5, 'Remaining 5 items must be unverified');

  const calculatedPct = Math.round((verifiedCount / testHoldings.length) * 100);
  assert.strictEqual(calculatedPct, 55, '6/11 should be 55% verified');
  console.log(`   ✅ 6/11 items verified (${calculatedPct}%). No false 100% defaults.`);

  // ── TEST 4: Missing Performance History (New Account) ──────────────────────
  console.log('\n🧪 [TEST 4] New account with no start-of-month snapshot...');
  const newUserId = 'new-user-' + Date.now();
  // Record only today's snapshot
  const today = new Date('2026-10-27T12:00:00Z');
  await portfolioSnapshotService.recordDailySnapshot(newUserId, {
    portfolioValue: 50000,
    cashBalance: 10000,
    date: today,
  });

  const perfNewUser = await portfolioSnapshotService.getMonthlyPerformance(newUserId, 50000, today);
  assert.strictEqual(perfNewUser.hasPerformanceHistory, false, 'Should have no performance history without baseline');
  assert.strictEqual(perfNewUser.performanceStatus, 'unavailable', 'Status should be unavailable');
  assert.strictEqual(perfNewUser.monthlyChangeNum, null, 'monthlyChangeNum should be null');
  assert.strictEqual(perfNewUser.monthlyChangePct, null, 'monthlyChangePct should be null');
  assert.strictEqual(perfNewUser.monthlyChangeFormatted, null, 'monthlyChangeFormatted should be null');
  console.log('   ✅ New account properly displays "Performance history unavailable" without invented numbers.');

  // ── TEST 5: Positive Monthly Performance ────────────────────────────────────
  console.log('\n🧪 [TEST 5] Positive monthly performance calculation...');
  const posUserId = 'pos-user-' + Date.now();
  // Seed baseline snapshot at start of month
  portfolioSnapshotService.seedMemorySnapshot(posUserId, {
    portfolioValue: 100000,
    snapshotDate: '2026-10-01',
  });
  // Intermediate snapshot
  portfolioSnapshotService.seedMemorySnapshot(posUserId, {
    portfolioValue: 108000,
    snapshotDate: '2026-10-15',
  });

  // Current value as of 2026-10-27: 115000 (+15,000 / +15.0%)
  const perfPositive = await portfolioSnapshotService.getMonthlyPerformance(posUserId, 115000, today);
  assert.strictEqual(perfPositive.hasPerformanceHistory, true, 'Performance history should be available');
  assert.strictEqual(perfPositive.baselineValue, 100000, 'Baseline value should be 100,000');
  assert.strictEqual(perfPositive.monthlyChangeNum, 15000, 'Gain should be exactly 15,000');
  assert.strictEqual(perfPositive.monthlyChangePct, '+15.0%', 'Percentage should be +15.0%');
  assert.ok(perfPositive.monthlyChangeFormatted.includes('+R15'), 'Formatted gain should contain +R15,000');
  assert.strictEqual(perfPositive.isPositive, true, 'isPositive should be true');
  assert.strictEqual(perfPositive.history.length, 3, 'History should have 3 points (01, 15, 27)');
  console.log(`   ✅ Positive gain calculated: ${perfPositive.monthlyChangePct} (${perfPositive.monthlyChangeFormatted})`);

  // ── TEST 6: Negative Monthly Performance ────────────────────────────────────
  console.log('\n🧪 [TEST 6] Negative monthly performance calculation...');
  const negUserId = 'neg-user-' + Date.now();
  portfolioSnapshotService.seedMemorySnapshot(negUserId, {
    portfolioValue: 200000,
    snapshotDate: '2026-10-01',
  });

  // Current value as of 2026-10-27: 180000 (-20,000 / -10.0%)
  const perfNegative = await portfolioSnapshotService.getMonthlyPerformance(negUserId, 180000, today);
  assert.strictEqual(perfNegative.hasPerformanceHistory, true, 'Performance history should be available');
  assert.strictEqual(perfNegative.baselineValue, 200000, 'Baseline value should be 200,000');
  assert.strictEqual(perfNegative.monthlyChangeNum, -20000, 'Loss should be exactly -20,000');
  assert.strictEqual(perfNegative.monthlyChangePct, '-10.0%', 'Percentage should be -10.0%');
  assert.ok(perfNegative.monthlyChangeFormatted.startsWith('-R'), 'Formatted change should start with -R');
  assert.strictEqual(perfNegative.isPositive, false, 'isPositive should be false');
  console.log(`   ✅ Negative loss calculated: ${perfNegative.monthlyChangePct} (${perfNegative.monthlyChangeFormatted})`);

  // ── TEST 7: Zero Starting Value ─────────────────────────────────────────────
  console.log('\n🧪 [TEST 7] Zero starting value (division by zero protection)...');
  const zeroUserId = 'zero-user-' + Date.now();
  portfolioSnapshotService.seedMemorySnapshot(zeroUserId, {
    portfolioValue: 0,
    snapshotDate: '2026-10-01',
  });

  // Gained R5,000 from 0
  const perfZeroStart = await portfolioSnapshotService.getMonthlyPerformance(zeroUserId, 5000, today);
  assert.strictEqual(perfZeroStart.hasPerformanceHistory, true, 'Performance history should be available');
  assert.strictEqual(perfZeroStart.monthlyChangeNum, 5000, 'Change should be 5,000');
  assert.strictEqual(perfZeroStart.monthlyChangePct, '+100.0%', 'Zero baseline growth handled without NaN/Infinity');
  assert.ok(perfZeroStart.monthlyChangeFormatted.includes('+R5'), 'Formatted change contains +R5,000');

  // Both baseline and current value 0
  const perfZeroBoth = await portfolioSnapshotService.getMonthlyPerformance(zeroUserId, 0, today);
  assert.strictEqual(perfZeroBoth.monthlyChangeNum, 0, 'Change should be 0');
  assert.strictEqual(perfZeroBoth.monthlyChangePct, '0.0%', 'Zero to zero is 0.0%');
  assert.ok(perfZeroBoth.monthlyChangeFormatted.includes('R0 this month'), 'Formatted change is R0 this month');
  console.log('   ✅ Zero starting values handled safely without NaN or division by zero.');

  // ── TEST 8: Graph Data Series & Coordinate Mapping ──────────────────────────
  console.log('\n🧪 [TEST 8] Graph series normalization & points mapping...');
  const historyData = [
    { date: '2026-10-01', value: 10000 },
    { date: '2026-10-10', value: 12000 },
    { date: '2026-10-20', value: 11000 },
    { date: '2026-10-27', value: 15000 },
  ];

  const vals = historyData.map((d) => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  assert.strictEqual(minV, 10000, 'Min value is 10,000');
  assert.strictEqual(maxV, 15000, 'Max value is 15,000');

  // Map to height 52 (usable range 8 to 44 = 36px)
  const mappedPoints = historyData.map((d, idx) => {
    const x = (idx / (historyData.length - 1)) * 420;
    const y = 44 - ((d.value - minV) / (maxV - minV)) * 36;
    return { x, y, value: d.value };
  });

  assert.strictEqual(mappedPoints[0].x, 0, 'First x coordinate is 0');
  assert.strictEqual(mappedPoints[0].y, 44, 'Lowest value (10000) maps to bottom y=44');
  assert.strictEqual(mappedPoints[3].x, 420, 'Last x coordinate is 420');
  assert.strictEqual(mappedPoints[3].y, 8, 'Highest value (15000) maps to top y=8');
  console.log('   ✅ Graph points normalized correctly from dated history.');

  console.log('\n======================================================');
  console.log('🎉 ALL 8 PORTFOLIO SUMMARY TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
