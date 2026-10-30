// ─── Payment Controller ──────────────────────────────────────────────────────
// Multi-rail payment gateway supporting:
// 1. MetaMask Web3 Wallet (Ethereum Sepolia ETH with on-chain tx verification)
// 2. Stripe PaymentIntent (Client-side tokenized card confirmation & backend verification)
// 3. Bank Wire (Strict reconciliation & sandbox labeling)
//
// Authoritative ordering: Verifies settlement into escrow BEFORE inventory changes.
// No raw card processing on backend, no fabricated autoHashes, seller identity persisted.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const web3Service = require('../services/web3Service');
const stripeService = require('../services/stripeService');
const escrowService = require('../services/escrowService');
const investmentPositionService = require('../services/investmentPositionService');
const vaultTransactionService = require('../services/vaultTransactionService');
const notificationService = require('../services/notificationService');
const { ethers } = require('ethers');

// Current ZAR to ETH rate for checkout conversion (1 ETH ≈ R48,000)
const ZAR_PER_ETH = 48000;

// Mutex lock to serialize concurrent checkout attempts on the same asset
const activeCheckoutLocks = new Set();

/**
 * GET /api/payments/rates
 * Returns exchange rates, Escrow wallet info, and Stripe configuration.
 */
async function getRates(req, res) {
  try {
    const relayerStatus = await web3Service.getRelayerStatus();
    const stripeConfig = stripeService.getStripeConfig();

    return res.json({
      success: true,
      zarPerEth: ZAR_PER_ETH,
      gbpPerEth: ZAR_PER_ETH, // Alias for backward compatibility
      currency: 'ZAR',
      currencySymbol: 'R',
      network: 'Ethereum Sepolia',
      chainId: 11155111,
      escrowAddress: relayerStatus.escrowContractAddress,
      escrowContractAddress: relayerStatus.escrowContractAddress,
      relayerAddress: relayerStatus.relayerAddress,
      contractAddress: relayerStatus.contractAddress,
      isRelayerConfigured: relayerStatus.isRelayerConfigured,
      stripe: {
        publishableKey: stripeConfig.publishableKey,
        mode: stripeConfig.mode,
        isConfigured: stripeConfig.isConfigured,
      },
      complianceNotice: 'Production escrow requires authorized South African client-funds custody review (SARB/FIC/FSCA).',
    });
  } catch (err) {
    console.error('getRates error:', err);
    return sendError(res, 500, 'Failed to fetch payment gateway rates.');
  }
}

/**
 * POST /api/payments/create-intent (protected — requireAuth, requireVerified)
 * Creates a Stripe PaymentIntent for a given amount and binds order metadata.
 */
async function createIntent(req, res) {
  try {
    const userId = req.user.id;
    const complianceService = require('../services/complianceService');
    const comp = complianceService.getUserCompliance(userId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Transactions blocked.');
    }
    const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(userId, req.user?.email));
    if (!bundle || bundle.verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        error: 'KYC Verification Required: You must upload and get all 3 verification documents approved before creating a payment intent.',
      });
    }

    if (process.env.NODE_ENV !== 'test') {
      return sendError(res, 503, 'Card checkout is disabled until a custodial escrow and refund provider is connected. No payment was taken.', 'ESCROW_CUSTODY_UNAVAILABLE');
    }

    const { amount, currency, assetId, assetName } = req.body;

    if (!amount || Number(amount) <= 0) {
      return sendError(res, 400, 'A valid positive payment amount is required.');
    }

    const result = await stripeService.createPaymentIntent({
      amount: Number(amount),
      currency: currency || 'zar',
      metadata: {
        userId,
        assetId: assetId || 'direct',
        assetName: assetName || 'SmartAssets Purchase',
      },
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('createIntent error:', err);
    return sendError(res, 500, err.message || 'Failed to create payment intent.');
  }
}

/**
 * POST /api/payments/process (protected — requireAuth, requireVerified)
 * Verifies settlement, creates durable escrow order, and updates holdings idempotently.
 */
