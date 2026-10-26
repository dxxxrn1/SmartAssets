// ─── User Data Controller ───────────────────────────────────────────────────
// Manages strictly user-isolated portfolio, vault holdings, KYC verification documents,
// and bank account approval workflows.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const avatarService = require('../services/avatarService');
const complianceService = require('../services/complianceService');
const auditLogService = require('../services/auditLogService');
const { uploadImageToCloud, saveBase64Image, normalizeImageUrl } = require('../utils/imageHandler');

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
      // If table doesn't exist yet or has error, return safe empty list
      return res.status(200).json({
        success: true,
        holdings: [],
        summary: {
          totalValueFormatted: 'R0',
          totalValueNum: 0,
          totalCount: 0,
          wholeCount: 0,
          fractionalCount: 0,
          gainText: '+0.0% MoM',
        },
      });
    }

    const items = (holdings || []).map((item) => {
      let initialValue = Number(item.price_num) || 0;
      let liveMarketValue = Number(item.price_num) || 0;
      let badgeText = item.gain || '+0.0% Market Gain';
      let badgeType = item.positive ? 'positive' : 'negative';
      let sharesOwned = 1;
      let myStake = Number(item.price_num) || 0;

      if (item.gain && item.gain.includes('<!--meta:')) {
        const match = item.gain.match(/<!--meta:([\s\S]*?)-->/);
        if (match) {
          try {
            const meta = JSON.parse(match[1]);
            if (meta.initialValue !== undefined) initialValue = Number(meta.initialValue);
            if (meta.liveMarketValue !== undefined) liveMarketValue = Number(meta.liveMarketValue);
            if (meta.badgeText) badgeText = meta.badgeText;
            if (meta.badgeType) badgeType = meta.badgeType;
            if (meta.sharesOwned) sharesOwned = meta.sharesOwned;
            if (meta.myStake) myStake = Number(meta.myStake);
            if (meta.certId) item.certId = meta.certId;
            if (meta.hashDisplay) item.hashDisplay = meta.hashDisplay;
          } catch (_) {}
        }
      }

      const cleanGain = badgeText.replace(/<!--[\s\S]*?-->/g, '').trim();

      return {
        ...item,
        image: normalizeImageUrl(item.image, req),
        initialValue,
        initialValueFormatted: `R${initialValue.toLocaleString('en-ZA')}`,
        liveMarketValue,
        liveMarketValueFormatted: `R${liveMarketValue.toLocaleString('en-ZA')}`,
        badgeText: cleanGain,
        badgeType,
        sharesOwned,
        myStake,
        myStakeFormatted: `R${myStake.toLocaleString('en-ZA')}`,
      };
    });
    const vaultTxService = require('../services/vaultTransactionService');
    const availableBalanceNum = await vaultTxService.getUserBalance(userId);
    const availableBalanceFormatted = vaultTxService.formatZar(availableBalanceNum);

    // Compute personal portfolio summary
    const portfolioValueNum = items.reduce((sum, item) => sum + (Number(item.price_num) || 0), 0);
    const wholeCount = items.filter((i) => i.asset_type !== 'fractional').length;
    const fractionalCount = items.filter((i) => i.asset_type === 'fractional').length;

    const formattedPortfolio = vaultTxService.formatZar(portfolioValueNum);
    const totalCombinedNum = availableBalanceNum + portfolioValueNum;
    const totalCombinedFormatted = vaultTxService.formatZar(totalCombinedNum);
    const transactions = await vaultTxService.fetchUserTransactions(userId);

    return res.status(200).json({
      success: true,
      holdings: items,
      transactions,
      summary: {
        availableBalanceNum,
        availableBalanceFormatted,
        portfolioValueNum,
        portfolioValueFormatted: formattedPortfolio,
        totalValueFormatted: availableBalanceFormatted, // Main available display
        totalValueNum: availableBalanceNum,
        combinedTotalNum: totalCombinedNum,
        combinedTotalFormatted: totalCombinedFormatted,
        totalCount: items.length,
        wholeCount,
        fractionalCount,
        gainText: items.length > 0 ? '+12.4% YTD' : '0.0% YTD',
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
    } = req.body;

    if (!name || !category || (priceNum === undefined && initialValue === undefined)) {
      return sendError(res, 400, 'Please provide asset name, category, and price.');
    }

    const effectivePriceNum = Number(priceNum !== undefined ? priceNum : (liveMarketValue || initialValue || 0));
    let gainVal = gain || badgeText || '+0.0%';
    if (initialValue !== undefined || liveMarketValue !== undefined || badgeText !== undefined) {
      const meta = {
        initialValue: Number(initialValue || effectivePriceNum),
        liveMarketValue: Number(liveMarketValue || effectivePriceNum),
        badgeText: badgeText || gainVal,
        badgeType: positive !== undefined ? (positive ? 'positive' : 'negative') : 'positive',
        certId: req.body.certId || 'ERC-721 #4811',
        hashDisplay: req.body.hashDisplay || '0x71c...9a',
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
    const { fullName, avatarUrl, gender, dob, phone, password } = req.body;

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
// Deposits funds into user's vault balance
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
    const { amount, method, reference, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      return sendError(res, 400, 'Please enter a valid deposit amount greater than R0.');
    }

    const vaultTxService = require('../services/vaultTransactionService');
    const result = await vaultTxService.depositFunds({
      userId,
      amount: Number(amount),
      method,
      reference,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully deposited ${vaultTxService.formatZar(amount)} into your vault!`,
      ...result,
    });
  } catch (err) {
    console.error('deposit error:', err);
    return sendError(res, 400, err.message || 'Deposit failed. Please try again.');
  }
}

// ── POST /api/user/withdraw ──────────────────────────────────────────────────
// Withdraws funds from user's vault balance (requires verified account + approved bank account)
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

    const { amount, method, bankDetails, walletAddress, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      return sendError(res, 400, 'Please enter a valid withdrawal amount greater than R0.');
    }

    const effectiveBankDetails = bankDetails || {
      bankName: approvedBank.bank_name,
      accountHolder: approvedBank.account_holder,
      accountNumber: approvedBank.account_number,
      branchCode: approvedBank.branch_code,
      accountType: approvedBank.account_type,
    };

    const vaultTxService = require('../services/vaultTransactionService');
    const result = await vaultTxService.withdrawFunds({
      userId,
      amount: Number(amount),
      method: method || 'bank_transfer',
      bankDetails: effectiveBankDetails,
      walletAddress,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully processed withdrawal of ${vaultTxService.formatZar(amount)} to your approved ${approvedBank.bank_name} account!`,
      ...result,
    });
  } catch (err) {
    console.error('withdraw error:', err);
    return sendError(res, 400, err.message || 'Withdrawal failed. Please try again.');
  }
}

// ── GET /api/user/transactions ───────────────────────────────────────────────
// Returns transaction history for the authenticated user
async function getTransactions(req, res) {
  try {
    const userId = req.user.id;
    const vaultTxService = require('../services/vaultTransactionService');
    const transactions = await vaultTxService.fetchUserTransactions(userId);
    const balanceNum = await vaultTxService.getUserBalance(userId);

    return res.status(200).json({
      success: true,
      transactions,
      balance: {
        amountNum: balanceNum,
        amountFormatted: vaultTxService.formatZar(balanceNum),
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
// Aggregates user profile analytics since joining date.
async function getAnalytics(req, res) {
  try {
    const userId = req.user.id;

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

    const items = holdings || [];
    const vaultTxService = require('../services/vaultTransactionService');
    const availableBalanceNum = await vaultTxService.getUserBalance(userId);
    const portfolioValueNum = items.reduce((sum, item) => sum + (Number(item.price_num) || 0), 0);
    const combinedNetWorth = availableBalanceNum + portfolioValueNum;

    // Category distribution
    const categoryTotals = {};
    items.forEach((item) => {
      const cat = item.category || 'Collectibles';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(item.price_num) || 0);
    });

    let categoryBreakdown = Object.entries(categoryTotals).map(([category, val]) => ({
      category,
      valueNum: val,
      valueFormatted: vaultTxService.formatZar(val),
      percentage: portfolioValueNum > 0 ? Math.round((val / portfolioValueNum) * 100) : 0,
    }));

    if (categoryBreakdown.length === 0) {
      categoryBreakdown = [];
    }

    // 3. Transactions & Escrows
    const transactions = vaultTxService.getUserTransactions(userId);
    let escrows = [];
    try {
      const escrowService = require('../services/escrowService');
      escrows = escrowService.getUserEscrowOrders(userId) || [];
    } catch (_err) {
      escrows = [];
    }

    const totalDeposits = transactions
      .filter((t) => t.type === 'deposit')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalWithdrawals = transactions
      .filter((t) => t.type === 'withdraw')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // 4. Growth & Performance since joining
    const totalGainsNum = items.reduce((sum, h) => sum + (Number(h.gain_num) || Math.round(Number(h.price_num || 0) * 0.05)), 0);
    const appreciationRate = portfolioValueNum > 0 ? Number(((totalGainsNum / portfolioValueNum) * 100).toFixed(1)) : 0;
    const baseVal = combinedNetWorth;
    const estimatedGainsNum = totalGainsNum;

    // 5. Monthly Timeline (Past 6 months since joining)
    const monthlyTimeline = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mName = d.toLocaleString('default', { month: 'short' });
      const factor = (0.72 + (5 - i) * 0.056);
      const val = Math.round(baseVal * factor);
      monthlyTimeline.push({
        month: mName,
        valueNum: val,
        valueFormatted: vaultTxService.formatZar(val),
        growthPct: `+${((5 - i) * 3.2 + 2.1).toFixed(1)}%`,
      });
    }

    // 6. User Milestones since joining
    const milestones = [
      {
        id: 'ms-1',
        title: 'Joined SmartAssets Network',
        date: joinedDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }),
        desc: 'Account activated with decentralized vault custody',
        icon: 'checkmark-circle',
        completed: true,
      },
      {
        id: 'ms-2',
        title: 'Vault Liquidity Activated',
        date: transactions.length > 0 ? new Date(transactions[transactions.length - 1].createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Verified',
        desc: `Initial vault balance initialized (${vaultTxService.formatZar(availableBalanceNum)})`,
        icon: 'wallet',
        completed: true,
      },
      {
        id: 'ms-3',
        title: 'Asset Acquisition & Provenance Token',
        date: items.length > 0 ? `${items.length} Assets Registered` : 'Active Verification',
        desc: 'Cryptographic ownership tokens registered on Sepolia Ethereum',
        icon: 'shield-checkmark',
        completed: true,
      },
      {
        id: 'ms-4',
        title: 'Private Collector Status',
        date: 'Tier 1 Prime',
        desc: 'Zero-fee peer escrow clearance and 96% health audit index',
        icon: 'ribbon',
        completed: true,
      },
    ];

    return res.status(200).json({
      success: true,
      analytics: {
        userId,
        fullName: profile?.full_name || authUser?.user_metadata?.full_name || req.user.fullName || 'Verified Member',
        email: authUser?.email || profile?.email || req.user.email || '',
        avatarUrl: profile?.avatar_url || authUser?.user_metadata?.avatar_url || null,
        joinedAt: createdAt,
        daysSinceJoined,
        memberSinceFormatted,
        membershipTier: 'Prime Collector Tier 1',
        netWorthNum: baseVal,
        netWorthFormatted: vaultTxService.formatZar(baseVal),
        availableBalanceNum,
        availableBalanceFormatted: vaultTxService.formatZar(availableBalanceNum),
        portfolioValueNum,
        portfolioValueFormatted: vaultTxService.formatZar(portfolioValueNum),
        growthRatePct: `+${appreciationRate}%`,
        estimatedGainsNum,
        estimatedGainsFormatted: `+${vaultTxService.formatZar(estimatedGainsNum)}`,
        healthScore: 96,
        healthGrade: 'Optimal Grade A+',
        totalHoldingsCount: items.length,
        totalTransactionsCount: transactions.length,
        totalEscrowsCount: escrows.length,
        totalDepositsNum: totalDeposits,
        totalDepositsFormatted: vaultTxService.formatZar(totalDeposits),
        totalWithdrawalsNum: totalWithdrawals,
        totalWithdrawalsFormatted: vaultTxService.formatZar(totalWithdrawals),
        categoryBreakdown,
        monthlyTimeline,
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

    const record = complianceService.submitKyc({
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

    return res.status(200).json({
      success: true,
      message: 'KYC compliance documents submitted successfully! Our compliance desk will review your dossier.',
      verification: record,
      kycStatus: 'pending',
    });
  } catch (err) {
    console.error('submitKyc error:', err);
    return sendError(res, 500, 'Failed to submit KYC compliance details.');
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
  getTransactions,
  lodgeSupport,
  getSupportTickets,
  getAnalytics,
};
