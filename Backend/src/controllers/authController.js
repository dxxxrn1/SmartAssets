// ─── SmartAssets Auth Controller ─────────────────────────────────────────────
// Handles user registration, login, MetaMask Web3 wallet authentication,
// token revocation, session timeouts, and audit logging via Supabase and SmartAssets Compliance Guard.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const avatarService = require('../services/avatarService');
const complianceService = require('../services/complianceService');
const auditLogService = require('../services/auditLogService');
const { revokeToken } = require('../middlewares/authMiddleware');
const {
  createNonceChallenge,
  verifyWalletSignature,
  generateSessionForUser,
  createWalletVerificationToken,
  verifyWalletVerificationToken,
} = require('../services/walletAuthService');

// Deterministic password generator for Web3 wallet accounts in Supabase
function getDeterministicPassword(walletAddress) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'smartassets-web3-salt';
  return (
    crypto
      .createHmac('sha256', secret)
      .update(walletAddress.toLowerCase())
      .digest('hex')
      .substring(0, 24) + 'Aa1!'
  );
}

// Allowed redirect targets for password resets
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
      return sendError(res, 400, 'Please provide email, password, and fullName.');
    }

    if (password.length < 6) {
      return sendError(res, 400, 'Password must be at least 6 characters.');
    }

    const cleanEmail = email.trim().toLowerCase();

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
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
        console.warn('Profile table sync warning:', profileError.message);
      }
    } catch (err) {
      console.warn('Profile sync exception:', err.message);
    }

    // Initialize user compliance profile
    const compliance = complianceService.getUserCompliance(authData.user.id, cleanEmail);

    // Audit log
    auditLogService.logEvent({
      eventType: 'REGISTER',
      category: 'Authentication',
      actorEmail: cleanEmail,
      actorId: authData.user.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'New user registered account. Awaiting FICA / KYC onboarding.',
      status: 'Success',
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully! Please complete FICA / KYC verification.',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: fullName.trim(),
        kycStatus: compliance.kycStatus || 'unverified',
        accountStatus: compliance.accountStatus || 'active',
        isSuspended: false,
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

    if (!email || !password) {
      return sendError(res, 400, 'Please provide email and password.');
    }

    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      auditLogService.logEvent({
        eventType: 'LOGIN_FAILED',
        category: 'Authentication',
        actorEmail: cleanEmail,
        actorId: 'unknown',
        ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
        device: req.headers['user-agent'] || 'SmartAssets Client',
        description: `Failed login attempt for ${cleanEmail}: ${error.message}`,
        status: 'Failed',
      });
      return sendError(res, 401, 'Invalid email or password.');
    }

    // ── Check Compliance Suspension Lock ──
    const compliance = complianceService.getUserCompliance(data.user.id, data.user.email);
    if (compliance && compliance.isSuspended) {
      auditLogService.logEvent({
        eventType: 'LOGIN_BLOCKED',
        category: 'Security',
        actorEmail: cleanEmail,
        actorId: data.user.id,
        ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
        device: req.headers['user-agent'] || 'SmartAssets Client',
        description: 'Login rejected: Account Suspended by Compliance.',
        status: 'Blocked',
      });
      return sendError(res, 403, 'Account Suspended by Compliance. Please contact support.');
    }

    // Record successful login audit
    auditLogService.logEvent({
      eventType: 'LOGIN',
      category: 'Authentication',
      actorEmail: data.user.email,
      actorId: data.user.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Mobile App',
      description: 'Successful user authentication via password.',
      status: 'Success',
    });

    // ── Fetch the user's profile (including avatar) ──
    let fullName = data.user.user_metadata?.full_name || '';
    let walletAddress = data.user.user_metadata?.wallet_address || null;
    let avatarUrl = data.user.user_metadata?.avatar_url || null;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, wallet_address, avatar_url')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profile?.full_name) {
        fullName = profile.full_name;
      }
      if (profile?.wallet_address) {
        walletAddress = profile.wallet_address;
      }
      if (profile?.avatar_url) {
        avatarUrl = profile.avatar_url;
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
        avatarUrl,
        avatar_url: avatarUrl,
        kycStatus: compliance.kycStatus || (walletAddress ? 'verified' : 'unverified'),
        accountStatus: compliance.accountStatus || 'active',
        isSuspended: compliance.isSuspended || false,
        bankingDetails: compliance.bankingDetails || null,
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

// ── POST /api/auth/wallet/nonce ──────────────────────────────────────────────
// Generates a cryptographically random, single-use 5-minute challenge nonce for a wallet.
async function getWalletNonce(req, res) {
  try {
    const walletAddress = req.body?.walletAddress || req.query?.walletAddress;

    if (!walletAddress || typeof walletAddress !== 'string') {
      return sendError(res, 400, 'Please provide a valid Ethereum wallet address.');
    }

    const cleanAddress = walletAddress.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(cleanAddress)) {
      return sendError(res, 400, 'Invalid Ethereum wallet address format (must be 0x followed by 40 hex chars).');
    }

    const challenge = await createNonceChallenge(cleanAddress);

    return res.status(200).json({
      success: true,
      walletAddress: cleanAddress,
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
    });
  } catch (err) {
    console.error('getWalletNonce error:', err);
    return sendError(res, 500, 'Failed to generate wallet verification challenge.');
  }
}

