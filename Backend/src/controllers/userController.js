// ─── User Data Controller ───────────────────────────────────────────────────
// Manages strictly user-isolated portfolio, vault holdings, KYC verification documents,
// and bank account approval workflows.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const avatarService = require('../services/avatarService');
const complianceService = require('../services/complianceService');
const auditLogService = require('../services/auditLogService');
const { uploadImageToCloud, saveBase64Image, normalizeImageUrl } = require('../utils/imageHandler');
const { isHoldingVerified } = require('../utils/holdingVerification');
const portfolioSnapshotService = require('../services/portfolioSnapshotService');

// ── GET /api/user/vault ──────────────────────────────────────────────────────
// Returns ONLY holdings belonging to the authenticated user.
async function getVault(req, res) {
  try {
    const userId = req.user.id;

    // Fetch strictly this user's holdings
    const { data: holdings, error } = await supabase
      .from('user_holdings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching vault holdings:', error);
      // If table doesn't exist yet or has error, return safe empty list with explicit unavailable states
      return res.status(200).json({
        success: true,
        holdings: [],
        summary: {
          availableBalanceNum: 0,
          availableBalanceFormatted: 'R0',
          escrowBalanceNum: 0,
          escrowBalanceFormatted: 'R0',
          sellerPendingEscrowNum: 0,
          sellerPendingEscrowFormatted: 'R0',
          portfolioValueNum: 0,
          portfolioValueFormatted: 'R0',
          valuationType: 'recorded',
          valuationLabel: 'Recorded Vault Value',
          totalValueFormatted: 'R0',
          totalValueNum: 0,
          combinedTotalNum: 0,
          combinedTotalFormatted: 'R0',
          totalCount: 0,
          wholeCount: 0,
          fractionalCount: 0,
          categoriesCount: 0,
          verifiedPct: null,
          hasPerformanceHistory: false,
          monthlyChangeNum: null,
          monthlyChangePct: null,
          monthlyChangeFormatted: null,
          isPositive: true,
          history: [],
          gainText: 'Performance history unavailable',
        },
      });
    }

    let allHaveMarketValue = (holdings || []).length > 0;
    let anyHasMarketValue = false;

    const items = (holdings || []).map((item) => {
      let initialValue = Number(item.price_num) || 0;
      let liveMarketValue = null;
      let hasMarketValue = false;
      let badgeText = item.gain || '+0.0% Market Gain';
      let badgeType = item.positive ? 'positive' : 'negative';
      let sharesOwned = 1;
      let myStake = Number(item.price_num) || 0;

      if (item.gain && item.gain.includes('<!--meta:')) {
        const match = item.gain.match(/<!--meta:([\s\S]*?)-->/);
        if (match) {
          try {
            const meta = JSON.parse(match[1]);
            if (meta.initialValue !== undefined && meta.initialValue !== null) {
              initialValue = Number(meta.initialValue);
            }
            if (meta.liveMarketValue !== undefined && meta.liveMarketValue !== null && !isNaN(meta.liveMarketValue)) {
              liveMarketValue = Number(meta.liveMarketValue);
              hasMarketValue = true;
            }
            if (meta.badgeText) badgeText = meta.badgeText;
            if (meta.badgeType) badgeType = meta.badgeType;
            if (meta.sharesOwned) sharesOwned = meta.sharesOwned;
            if (meta.myStake) myStake = Number(meta.myStake);
            if (meta.certId) item.certId = meta.certId;
            if (meta.hashDisplay) item.hashDisplay = meta.hashDisplay;
          } catch (_) {}
        }
      }

      if (!hasMarketValue) {
        allHaveMarketValue = false;
      } else {
        anyHasMarketValue = true;
      }

      const cleanGain = badgeText.replace(/<!--[\s\S]*?-->/g, '').trim();

      let assetId = item.asset_id || null;
      if (!assetId && item.gain && item.gain.includes('<!--meta:')) {
        const match = item.gain.match(/<!--meta:([\s\S]*?)-->/);
        if (match) {
          try {
            const meta = JSON.parse(match[1]);
            if (meta.assetId) assetId = meta.assetId;
          } catch (_) {}
        }
      }

      const isVerified = isHoldingVerified(item);

      // Determine authoritative holding value for portfolio total
      const isFractional = item.asset_type === 'fractional';
      const effectiveHoldingValue = isFractional
        ? myStake
        : (hasMarketValue ? liveMarketValue : initialValue);

      return {
        ...item,
        asset_id: assetId,
        image: normalizeImageUrl(item.image, req),
        initialValue,
        initialValueFormatted: `R${initialValue.toLocaleString('en-ZA')}`,
        liveMarketValue,
        liveMarketValueFormatted: liveMarketValue !== null ? `R${liveMarketValue.toLocaleString('en-ZA')}` : null,
        hasMarketValue,
        effectiveHoldingValue,
        isVerified,
        verified: isVerified,
        badgeText: cleanGain,
        badgeType,
        sharesOwned,
        myStake,
        myStakeFormatted: `R${myStake.toLocaleString('en-ZA')}`,
      };
    });

    const vaultTxService = require('../services/vaultTransactionService');
    const balanceDetails = await vaultTxService.getUserBalanceDetails(userId);
    const availableBalanceNum = balanceDetails.availableBalanceNum;
    const availableBalanceFormatted = balanceDetails.availableBalanceFormatted;
    const reservedBalanceNum = balanceDetails.reservedBalanceNum;
    const reservedBalanceFormatted = balanceDetails.reservedBalanceFormatted;

    // Compute separate escrow balances for funds locked in custody
    let escrowBalanceNum = 0;
    let sellerPendingEscrowNum = 0;
    try {
      const activeEscrowStatuses = [
        'payment_secured',
        'in_transit',
        'in_inspection',
        'delivered',
        'accepted',
        'disputed',
      ];

      const { data: buyerEscrows } = await supabase
        .from('escrow_orders')
        .select('amount_zar, status')
        .eq('buyer_id', userId)
        .in('status', activeEscrowStatuses);

      if (buyerEscrows && Array.isArray(buyerEscrows)) {
        escrowBalanceNum = buyerEscrows.reduce((sum, o) => sum + (Number(o.amount_zar) || 0), 0);
      }

      const { data: sellerEscrows } = await supabase
        .from('escrow_orders')
        .select('amount_zar, status')
        .eq('seller_id', userId)
        .in('status', activeEscrowStatuses);

      if (sellerEscrows && Array.isArray(sellerEscrows)) {
        sellerPendingEscrowNum = sellerEscrows.reduce((sum, o) => sum + (Number(o.amount_zar) || 0), 0);
      }
    } catch (_escErr) {
      console.warn('⚠️ [UserController] Escrow balance lookup fallback:', _escErr.message);
    }

    const escrowBalanceFormatted = vaultTxService.formatZar(escrowBalanceNum);
    const sellerPendingEscrowFormatted = vaultTxService.formatZar(sellerPendingEscrowNum);

    // Compute personal portfolio summary from authoritative holding values
    const portfolioValueNum = items.reduce((sum, item) => sum + (Number(item.effectiveHoldingValue) || 0), 0);
    const wholeCount = items.filter((i) => i.asset_type !== 'fractional').length;
    const fractionalCount = items.filter((i) => i.asset_type === 'fractional').length;

    // Valuation categorization: distinguishes live market valuations from recorded purchase prices
    const valuationType = items.length === 0
      ? 'recorded'
      : allHaveMarketValue
        ? 'market'
        : anyHasMarketValue
          ? 'mixed'
          : 'recorded';
    const valuationLabel = valuationType === 'market'
      ? 'Live Market Value'
      : valuationType === 'mixed'
        ? 'Mixed Market & Recorded'
        : 'Recorded Vault Value';

    // Categories count: distinct non-empty categories, 0 if no holdings
    const uniqueCategories = new Set(
      items
        .map((i) => (i.category ? String(i.category).trim() : ''))
        .filter((c) => c.length > 0)
    );
    const categoriesCount = items.length === 0 ? 0 : uniqueCategories.size;

    // Verified percentage: explicit authoritative verification status
    const verifiedCount = items.filter((i) => i.isVerified).length;
    const verifiedPct = items.length === 0
      ? null
      : Math.round((verifiedCount / items.length) * 100);

    const formattedPortfolio = vaultTxService.formatZar(portfolioValueNum);
    const totalCombinedNum = availableBalanceNum + escrowBalanceNum + portfolioValueNum;
    const totalCombinedFormatted = vaultTxService.formatZar(totalCombinedNum);
    const transactions = await vaultTxService.fetchUserTransactions(userId);

    // Authoritative dated snapshot recording & monthly performance calculation
    await portfolioSnapshotService.recordDailySnapshot(userId, {
      portfolioValue: portfolioValueNum,
      cashBalance: availableBalanceNum,
      totalValue: totalCombinedNum,
      holdingsCount: items.length,
    });

    const performance = await portfolioSnapshotService.getMonthlyPerformance(userId, portfolioValueNum);

    return res.status(200).json({
      success: true,
      holdings: items,
      transactions,
      summary: {
        availableBalanceNum,
        availableBalanceFormatted,
        reservedBalanceNum,
        reservedBalanceFormatted,
        escrowBalanceNum,
        escrowBalanceFormatted,
        sellerPendingEscrowNum,
        sellerPendingEscrowFormatted,
        portfolioValueNum,
        portfolioValueFormatted: formattedPortfolio,
        valuationType,
        valuationLabel,
        totalValueFormatted: availableBalanceFormatted, // Liquid cash available
        totalValueNum: availableBalanceNum,
        combinedTotalNum: totalCombinedNum,
        combinedTotalFormatted: totalCombinedFormatted,
        totalCount: items.length,
        wholeCount,
        fractionalCount,
        categoriesCount,
        verifiedPct,
        hasPerformanceHistory: performance.hasPerformanceHistory,
        monthlyChangeNum: performance.monthlyChangeNum,
        monthlyChangePct: performance.monthlyChangePct,
        monthlyChangeFormatted: performance.monthlyChangeFormatted,
        isPositive: performance.isPositive,
        history: performance.history || [],
        gainText: performance.hasPerformanceHistory
          ? performance.monthlyChangeFormatted
          : 'Performance history unavailable',
      },
    });
  } catch (err) {
    console.error('getVault error:', err);
    return sendError(res, 500, 'Failed to fetch personal vault data.');
  }
}

