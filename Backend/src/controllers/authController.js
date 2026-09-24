// ─── Auth Controller ─────────────────────────────────────────────────────────
// Handles user registration, login, and MetaMask Web3 wallet authentication via Supabase.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');

// Deterministic password generator for Web3 wallet accounts in Supabase
function getDeterministicPassword(walletAddress) {
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'smartassets-web3-salt';

  return (
    crypto
      .createHmac('sha256', secret)
      .update(walletAddress.toLowerCase())
      .digest('hex')
      .substring(0, 24) + 'Aa1!'
  );
}

// Only allow redirect targets we control, so nobody can abuse this endpoint
// to send Supabase reset emails that redirect to an arbitrary site.
const ALLOWED_RESET_REDIRECTS = [
  'smartassets://reset-password',
  'http://localhost:3000',
  'http://localhost:8081',
];

function isAllowedRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  return ALLOWED_RESET_REDIRECTS.some(
    (allowed) => url === allowed || url.startsWith(allowed)
  );
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
async function register(req, res) {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return sendError(
        res,
        400,
        'Please provide email, password, and fullName.'
      );
    }

    if (password.length < 6) {
      return sendError(
        res,
        400,
        'Password must be at least 6 characters.'
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    const {
      data: authData,
      error: authError,
    } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
      },
    });

    if (authError) {
      const isDuplicate =
        authError.message.toLowerCase().includes('already') ||
        authError.message.toLowerCase().includes('exists');

      const status = isDuplicate ? 409 : 400;

      return sendError(res, status, authError.message);
    }

    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: authData.user.id,
            full_name: fullName.trim(),
            email: cleanEmail,
          },
          { onConflict: 'id' }
        );

      if (profileError) {
        console.warn(
          'Profile table sync warning:',
          profileError.message
        );
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

    return sendError(
      res,
      500,
      'Internal server error. Please try again.'
    );
  }
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(
        res,
        400,
        'Please provide email and password.'
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

    if (error) {
      return sendError(
        res,
        401,
        'Invalid email or password.'
      );
    }

    let fullName =
      data.user.user_metadata?.full_name || '';

    let walletAddress =
      data.user.user_metadata?.wallet_address || null;

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
      console.warn(
        'Profile fetch warning (using metadata):',
        profileFetchErr.message
      );
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

    return sendError(
      res,
      500,
      'Internal server error. Please try again.'
    );
  }
}

// ── POST /api/auth/wallet-login ──────────────────────────────────────────────
async function walletLogin(req, res) {
  try {
    const { walletAddress } = req.body;

    if (
      !walletAddress ||
      typeof walletAddress !== 'string'
    ) {
      return sendError(
        res,
        400,
        'Please provide a valid wallet address.'
      );
    }

    const cleanAddress = walletAddress.trim().toLowerCase();

    if (!/^0x[a-f0-9]{40}$/i.test(cleanAddress)) {
      return sendError(
        res,
        400,
        'Invalid Ethereum wallet address format.'
      );
    }

    const deterministicEmail =
      `${cleanAddress}@metamask.smartassets.io`;

    const deterministicPassword =
      getDeterministicPassword(cleanAddress);

    const shortAddress =
      `${cleanAddress.slice(0, 6)}...${cleanAddress.slice(-4)}`;

    const displayName =
      `MetaMask (${shortAddress})`;

    let authResult =
      await supabase.auth.signInWithPassword({
        email: deterministicEmail,
        password: deterministicPassword,
      });

    if (authResult.error) {
      const {
        data: createdUser,
        error: createError,
      } = await supabase.auth.admin.createUser({
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
        console.error(
          'Error creating Web3 user:',
          createError
        );

        return sendError(
          res,
          500,
          `Could not register Web3 wallet: ${createError.message}`
        );
      }

      try {
        await supabase
          .from('profiles')
          .upsert(
            {
              id: createdUser.user.id,
              full_name: displayName,
              email: deterministicEmail,
              wallet_address: cleanAddress,
            },
            { onConflict: 'id' }
          );
      } catch (profErr) {
        console.warn(
          'Profile upsert warning for wallet:',
          profErr.message
        );
      }

      authResult =
        await supabase.auth.signInWithPassword({
          email: deterministicEmail,
          password: deterministicPassword,
        });

      if (authResult.error) {
        return sendError(
          res,
          500,
          'Failed to establish session for wallet.'
        );
      }
    }

    const { data: sessionData } = authResult;

    return res.status(200).json({
      success: true,
      message:
        'MetaMask wallet connected successfully!',
      user: {
        id: sessionData.user.id,
        email: deterministicEmail,
        fullName: displayName,
        walletAddress: cleanAddress,
        isWeb3: true,
      },
      session: {
        access_token:
          sessionData.session.access_token,
        refresh_token:
          sessionData.session.refresh_token,
        expires_at:
          sessionData.session.expires_at,
      },
    });
  } catch (err) {
    console.error('walletLogin error:', err);

    return sendError(
      res,
      500,
      'Internal wallet authentication error.'
    );
  }
}

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
async function forgotPassword(req, res) {
  try {
    const { email, redirectTo } = req.body || {};

    if (!email || typeof email !== 'string') {
      return sendError(res, 400, 'Please provide an email address.');
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      return sendError(res, 400, 'Please provide an email address.');
    }

    const finalRedirect = isAllowedRedirect(redirectTo)
      ? redirectTo
      : process.env.PASSWORD_RESET_REDIRECT_URL;

    const { error } = await supabase.auth.resetPasswordForEmail(
      cleanEmail,
      {
        redirectTo: finalRedirect,
      }
    );

    if (error) {
      console.error('SUPABASE RESET ERROR:', error);

      return sendError(
        res,
        500,
        error.message || 'Could not send the password reset email.'
      );
    }

    return res.status(200).json({
      success: true,
      message:
        'If an account exists for that email, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err);

    return sendError(
      res,
      500,
      'Internal server error. Please try again.'
    );
  }
}

// ── POST /api/auth/reset-password ────────────────────────────────────────────
// Takes the access_token that Supabase attached to the reset link, verifies it,
// and sets the new password for that user via the Supabase admin API.
async function resetPassword(req, res) {
  try {
    const { accessToken, newPassword } = req.body || {};

    if (!accessToken || typeof accessToken !== 'string') {
      return sendError(
        res,
        400,
        'This reset link is invalid or has expired. Please request a new one.'
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return sendError(
        res,
        400,
        'Password must be at least 6 characters.'
      );
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      console.error('RESET PASSWORD TOKEN ERROR:', userError);

      return sendError(
        res,
        401,
        'This reset link is invalid or has expired. Please request a new one.'
      );
    }

    const { error: updateError } =
      await supabase.auth.admin.updateUserById(userData.user.id, {
        password: newPassword,
      });

    if (updateError) {
      console.error('RESET PASSWORD UPDATE ERROR:', updateError);

      return sendError(
        res,
        500,
        updateError.message || 'Could not update your password.'
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully!',
    });
  } catch (err) {
    console.error('RESET PASSWORD ERROR:', err);

    return sendError(
      res,
      500,
      'Internal server error. Please try again.'
    );
  }
}

module.exports = {
  register,
  login,
  walletLogin,
  forgotPassword,
  resetPassword,
};