// ─── Holding Verification Utility ─────────────────────────────────────────────
// Authoritative rules for determining whether a user holding is verified.
// Shared across backend controllers and test harnesses.

/**
 * Determine authoritatively whether a holding is verified.
 *
 * Rules:
 * 1. Explicit boolean `verified` or `is_verified` (true = verified, false = unverified).
 * 2. Explicit `verification_status` string:
 *    - 'verified', 'certified', 'approved', 'on_chain' -> true
 *    - 'unverified', 'pending', 'rejected', 'in_review', 'none' -> false
 * 3. Parsed metadata in gain column:
 *    - Explicit meta.verified === true -> true
 *    - Explicit meta.verified === false -> false
 *    - meta.verification_status in ['verified', 'certified', 'approved'] -> true
 *    - Authentic on-chain txHash (not placeholder like '0x71c...9a') -> true
 * 4. Top-level tx_hash or txHash that is authentic (not placeholder) -> true.
 * 5. Default is false (unverified).
 *
 * @param {object} holding
 * @returns {boolean}
 */
function isHoldingVerified(holding) {
  if (!holding || typeof holding !== 'object') return false;

  // 1. Explicit boolean property
  if (holding.verified === true || holding.is_verified === true) return true;
  if (holding.verified === false || holding.is_verified === false) return false;

  // 2. Explicit string verification status
  const rawStatus = holding.verification_status || holding.status;
  if (typeof rawStatus === 'string') {
    const s = rawStatus.toLowerCase().trim();
    if (s === 'verified' || s === 'certified' || s === 'approved' || s === 'on_chain') {
      return true;
    }
    if (s === 'unverified' || s === 'pending' || s === 'rejected' || s === 'in_review' || s === 'none') {
      return false;
    }
  }

  // 3. Inspect metadata from gain tag if present
  let meta = null;
  if (typeof holding.gain === 'string' && holding.gain.includes('<!--meta:')) {
    const match = holding.gain.match(/<!--meta:([\s\S]*?)-->/);
    if (match) {
      try {
        meta = JSON.parse(match[1]);
      } catch (_) {}
    }
  }

  if (meta && typeof meta === 'object') {
    if (meta.verified === true || meta.is_verified === true) return true;
    if (meta.verified === false || meta.is_verified === false) return false;

    const metaStatus = meta.verification_status || meta.status;
    if (typeof metaStatus === 'string') {
      const ms = metaStatus.toLowerCase().trim();
      if (ms === 'verified' || ms === 'certified' || ms === 'approved') return true;
      if (ms === 'unverified' || ms === 'pending' || ms === 'rejected') return false;
    }

    if (typeof meta.txHash === 'string' && meta.txHash.length > 10 && !meta.txHash.includes('0x71c...9a')) {
      return true;
    }
  }

  // 4. Authentic on-chain transaction hash
  const txHash = holding.tx_hash || holding.txHash;
  if (typeof txHash === 'string' && txHash.length > 10 && !txHash.includes('0x71c...9a')) {
    return true;
  }

  // 5. Default unverified
  return false;
}

module.exports = {
  isHoldingVerified,
};