// ── POST /api/user/vault ─────────────────────────────────────────────────────
// Adds an asset into the authenticated user's personal vault.
async function addHolding(req, res) {
  try {
    const userId = req.user.id;
    const {
      name,
      category,
      price,
      priceNum,
      gain,
      gainPct,
      positive,
      image,
      assetType,
      initialValue,
      liveMarketValue,
      badgeText,
      verified,
      isVerified,
    } = req.body;

    if (!name || !category || (priceNum === undefined && initialValue === undefined)) {
      return sendError(res, 400, 'Please provide asset name, category, and price.');
    }

    const effectivePriceNum = Number(priceNum !== undefined ? priceNum : (liveMarketValue || initialValue || 0));
    let gainVal = gain || badgeText || '+0.0%';
    const holdingVerified = Boolean(verified || isVerified);
    if (initialValue !== undefined || liveMarketValue !== undefined || badgeText !== undefined || holdingVerified) {
      const meta = {
        initialValue: Number(initialValue || effectivePriceNum),
        liveMarketValue: liveMarketValue !== undefined ? Number(liveMarketValue) : undefined,
        badgeText: badgeText || gainVal,
        badgeType: positive !== undefined ? (positive ? 'positive' : 'negative') : 'positive',
        certId: req.body.certId || null,
        hashDisplay: req.body.hashDisplay || null,
        txHash: req.body.txHash || null,
        verified: holdingVerified,
      };
      gainVal = `${badgeText || gainVal}<!--meta:${JSON.stringify(meta)}-->`;
    }

    const cleanImage = image
      ? await uploadImageToCloud(image, 'assets', req, userId)
      : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800';

    const { data, error } = await supabase
      .from('user_holdings')
      .insert({
        user_id: userId,
        name: name.trim(),
        category: category.trim(),
        price: price || `R${effectivePriceNum.toLocaleString('en-ZA')}`,
        price_num: effectivePriceNum,
        gain: gainVal,
        gain_pct: gainPct || '0%',
        positive: positive !== undefined ? positive : true,
        image: cleanImage,
        asset_type: assetType || 'personal',
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding holding:', error);
      return sendError(res, 400, 'Could not add holding to vault.');
    }

    return res.status(201).json({
      success: true,
      message: 'Asset added to your personal vault!',
      holding: {
        ...data,
        image: normalizeImageUrl(data?.image, req),
      },
    });
  } catch (err) {
    console.error('addHolding error:', err);
    return sendError(res, 500, 'Failed to save holding to your vault.');
  }
}

// ── POST /api/user/seed-starter ──────────────────────────────────────────────
// Seeds starter assets strictly for this user (for testing/demo purposes)
async function seedStarterHoldings(req, res) {
  try {
    const userId = req.user.id;

    // Check if user already has items
    const { data: existing } = await supabase
      .from('user_holdings')
      .select('id')
      .eq('user_id', userId);

    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'User already has holdings.',
      });
    }

    // Pull actual assets from the database instead of hardcoding items
    const { data: dbAssets } = await supabase
      .from('assets')
      .select('*')
      .eq('status', 'active')
      .limit(2);

    if (!dbAssets || dbAssets.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No assets currently in database to seed.',
        holdings: [],
      });
    }

    const starterHoldings = dbAssets.map((a) => ({
      user_id: userId,
      name: a.name,
      category: a.category,
      price: a.price,
      price_num: a.price_num,
      gain: '+0.0%',
      gain_pct: '0%',
      positive: true,
      image: a.image,
      asset_type: 'whole',
    }));

    const { data, error } = await supabase
      .from('user_holdings')
      .insert(starterHoldings)
      .select();

    if (error) {
      console.error('Seed error:', error);
      return sendError(res, 400, 'Could not seed starter items.');
    }

    return res.status(201).json({
      success: true,
      message: 'Starter portfolio created for your account!',
      holdings: data,
    });
  } catch (err) {
    console.error('seed error:', err);
    return sendError(res, 500, 'Failed to seed starter assets.');
  }
}