// ── POST /api/auth/wallet/link ───────────────────────────────────────────────
// Links a verified MetaMask wallet to the CURRENT logged-in user's profile.
// Verifies the user actually owns the wallet via personal_sign.
async function linkWallet(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, 'Unauthorized: Please log in to link your wallet.');
    }

    const { walletAddress, signature, nonce } = req.body || {};

    if (!walletAddress || !signature || !nonce) {
      return sendError(res, 400, 'Wallet address, signature, and challenge nonce are required.');
    }

    const cleanAddress = walletAddress.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(cleanAddress)) {
      return sendError(res, 400, 'Invalid Ethereum wallet address format.');
    }

    // 1. Verify cryptographic signature
    const verification = await verifyWalletSignature(cleanAddress, signature, nonce);
    if (!verification.valid) {
      return sendError(res, 400, verification.error || 'Cryptographic signature verification failed.');
    }

    // 2. Check if this wallet is already linked to another account
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('wallet_address', cleanAddress)
      .maybeSingle();

    if (existingUser && existingUser.id !== userId) {
      return sendError(
        res,
        409,
        `This wallet address is already linked to another account (${existingUser.email ? existingUser.email.slice(0, 3) + '***' : 'different user'}). Each wallet can only be linked to one account.`,
        'WALLET_ALREADY_LINKED'
      );
    }

    // 3. Link wallet to the current user's profile
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ wallet_address: cleanAddress })
      .eq('id', userId);

    if (profileError) {
      console.error('Profile wallet link update error:', profileError);
      return sendError(res, 500, 'Could not save linked wallet to your profile.');
    }

    // Update Supabase auth user_metadata
    try {
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...(req.user.user_metadata || {}),
          wallet_address: cleanAddress,
        },
      });
    } catch (metaErr) {
      console.warn('Metadata wallet update warning:', metaErr.message);
    }

    // Retrieve fresh real profile
    const { data: freshProfile } = await supabase
      .from('profiles')
      .select('id, full_name, email, wallet_address, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    // Check compliance status
    const compliance = complianceService.getUserCompliance(userId, freshProfile?.email || req.user.email);

    auditLogService.logEvent({
      eventType: 'WALLET_LINKED',
      category: 'Web3',
      actorEmail: freshProfile?.email || req.user.email,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: `MetaMask wallet ${cleanAddress} linked to user profile.`,
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      message: 'MetaMask wallet linked successfully to your account!',
      user: {
        id: userId,
        email: freshProfile?.email || req.user.email,
        fullName: freshProfile?.full_name || req.user.user_metadata?.full_name || '',
        walletAddress: cleanAddress,
        avatarUrl: freshProfile?.avatar_url || req.user.user_metadata?.avatar_url || null,
        avatar_url: freshProfile?.avatar_url || req.user.user_metadata?.avatar_url || null,
        kycStatus: compliance?.kycStatus || 'verified',
        accountStatus: compliance?.accountStatus || 'active',
        isSuspended: compliance?.isSuspended || false,
        bankingDetails: compliance?.bankingDetails || null,
      },
    });
  } catch (err) {
    console.error('linkWallet error:', err);
    return sendError(res, 500, 'Internal error linking wallet.');
  }
}