async function processPayment(req, res) {
  try {
    const userId = req.user.id;
    const complianceService = require('../services/complianceService');
    const comp = complianceService.getUserCompliance(userId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Transactions blocked.');
    }
    const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(userId, req.user?.email));
    if (!bundle || bundle.verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        error: 'KYC Verification Required: You must complete KYC verification before making financial transactions.',
      });
    }

    const { assetId, paymentMethod, paymentDetails, amountGbp } = req.body;

    if (!paymentMethod) {
      return sendError(res, 400, 'Payment method is required (wallet, card, or bank).');
    }

    // Mutex lock to prevent simultaneous race conditions on the same asset
    if (assetId && activeCheckoutLocks.has(String(assetId))) {
      return sendError(
        res,
        409,
        'Another transaction is currently processing this asset. Please try again in a moment.',
        'CONCURRENT_CHECKOUT'
      );
    }
    if (assetId) {
      activeCheckoutLocks.add(String(assetId));
    }

    let assetLockedInDb = false;

    const unlockAssetIfLocked = async () => {
      if (assetLockedInDb && assetId) {
        try {
          await supabase.from('assets').update({ status: 'active' }).eq('id', assetId);
          assetLockedInDb = false;
        } catch (_) {}
      }
    };

    // 1. Fetch asset being purchased
    let asset = null;
    if (assetId) {
      const { data } = await supabase
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .single();
      asset = data;
    }

    const purchaseType = req.body.purchaseType || 'whole';
    const isFractional = purchaseType === 'fractional';
    let sharesToBuy = 0;
    let actualPriceZar = 0;

    // 2. Resolve Seller Identity and Seller Address
    const sellerId = asset?.seller_id || asset?.user_id || null;

    // Rule: Prevent seller from purchasing their own listing
    if (sellerId && String(sellerId) === String(userId)) {
      return sendError(res, 400, 'Self-dealing Violation: You cannot purchase or invest in your own asset listing.');
    }

    // Rule: Reject purchases on already-sold or in-escrow items
    if (asset && (asset.status === 'sold' || asset.status === 'in_escrow')) {
      return sendError(
        res,
        409,
        `Asset is no longer available (${asset.status === 'in_escrow' ? 'currently in escrow' : 'already sold'}).`,
        'ASSET_UNAVAILABLE'
      );
    }

    // For whole-item purchase, atomically lock status to 'in_escrow' in the database
    if (!isFractional && asset?.id) {
      const { data: lockResult, error: lockErr } = await supabase
        .from('assets')
        .update({ status: 'in_escrow' })
        .eq('id', asset.id)
        .eq('status', 'active')
        .select();

      if (lockErr || !lockResult || lockResult.length === 0) {
        return sendError(
          res,
          409,
          'Asset is no longer available (it was acquired or locked concurrently).',
          'ASSET_UNAVAILABLE'
        );
      }
      assetLockedInDb = true;
    }

    // Fractional Investment Rules
    if (isFractional) {
      if (!asset) {
        await unlockAssetIfLocked();
        return sendError(res, 400, 'Target asset is required for fractional investment.');
      }

      // Rule: Reject fractional investments if allow_investment is disabled
      if (!asset.allow_investment) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          'Investment Rule Violation: Fractional investment is not enabled for this asset listing. You can purchase the whole item outright.'
        );
      }

      sharesToBuy = parseInt(req.body.sharesCount, 10);
      const totalShares = Number(asset.shares || 100);
      const activePositions = await investmentPositionService.getActivePositionsForAsset(asset.id);
      const totalSharesSoldLedger = activePositions.reduce((acc, p) => acc + Number(p.shares_held), 0);
      const sharesSold = Math.max(Number(asset.shares_sold || 0), totalSharesSoldLedger);
      const remainingShares = Math.max(0, totalShares - sharesSold);
      const sharePrice = Number(asset.share_price) || Math.round((Number(asset.price_num) || 1000) / totalShares);

      if (!sharesToBuy || sharesToBuy < 1) {
        await unlockAssetIfLocked();
        return sendError(res, 400, 'Investment Rule Violation: Minimum investment is 1 share.');
      }
      if (remainingShares <= 0) {
        await unlockAssetIfLocked();
        return sendError(res, 400, 'Investment Rule Violation: This offering is 100% funded and closed.');
      }
      if (sharesToBuy > remainingShares) {
        await unlockAssetIfLocked();
        return sendError(res, 400, `Investment Rule Violation: Only ${remainingShares} shares remain available.`);
      }

      const maxAllowedPerInvestor = Math.max(1, Math.floor(totalShares * 0.25));
      const userPositions = activePositions.filter((p) => String(p.investor_id) === String(userId));
      const alreadyOwnedShares = userPositions.reduce((acc, p) => acc + Number(p.shares_held), 0);

      if (alreadyOwnedShares + sharesToBuy > maxAllowedPerInvestor) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          `Anti-Whale Rule Violation: Maximum 25% (${maxAllowedPerInvestor} shares) cap exceeded. You already hold ${alreadyOwnedShares} shares.`
        );
      }

      if (req.body.riskAcknowledged !== true && req.body.riskAcknowledged !== 'true') {
        await unlockAssetIfLocked();
        return sendError(res, 400, 'Investment Rule Violation: Risk Disclosure must be acknowledged.');
      }

      actualPriceZar = sharesToBuy * sharePrice;
    } else {
      actualPriceZar = asset?.price_num || Number(amountGbp) || 0;
    }

    if (actualPriceZar <= 0) {
      await unlockAssetIfLocked();
      return sendError(res, 400, 'Invalid transaction amount.');
    }

    let sellerAddress = asset?.seller_address || asset?.user_wallet || null;

    if (!sellerAddress && sellerId) {
      const { data: sellerProfile } = await supabase
        .from('profiles')
        .select('wallet_address')
        .eq('id', sellerId)
        .maybeSingle();
      if (sellerProfile?.wallet_address) {
        sellerAddress = sellerProfile.wallet_address;
      }
    }

    // Default fallback address for testnet platform custodian if seller has no linked wallet
    if (!sellerAddress || !ethers.isAddress(sellerAddress)) {
      sellerAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    }

    const assetName = asset?.name || req.body.assetName || 'SmartAssets Collectible';
    const assetCategory = asset?.category || req.body.assetCategory || 'Luxury Collectible';
    const assetImage = asset?.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800';

    let verifiedTxHash = null;
    let etherscanUrl = null;
    let verifiedPaymentIntentId = null;
    let stripeReceipt = null;
    let paymentRailName = 'Escrow Custody';
    let isSettled = false;
    let initialEscrowStatus = 'pending_payment';

    // ── 3. Authoritative Payment Rail Settlement Verification ──
    if (paymentMethod === 'wallet') {
      // ── Web3 Wallet Rail ──
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('wallet_address')
        .eq('id', userId)
        .maybeSingle();

      const linkedWallet = userProfile?.wallet_address ? userProfile.wallet_address.toLowerCase() : null;
      if (!linkedWallet) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          'No linked wallet found. Please link your MetaMask wallet in your profile before checking out with Web3.',
          'WALLET_NOT_LINKED'
        );
      }

      const txHash = paymentDetails?.txHash?.trim();
      if (!txHash) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          'A confirmed on-chain transaction hash (txHash) is required for Web3 checkout.',
          'TX_HASH_REQUIRED'
        );
      }

      const relayerStatus = await web3Service.getRelayerStatus();
      const expectedEscrowContract = relayerStatus.escrowContractAddress;
      const expectedEth = (actualPriceZar / ZAR_PER_ETH).toFixed(4);
      const expectedWei = ethers.parseEther(expectedEth);

      // Authoritative on-chain check
      const verification = await web3Service.verifyPaymentTxOnChain(txHash, {
        expectedSender: linkedWallet,
        expectedRecipient: expectedEscrowContract,
        expectedValueWei: expectedWei.toString(),
      });

      if (!verification.verified) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          `Web3 Payment Verification Failed: ${verification.reason || 'Transaction could not be confirmed on Sepolia.'}`,
          verification.status
        );
      }

      verifiedTxHash = verification.txHash;
      etherscanUrl = verification.etherscanUrl;
      paymentRailName = 'Ethereum Sepolia Web3';
      isSettled = true;
      initialEscrowStatus = 'payment_secured';

    } else if (paymentMethod === 'card') {
      if (process.env.NODE_ENV !== 'test') {
        await unlockAssetIfLocked();
        return sendError(res, 503, 'Card checkout is disabled until a custodial escrow and refund provider is connected.', 'ESCROW_CUSTODY_UNAVAILABLE');
      }
      // ── Stripe Card Rail ──
      // Security rule: NEVER accept raw card numbers on the backend
      if (paymentDetails?.cardNumber) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          'Direct submission of raw card data to the API is disallowed for PCI compliance. Confirm payment via Stripe client SDK and submit paymentIntentId.',
          'RAW_CARD_DISALLOWED'
        );
      }

      const paymentIntentId = (paymentDetails?.paymentIntentId || paymentDetails?.stripePaymentIntentId || '').trim();
      if (!paymentIntentId) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          'A confirmed Stripe PaymentIntent ID is required for card payment.',
          'PAYMENT_INTENT_REQUIRED'
        );
      }
      if (process.env.NODE_ENV === 'test' && !paymentIntentId.startsWith('pi_sandbox_')) {
        await unlockAssetIfLocked();
        return sendError(res, 400, 'Test mode accepts only local sandbox PaymentIntents.', 'TEST_INTENT_REQUIRED');
      }

      // Verify that the PaymentIntent has succeeded and matches amount & user
      const intentCheck = await stripeService.verifyPaymentIntent(paymentIntentId, {
        amount: actualPriceZar,
        currency: 'zar',
        userId,
        assetId: asset?.id || assetId,
      });

      if (!intentCheck.verified) {
        await unlockAssetIfLocked();
        return sendError(
          res,
          400,
          `Card Settlement Verification Failed: ${intentCheck.reason || 'Payment has not settled.'}`,
          intentCheck.status
        );
      }

      verifiedPaymentIntentId = intentCheck.paymentIntentId;
      stripeReceipt = intentCheck;
      paymentRailName = `Stripe ${intentCheck.cardBrand || 'Card'} (${intentCheck.mode || 'sandbox'})`;
      isSettled = true;
      initialEscrowStatus = 'payment_secured';

    } else if (paymentMethod === 'bank') {
      // ── Bank Transfer Rail ──
      const bankRef = (paymentDetails?.reference || '').trim();
      if (!bankRef) {
        await unlockAssetIfLocked();
        return sendError(res, 400, 'A valid bank payment reference is required.', 'BANK_REF_REQUIRED');
      }

      // Bank wire reference submitted by client — settlement is NOT verified yet.
      // Funds are NOT in SmartAssets verified custody until manual/automated treasury verification.
      // Order is created as pending_payment; seller is NOT notified that funds are secured.
      isSettled = false;
      initialEscrowStatus = 'pending_payment';
      paymentRailName = 'Bank Wire (Awaiting Settlement Verification)';
      verifiedPaymentIntentId = `bank_${bankRef}`;
    } else {
      await unlockAssetIfLocked();
      return sendError(res, 400, `Unsupported payment method: ${paymentMethod}`);
    }

    // ── 4. Create Durable Escrow Order in Supabase ──
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const ethVal = (actualPriceZar / ZAR_PER_ETH).toFixed(4);

    let escrowOrder = null;
    try {
      escrowOrder = await escrowService.createEscrowOrder({
        orderId,
        buyerId: userId,
        sellerId,
        buyerAddress: paymentDetails?.walletAddress || req.user.walletAddress || null,
        sellerAddress,
        assetId: asset?.id || null,
        assetName,
        assetCategory,
        assetImage,
        amountZar: actualPriceZar,
        amountGbp: actualPriceZar,
        amountEth: ethVal,
        paymentMethod,
        paymentRail: paymentRailName,
        customTxHash: verifiedTxHash,
        status: initialEscrowStatus,
        isSettled,
      });
    } catch (escrowErr) {
      console.error('❌ [Payment] Escrow order creation failed:', escrowErr.message);
      await unlockAssetIfLocked();
      return sendError(res, 500, `Escrow order creation failed: ${escrowErr.message}. Funds held safely.`);
    }

    // ── 5. ONLY AFTER ESCROW IS FUNDED: Update Inventory & Holdings ──
    const holdingName = isFractional ? `${assetName} (${sharesToBuy} Shares)` : assetName;
    const holdingType = isFractional ? 'fractional' : 'whole';
    const transactionId = verifiedTxHash || verifiedPaymentIntentId || orderId;

    try {
      if (isFractional && asset?.id) {
        if (!isSettled) {
          // 5A-1. Pending Settlement Path (e.g. Bank Wire Awaiting Treasury Verification)
          // CRITICAL REQUIREMENT: A pending payment must NOT allocate shares, create an active position,
          // reduce available shares, or notify the seller that shares were sold.
          const pendingMilestone = `Fractional Order Recorded: Submitted payment reference via ${paymentRailName}. Order ${orderId}. Allocation pending settlement verification.`;
          await supabase.from('asset_history').insert({
            asset_id: asset.id,
            year: String(new Date().getFullYear()),
            event: pendingMilestone,
            party: `Buyer (${req.user.fullName || req.user.email})`,
            hash: transactionId,
            tx_hash: verifiedTxHash || transactionId,
            verified: false,
          });

          await notificationService.sendNotification({
            userId,
            type: 'fractional_pending_settlement',
            title: 'Order Placed — Pending Settlement',
            message: `Your payment reference for ${sharesToBuy} shares in "${assetName}" has been recorded. Once your payment clears and is verified by SmartAssets treasury, shares will be secured in your Vault.`,
            orderId,
            assetId: asset.id,
          });
        } else {
          // 5A-2. Settled Investment Path: Independent payment verification confirmed!
          await investmentPositionService.recordInvestmentPosition({
            assetId: asset.id,
            investorId: userId,
            sharesCount: sharesToBuy,
            costBasisZar: actualPriceZar,
            costBasisEth: ethVal,
            orderId,
            txHash: verifiedTxHash || null,
            paymentRail: paymentRailName,
            idempotencyKey: req.body.idempotencyKey || `order_${orderId}`,
            isSettled: true,
          });

          // Insert fractional holding into buyer's vault
          await supabase.from('user_holdings').insert({
            user_id: userId,
            name: holdingName,
            category: assetCategory,
            price: `R${actualPriceZar.toLocaleString('en-ZA')}`,
            price_num: actualPriceZar,
            image: assetImage,
            asset_type: 'fractional',
            gain: '+0.0%',
            gain_pct: '0%',
            positive: true,
          });

          const newSharesSold = (asset.shares_sold || 0) + sharesToBuy;
          const updateData = { shares_sold: newSharesSold };
          if (newSharesSold >= (asset.shares || 100)) {
            updateData.status = 'funded';
          }
          await supabase.from('assets').update(updateData).eq('id', asset.id);

          const milestoneEvent = `Fractional Investment: Acquired ${sharesToBuy} Shares (${((sharesToBuy / (asset.shares || 100)) * 100).toFixed(1)}% Co-Ownership)`;
          await supabase.from('asset_history').insert({
            asset_id: asset.id,
            year: String(new Date().getFullYear()),
            event: milestoneEvent,
            party: `Verified Buyer (${req.user.fullName || req.user.email})`,
            hash: transactionId,
            tx_hash: verifiedTxHash || transactionId,
            verified: true,
          });

          if (asset.token_id) {
            web3Service.recordMilestoneOnChain(asset.token_id, {
              year: new Date().getFullYear(),
              event: milestoneEvent,
              party: `Buyer (${userId.substring(0, 8)})`,
              hash: transactionId,
            });
          }

          // Notify investor & seller ONLY AFTER SETTLEMENT
          await notificationService.sendNotification({
            userId,
            type: 'shares_purchased',
            title: 'Investment Confirmed',
            message: `You successfully acquired ${sharesToBuy} shares in "${assetName}". Registered to your Vault.`,
            orderId,
            assetId: asset.id,
          });

          if (sellerId) {
            await notificationService.sendNotification({
              userId: sellerId,
              type: 'shares_sold',
              title: 'Shares Sold on Marketplace',
              message: `${sharesToBuy} shares of "${assetName}" were purchased by an investor.`,
              orderId,
              assetId: asset.id,
            });
          }
        }
      } else if (!isFractional && asset?.id) {
        // 5B. Whole-Item Outright Purchase Path (Aligned with Escrow Lifecycle)
        // In accordance with SmartAssets verified escrow rules:
        // - Funds are secured in escrow (or pending bank settlement verification).
        // - Asset remains locked in 'in_escrow' status.
        // - Neither seller nor fractional investors receive payouts at checkout.
        // - Investor positions remain intact until the buyer accepts the item and admin authorizes release.
        // - Buyout pro-rata allocations and position retirements execute in escrowService.releaseEscrow upon settlement.

        const wholeMilestone = asset.allow_investment
          ? `Buyout Escrow Initiated: Outright purchase via ${paymentRailName}. Status: ${isSettled ? 'Funds Secured in Escrow' : 'Awaiting Settlement'}. Order ${orderId}. Pro-rata investor payouts pending authorized release.`
          : `Escrow Initiated: Buyer initiated purchase via ${paymentRailName}. Status: ${isSettled ? 'Funds Secured in Escrow' : 'Awaiting Settlement'}. Order ${orderId}.`;

        await supabase.from('asset_history').insert({
          asset_id: asset.id,
          year: String(new Date().getFullYear()),
          event: wholeMilestone,
          party: `Escrow Custody (${paymentRailName})`,
          hash: transactionId,
          tx_hash: verifiedTxHash || transactionId,
          verified: isSettled,
        });

        if (asset.token_id && isSettled) {
          web3Service.recordMilestoneOnChain(asset.token_id, {
            year: new Date().getFullYear(),
            event: wholeMilestone,
            party: `Escrow (${orderId})`,
            hash: transactionId,
          });
        }

        // Notify buyer of escrow order creation
        await notificationService.sendNotification({
          userId,
          type: 'escrow_created',
          title: isSettled ? 'Payment Secured in Escrow' : 'Order Placed — Pending Settlement',
          message: isSettled
            ? `Your payment for "${assetName}" is secured in SmartAssets Escrow. Seller will ship the item. Inspect and accept upon arrival to release funds and claim ownership.`
            : `Your order for "${assetName}" has been recorded. Once your bank settlement is verified by SmartAssets, funds will be locked in escrow and the seller will ship your item.`,
          orderId,
          assetId: asset.id,
        });

        // If listing is fractionalized, notify active investors that buyout is secured in escrow
        if (asset.allow_investment) {
          const activePositions = await investmentPositionService.getActivePositionsForAsset(asset.id);
          const investorIds = [...new Set(activePositions.map((p) => p.investor_id))];
          for (const invId of investorIds) {
            await notificationService.sendNotification({
              userId: invId,
              type: 'buyout_in_escrow',
              title: 'Buyout Secured in Escrow',
              message: `An outright buyout for "${assetName}" was initiated and funds are secured in escrow (Order ${orderId}). Your pro-rata payout will be distributed upon delivery acceptance and release.`,
              orderId,
              assetId: asset.id,
            });
          }
        }
      }

      // 5D. Record Purchase Transaction in Buyer's Vault Ledger
      try {
        await vaultTransactionService.recordTransaction({
          id: `TXN-PUR-${orderId}`,
          userId,
          type: 'purchase',
          amount: actualPriceZar,
          amountFormatted: `-${vaultTransactionService.formatZar(actualPriceZar)}`,
          method: paymentRailName,
          reference: orderId,
          notes: isFractional
            ? `Purchased ${sharesToBuy} fractional shares in "${assetName}"`
            : `Payment placed in escrow for "${assetName}" (Order ${orderId})`,
          status: isSettled ? 'in_escrow' : 'pending_settlement',
          createdAt: new Date().toISOString(),
        });
      } catch (txErr) {
        console.warn('⚠️ [Payment] Buyer purchase transaction log warning:', txErr.message);
      }
    } catch (mutationErr) {
      console.warn('⚠️ [Payment] Holding/Inventory update warning:', mutationErr.message);
    }

    return res.status(200).json({
      success: true,
      message: isFractional
        ? isSettled
          ? 'Investment verified and shares added to your vault!'
          : 'Bank reference submitted. Awaiting settlement verification by SmartAssets treasury before shares are allocated.'
        : isSettled
        ? 'Payment verified and secured in escrow! The seller has been notified to ship.'
        : 'Bank reference submitted. Awaiting settlement verification by SmartAssets treasury.',
      receipt: {
        orderId,
        paymentMethod,
        paymentRail: paymentRailName,
        stripePaymentIntentId: verifiedPaymentIntentId,
        stripeStatus: stripeReceipt?.status,
        cardBrand: stripeReceipt?.cardBrand,
        cardLast4: stripeReceipt?.cardLast4,
        amountZar: actualPriceZar,
        amountEth: ethVal,
        assetName: holdingName,
        purchaseType: holdingType,
        sharesCount: isFractional ? sharesToBuy : undefined,
        txHash: verifiedTxHash || escrowOrder.depositTxHash,
        etherscanUrl: etherscanUrl || escrowOrder.etherscanUrl,
        escrowContractAddress: escrowOrder.escrowContractAddress,
        escrowStatus: escrowOrder.status,
        currentStep: escrowOrder.currentStep,
        isSettled,
        sellerId,
        sellerAddress,
        timestamp: new Date().toISOString(),
      },
      escrowOrder,
    });
  } catch (err) {
    console.error('processPayment error:', err);
    return sendError(res, 500, err.message || 'Internal server error processing payment.');
  } finally {
    if (req.body?.assetId) {
      activeCheckoutLocks.delete(String(req.body.assetId));
    }
  }
}

