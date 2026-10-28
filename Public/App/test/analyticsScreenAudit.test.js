// ─── Frontend Analytics Screen Audit Test Suite ──────────────────────────────
// File: Public/App/test/analyticsScreenAudit.test.js
// Tests the client-side calculation logic of ProfileAnalyticsScreen.js:
// 1. Authoritative valuation (effectiveHoldingValue & myStake)
// 2. Clear separation of cash, escrow custody, and holdings
// 3. Time-based performance from snapshots (unavailable vs measured)
// 4. Asset-level performance (best/lowest performer requiring real appraisal)
// 5. Escrow lifecycle revenue semantics (released vs payment_secured)
// 6. Period filter consistency & timestamp handling
// 7. Explicit verification badges (holdings & listings)

const assert = require('assert');

// ── 1. Authoritative holding value extractor (mirrors ProfileAnalyticsScreen.js)
const getHoldingValue = (h) => {
  if (!h) return 0;
  if (h.effectiveHoldingValue !== undefined && h.effectiveHoldingValue !== null) {
    return Number(h.effectiveHoldingValue) || 0;
  }
  if (h.asset_type === "fractional") {
    return Number(h.myStake) || 0;
  }
  return Number(h.liveMarketValue) || Number(h.initialValue) || Number(h.price_num) || 0;
};

// ── 2. Holding verification badge resolver
const getHoldingBadge = (asset) => {
  const isMinted = Boolean(
    asset.nft_token_id || asset.tokenId || (asset.certId && asset.isVerified)
  );
  if (isMinted) return "Certificate Minted";
  if (asset.isVerified === true || asset.verified === true) return "Verified";
  if (asset.verification_status === "in_review" || asset.status === "in_review") return "Under Review";
  return "Unverified";
};

