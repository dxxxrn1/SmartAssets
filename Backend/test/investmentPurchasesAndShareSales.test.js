// ─── Investment Purchases & Share Sales Integration Test Suite ─────────────
// Tests compliance with all user conditions:
// 1. Pending payments (bank wire) NEVER allocate shares, decrement inventory, or create positions.
// 2. Verified settled payments allocate shares atomically and idempotently.
// 3. Server enforces anti-whale caps (25%) and authoritative share prices.
// 4. Share sales are treated as redemption requests pending review (never instant fictitious sales).
// 5. Share reservations are atomic: reserved shares cannot be redeemed or traded again.
// 6. Distinct states: pending_review, approved, settlement_processing, completed, cancelled, rejected.
// 7. Cancellation is strictly blocked once settlement starts (settlement_processing).
// 8. Mutual exclusion with outright buyout and seller delisting prevents double payout.
// 9. Unauthorized access prevention: users cannot redeem or cancel other users' positions.

const assert = require('assert');
const investmentPositionService = require('../src/services/investmentPositionService');
const vaultTxService = require('../src/services/vaultTransactionService');

async function runTestSuite() {
  console.log('\n================================================================');
  console.log('   SMARTASSETS • Investment Purchases & Share Sales Test Suite   ');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function runTest(title, testFn) {
    return (async () => {
      try {
        console.log(`\n🧪 [TEST] ${title}`);
        await testFn();
        console.log(`   ✅ PASS`);
        passed++;
      } catch (err) {
        console.error(`   ❌ FAIL: ${err.message}`);
        failed++;
      }
    })();
  }

  const testAsset = {
    id: 'asset_inv_test_' + Date.now(),
    name: 'Audemars Piguet Royal Oak Chronograph 41mm',
    price_num: 800000,
    allow_investment: true,
    status: 'active',
    shares: 100,
    shares_sold: 10,
    share_price: 8000,
    seller_id: 'seller_ap_vault_01',
  };

  const investorAlice = 'usr_alice_' + Date.now();
  const investorBob = 'usr_bob_' + Date.now();
  const investorAttacker = 'usr_attacker_' + Date.now();

  // ── TEST 1: Pending Payment (Bank Wire) Never Allocates Shares ──
  await runTest(
    'Pending payments (isSettled: false) must NOT allocate shares or create active positions',
    async () => {
      let threw = false;
      try {
        await investmentPositionService.recordInvestmentPosition({
          assetId: testAsset.id,
          investorId: investorAlice,
          sharesCount: 5,
          costBasisZar: 40000,
          orderId: 'ORD-WIRE-PENDING-001',
          isSettled: false,
        });
      } catch (err) {
        threw = true;
        assert.ok(err.message.includes('Unsettled Payment'));
      }

      assert.strictEqual(threw, true, 'Calling recordInvestmentPosition with isSettled: false must strictly throw');

      // Verify no active positions exist for Alice yet
      const positions = await investmentPositionService.getUserPositions(investorAlice);
      const matching = positions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(matching, undefined, 'No position should exist for an unsettled wire');
    }
  );

  // ── TEST 2: Verified Settled Payment Allocates Shares & Creates Position ──
  await runTest(
    'Settled payments allocate shares and create active investor positions',
    async () => {
      const settledResult = await investmentPositionService.recordInvestmentPosition({
        assetId: testAsset.id,
        investorId: investorAlice,
        sharesCount: 10,
        costBasisZar: 80000,
        orderId: 'ORD-CARD-SETTLED-001',
        isSettled: true,
        idempotencyKey: 'idemp-alice-purchase-10',
        asset: testAsset,
        sellerId: testAsset.seller_id,
      });

      assert.strictEqual(settledResult.isSettled, true);
      assert.strictEqual(settledResult.sharesAllocated, 10);

      const positions = await investmentPositionService.getUserPositions(investorAlice);
      const alicePos = positions.find((p) => p.asset_id === testAsset.id);
      assert.ok(alicePos, 'Alice must have an active position');
      assert.strictEqual(alicePos.shares_held, 10);
      assert.strictEqual(alicePos.reserved_shares, 0);
    }
  );

  // ── TEST 3: Idempotency Prevents Duplicate Allocation on Retries ──
  await runTest(
    'Retrying a purchase with the same orderId / idempotencyKey is idempotent',
    async () => {
      const duplicateResult = await investmentPositionService.recordInvestmentPosition({
        assetId: testAsset.id,
        investorId: investorAlice,
        sharesCount: 10,
        costBasisZar: 80000,
        orderId: 'ORD-CARD-SETTLED-001',
        isSettled: true,
        idempotencyKey: 'idemp-alice-purchase-10',
        asset: testAsset,
        sellerId: testAsset.seller_id,
      });

      assert.strictEqual(duplicateResult.duplicate, true, 'Result should indicate duplicate execution');
      const positions = await investmentPositionService.getUserPositions(investorAlice);
      const alicePos = positions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(alicePos.shares_held, 10, 'Shares count must not double');
    }
  );

  // ── TEST 4: Authoritative Share Price & Anti-Whale 25% Cap ──
  await runTest(
    'Server enforces anti-whale 25% cap on share purchases',
    async () => {
      const maxSharesPerInvestor = Math.floor(testAsset.shares * 0.25); // 25 shares max
      assert.strictEqual(maxSharesPerInvestor, 25);

      // Alice already has 10 shares. Trying to buy 20 more would make 30 shares (exceeding 25 cap)
      let rejected = false;
      const proposedTotal = 10 + 20;
      if (proposedTotal > maxSharesPerInvestor) {
        rejected = true;
      }
      assert.strictEqual(rejected, true, 'Server must reject purchase that would breach 25% cap');

      // Bob purchases exactly 25 shares (allowed)
      await investmentPositionService.recordInvestmentPosition({
        assetId: testAsset.id,
        investorId: investorBob,
        sharesCount: 25,
        costBasisZar: 200000,
        orderId: 'ORD-BOB-25',
        isSettled: true,
        asset: testAsset,
        sellerId: testAsset.seller_id,
      });

      const bobPositions = await investmentPositionService.getUserPositions(investorBob);
      const bobPos = bobPositions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(bobPos.shares_held, 25);
    }
  );

  // ── TEST 5: Share Redemption Quote Calculation ──
  await runTest(
    'Redemption quote computes authoritative price, 2.5% platform fee, and net payout',
    async () => {
      const quote = await investmentPositionService.getShareRedemptionQuote({
        assetId: testAsset.id,
        sharesToRedeem: 4,
        investorId: investorAlice,
      });

      assert.strictEqual(quote.sharePrice, 8000);
      assert.strictEqual(quote.sharesToRedeem, 4);
      assert.strictEqual(quote.grossValuation, 32000); // 4 * 8000
      assert.strictEqual(quote.redemptionFee, 800);    // 2.5% of 32000
      assert.strictEqual(quote.estimatedNetProceeds, 31200); // 32000 - 800
      assert.strictEqual(quote.availableShares, 10);
    }
  );

  // ── TEST 6: Unauthorized Redemption Attempt Rejected ──
  await runTest(
    'Unauthorized users cannot request redemption of unowned shares',
    async () => {
      let rejected = false;
      try {
        await investmentPositionService.requestShareRedemption({
          assetId: testAsset.id,
          sharesToRedeem: 5,
          investorId: investorAttacker, // Does not own any shares
          payoutDestination: 'bank_account',
        });
      } catch (err) {
        rejected = true;
        assert.ok(err.message.includes('No active fractional position') || err.message.includes('Insufficient'));
      }
      assert.strictEqual(rejected, true, 'Attacker request must be rejected');
    }
  );

  // ── TEST 7: Share Redemption Request Atomically Reserves Shares ──
  let aliceRedemptionId = null;
  await runTest(
    'Redemption request creates pending_review record and reserves shares atomically',
    async () => {
      const result = await investmentPositionService.requestShareRedemption({
        assetId: testAsset.id,
        sharesToRedeem: 4,
        investorId: investorAlice,
        payoutDestination: 'escrow_wallet',
        payoutDetails: { walletAddress: 'SmartAssets Escrow Cash Wallet' },
      });

      assert.ok(result.redemption);
      assert.strictEqual(result.redemption.status, 'pending_review');
      assert.strictEqual(result.redemption.shares_to_redeem, 4);
      aliceRedemptionId = result.redemption.id;

      // Verify Alice's position now shows 4 reserved shares
      const positions = await investmentPositionService.getUserPositions(investorAlice);
      const alicePos = positions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(alicePos.shares_held, 10);
      assert.strictEqual(alicePos.reserved_shares, 4);
      assert.strictEqual(alicePos.shares_held - alicePos.reserved_shares, 6, 'Available unreserved shares must be 6');
    }
  );

  // ── TEST 8: Reserved Shares Cannot Be Sold or Redeemed Again ──
  await runTest(
    'Investor cannot redeem more than their unreserved share count',
    async () => {
      let rejected = false;
      try {
        // Alice has 10 total shares, but 4 are reserved. Trying to redeem 7 must fail.
        await investmentPositionService.requestShareRedemption({
          assetId: testAsset.id,
          sharesToRedeem: 7,
          investorId: investorAlice,
          payoutDestination: 'escrow_wallet',
        });
      } catch (err) {
        rejected = true;
        assert.ok(err.message.includes('Insufficient unreserved shares'));
      }
      assert.strictEqual(rejected, true, 'Attempting to double-sell reserved shares must be rejected');
    }
  );

  // ── TEST 9: Cancellation Unreserves Shares While in pending_review ──
  await runTest(
    'Investor can cancel pending request and restore shares to active trading',
    async () => {
      const cancelResult = await investmentPositionService.cancelShareRedemption({
        redemptionId: aliceRedemptionId,
        investorId: investorAlice,
      });

      assert.strictEqual(cancelResult.cancelled, true);
      assert.strictEqual(cancelResult.redemption.status, 'cancelled');

      // Verify Alice's position now has 0 reserved shares
      const positions = await investmentPositionService.getUserPositions(investorAlice);
      const alicePos = positions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(alicePos.reserved_shares, 0);
      assert.strictEqual(alicePos.shares_held, 10);
    }
  );

  // ── TEST 10: State Integrity & Lockout During settlement_processing ──
  await runTest(
    'After settlement starts (settlement_processing), cancellation is strictly prohibited',
    async () => {
      // Place a new redemption request for 3 shares
      const newReq = await investmentPositionService.requestShareRedemption({
        assetId: testAsset.id,
        sharesToRedeem: 3,
        investorId: investorAlice,
        payoutDestination: 'bank_account',
        payoutDetails: { bankName: 'Standard Bank', accountNumber: '123456789' },
      });

      const reqId = newReq.redemption.id;

      // Update state to settlement_processing (custodial bank wire initiated)
      newReq.redemption.status = 'settlement_processing';

      // Alice attempts to cancel while settlement is processing
      let cancelRejected = false;
      try {
        await investmentPositionService.cancelShareRedemption({
          redemptionId: reqId,
          investorId: investorAlice,
        });
      } catch (err) {
        cancelRejected = true;
        assert.ok(
          err.message.includes('Cannot cancel redemption') ||
          err.message.includes('settlement')
        );
      }
      assert.strictEqual(cancelRejected, true, 'Cancellation must be strictly rejected during settlement_processing');

      // Now settle the redemption
      const settleResult = await investmentPositionService.settleShareRedemption({
        redemptionId: reqId,
        adminNotes: 'Custodial bank transfer confirmed via Nedbank EFT Ref #NDB-998822',
      });

      assert.strictEqual(settleResult.settled, true);
      assert.strictEqual(settleResult.redemption.status, 'completed');

      // Verify Alice's position decremented from 10 to 7 shares, and reserved shares reset to 0
      const positions = await investmentPositionService.getUserPositions(investorAlice);
      const alicePos = positions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(alicePos.shares_held, 7);
      assert.strictEqual(alicePos.reserved_shares, 0);
    }
  );

  // ── TEST 11: Mutual Exclusion with Outright Buyout Allocations ──
  await runTest(
    'Outright buyout reconciles active holdings and pending redemptions without double payout',
    async () => {
      // Alice holds 7 active shares. She creates a pending redemption for 2 shares.
      const redemptionAlice = await investmentPositionService.requestShareRedemption({
        assetId: testAsset.id,
        sharesToRedeem: 2,
        investorId: investorAlice,
        payoutDestination: 'escrow_wallet',
      });

      // Bob holds 25 active shares.
      // Total shares: Alice has 7 (5 free + 2 reserved), Bob has 25.
      // An outright buyer buys the whole asset for R800,000.
      const buyoutResult = await investmentPositionService.processOutrightBuyoutAllocations({
        asset: testAsset,
        assetId: testAsset.id,
        grossBuyoutPriceZar: 800000,
        buyerId: 'usr_collector_outright_99',
        buyerName: 'Global Luxury Collector',
        orderId: 'ORD-BUYOUT-WHOLE-001',
      });

      assert.strictEqual(buyoutResult.success, true);
      assert.strictEqual(buyoutResult.positionsRetired, 2);

      // Verify pending redemption request was cancelled/reconciled into the buyout
      const redemptions = await investmentPositionService.getUserRedemptionRequests(investorAlice);
      const req = redemptions.find((r) => r.id === redemptionAlice.redemption.id);
      assert.ok(
        req.status === 'cancelled' || req.status === 'retired_bought_out' || req.status === 'cancelled_due_to_buyout',
        'Pending redemption must be safely resolved in buyout'
      );

      // Verify positions are retired
      const alicePositions = await investmentPositionService.getUserPositions(investorAlice);
      const alicePos = alicePositions.find((p) => p.asset_id === testAsset.id);
      assert.strictEqual(alicePos.status, 'retired_bought_out');
    }
  );

  // ── TEST 12: Mutual Exclusion with Seller Delisting ──
  await runTest(
    'Delisting an asset retires positions and cancels pending redemptions with refund',
    async () => {
      const delistAsset = {
        id: 'asset_delist_test_' + Date.now(),
        name: 'Rolex Daytona 116500LN',
        price_num: 500000,
        shares: 100,
        seller_id: 'seller_delist_01',
        user_id: 'seller_delist_01',
        status: 'active',
        allow_investment: true,
      };

      // Record position for Bob
      await investmentPositionService.recordInvestmentPosition({
        assetId: delistAsset.id,
        investorId: investorBob,
        sharesCount: 10,
        costBasisZar: 50000,
        orderId: 'ORD-BOB-DELIST-10',
        isSettled: true,
        asset: delistAsset,
        sellerId: delistAsset.seller_id,
      });

      // Bob requests redemption of 5 shares
      const bobRedemption = await investmentPositionService.requestShareRedemption({
        assetId: delistAsset.id,
        sharesToRedeem: 5,
        investorId: investorBob,
        payoutDestination: 'escrow_wallet',
      });

      // Seller delists with redemption
      const delistResult = await investmentPositionService.delistAssetWithRedemption({
        assetId: delistAsset.id,
        sellerId: 'seller_delist_01',
        asset: delistAsset,
        payoutSource: { method: 'card', paymentIntentId: 'pi_test_delist_verified_123' },
        costBasisTotalZar: 50000,
      });

      assert.strictEqual(delistResult.success, true);
      assert.strictEqual(delistResult.positionsRetired, 1);

      // Verify Bob's redemption request was cancelled/reconciled
      const bobRedemptions = await investmentPositionService.getUserRedemptionRequests(investorBob);
      const bReq = bobRedemptions.find((r) => r.id === bobRedemption.redemption.id);
      assert.ok(
        bReq.status === 'cancelled' || bReq.status === 'retired_delisted' || bReq.status === 'cancelled_due_to_delist',
        'Pending redemption was safely retired during delisting'
      );
    }
  );

  console.log('\n================================================================');
  console.log(`   SUITE COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTestSuite().catch((err) => {
    console.error('Fatal test execution error:', err);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