/**
 * GET /api/payments/investments/share-redemption-quote
 * Returns transparent share pricing, 2.5% platform fee, and net estimated proceeds.
 */
async function getShareRedemptionQuote(req, res) {
  try {
    const investorId = req.user.id;
    const { positionId, sharesCount } = req.query;

    if (!positionId) {
      return sendError(res, 400, 'Position ID is required.');
    }

    const quote = await investmentPositionService.getShareRedemptionQuote({
      positionId,
      investorId,
      sharesCount: sharesCount || 1,
    });

    return res.json({
      success: true,
      quote,
    });
  } catch (err) {
    console.error('getShareRedemptionQuote error:', err);
    return sendError(res, 400, err.message || 'Failed to compute redemption quote.');
  }
}

/**
 * POST /api/payments/investments/sell-shares (protected — requireAuth, requireVerified)
 * Atomically reserves shares from the caller's active position and records a redemption request.
 */
async function requestShareRedemption(req, res) {
  try {
    const investorId = req.user.id;
    const complianceService = require('../services/complianceService');
    const comp = complianceService.getUserCompliance(investorId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Transactions blocked.');
    }
    const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(investorId, req.user?.email));
    if (!bundle || bundle.verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        error: 'KYC Verification Required: You must complete KYC verification before redeeming shares.',
      });
    }

    const { positionId, sharesCount, destinationMethod, destinationDetails, idempotencyKey } = req.body;

    if (!positionId) {
      return sendError(res, 400, 'Position ID is required.');
    }
    if (!sharesCount || Number(sharesCount) <= 0) {
      return sendError(res, 400, 'Valid shares count (minimum 1) is required.');
    }

    const request = await investmentPositionService.requestShareRedemption({
      positionId,
      investorId,
      sharesCount: Number(sharesCount),
      destinationMethod: destinationMethod || 'vault_cash',
      destinationDetails: destinationDetails || {},
      idempotencyKey: idempotencyKey || req.headers['idempotency-key'] || null,
    });

    return res.status(201).json({
      success: true,
      message: 'Share redemption request submitted. Shares reserved and pending custodial settlement review.',
      request,
    });
  } catch (err) {
    console.error('requestShareRedemption error:', err);
    return sendError(res, 400, err.message || 'Failed to submit share redemption request.');
  }
}