// ── GET /api/user/profile ────────────────────────────────────────────────────
// Returns full profile metadata for the authenticated user.
async function getProfile(req, res) {
  try {
    const userId = req.user.id;

    // Fetch auth user from Supabase Admin
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const authUser = authData?.user;

    // Fetch database profile (including avatar_url stored in DB)
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const userMeta = authUser?.user_metadata || {};
    const fullName = profile?.full_name || userMeta.full_name || req.user.fullName || '';
    const email = authUser?.email || profile?.email || req.user.email || '';
    const walletAddress = profile?.wallet_address || userMeta.wallet_address || req.user.walletAddress || null;
    const avatarUrl = profile?.avatar_url || userMeta.avatar_url || null;
    const gender = userMeta.gender || '';
    const dob = userMeta.dob || '';
    const phone = userMeta.phone || '';
    const createdAt = authUser?.created_at || profile?.created_at || new Date().toISOString();

    const comp = complianceService.getUserCompliance(userId, email);
    const verificationBundle = await complianceService.getVerificationStatusBundle(userId, email, req);
    const effectiveVerificationStatus =
      profile?.verification_status === 'verified'
        ? 'verified'
        : verificationBundle.verification_status || comp.kycStatus || 'unverified';

    return res.status(200).json({
      success: true,
      profile: {
        id: userId,
        fullName,
        email,
        walletAddress,
        avatarUrl,
        avatar_url: avatarUrl,
        gender,
        dob,
        phone,
        createdAt,
        role: profile?.role || 'user',
        verification_status: effectiveVerificationStatus,
        kycStatus: effectiveVerificationStatus,
        accountStatus: comp.accountStatus || 'active',
        isSuspended: comp.isSuspended || false,
        suspensionReason: comp.suspensionReason || null,
        bankingDetails: comp.bankingDetails || null,
        bankAccount: verificationBundle.bank_account || null,
        bankStatus: verificationBundle.bank_account?.status || 'not_submitted',
        verificationDocuments: verificationBundle.documents || null,
        notificationPreferences: userMeta.notification_preferences || {
          escrowAlerts: true,
          priceAlerts: true,
          securityAlerts: true,
          marketing: false,
        },
      },
    });
  } catch (err) {
    console.error('getProfile error:', err);
    return sendError(res, 500, 'Failed to fetch user profile.');
  }
}

// ── PUT /api/user/profile ────────────────────────────────────────────────────
// Updates profile details (fullName, avatarUrl, gender, dob, phone, password).
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const { fullName, avatarUrl, gender, dob, phone, password, notificationPreferences } = req.body;

    // Save avatar to the database (profiles.avatar_url column)
    let savedAvatar = null;
    if (avatarUrl !== undefined && avatarUrl !== null) {
      savedAvatar = await avatarService.saveUserAvatar(userId, avatarUrl);
    }

    // Fetch current user metadata
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const existingMeta = authData?.user?.user_metadata || {};

    // Keep user_metadata lightweight — store a short marker, not the full base64
    const updatedMeta = {
      ...existingMeta,
      ...(fullName ? { full_name: fullName.trim() } : {}),
      ...(avatarUrl !== undefined ? { avatar_url: 'db_stored' } : {}),
      ...(gender !== undefined ? { gender: gender.trim() } : {}),
      ...(dob !== undefined ? { dob: dob.trim() } : {}),
      ...(phone !== undefined ? { phone: phone.trim() } : {}),
      ...(notificationPreferences ? { notification_preferences: notificationPreferences } : {}),
    };

    const updatePayload = {
      user_metadata: updatedMeta,
    };

    if (password && password.length >= 6) {
      updatePayload.password = password;
    }

    const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      updatePayload
    );

    if (updateError) {
      console.error('Auth metadata update error:', updateError);
      return sendError(res, 400, updateError.message || 'Could not update user metadata.');
    }

    // Sync full_name to profiles table
    if (fullName) {
      await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', userId);
    }

    const effectiveAvatar = savedAvatar || (await avatarService.getUserAvatar(userId)) || null;

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        id: userId,
        email: updatedUser?.user?.email || req.user.email,
        fullName: updatedMeta.full_name || fullName || '',
        avatarUrl: effectiveAvatar,
        avatar_url: effectiveAvatar,
        gender: updatedMeta.gender || '',
        dob: updatedMeta.dob || '',
        phone: updatedMeta.phone || '',
      },
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    return sendError(res, 500, 'Failed to update profile.');
  }
}

