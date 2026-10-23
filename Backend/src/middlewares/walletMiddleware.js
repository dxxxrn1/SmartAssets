// ─── Linked Wallet Verification Middleware ───────────────────────────────────
// Enforces that transactions must use the authenticated user's verified linked wallet.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

/**
 * Middleware that verifies the authenticated user has a linked wallet address
 * and that any transaction `from` or `walletAddress` strictly matches it.
 */
async function requireLinkedWallet(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, 'Unauthorized: Please log in to perform this action.');
    }

    // Retrieve user's linked wallet from database profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_address, full_name')
      .eq('id', userId)
      .maybeSingle();

    const linkedAddress = profile?.wallet_address || req.user?.user_metadata?.wallet_address;

    if (!linkedAddress) {
      return sendError(
        res,
        400,
        'No wallet linked: Please connect and verify your MetaMask wallet in your Profile before performing transactions.',
        'NO_LINKED_WALLET'
      );
    }

    const cleanLinked = linkedAddress.trim().toLowerCase();

    // If client supplied a from or walletAddress in body or query, verify it matches
    const incomingAddress =
      req.body?.from ||
      req.body?.walletAddress ||
      req.body?.buyerWallet ||
      req.body?.sellerWallet ||
      req.query?.walletAddress;

    if (incomingAddress && typeof incomingAddress === 'string') {
      const cleanIncoming = incomingAddress.trim().toLowerCase();
      if (cleanIncoming !== cleanLinked) {
        return sendError(
          res,
          403,
          `Wallet mismatch: Your account is linked to ${linkedAddress.slice(0, 6)}...${linkedAddress.slice(-4)}. Please switch MetaMask to your linked account.`,
          'WALLET_MISMATCH'
        );
      }
    }

    req.userLinkedWallet = cleanLinked;
    next();
  } catch (err) {
    console.error('requireLinkedWallet error:', err);
    return sendError(res, 500, 'Failed to verify linked wallet status.');
  }
}

module.exports = {
  requireLinkedWallet,
};
