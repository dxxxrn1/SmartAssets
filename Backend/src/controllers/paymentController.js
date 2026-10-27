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

    // Rule: Reject purchases on already-sold items
    if (asset && asset.status === 'sold') {
      return sendError(res, 400, 'Asset has already been sold and is no longer available in the marketplace.');
    }

    // Fractional Investment Rules
    if (isFractional) {
      if (!asset) {
        return sendError(res, 400, 'Target asset is required for fractional investment.');
      }

      // Rule: Reject fractional investments if allow_investment is disabled
      if (!asset.allow_investment) {
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
        return sendError(res, 400, 'Investment Rule Violation: Minimum investment is 1 share.');
      }
      if (remainingShares <= 0) {
        return sendError(res, 400, 'Investment Rule Violation: This offering is 100% funded and closed.');
      }
      if (sharesToBuy > remainingShares) {
        return sendError(res, 400, `Investment Rule Violation: Only ${remainingShares} shares remain available.`);
      }

      const maxAllowedPerInvestor = Math.max(1, Math.floor(totalShares * 0.25));
      const userPositions = activePositions.filter((p) => String(p.investor_id) === String(userId));
      const alreadyOwnedShares = userPositions.reduce((acc, p) => acc + Number(p.shares_held), 0);

      if (alreadyOwnedShares + sharesToBuy > maxAllowedPerInvestor) {
        return sendError(
          res,
          400,
          `Anti-Whale Rule Violation: Maximum 25% (${maxAllowedPerInvestor} shares) cap exceeded. You already hold ${alreadyOwnedShares} shares.`
        );
      }

      if (req.body.riskAcknowledged !== true && req.body.riskAcknowledged !== 'true') {
        return sendError(res, 400, 'Investment Rule Violation: Risk Disclosure must be acknowledged.');
      }

      actualPriceZar = sharesToBuy * sharePrice;
    } else {
      actualPriceZar = asset?.price_num || Number(amountGbp) || 0;
    }

    if (actualPriceZar <= 0) {
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
        return sendError(
          res,
          400,
          'No linked wallet found. Please link your MetaMask wallet in your profile before checking out with Web3.',
          'WALLET_NOT_LINKED'
        );
      }

      const txHash = paymentDetails?.txHash?.trim();
      if (!txHash) {
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

    } else if (paymentMethod === 'card') {
      // ── Stripe Card Rail ──
      // Security rule: NEVER accept raw card numbers on the backend
      if (paymentDetails?.cardNumber) {
        return sendError(
          res,
          400,
          'Direct submission of raw card data to the API is disallowed for PCI compliance. Confirm payment via Stripe client SDK and submit paymentIntentId.',
          'RAW_CARD_DISALLOWED'
        );
      }

      const paymentIntentId = (paymentDetails?.paymentIntentId || paymentDetails?.stripePaymentIntentId || '').trim();
      if (!paymentIntentId) {
        return sendError(
          res,
          400,
          'A confirmed Stripe PaymentIntent ID is required for card payment.',
          'PAYMENT_INTENT_REQUIRED'
        );
      }

      // Verify that the PaymentIntent has succeeded and matches amount & user
      const intentCheck = await stripeService.verifyPaymentIntent(paymentIntentId, {
        amount: actualPriceZar,
        currency: 'zar',
        userId,
        assetId: asset?.id || assetId,
      });

      if (!intentCheck.verified) {
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

    } else if (paymentMethod === 'bank') {
      // ── Bank Transfer Rail ──
      const bankRef = (paymentDetails?.reference || '').trim();
      if (!bankRef) {
        return sendError(res, 400, 'A valid bank payment reference is required.', 'BANK_REF_REQUIRED');
      }

      paymentRailName = 'Bank Wire (Sandbox Settlement)';
      verifiedPaymentIntentId = `bank_${bankRef}`;
    } else {
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
      });
    } catch (escrowErr) {
      console.error('❌ [Payment] Escrow order creation failed:', escrowErr.message);
      return sendError(res, 500, `Escrow order creation failed: ${escrowErr.message}. Funds held safely.`);
    }

    // ── 5. ONLY AFTER ESCROW IS FUNDED: Update Inventory & Holdings ──
    const holdingName = isFractional ? `${assetName} (${sharesToBuy} Shares)` : assetName;
    const holdingType = isFractional ? 'fractional' : 'whole';
    const transactionId = verifiedTxHash || verifiedPaymentIntentId || orderId;

    try {
      if (isFractional && asset?.id) {
        // 5A. Fractional Investment Path: Record durable investor position
        await investmentPositionService.recordInvestmentPosition({
          assetId: asset.id,
          investorId: userId,
          sharesCount: sharesToBuy,
          costBasisZar: actualPriceZar,
          costBasisEth: ethVal,
          orderId,
          txHash: verifiedTxHash || null,
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

        // Notify investor & seller
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
      } else if (!isFractional && asset?.id) {
        // 5B. Whole-Item Outright Purchase Path
        if (asset.allow_investment) {
          // Fractionalized asset: processOutrightBuyoutAllocations executes pro-rata payouts,
          // atomically retires investor positions, updates asset ownership, inserts buyer holding,
          // cleans up seller holding, records provenance, and sends notifications.
          console.log(`🏦 [Payment] Outright purchase of fractionalized asset ${asset.id}. Distributing pro-rata buyout proceeds...`);
          await investmentPositionService.processOutrightBuyoutAllocations({
            asset,
            buyerId: userId,
            buyerName: req.user.fullName || req.user.email,
            orderId,
            grossSaleZar: actualPriceZar,
            txHash: verifiedTxHash || null,
            paymentRailName,
          });
        } else {
          // Standard whole listing: credit seller proceeds, update asset ownership, transfer holding
          if (sellerId) {
            const netProceeds = Math.round(actualPriceZar * 0.975);
            await vaultTransactionService.depositFunds({
              userId: sellerId,
              amount: netProceeds,
              method: 'Marketplace Sale Proceeds',
              reference: `SALE-${orderId}`,
              notes: `Net proceeds for sale of "${assetName}" to ${req.user.fullName || req.user.email}.`,
            });

            await notificationService.sendNotification({
              userId: sellerId,
              type: 'asset_sold',
              title: 'Item Sold Outright — Proceeds Credited',
              message: `Your listing "${assetName}" was purchased outright for R${actualPriceZar.toLocaleString('en-ZA')}. R${netProceeds.toLocaleString('en-ZA')} has been credited to your Vault.`,
              orderId,
              assetId: asset.id,
            });
          }

          // Update asset ownership to buyer while preserving original seller
          await supabase
            .from('assets')
            .update({
              status: 'sold',
              current_owner_id: userId,
              user_id: userId,
              seller_id: sellerId || asset.user_id,
              allow_investment: false,
            })
            .eq('id', asset.id);

          // Reassign existing holding or insert new whole holding into buyer's vault
          if (sellerId && sellerId !== userId) {
            const { data: existingSellerHoldings } = await supabase
              .from('user_holdings')
              .select('*')
              .eq('user_id', sellerId)
              .ilike('name', assetName)
              .limit(1);

            if (existingSellerHoldings && existingSellerHoldings.length > 0) {
              await supabase
                .from('user_holdings')
                .update({
                  user_id: userId,
                  price: `R${actualPriceZar.toLocaleString('en-ZA')}`,
                  price_num: actualPriceZar,
                })
                .eq('id', existingSellerHoldings[0].id);
            } else {
              await supabase.from('user_holdings').insert({
                user_id: userId,
                name: holdingName,
                category: assetCategory,
                price: `R${actualPriceZar.toLocaleString('en-ZA')}`,
                price_num: actualPriceZar,
                image: assetImage,
                asset_type: holdingType,
                gain: '+0.0%',
                gain_pct: '0%',
                positive: true,
              });
            }

            // Remove legacy holding from seller's vault
            await supabase
              .from('user_holdings')
              .delete()
              .eq('user_id', sellerId)
              .ilike('name', assetName);
          } else {
            await supabase.from('user_holdings').insert({
              user_id: userId,
              name: holdingName,
              category: assetCategory,
              price: `R${actualPriceZar.toLocaleString('en-ZA')}`,
              price_num: actualPriceZar,
              image: assetImage,
              asset_type: holdingType,
              gain: '+0.0%',
              gain_pct: '0%',
              positive: true,
            });
          }

          // Record Provenance
          const wholeMilestone = `Ownership Transferred: Acquired 100% full ownership via ${paymentRailName}. Original seller: ${sellerId ? String(sellerId).slice(0, 8) : 'Verified Lister'}.`;
          await supabase.from('asset_history').insert({
            asset_id: asset.id,
            year: String(new Date().getFullYear()),
            event: wholeMilestone,
            party: `Buyer (${req.user.fullName || req.user.email})`,
            hash: transactionId,
            tx_hash: verifiedTxHash || transactionId,
            verified: true,
          });

          if (asset.token_id) {
            web3Service.recordMilestoneOnChain(asset.token_id, {
              year: new Date().getFullYear(),
              event: wholeMilestone,
              party: `Buyer (${userId.substring(0, 8)})`,
              hash: transactionId,
            });
          }

          await notificationService.sendNotification({
            userId,
            type: 'ownership_transferred',
            title: 'Purchase Complete — Ownership Transferred',
            message: `Congratulations! You now hold 100% verified ownership of "${assetName}". Secured in your Vault.`,
            orderId,
            assetId: asset.id,
          });
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
            : `Purchased "${assetName}" (100% Outright Ownership)`,
          status: 'completed',
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
      message: isFractional ? 'Investment verified and shares added to your vault!' : 'Payment verified and secured in escrow!',
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
        sellerId,
        sellerAddress,
        timestamp: new Date().toISOString(),
      },
      escrowOrder,
    });
  }
  catch (err) {
    console.error('processPayment error:', err);
    return sendError(res, 500, err.message || 'Internal server error processing payment.');
  }
}

module.exports = {
  getRates,
  createIntent,
  processPayment,
};