// ── DELETE /api/user/account ─────────────────────────────────────────────────
// Permanently removes the user's account and associated holdings.
async function deleteAccount(req, res) {
  try {
    const userId = req.user.id;
    console.log(`⚠️ [DeleteAccount] Deleting account for user ${userId}...`);

    // Clean up stored avatar from DB
    try {
      await avatarService.deleteUserAvatar(userId);
    } catch (e) {
      console.warn('Avatar cleanup warning:', e.message);
    }

    // 1. Delete user holdings
    try {
      await supabase.from('user_holdings').delete().eq('user_id', userId);
    } catch (e) {
      console.warn('Holdings cleanup warning:', e.message);
    }

    // 2. Archive user-listed assets if any
    try {
      await supabase.from('assets').update({ status: 'archived' }).eq('user_id', userId);
    } catch (e) {
      console.warn('Assets archive warning:', e.message);
    }

    // 3. Delete database profile
    try {
      await supabase.from('profiles').delete().eq('id', userId);
    } catch (e) {
      console.warn('Profile cleanup warning:', e.message);
    }

    // 4. Delete Supabase Auth account
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      console.error('Auth user delete error:', authDeleteError);
      return sendError(res, 500, 'Failed to remove user auth account.');
    }

    console.log(`✅ [DeleteAccount] Successfully deleted user ${userId}`);
    return res.status(200).json({
      success: true,
      message: 'Your account and personal data have been permanently deleted.',
    });
  } catch (err) {
    console.error('deleteAccount error:', err);
    return sendError(res, 500, 'Internal server error deleting account.');
  }
}

// ── POST /api/user/deposit ───────────────────────────────────────────────────
// Records a deposit request or credits verified provider settlement
async function deposit(req, res) {
  try {
    const userId = req.user.id;
    const comp = complianceService.getUserCompliance(userId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Transactions blocked.');
    }
    const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(userId, req.user?.email));
    if (!bundle || bundle.verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        error: 'KYC Verification Required: You must upload and get all 3 verification documents (ID, Tax, Proof of Residence) approved before depositing funds.',
      });
    }
    if (!bundle.hasApprovedBank && bundle.bank_account?.status !== 'approved') {
      return res.status(403).json({
        success: false,
        code: 'BANK_APPROVAL_REQUIRED',
        error: 'Bank Verification Required: You must link and get your bank account approved by an administrator before depositing funds.',
      });
    }

    const {
      amount,
      currency,
      method,
      reference,
      notes,
      paymentIntentId,
      idempotencyKey: bodyIdempKey,
    } = req.body || {};
    const idempotencyKey = bodyIdempKey || req.headers?.['x-idempotency-key'] || null;

    if (!amount || Number(amount) <= 0) {
      return sendError(res, 400, 'Please enter a valid deposit amount greater than R0.');
    }

    // Never allow client HTTP requests to spoof internal system payout methods
    const rawMethod = String(method || 'Manual Bank EFT').trim();
    const isClientStripe = Boolean(paymentIntentId) || rawMethod.toLowerCase().includes('stripe') || rawMethod.toLowerCase() === 'card';
    const sanitizedMethod = isClientStripe ? 'Card (Stripe)' : 'Manual Bank EFT';

    const vaultTxService = require('../services/vaultTransactionService');
    const result = await vaultTxService.depositFunds({
      userId,
      amount: Number(amount),
      currency: currency || 'zar',
      method: sanitizedMethod,
      reference,
      notes,
      paymentIntentId,
      idempotencyKey,
    });

    const msg = result.credited
      ? `Verified deposit of ${vaultTxService.formatZar(amount)} settled and credited to your Vault!`
      : `Deposit request of ${vaultTxService.formatZar(amount)} recorded as Pending Verification. Your spendable balance will be credited once receipt of funds is confirmed.`;

    const statusCode = result.credited ? 200 : 202;
    return res.status(statusCode).json({
      success: true,
      message: msg,
      ...result,
    });
  } catch (err) {
    console.error('deposit error:', err);
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      code: err.code || 'DEPOSIT_FAILED',
      error: err.message || 'Deposit failed. Please try again.',
    });
  }
}

// ── POST /api/user/withdraw ──────────────────────────────────────────────────
// Creates a pending withdrawal request & atomically reserves funds to the approved bank account on file
async function withdraw(req, res) {
  try {
    const userId = req.user.id;
    const comp = complianceService.getUserCompliance(userId, req.user?.email);
    if (comp && comp.isSuspended) {
      return sendError(res, 403, 'Account Suspended by Compliance. Transactions blocked.');
    }
    const bundle = req.verificationBundle || (await complianceService.getVerificationStatusBundle(userId, req.user?.email));
    if (!bundle || bundle.verification_status !== 'verified') {
      return res.status(403).json({
        success: false,
        code: 'KYC_REQUIRED',
        error: 'KYC Verification Required: You must upload and get all 3 verification documents approved before withdrawing funds.',
      });
    }

    const approvedBank = req.approvedBankAccount || complianceService.getUserBankAccount(userId, req.user?.email);
    if (!approvedBank || approvedBank.status !== 'approved') {
      return res.status(403).json({
        success: false,
        code: 'BANK_APPROVAL_REQUIRED',
        error: 'Approved bank account required. Please submit your bank details and wait for admin approval before withdrawing funds.',
      });
    }

    const {
      amount,
      method,
      bankDetails,
      walletAddress,
      notes,
      idempotencyKey: bodyIdempKey,
    } = req.body || {};
    const idempotencyKey = bodyIdempKey || req.headers?.['x-idempotency-key'] || null;

    if (!amount || Number(amount) <= 0) {
      return sendError(res, 400, 'Please enter a valid withdrawal amount greater than R0.');
    }

    const vaultTxService = require('../services/vaultTransactionService');
    const result = await vaultTxService.withdrawFunds({
      userId,
      userEmail: req.user?.email,
      amount: Number(amount),
      method: method || 'Approved Bank EFT',
      bankDetails,
      walletAddress,
      notes,
      idempotencyKey,
      approvedBank,
    });

    return res.status(200).json({
      success: true,
      message: `Withdrawal request of ${vaultTxService.formatZar(amount)} submitted for review. Funds are reserved and will be paid to your approved ${approvedBank.bank_name || approvedBank.bankName} account upon settlement confirmation.`,
      ...result,
    });
  } catch (err) {
    console.error('withdraw error:', err);
    const statusCode = err.code === 'UNAPPROVED_DESTINATION' || err.code === 'BANK_APPROVAL_REQUIRED' ? 403 : 400;
    return res.status(statusCode).json({
      success: false,
      code: err.code || 'WITHDRAWAL_FAILED',
      error: err.message || 'Withdrawal failed. Please try again.',
    });
  }
}

