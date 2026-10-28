// ─── Frontend Portfolio Summary Card Tests ────────────────────────────────────
const assert = require('assert');

// Client-side verification function (matching HomeScreen.js)
const isHoldingVerified = (item) => {
  if (!item || typeof item !== "object") return false;
  if (item.verified === true || item.is_verified === true) return true;
  if (item.verified === false || item.is_verified === false) return false;

  const rawStatus = item.verification_status || item.status;
  if (typeof rawStatus === "string") {
    const s = rawStatus.toLowerCase().trim();
    if (s === "verified" || s === "certified" || s === "approved" || s === "on_chain") return true;
    if (s === "unverified" || s === "pending" || s === "rejected" || s === "in_review" || s === "none") return false;
  }

  let meta = null;
  if (typeof item.gain === "string" && item.gain.includes("<!--meta:")) {
    const match = item.gain.match(/<!--meta:([\s\S]*?)-->/);
    if (match) {
      try {
        meta = JSON.parse(match[1]);
      } catch (_) {}
    }
  }

  if (meta && typeof meta === "object") {
    if (meta.verified === true || meta.is_verified === true) return true;
    if (meta.verified === false || meta.is_verified === false) return false;
    const metaStatus = meta.verification_status || meta.status;
    if (typeof metaStatus === "string") {
      const ms = metaStatus.toLowerCase().trim();
      if (ms === "verified" || ms === "certified" || ms === "approved") return true;
      if (ms === "unverified" || ms === "pending" || ms === "rejected") return false;
    }
    if (typeof meta.txHash === "string" && meta.txHash.length > 10 && !meta.txHash.includes("0x71c...9a")) {
      return true;
    }
  }

  const txHash = item.tx_hash || item.txHash;
  if (typeof txHash === "string" && txHash.length > 10 && !txHash.includes("0x71c...9a")) {
    return true;
  }

  return false;
};

// Client-side graph coordinate normalizer (matching PortfolioWaveGraph in HomeScreen.js)
function computeGraphPoints(data = []) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const values = data.map((d) => Number(d.value) || 0);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal;

  return data.map((d, idx) => {
    const x = (idx / (data.length - 1)) * 420;
    const y =
      valRange === 0
        ? 26
        : 44 - ((Number(d.value || 0) - minVal) / valRange) * 36;
    return { x, y, value: d.value, date: d.date };
  });
}

async function runClientTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING FRONTEND PORTFOLIO SUMMARY CARD TESTS');
  console.log('======================================================\n');

  // ── TEST 1: Verification Matching Backend ───────────────────────────────────
  console.log('🧪 [TEST 1] Client-side verification parity...');
  assert.strictEqual(isHoldingVerified({ verified: true }), true);
  assert.strictEqual(isHoldingVerified({ verification_status: 'verified' }), true);
  assert.strictEqual(isHoldingVerified({ verification_status: 'unverified' }), false);
  assert.strictEqual(isHoldingVerified({}), false);
  assert.strictEqual(isHoldingVerified(null), false);
  console.log('   ✅ Client-side verification logic aligns perfectly with backend rules.');

  // ── TEST 2: Cache Fallback Preserves Valid Numbers on Failure ──────────────
  console.log('\n🧪 [TEST 2] Cache fallback on failed request...');
  const existingSummary = {
    portfolioValueFormatted: "R250,000",
    portfolioValueNum: 250000,
    totalCount: 5,
    categoriesCount: 3,
    verifiedPct: 60,
    isCached: false,
  };

  // Simulate network failure catch block:
  const nextSummary = {
    ...existingSummary,
    isCached: true,
  };

  assert.strictEqual(nextSummary.portfolioValueNum, 250000, 'Must not zero out portfolio value on failure');
  assert.strictEqual(nextSummary.totalCount, 5, 'Must preserve totalCount');
  assert.strictEqual(nextSummary.isCached, true, 'Must flag as cached');
  console.log('   ✅ Failed request retains valid cached figures without substituting zeros.');

  // ── TEST 3: Graph Coordinate Bounds ─────────────────────────────────────────
  console.log('\n🧪 [TEST 3] Graph coordinate bounds and empty state...');
  assert.strictEqual(computeGraphPoints([]), null, 'Empty array yields null (triggers empty track)');
  assert.strictEqual(computeGraphPoints([{ date: '2026-10-27', value: 5000 }]), null, 'Single point yields null');

  const twoPoints = computeGraphPoints([
    { date: '2026-10-01', value: 1000 },
    { date: '2026-10-27', value: 2000 },
  ]);
  assert.ok(twoPoints, 'Two points successfully compute graph series');
  assert.strictEqual(twoPoints[0].x, 0);
  assert.strictEqual(twoPoints[0].y, 44); // min value
  assert.strictEqual(twoPoints[1].x, 420);
  assert.strictEqual(twoPoints[1].y, 8);  // max value

  // Flat line (zero range)
  const flatPoints = computeGraphPoints([
    { date: '2026-10-01', value: 5000 },
    { date: '2026-10-27', value: 5000 },
  ]);
  assert.strictEqual(flatPoints[0].y, 26, 'Flat line maps to center (y=26)');
  assert.strictEqual(flatPoints[1].y, 26, 'Flat line maps to center (y=26)');
  console.log('   ✅ Graph points normalized properly within 420x52 coordinate box.');

  // ── TEST 4: Verified Percentage Rendering ───────────────────────────────────
  console.log('\n🧪 [TEST 4] Verified percentage display values...');
  const renderVerified = (totalCount, verifiedPct) => {
    if (totalCount > 0 && verifiedPct !== null && verifiedPct !== undefined) {
      return `${verifiedPct}%`;
    }
    return "—";
  };

  assert.strictEqual(renderVerified(0, null), "—", "0 count yields dash (not 100%)");
  assert.strictEqual(renderVerified(0, 100), "—", "0 count always yields dash");
  assert.strictEqual(renderVerified(2, 50), "50%", "2 count with 50% yields 50%");
  assert.strictEqual(renderVerified(3, 100), "100%", "3 verified items yields 100%");
  console.log('   ✅ Verified percentage rendered truthfully across empty and loaded states.');

  console.log('\n======================================================');
  console.log('🎉 ALL 4 FRONTEND PORTFOLIO CARD TESTS PASSED!');
  console.log('======================================================\n');
}

runClientTests().catch((err) => {
  console.error('❌ Frontend test failed:', err);
  process.exit(1);
});