// ── POST /api/auth/wallet/login (and /api/auth/wallet-login) ──────────────────
// Logs into an existing account via linked wallet signature.
// If wallet is NOT linked, refuses to create a dummy user and returns needsAccount: true.
async function walletLogin(req, res) {
  try {
    const { walletAddress, signature, nonce } = req.body || {};

    if (!walletAddress) {
      return sendError(res, 400, 'Please provide a valid Ethereum wallet address.');
    }

    const cleanAddress = walletAddress.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(cleanAddress)) {
      return sendError(res, 400, 'Invalid Ethereum wallet address format.');
    }

    // If client supplied signature & nonce, verify cryptographically
    if (signature && nonce) {
      const verification = await verifyWalletSignature(cleanAddress, signature, nonce);
      if (!verification.valid) {
        return sendError(res, 400, verification.error || 'Cryptographic signature verification failed.');
      }
    }

    // 1. Check if this wallet is linked to ANY real user account
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, email, wallet_address, avatar_url')
      .eq('wallet_address', cleanAddress)
      .maybeSingle();

    // 2. If NOT linked to an existing account: DO NOT CREATE A DUMMY USER!
    if (!profile || profile.email?.includes('@metamask.smartassets.io') || profile.full_name?.startsWith('MetaMask (0x')) {
      const verificationToken = createWalletVerificationToken(cleanAddress);
      return res.status(200).json({
        success: true,
        needsProfile: true,
        needsAccount: true,
        walletAddress: cleanAddress,
        verificationToken,
        message: 'Wallet verified! Please complete your profile with your real name and email to finish registering.',
      });
    }

    // Check Compliance Suspension Lock
    const compliance = complianceService.getUserCompliance(profile.id, profile.email);
    if (compliance && compliance.isSuspended) {
      auditLogService.logEvent({
        eventType: 'LOGIN_BLOCKED',
        category: 'Security',
        actorEmail: profile.email,
        actorId: profile.id,
        ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
        device: req.headers['user-agent'] || 'SmartAssets Web3 / MetaMask',
        description: 'Login rejected: Account Suspended by Compliance.',
        status: 'Blocked',
      });
      return sendError(res, 403, 'Account Suspended by Compliance. Please contact support.');
    }

    // 3. User IS linked! Generate authentic session for their real account
    let session = null;
    try {
      session = await generateSessionForUser(profile.email);
    } catch (sessionErr) {
      console.warn('generateSessionForUser fallback:', sessionErr.message);
      const tempPass = getDeterministicPassword(cleanAddress);
      const resAttempt = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: tempPass,
      });
      if (resAttempt.data?.session) {
        session = resAttempt.data.session;
      }
    }

    if (!session?.access_token) {
      return sendError(
        res,
        500,
        'Could not establish session for your linked account. Please sign in with your email and password.'
      );
    }

    // Record audit event
    auditLogService.logEvent({
      eventType: 'LOGIN',
      category: 'Authentication',
      actorEmail: profile.email,
      actorId: profile.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Web3 / MetaMask',
      description: `Successful Web3 wallet login (${cleanAddress}).`,
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully with linked wallet!',
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        walletAddress: cleanAddress,
        avatarUrl: profile.avatar_url,
        avatar_url: profile.avatar_url,
        kycStatus: compliance?.kycStatus || 'verified',
        accountStatus: compliance?.accountStatus || 'active',
        isSuspended: false,
        bankingDetails: compliance?.bankingDetails || null,
      },
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      },
    });
  } catch (err) {
    console.error('walletLogin error:', err);
    return sendError(res, 500, 'Internal wallet authentication error.');
  }
}

// ── POST /api/auth/wallet/unlink ─────────────────────────────────────────────
// Disconnects/unlinks the wallet from the current user's profile.
async function unlinkWallet(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, 'Unauthorized: Please log in to manage your wallet.');
    }

    await supabase
      .from('profiles')
      .update({ wallet_address: null })
      .eq('id', userId);

    try {
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...(req.user.user_metadata || {}),
          wallet_address: null,
        },
      });
    } catch (_) {}

    auditLogService.logEvent({
      eventType: 'WALLET_UNLINKED',
      category: 'Web3',
      actorEmail: req.user?.email || 'unknown',
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'Web3 wallet disconnected from user profile.',
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      message: 'Wallet unlinked successfully.',
    });
  } catch (err) {
    console.error('unlinkWallet error:', err);
    return sendError(res, 500, 'Failed to unlink wallet.');
  }
}