// ── POST /api/user/withdraw/:id/cancel ───────────────────────────────────────
// Cancels a user's own pending_review withdrawal and restores reserved funds
async function cancelWithdrawal(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const vaultTxService = require('../services/vaultTransactionService');

    const result = await vaultTxService.cancelOrRejectWithdrawal({
      transactionId: id,
      actorId: userId,
      newStatus: 'cancelled',
      reason: req.body?.reason || 'Cancelled by user prior to payout processing',
    });

    return res.status(200).json({
      success: true,
      message: 'Pending withdrawal cancelled. Reserved funds have been restored to your spendable balance.',
      ...result,
    });
  } catch (err) {
    console.error('cancelWithdrawal error:', err);
    const statusCode = err.statusCode || (err.code === 'CANCELLATION_LOCKED' ? 409 : 400);
    return res.status(statusCode).json({
      success: false,
      code: err.code || 'CANCEL_FAILED',
      error: err.message || 'Could not cancel withdrawal.',
    });
  }
}

// ── GET /api/user/transactions ───────────────────────────────────────────────
// Returns transaction history and balance breakdown for the authenticated user
async function getTransactions(req, res) {
  try {
    const userId = req.user.id;
    const vaultTxService = require('../services/vaultTransactionService');
    const transactions = await vaultTxService.fetchUserTransactions(userId);
    const balanceDetails = await vaultTxService.getUserBalanceDetails(userId);

    return res.status(200).json({
      success: true,
      transactions,
      balance: {
        amountNum: balanceDetails.availableBalanceNum,
        amountFormatted: balanceDetails.availableBalanceFormatted,
        totalBalanceNum: balanceDetails.totalBalanceNum,
        totalBalanceFormatted: balanceDetails.totalBalanceFormatted,
        reservedBalanceNum: balanceDetails.reservedBalanceNum,
        reservedBalanceFormatted: balanceDetails.reservedBalanceFormatted,
      },
    });
  } catch (err) {
    console.error('getTransactions error:', err);
    return sendError(res, 500, 'Failed to fetch user transaction history.');
  }
}

// ── POST /api/user/support ───────────────────────────────────────────────────
// Lodges a support ticket for the user.
async function lodgeSupport(req, res) {
  try {
    const userId = req.user.id;
    const { category, subject, message, priority } = req.body;

    if (!subject || !subject.trim() || !message || !message.trim()) {
      return sendError(res, 400, 'Please provide both a subject and message for your support inquiry.');
    }

    const supportService = require('../services/supportService');
    const ticket = supportService.createTicket({
      userId,
      userEmail: req.user.email,
      userName: req.user.fullName || req.user.email?.split('@')[0],
      category,
      subject,
      message,
      priority,
    });

    return res.status(201).json({
      success: true,
      message: 'Support ticket lodged successfully! Our concierge team will review it shortly.',
      ticket,
    });
  } catch (err) {
    console.error('lodgeSupport error:', err);
    return sendError(res, 500, 'Failed to lodge support ticket.');
  }
}

// ── GET /api/user/support ────────────────────────────────────────────────────
// Returns ticket history for the authenticated user.
async function getSupportTickets(req, res) {
  try {
    const userId = req.user.id;
    const supportService = require('../services/supportService');
    const tickets = supportService.getUserTickets(userId);

    return res.status(200).json({
      success: true,
      tickets,
    });
  } catch (err) {
    console.error('getSupportTickets error:', err);
    return sendError(res, 500, 'Failed to fetch support tickets.');
  }
}

