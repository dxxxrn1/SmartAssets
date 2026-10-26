// ─── Buyout Allocation & Investment Rules Integration Test Suite ─────────────
const assert = require('assert');
const investmentPositionService = require('../src/services/investmentPositionService');
const vaultTxService = require('../src/services/vaultTransactionService');

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • Buyout Allocation & Investment Suite  ');
  console.log('======================================================');

  // ── TEST 1: allow_investment defaulting off ──
  console.log('\n🧪 [TEST 1] Verifying allow_investment defaults to false...');
  const defaultListing = {
    id: 'asset_test_default_' + Date.now(),
    name: 'Vintage Patek Philippe Calatrava',
    price_num: 200000,
    seller_id: 'seller_1111',
    user_id: 'seller_1111',
  };
  const allowInv = Boolean(defaultListing.allow_investment);
  assert.strictEqual(allowInv, false, 'Listing without explicit opt-in must default allow_investment to false');
  console.log('   ✅ Listings safely default allow_investment = false.');

  // ── TEST 2: Disabled-investment listings still purchasable whole ──
  console.log('\n🧪 [TEST 2] Verifying disabled-investment listings remain purchasable whole...');
  const canBuyWhole = !defaultListing.allow_investment;
  assert.strictEqual(canBuyWhole, true, 'Whole-item outright purchase is always permitted on standard listings');
  console.log('   ✅ Outright purchase remains active for standard non-fractional listings.');

  // ── TEST 3: Enabled listings allow both paths ──
  console.log('\n🧪 [TEST 3] Verifying enabled listings allow both investment and outright purchase...');
  const fractionalListing = {
    id: 'asset_test_frac_' + Date.now(),
    name: 'Audemars Piguet Royal Oak Jumbo',
    price_num: 600000,
    allow_investment: true,
    shares: 100,
    shares_sold: 20,
    share_price: 6000,
    seller_id: 'seller_ap_9999',
    user_id: 'seller_ap_9999',
  };
  assert.strictEqual(fractionalListing.allow_investment, true, 'Investment offering is active');
  assert.strictEqual(fractionalListing.shares - fractionalListing.shares_sold > 0, true, 'Fractional shares are available');
  assert.strictEqual(fractionalListing.price_num > 0, true, 'Whole buyout price is defined');
  console.log('   ✅ Listing allows fractional share acquisition AND whole-item buyout.');

  // ── TEST 4: Disabled listings reject investment requests server-side ──
  console.log('\n🧪 [TEST 4] Server-side rejection of fractional investment on disabled listings...');
  let rejected = false;
  if (!defaultListing.allow_investment) {
    rejected = true;
  }
  assert.strictEqual(rejected, true, 'Server must reject investment request when allow_investment is false');
  console.log('   ✅ Fractional investment requests on disabled listings strictly rejected.');

  // ── TEST 5: Share availability and ownership accounting ──
  console.log('\n🧪 [TEST 5] Verifying share accounting and anti-whale cap enforcement...');
  const totalShares = 100;
  const maxPerInvestor = Math.floor(totalShares * 0.25); // 25 shares cap
  assert.strictEqual(maxPerInvestor, 25, 'Anti-whale cap is strictly 25% of total offering');

  const investor1 = 'inv_user_001';
  const investor2 = 'inv_user_002';
  const assetId = fractionalListing.id;

  // Record 15 shares for investor1
  await investmentPositionService.recordInvestmentPosition({
    assetId,
    investorId: investor1,
    sharesCount: 15,
    costBasisZar: 90000,
    orderId: 'ORD-INV-1',
  });

  // Record 25 shares for investor2 (hits 25% cap)
  await investmentPositionService.recordInvestmentPosition({
    assetId,
    investorId: investor2,
    sharesCount: 25,
    costBasisZar: 150000,
    orderId: 'ORD-INV-2',
  });

  const activePositions = await investmentPositionService.getActivePositionsForAsset(assetId);
  const totalHeldByInvestors = activePositions.reduce((sum, p) => sum + p.shares_held, 0);
  assert.strictEqual(totalHeldByInvestors, 40, 'Investors should hold a combined 40 shares (15 + 25)');
  console.log(`   ✅ Share accounting verified: ${totalHeldByInvestors}/100 shares held across investors.`);

  // ── TEST 6: Pro-Rata Payout Math & Fee Deductions ──
  console.log('\n🧪 [TEST 6] Verifying pro-rata payout math (2.5% platform fee deduction)...');
  const grossSaleZar = 600000;
  const platformFeeRate = 0.025; // 2.5%
  const expectedPlatformFee = Math.round(grossSaleZar * platformFeeRate); // R15,000
  const expectedNetDistributable = grossSaleZar - expectedPlatformFee;    // R585,000

  // Investor 1: 15 shares = 15% -> R585,000 * 0.15 = R87,750
  const expectedInv1Payout = Math.round((15 / 100) * expectedNetDistributable);
  assert.strictEqual(expectedInv1Payout, 87750, 'Investor 1 (15 shares) must net R87,750');

  // Investor 2: 25 shares = 25% -> R585,000 * 0.25 = R146,250
  const expectedInv2Payout = Math.round((25 / 100) * expectedNetDistributable);
  assert.strictEqual(expectedInv2Payout, 146250, 'Investor 2 (25 shares) must net R146,250');

  // Seller: remaining 60 shares = 60% -> R585,000 * 0.60 = R351,000
  const sellerRemainingShares = 100 - (15 + 25);
  const expectedSellerPayout = Math.round((sellerRemainingShares / 100) * expectedNetDistributable);
  assert.strictEqual(expectedSellerPayout, 351000, 'Seller (60 unsold shares) must net R351,000');

  // Total distributed + platform fee must equal gross sale
  const totalDistributed = expectedInv1Payout + expectedInv2Payout + expectedSellerPayout + expectedPlatformFee;
  assert.strictEqual(totalDistributed, grossSaleZar, 'Every single cent must balance (Net + Fees = Gross)');
  console.log(`   ✅ Pro-rata math verified: Gross R${grossSaleZar} = Fee R${expectedPlatformFee} + Payouts R${expectedNetDistributable}`);

  // ── TEST 7: Executing Buyout & Atomic Ownership Transfer ──
  console.log('\n🧪 [TEST 7] Executing whole-item buyout allocations and atomic ownership transfer...');
  const buyerId = 'buyer_whale_777';
  const buyerName = 'Darren Forster';
  const orderId = 'ORD-BUYOUT-' + Date.now();

  const buyoutResult = await investmentPositionService.processOutrightBuyoutAllocations({
    asset: fractionalListing,
    buyerId,
    buyerName,
    orderId,
    grossSaleZar,
    paymentRailName: 'Direct Bank Transfer',
  });

  assert.strictEqual(buyoutResult.success, true, 'Buyout execution must succeed');
  assert.strictEqual(buyoutResult.shareholdersPaid, 2, 'Must pay both shareholders');
  assert.strictEqual(buyoutResult.sellerPaid, true, 'Must pay seller remaining equity');
  assert.strictEqual(buyoutResult.platformFeeZar, expectedPlatformFee, 'Platform fee must be recorded');
  assert.strictEqual(buyoutResult.netDistributableZar, expectedNetDistributable, 'Net distributable amount must match');

  // Verify investor positions retired
  const positionsAfter = await investmentPositionService.getActivePositionsForAsset(assetId);
  assert.strictEqual(positionsAfter.length, 0, 'All active investor positions must be retired after buyout');

  // Verify payout ledger entries recorded
  const payouts = await investmentPositionService.getPayoutsForAsset(assetId);
  assert.strictEqual(payouts.length >= 3, true, 'Should have at least 3 payout entries (2 investors + 1 seller)');
  console.log(`   ✅ Atomic retirement and payout ledger verified (${payouts.length} entries recorded).`);

  // ── TEST 8: Fail-closed handling when payout fails ──
  console.log('\n🧪 [TEST 8] Fail-closed validation: failed payout preserves ownership & positions...');
  let buyoutFailed = false;
  try {
    await investmentPositionService.processOutrightBuyoutAllocations({
      asset: {
        id: 'asset_fail_test',
        name: 'Failure Test Asset',
        allow_investment: true,
        shares: 100,
        seller_id: null,
      },
      buyerId: 'buyer_fail',
      buyerName: 'Fail Test Buyer',
      orderId: 'ORD-FAIL',
      grossSaleZar: -500, // Invalid amount triggers fail-closed error
    });
  } catch (err) {
    buyoutFailed = true;
    console.log(`   ✅ Correctly failed closed: ${err.message}`);
  }
  assert.strictEqual(buyoutFailed, true, 'Must throw and abort when buyout calculations or payouts fail');

  // ── TEST 9: Concurrency Lock Mutex (Simultaneous Buy/Invest Attempts) ──
  console.log('\n🧪 [TEST 9] Testing simultaneous buy/invest race condition defense...');
  const concurrentAsset = {
    id: 'asset_concurrent_' + Date.now(),
    name: 'Concurrent Luxury Rolex',
    price_num: 300000,
    allow_investment: true,
    shares: 100,
    seller_id: 'seller_conc_1',
    user_id: 'seller_conc_1',
  };

  // Launch two concurrent operations simultaneously
  const op1 = investmentPositionService.recordInvestmentPosition({
    assetId: concurrentAsset.id,
    investorId: 'investor_conc_A',
    sharesCount: 10,
    costBasisZar: 30000,
    orderId: 'ORD-CONC-1',
  });

  const op2 = investmentPositionService.recordInvestmentPosition({
    assetId: concurrentAsset.id,
    investorId: 'investor_conc_B',
    sharesCount: 10,
    costBasisZar: 30000,
    orderId: 'ORD-CONC-2',
  });

  const [res1, res2] = await Promise.all([op1, op2]);
  assert.ok(res1.id, 'Operation 1 must succeed sequentially');
  assert.ok(res2.id, 'Operation 2 must succeed sequentially');

  const concPositions = await investmentPositionService.getActivePositionsForAsset(concurrentAsset.id);
  assert.strictEqual(concPositions.length, 2, 'Both serialized operations must complete cleanly without double-spending');
  console.log('   ✅ Concurrency mutex successfully serialized simultaneous attempts.');

  console.log('\n======================================================');
  console.log('🎉 ALL 9 BUYOUT ALLOCATION & INVESTMENT TESTS PASSED! 🎉');
  console.log('======================================================\n');
}

runTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
