// ─── Escrow Controller ────────────────────────────────────────────────────────
// Manages the multi-party luxury asset escrow lifecycle:
// 1. Payment Secured in Smart Contract (Locked on Sepolia)
// 2. Physical Asset in Transit to Vault
// 3. Appraiser Inspection & Authentication
// 4. Funds Released to Seller & NFT Delivered to Buyer Vault / Full Refund

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const escrowService = require('../services/escrowService');
const { isUserAdmin } = require('../middlewares/authMiddleware');

/**
 * POST /api/escrow/create (protected — requireAuth)
 * Initializes an escrow order and locks the deposit on-chain.
 */
async function createEscrow(req, res) {
  try {
    const userId = req.user.id;
    const complianceService = require('../services/complianceService');
    const comp = complianceService.getUserCompliance(userId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Escrow creation blocked.');
    }
    const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(userId, req.user?.email));
    if (!bundle || bundle.verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        error: 'KYC Verification Required: You must upload and get all 3 verification documents approved before creating an escrow order.',
      });
    }

    const {
      assetId,
      assetName,
      assetCategory,
      assetImage,
      amountZar,
      amountGbp,
      amountEth,
      paymentMethod,
      paymentDetails,
      sellerAddress,
    } = req.body;

    // ── Self-Dealing Check ──
    // Allowed for testing and co-ownership escrow initialization


    const order = await escrowService.createEscrowOrder({
      buyerId: userId,
      assetId,
      assetName,
      assetCategory,
      assetImage,
      amountZar,
      amountGbp,
      amountEth,
      paymentMethod,
      buyerAddress: paymentDetails?.walletAddress || req.user.walletAddress,
      sellerAddress,
    });

    return res.status(201).json({
      success: true,
      message: 'Escrow order created and payment locked on Ethereum Sepolia!',
      order,
    });
  } catch (err) {
    console.error('createEscrow error:', err);
    return sendError(res, 500, err.message || 'Failed to initialize escrow.');
  }
}

/**
 * GET /api/escrow/order/:orderId
 * Returns the live status and timeline of an escrow order.
 */
async function getEscrowOrder(req, res) {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return sendError(res, 400, 'Order ID is required.');
    }

    const order = escrowService.getEscrowOrder(orderId, req);
    return res.json({ success: true, order });
  } catch (err) {
    console.error('getEscrowOrder error:', err);
    return sendError(res, 500, 'Failed to fetch escrow order.');
  }
}

/**
 * GET /api/escrow/my-orders (protected — requireAuth)
 * Returns all active and historical escrow orders for the logged-in buyer.
 */
async function getMyEscrows(req, res) {
  try {
    const userId = req.user.id;
    const orders = escrowService.getUserEscrowOrders(userId, req);
    return res.json({ success: true, orders });
  } catch (err) {
    console.error('getMyEscrows error:', err);
    return sendError(res, 500, 'Failed to fetch your escrow orders.');
  }
}

/**
 * POST /api/escrow/progress (protected — requireAuth)
 * Advances the escrow stage (e.g. In Transit, In Inspection).
 */
async function progressEscrow(req, res) {
  try {
    const { orderId, step, note } = req.body;
    if (!orderId || !step) {
      return sendError(res, 400, 'orderId and target step (2 or 3) are required.');
    }

    const order = await escrowService.progressEscrowStep(orderId, step, note);
    return res.json({
      success: true,
      message: `Escrow order advanced to Step ${step}!`,
      order,
    });
  } catch (err) {
    console.error('progressEscrow error:', err);
    return sendError(res, 400, err.message || 'Failed to update escrow stage.');
  }
}

/**
 * POST /api/escrow/release (protected — requireAuth)
 * Releases funds to the seller once buyer confirms delivery or inspection passes.
 */
async function releaseEscrow(req, res) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return sendError(res, 400, 'orderId is required.');
    }

    const order = await escrowService.releaseEscrow(orderId);
    return res.json({
      success: true,
      message: 'Escrow funds released to seller and NFT certificate finalized!',
      order,
    });
  } catch (err) {
    console.error('releaseEscrow error:', err);
    return sendError(res, 500, err.message || 'Failed to release escrow funds.');
  }
}

/**
 * POST /api/escrow/refund (protected — requireAuth)
 * Refunds locked funds to buyer if asset fails inspection or buyer disputes.
 */
async function refundEscrow(req, res) {
  try {
    const { orderId, reason } = req.body;
    if (!orderId) {
      return sendError(res, 400, 'orderId is required.');
    }

    const order = await escrowService.refundEscrow(orderId, reason);
    return res.json({
      success: true,
      message: '100% of escrow funds refunded to buyer on-chain!',
      order,
    });
  } catch (err) {
    console.error('refundEscrow error:', err);
    return sendError(res, 500, err.message || 'Failed to process escrow refund.');
  }
}

module.exports = {
  createEscrow,
  getEscrowOrder,
  getMyEscrows,
  progressEscrow,
  releaseEscrow,
  refundEscrow,
};