// ── GET /api/user/analytics ──────────────────────────────────────────────────
// Aggregates user profile analytics from authoritative database, vault, and snapshot records.
// Strictly ZERO fabricated trends, zero fake health scores, and zero fallback gains.
async function getAnalytics(req, res) {
  try {
    const userId = req.user.id;
    const portfolioSnapshotService = require('../services/portfolioSnapshotService');
    const { isHoldingVerified } = require('../utils/holdingVerification');
    const vaultTxService = require('../services/vaultTransactionService');

    // 1. Fetch user profile & created_at
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const authUser = authData?.user;

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const createdAt = authUser?.created_at || profile?.created_at || req.user.created_at || new Date().toISOString();
    const joinedDate = new Date(createdAt);
    const now = new Date();
    const daysSinceJoined = Math.max(1, Math.floor((now.getTime() - joinedDate.getTime()) / (1000 * 60 * 60 * 24)));

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const memberSinceFormatted = `${monthNames[joinedDate.getMonth()]} ${joinedDate.getFullYear()}`;

    // 2. Fetch Vault Holdings
    const { data: holdings } = await supabase
      .from('user_holdings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const rawHoldings = holdings || [];
    let allHaveMarketValue = rawHoldings.length > 0;
    let anyHasMarketValue = false;
    let measuredGainsNum = 0;
    let holdingsWithMarketValueCount = 0;

    const items = rawHoldings.map((item) => {
      const isFractional = item.asset_type === 'fractional';
      const sharesOwned = Number(item.shares_owned) || 1;
      const sharePrice = Number(item.price_num) || 0;
      const myStake = isFractional
        ? (Number(item.my_stake) || sharesOwned * sharePrice)
        : sharePrice;

      let initialValue = Number(item.initial_value);
      if (isNaN(initialValue) || initialValue <= 0) {
        initialValue = isFractional ? myStake : (Number(item.price_num) || 0);
      }

      let liveMarketValue = null;
      let hasMarketValue = false;
      if (item.live_market_value !== null && item.live_market_value !== undefined) {
        const lmv = Number(item.live_market_value);
        if (!isNaN(lmv) && lmv > 0) {
          liveMarketValue = lmv;
          hasMarketValue = true;
        }
      }

      if (!hasMarketValue) {
        allHaveMarketValue = false;
      } else {
        anyHasMarketValue = true;
        holdingsWithMarketValueCount += 1;
        if (initialValue > 0) {
          measuredGainsNum += (liveMarketValue - initialValue);
        }
      }

      const effectiveHoldingValue = isFractional
        ? myStake
        : (hasMarketValue ? liveMarketValue : initialValue);

      const isVerified = isHoldingVerified(item);

      return {
        ...item,
        isFractional,
        myStake,
        initialValue,
        liveMarketValue,
        hasMarketValue,
        effectiveHoldingValue,
        isVerified,
      };
    });

    const availableBalanceNum = await vaultTxService.getUserBalance(userId);
    const availableBalanceFormatted = vaultTxService.formatZar(availableBalanceNum);

    // Compute separate escrow balances for funds locked in custody
    let escrowBalanceNum = 0;
    let sellerPendingEscrowNum = 0;
    const activeEscrowStatuses = [
      'payment_secured',
      'in_transit',
      'in_inspection',
      'delivered',
      'accepted',
      'disputed',
    ];

    try {
      const { data: buyerEscrows } = await supabase
        .from('escrow_orders')
        .select('amount_zar, status')
        .eq('buyer_id', userId)
        .in('status', activeEscrowStatuses);

      if (buyerEscrows && Array.isArray(buyerEscrows)) {
        escrowBalanceNum = buyerEscrows.reduce((sum, o) => sum + (Number(o.amount_zar) || 0), 0);
      }

      const { data: sellerEscrows } = await supabase
        .from('escrow_orders')
        .select('amount_zar, status')
        .eq('seller_id', userId)
        .in('status', activeEscrowStatuses);

      if (sellerEscrows && Array.isArray(sellerEscrows)) {
        sellerPendingEscrowNum = sellerEscrows.reduce((sum, o) => sum + (Number(o.amount_zar) || 0), 0);
      }
    } catch (_escErr) {
      console.warn('⚠️ [UserController] Escrow balance lookup notice in getAnalytics:', _escErr.message);
    }

    const escrowBalanceFormatted = vaultTxService.formatZar(escrowBalanceNum);
    const sellerPendingEscrowFormatted = vaultTxService.formatZar(sellerPendingEscrowNum);

    // Authoritative portfolio valuation
    const portfolioValueNum = items.reduce((sum, item) => sum + (Number(item.effectiveHoldingValue) || 0), 0);
    const combinedNetWorth = availableBalanceNum + escrowBalanceNum + portfolioValueNum;

    // Valuation categorization: distinguishes live market valuations from recorded purchase prices
    const valuationType = items.length === 0
      ? 'recorded'
      : allHaveMarketValue
        ? 'market'
        : anyHasMarketValue
          ? 'mixed'
          : 'recorded';
    const valuationLabel = valuationType === 'market'
      ? 'Live Market Value'
      : valuationType === 'mixed'
        ? 'Mixed Market & Recorded'
        : 'Recorded Vault Value';

    // Category distribution using authoritative effectiveHoldingValue
    const categoryTotals = {};
    items.forEach((item) => {
      const cat = item.category ? String(item.category).trim() : 'Collectibles';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(item.effectiveHoldingValue) || 0);
    });

    const categoryBreakdown = Object.entries(categoryTotals).map(([category, val]) => ({
      category,
      valueNum: val,
      valueFormatted: vaultTxService.formatZar(val),
      percentage: portfolioValueNum > 0 ? Math.round((val / portfolioValueNum) * 100) : 0,
    }));

    // 3. Transactions & Escrows
    const transactions = await vaultTxService.fetchUserTransactions(userId);
    let userEscrows = [];
    try {
      const escrowService = require('../services/escrowService');
      userEscrows = await escrowService.getUserEscrowOrders(userId);
    } catch (_err) {
      userEscrows = [];
    }

    const totalDeposits = transactions
      .filter((t) => t.type === 'deposit')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalWithdrawals = transactions
      .filter((t) => t.type === 'withdraw')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // 4. Growth & Performance from authoritative dated snapshots
    // Ensure today's snapshot is authoritatively recorded
    await portfolioSnapshotService.recordDailySnapshot(userId, {
      portfolioValue: portfolioValueNum,
      cashBalance: availableBalanceNum,
      totalValue: combinedNetWorth,
      holdingsCount: items.length,
    });

    const performance = await portfolioSnapshotService.getMonthlyPerformance(userId, portfolioValueNum);
    const userSnapshots = await portfolioSnapshotService.getUserSnapshots(userId);

    // Real monthly timeline from dated portfolio_snapshots (NEVER fabricated multipliers)
    const monthlyTimeline = userSnapshots.map((s) => ({
      date: s.snapshotDate,
      valueNum: s.portfolioValue,
      valueFormatted: vaultTxService.formatZar(s.portfolioValue),
      cashBalanceNum: s.cashBalance,
      cashBalanceFormatted: vaultTxService.formatZar(s.cashBalance),
      totalValueNum: s.totalValue,
      totalValueFormatted: vaultTxService.formatZar(s.totalValue),
      holdingsCount: s.holdingsCount,
    }));

    // 5. User Milestones derived strictly from real recorded events
    const milestones = [
      {
        id: 'ms-joined',
        title: 'Joined SmartAssets Network',
        date: joinedDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }),
        desc: 'Account activated with decentralized vault custody',
        icon: 'checkmark-circle',
        completed: true,
      },
    ];

    if (transactions.length > 0) {
      const firstTx = transactions[transactions.length - 1];
      milestones.push({
        id: 'ms-vault',
        title: 'Vault Liquidity Initialized',
        date: firstTx.createdAt ? new Date(firstTx.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Confirmed',
        desc: `Vault balance recorded (${availableBalanceFormatted})`,
        icon: 'wallet',
        completed: true,
      });
    }

    if (items.length > 0) {
      milestones.push({
        id: 'ms-holdings',
        title: 'Asset Acquisition Recorded',
        date: `${items.length} ${items.length === 1 ? 'Asset' : 'Assets'} in Vault`,
        desc: `${items.filter((i) => i.isVerified).length} verified custody holdings`,
        icon: 'shield-checkmark',
        completed: true,
      });
    }

    const verifiedHoldingsCount = items.filter((i) => i.isVerified).length;
    const verifiedPct = items.length === 0 ? null : Math.round((verifiedHoldingsCount / items.length) * 100);

    return res.status(200).json({
      success: true,
      analytics: {
        userId,
        fullName: profile?.full_name || authUser?.user_metadata?.full_name || req.user.fullName || 'Member',
        email: authUser?.email || profile?.email || req.user.email || '',
        avatarUrl: profile?.avatar_url || authUser?.user_metadata?.avatar_url || null,
        joinedAt: createdAt,
        daysSinceJoined,
        memberSinceFormatted,
        membershipTier: profile?.tier || 'Member',
        netWorthNum: combinedNetWorth,
        netWorthFormatted: vaultTxService.formatZar(combinedNetWorth),
        availableBalanceNum,
        availableBalanceFormatted,
        escrowBalanceNum,
        escrowBalanceFormatted,
        sellerPendingEscrowNum,
        sellerPendingEscrowFormatted,
        portfolioValueNum,
        portfolioValueFormatted: vaultTxService.formatZar(portfolioValueNum),
        valuationType,
        valuationLabel,
        hasPerformanceHistory: performance.hasPerformanceHistory,
        growthRatePct: performance.hasPerformanceHistory ? performance.monthlyChangePct : null,
        monthlyChangeNum: performance.hasPerformanceHistory ? performance.monthlyChangeNum : null,
        monthlyChangeFormatted: performance.hasPerformanceHistory ? performance.monthlyChangeFormatted : null,
        performanceMessage: performance.performanceMessage,
        measuredGainsNum: holdingsWithMarketValueCount > 0 ? measuredGainsNum : null,
        measuredGainsFormatted: holdingsWithMarketValueCount > 0
          ? `${measuredGainsNum >= 0 ? '+' : ''}${vaultTxService.formatZar(measuredGainsNum)}`
          : null,
        healthScore: null, // Removed fabricated score
        healthGrade: null, // Removed fabricated grade
        totalHoldingsCount: items.length,
        verifiedHoldingsCount,
        verifiedPct,
        totalTransactionsCount: transactions.length,
        totalEscrowsCount: userEscrows.length,
        totalDepositsNum: totalDeposits,
        totalDepositsFormatted: vaultTxService.formatZar(totalDeposits),
        totalWithdrawalsNum: totalWithdrawals,
        totalWithdrawalsFormatted: vaultTxService.formatZar(totalWithdrawals),
        categoryBreakdown,
        monthlyTimeline,
        history: performance.history || [],
        milestones,
      },
    });
  } catch (err) {
    console.error('getAnalytics error:', err);
    return sendError(res, 500, 'Failed to fetch user analytics.');
  }
}

