// ─── Escrow Controller ────────────────────────────────────────────────────────
// Manages the multi-party luxury asset escrow lifecycle:
// 1. Payment Secured in Smart Contract (Locked on Sepolia)
// 2. Physical Asset in Transit to Vault (Seller/Armored courier dispatch)
// 3. Appraiser Inspection & Authentication (Horologist / Gemologist verification)
// 4. Physical Delivery & Buyer Acceptance
// 5. Funds Released to Seller & Ownership Finalized / Full Refund / Dispute
//
// Strict authorization: Binds authenticated user role to buyer, seller, or administrator.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const escrowService = require('../services/escrowService');
const { isUserAdmin } = require('../middlewares/authMiddleware');

/**
 * POST /api/escrow/create (protected — requireAuth, requireVerified)
 * Initializes an escrow order and locks the deposit.
 */
async function createEscrow(req, res) {
  const userId = req.user?.id;
  const complianceService = require('../services/complianceService');
  const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(userId, req.user?.email));
  if (!bundle || bundle.verification_status !== 'verified') {
    return res.status(403).json({
      success: false,
      code: 'KYC_REQUIRED',
      error: 'KYC Verification Required: You must upload and get all 3 verification documents approved before creating an escrow order.',
    });
  }
  return sendError(res, 410, 'Direct escrow creation is disabled. Orders must be created through the payment verification flow.', 'VERIFIED_PAYMENT_REQUIRED');
}

/**
 * GET /api/escrow/order/:orderId (protected — requireAuth)
 * Returns the live status and timeline of an escrow order.
 * Enforces role privacy: Only buyer, seller, or platform administrators can view order.
 */
async function getEscrowOrder(req, res) {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return sendError(res, 400, 'Order ID is required.');
    }

    const requestingUserId = req.user?.id;
    const isAdmin = await isUserAdmin(req.user);

    const order = await escrowService.getEscrowOrder(orderId, req, requestingUserId, isAdmin);
    if (!order) {
      return sendError(res, 404, 'Escrow order not found.');
    }

    return res.json({ success: true, order });
  } catch (err) {
    if (err.message && err.message.startsWith('UNAUTHORIZED_ORDER_ACCESS')) {
      return sendError(res, 403, 'Access Denied: You are not authorized to view this escrow order.');
    }
    console.error('getEscrowOrder error:', err);
    return sendError(res, 500, 'Failed to fetch escrow order.');
  }
}

/**
 * GET /api/escrow/my-orders (protected — requireAuth)
 * Returns all escrow orders for the logged-in buyer.
 */
async function getMyEscrows(req, res) {
  try {
    const userId = req.user.id;
    const orders = await escrowService.getUserEscrowOrders(userId, req);
    return res.json({ success: true, orders });
  } catch (err) {
    console.error('getMyEscrows error:', err);
    return sendError(res, 500, 'Failed to fetch your escrow orders.');
  }
}

/**
 * GET /api/escrow/seller-orders (protected — requireAuth)
 * Returns all escrow orders where logged-in user is seller.
 */
async function getSellerEscrows(req, res) {
  try {
    const userId = req.user.id;
    const orders = await escrowService.getSellerEscrowOrders(userId, req);
    return res.json({ success: true, orders });
  } catch (err) {
    console.error('getSellerEscrows error:', err);
    return sendError(res, 500, 'Failed to fetch seller escrow orders.');
  }
}

/**
 * POST /api/escrow/progress (protected — requireAuth)
 * Advances the escrow stage (e.g. In Transit, In Inspection, Delivered, Accepted).
 * Strictly enforces requester ownership, role, and valid sequential transitions.
 */
async function progressEscrow(req, res) {
  try {
    const { orderId, step, note, carrier, trackingNumber } = req.body;
    if (!orderId || !step) {
      return sendError(res, 400, 'orderId and target step are required.');
    }

    const requester = {
      userId: req.user.id,
      role: req.user.role === 'admin' || await isUserAdmin(req.user) ? 'admin' : 'user',
    };

    const order = await escrowService.progressEscrowStep(
      orderId,
      step,
      { note, carrier, trackingNumber },
      requester
    );

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

async function postSellerUpdate(req, res) {
  try {
    const { orderId, update, carrier, trackingNumber } = req.body;
    if (!orderId) return sendError(res, 400, 'orderId is required.');
    const order = await escrowService.addSellerEscrowUpdate(orderId, { update, carrier, trackingNumber }, { userId: req.user.id, role: req.user.role });
    return res.json({ success: true, message: 'Order update saved and shared with the buyer.', order });
  } catch (err) {
    console.error('postSellerUpdate error:', err);
    return sendError(res, 400, err.message || 'Failed to post seller update.');
  }
}

/**
 * POST /api/escrow/release (protected — requireAuth, requireVerified)
 * Releases funds to the seller once buyer confirms delivery and inspection passes.
 * Strictly binds authenticated user to buyer or admin.
 */
async function releaseEscrow(req, res) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return sendError(res, 400, 'orderId is required.');
    }

    const requester = {
      userId: req.user.id,
      role: req.user.role === 'admin' || await isUserAdmin(req.user) ? 'admin' : 'user',
    };

    const order = await escrowService.releaseEscrow(orderId, requester);
    return res.json({
      success: true,
      message: 'Escrow funds successfully released to seller!',
      order,
    });
  } catch (err) {
    console.error('releaseEscrow error:', err);
    return sendError(res, 400, err.message || 'Failed to release escrow funds.');
  }
}

/**
 * POST /api/escrow/refund (protected — requireAuth, requireVerified)
 * Refunds locked funds to buyer if asset fails inspection or delivery canceled.
 * Authorized by seller or platform administrator.
 */
async function refundEscrow(req, res) {
  try {
    const { orderId, reason } = req.body;
    if (!orderId) {
      return sendError(res, 400, 'orderId is required.');
    }

    const requester = {
      userId: req.user.id,
      role: req.user.role === 'admin' || await isUserAdmin(req.user) ? 'admin' : 'user',
    };

    const order = await escrowService.refundEscrow(orderId, reason, requester);
    return res.json({
      success: true,
      message: '100% of escrow funds refunded to buyer!',
      order,
    });
  } catch (err) {
    console.error('refundEscrow error:', err);
    return sendError(res, 400, err.message || 'Failed to process escrow refund.');
  }
}

/**
 * POST /api/escrow/dispute (protected — requireAuth)
 * Opens an auditable dispute freezing release until arbitrated.
 */
async function disputeEscrow(req, res) {
  try {
    const { orderId, reason, evidence } = req.body;
    if (!orderId || !reason) {
      return sendError(res, 400, 'orderId and dispute reason are required.');
    }

    const requester = {
      userId: req.user.id,
      role: req.user.role === 'admin' || await isUserAdmin(req.user) ? 'admin' : 'user',
    };

    const order = await escrowService.disputeEscrow(orderId, {
      reason,
      evidence,
      requester,
    });

    return res.json({
      success: true,
      message: 'Dispute opened. Escrow release frozen pending platform review.',
      order,
    });
  } catch (err) {
    console.error('disputeEscrow error:', err);
    return sendError(res, 400, err.message || 'Failed to open dispute.');
  }
}

module.exports = {
  createEscrow,
  getEscrowOrder,
  getMyEscrows,
  getSellerEscrows,
  progressEscrow,
  postSellerUpdate,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
};
