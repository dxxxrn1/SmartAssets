// ─── Auth Controller ─────────────────────────────────────────────────────────
// Handles user registration, login, and MetaMask Web3 wallet authentication via Supabase.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

// Deterministic password generator for Web3 wallet accounts in Supabase
function getDeterministicPassword(walletAddress) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'smartassets-web3-salt';
  return crypto.createHmac('sha256', secret).update(walletAddress.toLowerCase()).digest('hex').substring(0, 24) + 'Aa1!';
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
async function register(req, res) {
  try {
    const { email, password, fullName } = req.body;

    // ── Validate required fields ──
    if (!email || !password || !fullName) {
      return sendError(res, 400, 'Please provide email, password, and fullName.');
    }
    if (password.length < 6) {
      return sendError(res, 400, 'Password must be at least 6 characters.');
    }

    const cleanEmail = email.trim().toLowerCase();

    // ── Create the user in Supabase Auth ──
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true, // Auto-confirm so user can sign in immediately
      user_metadata: { full_name: fullName.trim() },
    });

    if (authError) {
      const isDuplicate = authError.message.toLowerCase().includes('already') ||
                          authError.message.toLowerCase().includes('exists');
      const status = isDuplicate ? 409 : 400;
      return sendError(res, status, authError.message);
    }

    // ── Upsert row into the profiles table ──
    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          full_name: fullName.trim(),
          email: cleanEmail,
        }, { onConflict: 'id' });

      if (profileError) {
        console.warn('Profile table sync warning:', profileError.message);
      }
    } catch (err) {
      console.warn('Profile sync exception:', err.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: fullName.trim(),
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return sendError(res, 500, 'Internal server error. Please try again.');
  }
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // ── Validate required fields ──
    if (!email || !password) {
      return sendError(res, 400, 'Please provide email and password.');
    }

    const cleanEmail = email.trim().toLowerCase();

    // ── Sign in via Supabase Auth ──
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      return sendError(res, 401, 'Invalid email or password.');
    }

    // ── Fetch the user's profile (fallback to user_metadata) ──
    let fullName = data.user.user_metadata?.full_name || '';
    let walletAddress = data.user.user_metadata?.wallet_address || null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, wallet_address')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profile?.full_name) {
        fullName = profile.full_name;
      }
      if (profile?.wallet_address) {
        walletAddress = profile.wallet_address;
      }
    } catch (profileFetchErr) {
      console.warn('Profile fetch warning (using metadata):', profileFetchErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful!',
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName,
        walletAddress,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return sendError(res, 500, 'Internal server error. Please try again.');
  }
}

// ── POST /api/auth/wallet-login ──────────────────────────────────────────────
// Authenticates or provisions a Supabase user via MetaMask wallet address.
async function walletLogin(req, res) {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress || typeof walletAddress !== 'string') {
      return sendError(res, 400, 'Please provide a valid wallet address.');
    }

    const cleanAddress = walletAddress.trim().toLowerCase();

    // Basic Ethereum address format validation (0x followed by 40 hex chars)
    if (!/^0x[a-f0-9]{40}$/i.test(cleanAddress)) {
      return sendError(res, 400, 'Invalid Ethereum wallet address format.');
    }

    const deterministicEmail = `${cleanAddress}@metamask.smartassets.io`;
    const deterministicPassword = getDeterministicPassword(cleanAddress);
    const shortAddress = `${cleanAddress.slice(0, 6)}...${cleanAddress.slice(-4)}`;
    const displayName = `MetaMask (${shortAddress})`;

    // 1. Try to sign in first
    let authResult = await supabase.auth.signInWithPassword({
      email: deterministicEmail,
      password: deterministicPassword,
    });

    // 2. If user does not exist, provision a new user in Supabase
    if (authResult.error) {
      const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
        email: deterministicEmail,
        password: deterministicPassword,
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          wallet_address: cleanAddress,
          is_web3: true,
        },
      });

      if (createError) {
        console.error('Error creating Web3 user:', createError);
        return sendError(res, 500, `Could not register Web3 wallet: ${createError.message}`);
      }

      // Sync into profiles table
      try {
        await supabase
          .from('profiles')
          .upsert({
            id: createdUser.user.id,
            full_name: displayName,
            email: deterministicEmail,
            wallet_address: cleanAddress,
          }, { onConflict: 'id' });
      } catch (profErr) {
        console.warn('Profile upsert warning for wallet:', profErr.message);
      }

      // Now sign in to obtain tokens
      authResult = await supabase.auth.signInWithPassword({
        email: deterministicEmail,
        password: deterministicPassword,
      });

      if (authResult.error) {
        return sendError(res, 500, 'Failed to establish session for wallet.');
      }
    }

    const { data: sessionData } = authResult;

    return res.status(200).json({
      success: true,
      message: 'MetaMask wallet connected successfully!',
      user: {
        id: sessionData.user.id,
        email: deterministicEmail,
        fullName: displayName,
        walletAddress: cleanAddress,
        isWeb3: true,
      },
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_at: sessionData.session.expires_at,
      },
    });
  } catch (err) {
    console.error('walletLogin error:', err);
    return sendError(res, 500, 'Internal wallet authentication error.');
  }
}

module.exports = { register, login, walletLogin };