// ── POST /api/user/kyc-submit (Legacy Dossier Pack Submission) ───────────────
async function submitKyc(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const fullName = req.user.user_metadata?.full_name || req.body.fullName || 'SmartAssets Collector';
    const {
      idNumber,
      idDocumentUrl,
      taxNumber,
      taxDocumentUrl,
      residentialAddress,
      proofOfResidenceUrl,
      bankingDetails,
    } = req.body;

    const record = await complianceService.submitKyc({
      userId,
      userEmail,
      fullName,
      idNumber,
      idDocumentUrl,
      taxNumber,
      taxDocumentUrl,
      residentialAddress,
      proofOfResidenceUrl,
      bankingDetails,
    });

    auditLogService.logEvent({
      eventType: 'KYC_SUBMIT',
      category: 'Compliance',
      actorEmail: userEmail,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Mobile App',
      description: 'Submitted FICA / KYC compliance pack. Dossier: ' + record.id,
      status: 'Pending Review',
    });

    const bundle = await complianceService.getVerificationStatusBundle(userId, userEmail, req);

    return res.status(200).json({
      success: true,
      message: 'KYC compliance documents submitted successfully! Our compliance desk will review your dossier.',
      verification: record,
      kycStatus: bundle.verification_status || 'pending',
      verification_status: bundle.verification_status || 'pending',
      bundle,
    });
  } catch (err) {
    console.error('submitKyc error:', err);
    return sendError(res, 500, err.message || 'Failed to submit KYC compliance details.');
  }
}

// ── GET /api/user/kyc-status ─────────────────────────────────────────────────
async function getKycStatus(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const compliance = complianceService.getUserCompliance(userId, userEmail);
    const bundle = await complianceService.getVerificationStatusBundle(userId, userEmail, req);

    return res.status(200).json({
      success: true,
      compliance: {
        ...compliance,
        verification_status: bundle.verification_status,
        kycStatus: bundle.verification_status,
        documents: bundle.documents,
        bankAccount: bundle.bank_account,
        bankStatus: bundle.bank_account?.status || 'not_submitted',
      },
      ...bundle,
    });
  } catch (err) {
    console.error('getKycStatus error:', err);
    return sendError(res, 500, 'Failed to fetch KYC compliance status.');
  }
}

// ── POST /verification/documents ─────────────────────────────────────────────
// Uploads a single KYC verification document (id | tax | proof_of_residence)
async function uploadVerificationDocument(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const fullName =
      req.user.user_metadata?.full_name || req.body.fullName || req.user.email?.split('@')[0] || 'SmartAssets Collector';

    const docType = req.body.doc_type || req.body.docType;
    const fileData = req.body.file_data || req.body.fileData || req.body.documentUrl || req.body.base64;
    const fileName = req.body.file_name || req.body.fileName || `${docType}_document.jpg`;
    const mimeType = req.body.mime_type || req.body.mimeType || null;
    const metaValue = req.body.meta_value || req.body.metaValue || null;

    if (!docType) {
      return sendError(res, 400, 'doc_type is required ("id", "tax", or "proof_of_residence").');
    }

    const uploadRes = await complianceService.uploadVerificationDocument({
      userId,
      userEmail,
      fullName,
      docType,
      fileData,
      fileName,
      mimeType,
      metaValue,
    });

    const docRecord = uploadRes?.document || uploadRes || {};
    const docTypeName = docRecord.doc_type || docType || 'Document';

    auditLogService.logEvent({
      eventType: 'KYC_DOC_UPLOAD',
      category: 'Compliance',
      actorEmail: userEmail,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Mobile App',
      description: `Uploaded ${docTypeName} verification document (${docRecord.id || 'new'}). Status set to pending review.`,
      status: 'Pending Review',
    });

    const bundle = await complianceService.getVerificationStatusBundle(userId, userEmail, req);

    return res.status(200).json({
      success: true,
      message: `${String(docTypeName).replace(/_/g, ' ').toUpperCase()} uploaded and queued for admin review.`,
      document: docRecord,
      ...bundle,
    });
  } catch (err) {
    console.error('uploadVerificationDocument error:', err);
    const status = err.statusCode || 500;
    const msg = status === 500 ? 'Could not save your document. Please try again.' : (err.message || 'Failed to upload verification document.');
    return sendError(res, status, msg);
  }
}