// ── POST /api/auth/wallet/register (and /complete-profile) ─────────────────────
// Creates a real user account with real name & email linked to a verified wallet.
// Extracts wallet_address strictly from the cryptographically verified token.
async function registerWallet(req, res) {
  try {
    const { verificationToken, walletAddress, signature, nonce, email, fullName, password, avatarUrl } = req.body || {};

    if (!email || !fullName) {
      return sendError(res, 400, 'Please provide both your full name and email address.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFullName = fullName.trim();

    // 1. Resolve verified wallet address
    let verifiedAddress = null;
    if (verificationToken) {
      const tokenVerification = verifyWalletVerificationToken(verificationToken);
      if (!tokenVerification.valid) {
        return sendError(res, 400, tokenVerification.error || 'Invalid or expired wallet verification token.');
      }
      verifiedAddress = tokenVerification.walletAddress;
    } else if (walletAddress && signature && nonce) {
      const cleanAddr = walletAddress.trim().toLowerCase();
      const sigVerification = await verifyWalletSignature(cleanAddr, signature, nonce);
      if (!sigVerification.valid) {
        return sendError(res, 400, sigVerification.error || 'Cryptographic signature verification failed.');
      }
      verifiedAddress = cleanAddr;
    } else {
      return sendError(res, 400, 'Valid wallet verification token or signed challenge is required.');
    }

    // 2. Validate email is not already in use
    const { data: existingEmailUser } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingEmailUser) {
      return sendError(
        res,
        409,
        'An account with this email address already exists. Please log in with your email and password, then link your wallet from your Profile.',
        'EMAIL_ALREADY_IN_USE'
      );
    }

    // 3. Check if wallet is already linked to another account
    const { data: existingWallet } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('wallet_address', verifiedAddress)
      .maybeSingle();

    if (existingWallet) {
      return sendError(res, 409, 'This wallet is already linked to an account.', 'WALLET_ALREADY_LINKED');
    }

    // 4. Create user in Supabase Auth
    const effectivePassword = password && password.length >= 6 ? password : getDeterministicPassword(verifiedAddress);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password: effectivePassword,
      email_confirm: true,
      user_metadata: {
        full_name: cleanFullName,
        wallet_address: verifiedAddress,
        avatar_url: avatarUrl || null,
      },
    });

    if (authError) {
      const isDuplicate = authError.message.toLowerCase().includes('already') || authError.message.toLowerCase().includes('exists');
      const status = isDuplicate ? 409 : 400;
      return sendError(
        res,
        status,
        isDuplicate
          ? 'An account with this email already exists. Please log in with your email and password, then link your wallet from Profile.'
          : authError.message
      );
    }

    // 5. Create or sync profile table record
    await supabase.from('profiles').upsert(
      {
        id: authData.user.id,
        full_name: cleanFullName,
        email: cleanEmail,
        wallet_address: verifiedAddress,
        avatar_url: avatarUrl || null,
      },
      { onConflict: 'id' }
    );

    // 6. Initialize compliance profile
    const compliance = complianceService.getUserCompliance(authData.user.id, cleanEmail);

    // 7. Generate genuine Supabase session
    const session = await generateSessionForUser(cleanEmail);

    // Audit log
    auditLogService.logEvent({
      eventType: 'REGISTER',
      category: 'Authentication',
      actorEmail: cleanEmail,
      actorId: authData.user.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: `New user account created via verified wallet ${verifiedAddress}.`,
      status: 'Success',
    });

    return res.status(201).json({
      success: true,
      message: 'Account created and wallet linked successfully!',
      user: {
        id: authData.user.id,
        email: cleanEmail,
        fullName: cleanFullName,
        walletAddress: verifiedAddress,
        avatarUrl: avatarUrl || null,
        avatar_url: avatarUrl || null,
        kycStatus: compliance?.kycStatus || 'unverified',
        accountStatus: compliance?.accountStatus || 'active',
        isSuspended: false,
      },
      session,
    });
  } catch (err) {
    console.error('registerWallet error:', err);
    return sendError(res, 500, 'Failed to complete profile registration.');
  }
}

