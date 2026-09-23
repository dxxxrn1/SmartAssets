// ─── User Data Controller ───────────────────────────────────────────────────
// Manages strictly user-isolated portfolio and vault holdings.

const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const avatarService = require('../services/avatarService');

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

    const items = holdings || [];
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
    const transactions = vaultTxService.getUserTransactions(userId);

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
        gainText: '+12.4% YTD',
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
    const { name, category, price, priceNum, gain, gainPct, positive, image, assetType } = req.body;

    if (!name || !category || priceNum === undefined) {
      return sendError(res, 400, 'Please provide asset name, category, and price.');
    }

    const { data, error } = await supabase
      .from('user_holdings')
      .insert({
        user_id: userId,
        name: name.trim(),
        category: category.trim(),
        price: price || `R${Number(priceNum).toLocaleString('en-ZA')}`,
        price_num: Number(priceNum),
        gain: gain || '+0.0%',
        gain_pct: gainPct || '0%',
        positive: positive !== undefined ? positive : true,
        image: image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
        asset_type: assetType || 'whole',
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
      holding: data,
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
// Withdraws funds from user's vault balance
async function withdraw(req, res) {
  try {
    const userId = req.user.id;
    const { amount, method, bankDetails, walletAddress, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      return sendError(res, 400, 'Please enter a valid withdrawal amount greater than R0.');
    }

    const vaultTxService = require('../services/vaultTransactionService');
    const result = await vaultTxService.withdrawFunds({
      userId,
      amount: Number(amount),
      method,
      bankDetails,
      walletAddress,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully processed withdrawal of ${vaultTxService.formatZar(amount)}!`,
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
    const transactions = vaultTxService.getUserTransactions(userId);
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

module.exports = {
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
};