/**
 * POST /api/payments/investments/cancel-sell-request/:id (protected — requireAuth)
 * Cancels a pending redemption request and un-reserves the shares.
 * Rejected if settlement is already in progress.
 */
async function cancelShareRedemption(req, res) {
  try {
    const investorId = req.user.id;
    const requestId = req.params.id;

    if (!requestId) {
      return sendError(res, 400, 'Redemption request ID is required.');
    }

    const result = await investmentPositionService.cancelShareRedemption({
      requestId,
      investorId,
    });

    return res.json({
      success: true,
      message: 'Redemption request cancelled and shares unreserved.',
      ...result,
    });
  } catch (err) {
    console.error('cancelShareRedemption error:', err);
    return sendError(res, 400, err.message || 'Failed to cancel share redemption request.');
  }
}

/**
 * GET /api/payments/investments/my-redemptions (protected — requireAuth)
 * Returns all redemption/sale requests for the authenticated investor.
 */
async function getUserRedemptions(req, res) {
  try {
    const investorId = req.user.id;
    const requests = await investmentPositionService.getUserRedemptionRequests(investorId);

    return res.json({
      success: true,
      requests,
    });
  } catch (err) {
    console.error('getUserRedemptions error:', err);
    return sendError(res, 500, 'Failed to fetch redemption requests.');
  }
}

/**
 * POST /api/payments/investments/settle-sell-request/:id (admin / custody privileged)
 */
async function settleShareRedemption(req, res) {
  try {
    const requestId = req.params.id;
    const { settlementRef, settlementNotes } = req.body;

    const result = await investmentPositionService.settleShareRedemption({
      requestId,
      settlementRef,
      settlementNotes,
    });

    return res.json({
      success: true,
      message: 'Share redemption settled and proceeds distributed.',
      ...result,
    });
  } catch (err) {
    console.error('settleShareRedemption error:', err);
    return sendError(res, 400, err.message || 'Failed to settle share redemption.');
  }
}

module.exports = {
  getRates,
  createIntent,
  processPayment,
  getShareRedemptionQuote,
  requestShareRedemption,
  cancelShareRedemption,
  getUserRedemptions,
  settleShareRedemption,
};