const completeWalletProfile = registerWallet;

// ── POST /api/auth/logout ────────────────────────────────────────────────────
// Terminates the session, revokes the JWT token, invalidates Supabase session,
// and records the logout event in the security audit ledger.
async function logout(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        revokeToken(token);
        try {
          await supabase.auth.admin.signOut(token);
        } catch (_) {
          // Best-effort signout from Supabase
        }
      }
    }

    const email = req.user?.email || req.body?.email || 'collector@smartassets.io';
    const userId = req.user?.id || req.body?.userId || 'system';

    auditLogService.logEvent({
      eventType: 'LOGOUT',
      category: 'Authentication',
      actorEmail: email,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'User initiated session sign out.',
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully. Session revoked.',
    });
  } catch (err) {
    console.error('logout error:', err);
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  }
}

// ── POST /api/auth/session-timeout ───────────────────────────────────────────
async function sessionTimeout(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        revokeToken(token);
      }
    }

    const email = req.body?.email || req.user?.email || 'collector@smartassets.io';
    const userId = req.body?.userId || req.user?.id || 'system';

    auditLogService.logEvent({
      eventType: 'SESSION_TIMEOUT',
      category: 'Security',
      actorEmail: email,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Mobile App',
      description: 'User session automatically terminated due to 5 minutes of inactivity.',
      status: 'Session Expired',
    });

    return res.status(200).json({
      success: true,
      message: 'Inactivity session timeout logged.',
    });
  } catch (err) {
    console.error('sessionTimeout error:', err);
    return sendError(res, 500, 'Error recording session timeout.');
  }
}

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
async function forgotPassword(req, res) {
  try {
    const { email, redirectTo } = req.body || {};

    if (!email) {
      return sendError(res, 400, 'Please provide your email address.');
    }

    const cleanEmail = email.trim().toLowerCase();

    if (redirectTo && !isAllowedRedirect(redirectTo)) {
      return sendError(res, 400, 'Invalid redirect URL.');
    }

    const finalRedirect = redirectTo
      ? redirectTo
      : process.env.PASSWORD_RESET_REDIRECT_URL;

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: finalRedirect,
    });

    if (error) {
      console.error('SUPABASE RESET ERROR:', error);
      return sendError(res, 500, error.message || 'Could not send the password reset email.');
    }

    return res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err);
    return sendError(res, 500, 'Internal server error. Please try again.');
  }
}

// ── POST /api/auth/reset-password ────────────────────────────────────────────
async function resetPassword(req, res) {
  try {
    const { accessToken, newPassword } = req.body || {};

    if (!accessToken) {
      return sendError(
        res,
        400,
        'Reset token is missing. Please request a new reset link.'
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return sendError(res, 400, 'Password must be at least 6 characters.');
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      console.error('RESET PASSWORD TOKEN ERROR:', userError);
      return sendError(
        res,
        401,
        'This reset link is invalid or has expired. Please request a new one.'
      );
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(userData.user.id, {
      password: newPassword,
    });

    if (updateError) {
      console.error('RESET PASSWORD UPDATE ERROR:', updateError);
      return sendError(res, 500, updateError.message || 'Could not update your password.');
    }

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in.',
    });
  } catch (err) {
    console.error('RESET PASSWORD ERROR:', err);
    return sendError(res, 500, 'Internal server error. Please try again.');
  }
}

// ── GET /api/auth/session ────────────────────────────────────────────────────
async function verifySession(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'No session token provided.');
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return sendError(res, 401, 'Session has expired or is invalid.', 'SESSION_EXPIRED');
    }

    return res.status(200).json({
      success: true,
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.user_metadata?.full_name || '',
      },
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to verify session.');
  }
}

module.exports = {
  register,
  login,
  walletLogin,
  getWalletNonce,
  linkWallet,
  unlinkWallet,
  registerWallet,
  completeWalletProfile,
  logout,
  sessionTimeout,
  forgotPassword,
  resetPassword,
  verifySession,
};