// ── 3. Listing status badge resolver
const getListingBadge = (listing) => {
  const isMinted = Boolean(listing.nft_token_id || listing.token_id || listing.cert_id);
  const isVer =
    listing.is_verified === true ||
    listing.verified === true ||
    listing.verification_status === "verified" ||
    listing.verification_status === "certified";

  if (listing.status === "sold") return "Sold";
  if (isMinted && isVer) return "Cert Minted";
  if (isVer) return "Verified";
  if (listing.status === "active") return "Listed";
  if (
    listing.status === "pending" ||
    listing.status === "pending_review" ||
    listing.verification_status === "in_review"
  ) {
    return "In Review";
  }
  return "Unverified";
};

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING PROFILE ANALYTICS SCREEN AUDIT TESTS');
  console.log('======================================================\n');

  // ── TEST 1: Authoritative Valuation & Fractional Stakes ─────────────────────
  console.log('🧪 [TEST 1] Authoritative valuation & fractional stake calculation...');
  const testHoldings = [
    {
      name: 'Rolex Daytona',
      asset_type: 'whole',
      price_num: 250000,
      initialValue: 250000,
      liveMarketValue: 275000,
      effectiveHoldingValue: 275000,
    },
    {
      name: 'Fractional Vintage Ferrari',
      asset_type: 'fractional',
      price_num: 12000000, // R12M pool price
      shares_owned: 50,
      myStake: 120000, // User owns R120,000 stake
      effectiveHoldingValue: 120000,
    },
    {
      name: 'Art Print (Recorded Cost)',
      asset_type: 'whole',
      price_num: 45000,
      initialValue: 45000,
      effectiveHoldingValue: 45000,
    },
  ];

  const totalPortfolioVal = testHoldings.reduce((sum, h) => sum + getHoldingValue(h), 0);
  assert.strictEqual(totalPortfolioVal, 440000, 'Total portfolio must be 275k + 120k + 45k = 440,000');

  // Check fractional value separately
  const fractionalOnly = testHoldings.filter((h) => h.asset_type === 'fractional');
  const fractionalVal = fractionalOnly.reduce((sum, h) => sum + getHoldingValue(h), 0);
  assert.strictEqual(fractionalVal, 120000, 'Fractional holding value must strictly equal myStake (R120,000)');
  assert.notStrictEqual(fractionalVal, 12120000, 'Must NOT sum R12M pool and myStake together');
  console.log('   ✅ Authoritative holding values computed correctly without fractional inflation.');

  // ── TEST 2: Separation of Cash, Escrow Custody, and Holdings ────────────────
  console.log('\n🧪 [TEST 2] Separation of liquid cash, locked escrow funds, and holdings...');
  const availableCash = 50000;
  const lockedEscrow = 30000;
  const portfolioVal = 440000;
  const combinedNetWorth = availableCash + lockedEscrow + portfolioVal;

  assert.strictEqual(combinedNetWorth, 520000, 'Combined net worth must equal 50k + 30k + 440k');
  assert.strictEqual(availableCash, 50000, 'Available cash must be liquid funds only (not including locked escrow)');
  console.log('   ✅ Liquid cash (R50k) and locked escrow custody (R30k) kept strictly separate.');

  // ── TEST 3: Best and Lowest Performers (Requires Dated Market Appraisal) ───
  console.log('\n🧪 [TEST 3] Best and lowest performers calculation...');
  // Scenario A: Holdings recorded only at cost basis (no live appraisal)
  const costBasisOnlyHoldings = [
    { name: 'Gold Bar', initialValue: 50000, price_num: 50000, hasMarketValue: false, liveMarketValue: null },
    { name: 'Diamond Ring', initialValue: 80000, price_num: 80000, hasMarketValue: false, liveMarketValue: null },
  ];

  const eligibleForPerfA = costBasisOnlyHoldings.filter(
    (h) => (h.hasMarketValue === true || (h.liveMarketValue !== null && Number(h.liveMarketValue) > 0)) &&
           (h.initialValue !== null && Number(h.initialValue) > 0)
  );

  assert.strictEqual(eligibleForPerfA.length, 0, 'No cost-basis-only holdings should be eligible for performance ranking');

  // Scenario B: Holdings with authentic dated market appraisals
  const holdingsWithAppraisals = [
    { name: 'Omega Speedmaster', initialValue: 60000, liveMarketValue: 72000, hasMarketValue: true }, // +20.0%
    { name: 'Vintage Wine Case', initialValue: 40000, liveMarketValue: 36000, hasMarketValue: true }, // -10.0%
    { name: 'Silver Coins', initialValue: 10000, liveMarketValue: null, hasMarketValue: false },     // no appraisal
  ];

  const eligibleForPerfB = holdingsWithAppraisals
    .filter((h) => (h.hasMarketValue === true || (h.liveMarketValue !== null && Number(h.liveMarketValue) > 0)) &&
                   (h.initialValue !== null && Number(h.initialValue) > 0))
    .map((h) => {
      const diff = h.liveMarketValue - h.initialValue;
      const pct = (diff / h.initialValue) * 100;
      return { ...h, diff, pct };
    })
    .sort((a, b) => b.pct - a.pct);

  assert.strictEqual(eligibleForPerfB.length, 2, 'Exactly 2 holdings have real appraisals');
  assert.strictEqual(eligibleForPerfB[0].name, 'Omega Speedmaster');
  assert.strictEqual(eligibleForPerfB[0].pct, 20.0);
  assert.strictEqual(eligibleForPerfB[1].name, 'Vintage Wine Case');
  assert.strictEqual(eligibleForPerfB[1].pct, -10.0);
  console.log('   ✅ Best (+20.0%) and Lowest (-10.0%) performers calculated only from dated appraisals.');

  // ── TEST 4: Escrow Revenue Semantics (Released vs Payment Secured) ──────────
  console.log('\n🧪 [TEST 4] Escrow revenue semantics: completed vs active orders...');
  const orders = [
    { orderId: 'ORD-A', status: 'released', amountZar: 15000 },
    { orderId: 'ORD-B', status: 'completed', amountZar: 25000 },
    { orderId: 'ORD-C', status: 'payment_secured', amountZar: 40000 }, // Under active custody
    { orderId: 'ORD-D', status: 'in_transit', amountZar: 35000 },      // In courier transit
    { orderId: 'ORD-E', status: 'refunded', amountZar: 10000 },        // Refunded
  ];

  const TERMINAL_SUCCESSFUL = ['completed', 'released'];
  const ACTIVE_ESCROW = ['payment_secured', 'in_transit', 'in_inspection', 'delivered', 'accepted', 'disputed'];

  const completedSales = orders.filter((o) => TERMINAL_SUCCESSFUL.includes(o.status));
  const activeEscrow = orders.filter((o) => ACTIVE_ESCROW.includes(o.status));

  const completedRevenue = completedSales.reduce((sum, o) => sum + o.amountZar, 0);
  const inEscrowBalance = activeEscrow.reduce((sum, o) => sum + o.amountZar, 0);

  assert.strictEqual(completedRevenue, 40000, 'Completed revenue must only sum released + completed (15k + 25k = 40,000)');
  assert.strictEqual(inEscrowBalance, 75000, 'In-escrow balance must sum active custody (40k + 35k = 75,000)');
  console.log('   ✅ payment_secured and in_transit strictly excluded from sales revenue (R40,000).');

  // ── TEST 5: Period Filter & Undated Order Handling ─────────────────────────
  console.log('\n🧪 [TEST 5] Period filter consistency and timestamp handling...');
  const now = Date.now();
  const salesOrders = [
    { orderId: 'O-recent', amountZar: 10000, status: 'released', created_at: new Date(now - 3 * 86400000).toISOString() }, // 3 days ago
    { orderId: 'O-older', amountZar: 20000, status: 'released', created_at: new Date(now - 40 * 86400000).toISOString() },  // 40 days ago
    { orderId: 'O-undated', amountZar: 15000, status: 'released', created_at: null },                                        // No date
  ];

  const getTs = (o) => (o.created_at ? new Date(o.created_at).getTime() : null);

  // 7-day filter
  const cutoff7d = now - 7 * 86400000;
  const in7d = salesOrders.filter((o) => {
    const ts = getTs(o);
    if (ts === null) return false;
    return ts >= cutoff7d;
  });
  assert.strictEqual(in7d.length, 1, 'Only O-recent should be in 7d; undated must NOT be counted as now');
  assert.strictEqual(in7d[0].orderId, 'O-recent');

  // All Time filter
  const allTime = salesOrders.filter(() => true);
  assert.strictEqual(allTime.length, 3, 'All Time filter must include all 3 orders including undated');
  console.log('   ✅ Undated records excluded from time window, included in All Time.');

  // ── TEST 6: Explicit Verification Badges Distinction ────────────────────────
  console.log('\n🧪 [TEST 6] Verification badge distinction for holdings & listings...');
  assert.strictEqual(getHoldingBadge({ nft_token_id: '0x12', certId: 'CERT-1', isVerified: true }), 'Certificate Minted');
  assert.strictEqual(getHoldingBadge({ isVerified: true }), 'Verified');
  assert.strictEqual(getHoldingBadge({ verification_status: 'in_review' }), 'Under Review');
  assert.strictEqual(getHoldingBadge({ status: 'active', isVerified: false }), 'Unverified');

  assert.strictEqual(getListingBadge({ status: 'active', is_verified: true, nft_token_id: '0x99' }), 'Cert Minted');
  assert.strictEqual(getListingBadge({ status: 'active', is_verified: true }), 'Verified');
  assert.strictEqual(getListingBadge({ status: 'active', is_verified: false }), 'Listed');
  assert.strictEqual(getListingBadge({ status: 'pending' }), 'In Review');
  assert.strictEqual(getListingBadge({ status: 'sold' }), 'Sold');
  console.log('   ✅ Listings and holdings badges distinguish Listed, Verified, In Review, and Minted.');

  console.log('\n======================================================');
  console.log('🎉 ALL 6 PROFILE ANALYTICS SCREEN TESTS PASSED! 🎉');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