// ── GET /verification/status ─────────────────────────────────────────────────
// Returns the user's 3 document slots + overall verification_status + bank account status
async function getVerificationStatus(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const bundle = await complianceService.getVerificationStatusBundle(userId, userEmail, req);

    return res.status(200).json({
      success: true,
      ...bundle,
    });
  } catch (err) {
    console.error('getVerificationStatus error:', err);
    return sendError(res, 500, 'Failed to fetch verification status.');
  }
}

// ── POST /bank-accounts ──────────────────────────────────────────────────────
// Submits or updates the user's bank account details for withdrawal approval
async function submitBankAccount(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const fullName =
      req.user.user_metadata?.full_name || req.body.fullName || req.user.email?.split('@')[0] || 'SmartAssets Collector';

    const accountHolder = req.body.account_holder || req.body.accountHolder;
    const bankName = req.body.bank_name || req.body.bankName;
    const accountNumber = req.body.account_number || req.body.accountNumber;
    const branchCode = req.body.branch_code || req.body.branchCode;
    const accountType = req.body.account_type || req.body.accountType || 'Cheque / Current';

    const bankRecord = await complianceService.submitBankAccount({
      userId,
      userEmail,
      fullName,
      accountHolder,
      bankName,
      accountNumber,
      branchCode,
      accountType,
    });

    auditLogService.logEvent({
      eventType: 'BANK_ACCOUNT_SUBMIT',
      category: 'Compliance',
      actorEmail: userEmail,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Mobile App',
      description: `Submitted bank account (${bankRecord.bank_name} ${bankRecord.account_number_masked}) for withdrawal approval.`,
      status: 'Pending Review',
    });

    return res.status(200).json({
      success: true,
      message: 'Bank account details submitted! An administrator will review and approve your bank account before withdrawals are enabled.',
      bank_account: bankRecord,
    });
  } catch (err) {
    console.error('submitBankAccount error:', err);
    return sendError(res, err.statusCode || 400, err.message || 'Failed to submit bank account details.');
  }
}

// ── GET /bank-accounts ───────────────────────────────────────────────────────
// Returns the authenticated user's bank account status
async function getBankAccount(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const bankAccount = complianceService.getUserBankAccount(userId, userEmail);

    const sanitizedBank = bankAccount
      ? {
          ...bankAccount,
          account_number: undefined,
        }
      : null;
    return res.status(200).json({
      success: true,
      bank_account: sanitizedBank,
      status: bankAccount?.status || 'not_submitted',
    });
  } catch (err) {
    console.error('getBankAccount error:', err);
    return sendError(res, 500, 'Failed to fetch bank account details.');
  }
}

// ── GET /api/user/notifications/preferences ──────────────────────────────────
async function getNotificationPreferences(req, res) {
  try {
    const userId = req.user.id;
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const existingMeta = authData?.user?.user_metadata || {};
    const defaultPrefs = {
      escrowAlerts: true,
      priceAlerts: true,
      securityAlerts: true,
      marketing: false,
    };
    const preferences = {
      ...defaultPrefs,
      ...(existingMeta.notification_preferences || {}),
    };
    return res.status(200).json({
      success: true,
      preferences,
    });
  } catch (err) {
    console.error('getNotificationPreferences error:', err);
    return sendError(res, 500, 'Failed to fetch notification preferences.');
  }
}

// ── PUT /api/user/notifications/preferences ──────────────────────────────────
async function updateNotificationPreferences(req, res) {
  try {
    const userId = req.user.id;
    const inputPrefs = req.body.preferences || req.body || {};
    const defaultPrefs = {
      escrowAlerts: true,
      priceAlerts: true,
      securityAlerts: true,
      marketing: false,
    };
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const existingMeta = authData?.user?.user_metadata || {};
    const updatedPreferences = {
      ...defaultPrefs,
      ...(existingMeta.notification_preferences || {}),
      ...(inputPrefs.escrowAlerts !== undefined ? { escrowAlerts: Boolean(inputPrefs.escrowAlerts) } : {}),
      ...(inputPrefs.priceAlerts !== undefined ? { priceAlerts: Boolean(inputPrefs.priceAlerts) } : {}),
      ...(inputPrefs.securityAlerts !== undefined ? { securityAlerts: Boolean(inputPrefs.securityAlerts) } : {}),
      ...(inputPrefs.marketing !== undefined ? { marketing: Boolean(inputPrefs.marketing) } : {}),
    };

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...existingMeta,
        notification_preferences: updatedPreferences,
      },
    });

    if (updateError) {
      return sendError(res, 400, updateError.message || 'Could not update notification preferences.');
    }

    return res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully.',
      preferences: updatedPreferences,
    });
  } catch (err) {
    console.error('updateNotificationPreferences error:', err);
    return sendError(res, 500, 'Failed to update notification preferences.');
  }
}

module.exports = {
  submitKyc,
  getKycStatus,
  uploadVerificationDocument,
  getVerificationStatus,
  submitBankAccount,
  getBankAccount,
  getVault,
  addHolding,
  seedStarterHoldings,
  getProfile,
  updateProfile,
  deleteAccount,
  deposit,
  withdraw,
  cancelWithdrawal,
  getTransactions,
  lodgeSupport,
  getSupportTickets,
  getAnalytics,
  getNotificationPreferences,
  updateNotificationPreferences,
};
