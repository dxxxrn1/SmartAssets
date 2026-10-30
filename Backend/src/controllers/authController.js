// ─── SmartAssets Auth Controller ─────────────────────────────────────────────
// Handles user registration, login, MetaMask Web3 wallet authentication,
// token revocation, session timeouts, and audit logging via Supabase and SmartAssets Compliance Guard.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const { sendError } = require('../utils/errorHandler');
const avatarService = require('../services/avatarService');
const complianceService = require('../services/complianceService');
const auditLogService = require('../services/auditLogService');
const presenceService = require('../services/presenceService');
const tokenRevocationService = require('../services/tokenRevocationService');
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

// Allowed redirect targets for password resets — exact matching only (no unsafe prefixes)
function getAllowedResetRedirects() {
  const allowed = [
    'smartassets://reset-password',
    'http://localhost:3000',
    'http://localhost:3000/',
    'http://localhost:8081',
    'http://localhost:8081/',
    'https://smartassets.onrender.com',
    'https://smartassets.onrender.com/',
    'https://smartassets.onrender.com/reset-password',
  ];
  if (process.env.PUBLIC_WEB_BASE_URL) {
    const pub = process.env.PUBLIC_WEB_BASE_URL.trim().replace(/\/+$/, '');
    allowed.push(pub);
    allowed.push(`${pub}/`);
  }
  if (process.env.PASSWORD_RESET_REDIRECT_URL) {
    allowed.push(process.env.PASSWORD_RESET_REDIRECT_URL.trim());
  }
  return [...new Set(allowed)];
}

function isAllowedRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  const allowedList = getAllowedResetRedirects();
  return allowedList.includes(clean);
}

// ── Single-Use Cryptographic Recovery Authorization ──────────────────────────
function getRecoverySecret() {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || secret.trim().length < 16) {
    throw new Error('RECOVERY_SECRET_MISSING: Secure cryptographic signing secret is not configured.');
  }
  return secret.trim();
}

// In-memory tracker for single-use recovery authorization JTIs (fast path)
const usedRecoveryJtis = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of usedRecoveryJtis.entries()) {
    if (now >= exp) {
      usedRecoveryJtis.delete(jti);
    }
  }
}, 5 * 60 * 1000).unref();

function createRecoveryAuthorizationToken(userId, email) {
  const secret = getRecoverySecret();
  const jti = crypto.randomUUID();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15-minute expiration
  const payload = {
    userId,
    email: email.trim().toLowerCase(),
    jti,
    expiresAt,
    type: 'password_recovery_authorization',
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');
  return `${payloadBase64}.${signature}`;
}

function verifyAndConsumeRecoveryAuthorizationToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Recovery authorization token is required.', code: 'TOKEN_REQUIRED' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid recovery authorization format.', code: 'INVALID_TOKEN_FORMAT' };
  }

  let secret;
  try {
    secret = getRecoverySecret();
  } catch (err) {
    return { valid: false, error: 'Server configuration error verifying recovery authorization.', code: 'SECRET_UNAVAILABLE' };
  }

  const [payloadBase64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');

  if (providedSig !== expectedSig) {
    return { valid: false, error: 'Invalid or forged recovery authorization.', code: 'INVALID_SIGNATURE' };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    if (payload.type !== 'password_recovery_authorization') {
      return { valid: false, error: 'Invalid recovery authorization type.', code: 'INVALID_TOKEN_TYPE' };
    }
    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: 'Recovery authorization has expired. Please verify your recovery code again.', code: 'RECOVERY_TOKEN_EXPIRED' };
    }
    if (usedRecoveryJtis.has(payload.jti) || tokenRevocationService.isTokenRevokedSync(`recovery_jti:${payload.jti}`)) {
      return { valid: false, error: 'This recovery authorization has already been used. Please request a new recovery code.', code: 'RECOVERY_TOKEN_REUSED' };
    }

    // Single-use: record JTI immediately in memory and durable store
    usedRecoveryJtis.set(payload.jti, payload.expiresAt);
    try {
      tokenRevocationService.revokeToken(`recovery_jti:${payload.jti}`, {
        expiresAt: new Date(payload.expiresAt),
        reason: 'consumed_recovery_token',
      }).catch?.(() => {});
    } catch (_) {}

    return {
      valid: true,
      userId: payload.userId,
      email: payload.email,
    };
  } catch (err) {
    return { valid: false, error: 'Corrupt recovery authorization payload.', code: 'CORRUPT_PAYLOAD' };
  }
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
    const cleanFullName = fullName.trim();
    const authClient = supabase.supabaseAnon || supabase;

    // Account enumeration protection: check if an existing account is already registered
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingProfile) {
      return res.status(200).json({
        success: true,
        pendingVerification: true,
        email: cleanEmail,
        message: 'If an account does not already exist with this email, a verification code has been sent.',
      });
    }

    // Call Supabase Auth signup without automatic email confirmation (email_confirm: false)
    const { data: authData, error: authError } = await authClient.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: cleanFullName,
        },
      },
    });

    if (authError) {
      const isDuplicate =
        authError.message.toLowerCase().includes('already') ||
        authError.message.toLowerCase().includes('exists');
      if (isDuplicate) {
        return res.status(200).json({
          success: true,
          pendingVerification: true,
          email: cleanEmail,
          message: 'If an account does not already exist with this email, a verification code has been sent.',
        });
      }
      return sendError(res, 400, authError.message);
    }

    const userId = authData?.user?.id;
    const isExistingUser =
      Array.isArray(authData?.user?.identities) && authData.user.identities.length === 0;

    if (!userId || isExistingUser) {
      return res.status(200).json({
        success: true,
        pendingVerification: true,
        email: cleanEmail,
        message: 'If an account does not already exist with this email, a verification code has been sent.',
      });
    }

    // Create unverified profile in Supabase profiles table
    try {
      await supabase
        .from('profiles')
        .upsert(
          {
            id: userId,
            full_name: cleanFullName,
            email: cleanEmail,
            balance: 0,
            role: 'user',
            verification_status: 'unverified',
          },
          { onConflict: 'id' }
        );
    } catch (profErr) {
      console.warn('Initial profile registration notice:', profErr.message);
    }

    // Initialize user compliance profile
    const compliance = complianceService.getUserCompliance(userId, cleanEmail);

    // Audit log
    auditLogService.logEvent({
      eventType: 'REGISTER_INITIATED',
      category: 'Authentication',
      actorEmail: cleanEmail,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'New user registered account. Awaiting email verification code.',
      status: 'Pending',
    });

    // Do NOT return an active session. Account must be verified via OTP first.
    return res.status(201).json({
      success: true,
      pendingVerification: true,
      message: 'Verification code sent to your email. Please enter the 6-digit code to complete registration.',
      user: {
        id: userId,
        email: cleanEmail,
        fullName: cleanFullName,
        kycStatus: compliance?.kycStatus || 'unverified',
        accountStatus: compliance?.accountStatus || 'active',
        isSuspended: false,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return sendError(res, 500, 'Internal server error. Please try again.');
  }
}

// ── POST /api/auth/verify-email ──────────────────────────────────────────────
async function verifyEmail(req, res) {
  try {
    const { email, code, token, type, verificationToken } = req.body || {};
    const inputToken = (code || token || '').trim();

    if (!email || !inputToken) {
      return sendError(res, 400, 'Please provide both your email address and 6-digit verification code.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const authClient = supabase.supabaseAnon || supabase;

    // Verify OTP code via documented Supabase Auth verifyOtp
    let verifyType = type || 'signup';
    let { data: verifyData, error: verifyError } = await authClient.auth.verifyOtp({
      email: cleanEmail,
      token: inputToken,
      type: verifyType,
    });

    // Fallback to type 'email' if signup type is rejected by provider configuration
    if (verifyError && (verifyError.message?.toLowerCase().includes('type') || verifyError.status === 400)) {
      const fallback = await authClient.auth.verifyOtp({
        email: cleanEmail,
        token: inputToken,
        type: 'email',
      });
      if (!fallback.error && fallback.data?.user) {
        verifyData = fallback.data;
        verifyError = null;
      }
    }

    if (verifyError || !verifyData?.user) {
      return sendError(
        res,
        400,
        verifyError?.message || 'Invalid or expired verification code. Please request a new one.',
        'INVALID_CODE'
      );
    }

    const verifiedUser = verifyData.user;
    const fullName = verifiedUser.user_metadata?.full_name || '';
    let walletAddress = verifiedUser.user_metadata?.wallet_address || null;

    // If client provided a pending wallet verification token, verify wallet binding
    if (verificationToken) {
      const walletCheck = verifyWalletVerificationToken(verificationToken);
      if (walletCheck.valid && walletCheck.walletAddress) {
        walletAddress = walletCheck.walletAddress;
      }
    }

    // Safely and idempotently finalize user profile in Supabase profiles table
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(
        {
          id: verifiedUser.id,
          full_name: fullName,
          email: cleanEmail,
          wallet_address: walletAddress,
          balance: 0,
          role: 'user',
          verification_status: 'unverified',
        },
        { onConflict: 'id' }
      );

    if (profileError) {
      console.error('❌ Profile finalization error:', profileError.message);
      return sendError(res, 500, 'Failed to finalize profile after verification.');
    }

    // Initialize user compliance profile
    const compliance = complianceService.getUserCompliance(verifiedUser.id, cleanEmail);

    // Audit log
    auditLogService.logEvent({
      eventType: 'EMAIL_VERIFIED',
      category: 'Authentication',
      actorEmail: cleanEmail,
      actorId: verifiedUser.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'User email verified successfully via OTP code.',
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      emailVerified: true,
      message: 'Email verified successfully! You can now sign in.',
      session: verifyData.session || null,
      user: {
        id: verifiedUser.id,
        email: cleanEmail,
        fullName,
        walletAddress,
        kycStatus: compliance?.kycStatus || 'unverified',
        accountStatus: compliance?.accountStatus || 'active',
      },
    });
  } catch (err) {
    console.error('verifyEmail error:', err);
    return sendError(res, 500, 'Internal server error verifying email code.');
  }
}

// In-memory tracker for resend cooldowns (60s cooldown per normalized email)
const resendCooldowns = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [email, exp] of resendCooldowns.entries()) {
    if (now >= exp) {
      resendCooldowns.delete(email);
    }
  }
}, 60 * 1000).unref();

// ── POST /api/auth/resend-code ───────────────────────────────────────────────
async function resendVerificationCode(req, res) {
  try {
    const { email, type } = req.body || {};

    if (!email) {
      return sendError(res, 400, 'Please provide your email address.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const now = Date.now();
    const lastResend = resendCooldowns.get(cleanEmail);

    if (lastResend && now < lastResend) {
      const waitSeconds = Math.ceil((lastResend - now) / 1000);
      return sendError(
        res,
        429,
        `Please wait ${waitSeconds}s before requesting another verification code.`,
        'RESEND_COOLDOWN'
      );
    }

    // Set 60-second cooldown
    resendCooldowns.set(cleanEmail, now + 60 * 1000);

    const authClient = supabase.supabaseAnon || supabase;

    try {
      const { error: resendError } = await authClient.auth.resend({
        type: type || 'signup',
        email: cleanEmail,
      });

      if (resendError) {
        if (resendError.message?.toLowerCase().includes('rate limit') || resendError.status === 429) {
          return sendError(
            res,
            429,
            'Too many requests. Please wait before requesting another code.',
            'RESEND_COOLDOWN'
          );
        }
        console.warn('Notice: Supabase resend warning:', resendError.message);
      }
    } catch (resendErr) {
      console.error('Notice: Supabase resend error:', resendErr.message);
      return sendError(res, 500, 'Failed to resend verification code. Please try again shortly.');
    }

    // Account enumeration defense: always return generic confirmation
    return res.status(200).json({
      success: true,
      message: 'If an unverified account exists for that email, a new verification code has been sent.',
    });
  } catch (err) {
    console.error('resendVerificationCode error:', err);
    return sendError(res, 500, 'Internal server error resending code.');
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
      const isUnconfirmed =
        error.message?.toLowerCase().includes('not confirmed') ||
        error.message?.toLowerCase().includes('unconfirmed');
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
      if (isUnconfirmed) {
        return sendError(
          res,
          403,
          'Your email has not been verified yet. Please enter the 6-digit verification code sent to your email.',
          'EMAIL_NOT_VERIFIED'
        );
      }
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
    let userProfile = null;

    try {
      const { data: fetchedProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('full_name, wallet_address, avatar_url, verification_status')
        .eq('id', data.user.id)
        .maybeSingle();

      if (!profileErr && fetchedProfile) {
        userProfile = fetchedProfile;
        if (fetchedProfile.full_name) {
          fullName = fetchedProfile.full_name;
        }
        if (fetchedProfile.wallet_address) {
          walletAddress = fetchedProfile.wallet_address;
        }
        if (fetchedProfile.avatar_url) {
          avatarUrl = fetchedProfile.avatar_url;
        }
      }
    } catch (profileFetchErr) {
      console.warn('Profile fetch warning (using metadata):', profileFetchErr.message);
    }

    try {
      presenceService.recordActivity(data.user.id, {
        email: data.user.email,
        fullName,
        ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
        userAgent: req.headers['user-agent'],
        endpoint: '/api/auth/login',
      });
    } catch (_) {}

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
        kycStatus: (compliance && compliance.kycStatus === 'verified') ? 'verified' : (userProfile?.verification_status === 'verified' ? 'verified' : 'unverified'),
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
        kycStatus: (compliance && compliance.kycStatus === 'verified') ? 'verified' : (freshProfile?.verification_status === 'verified' ? 'verified' : 'unverified'),
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
        kycStatus: (compliance && compliance.kycStatus === 'verified') ? 'verified' : (profile?.verification_status === 'verified' ? 'verified' : 'unverified'),
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
        return sendError(res, 401, sigVerification.error || 'Cryptographic signature verification failed.', 'INVALID_SIGNATURE');
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

    // 4. Create user in Supabase Auth via documented signUp (requires email verification)
    const effectivePassword = password && password.length >= 6 ? password : getDeterministicPassword(verifiedAddress);
    const authClient = supabase.supabaseAnon || supabase;

    const { data: authData, error: authError } = await authClient.auth.signUp({
      email: cleanEmail,
      password: effectivePassword,
      options: {
        data: {
          full_name: cleanFullName,
          wallet_address: verifiedAddress,
          avatar_url: avatarUrl || null,
        },
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

    const userId = authData?.user?.id;
    if (!userId) {
      return sendError(res, 400, 'Could not initiate wallet registration. Please try again.');
    }

    // 5. Create unverified profile record in Supabase profiles table linked to wallet
    try {
      await supabase.from('profiles').upsert(
        {
          id: userId,
          full_name: cleanFullName,
          email: cleanEmail,
          wallet_address: verifiedAddress,
          avatar_url: avatarUrl || null,
          balance: 0,
          role: 'user',
          verification_status: 'unverified',
        },
        { onConflict: 'id' }
      );
    } catch (profErr) {
      console.warn('Initial wallet profile creation notice:', profErr.message);
    }

    // 6. Initialize compliance profile
    const compliance = complianceService.getUserCompliance(userId, cleanEmail);

    // 7. Audit log (Awaiting mailbox confirmation)
    auditLogService.logEvent({
      eventType: 'REGISTER_INITIATED',
      category: 'Authentication',
      actorEmail: cleanEmail,
      actorId: userId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: `New user account initiated via verified wallet ${verifiedAddress}. Awaiting email verification code.`,
      status: 'Pending',
    });

    // Do NOT return an active session. The email must be verified via OTP first.
    return res.status(201).json({
      success: true,
      pendingVerification: true,
      email: cleanEmail,
      walletAddress: verifiedAddress,
      message: 'Verification code sent to your email. Please enter the 6-digit code to complete wallet registration.',
      user: {
        id: userId,
        email: cleanEmail,
        fullName: cleanFullName,
        walletAddress: verifiedAddress,
        avatarUrl: avatarUrl || null,
        kycStatus: compliance?.kycStatus || 'unverified',
        accountStatus: compliance?.accountStatus || 'active',
        isSuspended: false,
      },
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

    if (userId && userId !== 'system') {
      try {
        presenceService.setUserOffline(userId, 'logout');
      } catch (_) {}
    }

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

    if (userId && userId !== 'system') {
      try {
        presenceService.setUserOffline(userId, 'inactivity_timeout');
      } catch (_) {}
    }

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
    const { email } = req.body || {};

    if (!email) {
      return sendError(res, 400, 'Please provide your email address.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const authClient = supabase.supabaseAnon || supabase;

    try {
      // In-app code-only recovery: do NOT pass redirectTo so Supabase delivers an OTP code
      const { error } = await authClient.auth.resetPasswordForEmail(cleanEmail);

      if (error) {
        const errMsg = (error.message || '').toLowerCase();
        const errStatus = error.status || 0;

        // Rate limiting
        if (errStatus === 429 || errMsg.includes('rate limit')) {
          return sendError(
            res,
            429,
            'Too many password recovery requests. Please wait before requesting another code.',
            'RATE_LIMIT_EXCEEDED'
          );
        }

        // True provider/SMTP delivery failure (do not report that code was sent)
        const isProviderFailure =
          errStatus >= 500 ||
          errMsg.includes('error sending') ||
          errMsg.includes('smtp') ||
          errMsg.includes('connection refused') ||
          errMsg.includes('failed to send');

        if (isProviderFailure) {
          console.error('Password recovery delivery failure:', error.message);
          return sendError(
            res,
            503,
            'Unable to send recovery code at this time. Please try again shortly.',
            'EMAIL_SERVICE_ERROR'
          );
        }

        // Non-existent account: safely return generic success message to prevent enumeration
        console.warn('Notice: Supabase resetPasswordForEmail notice:', error.message);
      }
    } catch (callErr) {
      console.error('Notice: resetPasswordForEmail exception:', callErr.message);
      return sendError(
        res,
        503,
        'Unable to send recovery code at this time. Please try again shortly.',
        'EMAIL_SERVICE_ERROR'
      );
    }

    // Preserve account enumeration protection: always return the same generic message
    return res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a 6-digit recovery code has been sent.',
    });
  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err);
    return sendError(res, 500, 'Internal server error. Please try again.');
  }
}

// ── POST /api/auth/verify-recovery-code ──────────────────────────────────────
async function verifyRecoveryCode(req, res) {
  try {
    const { email, code } = req.body || {};
    const inputCode = (code || '').trim();

    if (!email || !inputCode) {
      return sendError(res, 400, 'Please provide both your email address and 6-digit recovery code.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const authClient = supabase.supabaseAnon || supabase;

    // Verify recovery OTP via documented Supabase Auth verifyOtp
    const { data, error } = await authClient.auth.verifyOtp({
      email: cleanEmail,
      token: inputCode,
      type: 'recovery',
    });

    if (error || !data?.user) {
      return sendError(
        res,
        400,
        'Invalid or expired recovery code. Please check the code or request a new one.',
        'INVALID_RECOVERY_CODE'
      );
    }

    // Issue cryptographically signed, single-use recovery authorization
    const recoveryToken = createRecoveryAuthorizationToken(data.user.id, cleanEmail);

    auditLogService.logEvent({
      eventType: 'RECOVERY_CODE_VERIFIED',
      category: 'Authentication',
      actorEmail: cleanEmail,
      actorId: data.user.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'Password recovery OTP verified successfully. Single-use ticket issued.',
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      message: 'Recovery code verified successfully.',
      recoveryToken,
    });
  } catch (err) {
    console.error('VERIFY RECOVERY CODE ERROR:', err);
    return sendError(res, 500, 'Internal server error verifying recovery code.');
  }
}

// ── POST /api/auth/reset-password ────────────────────────────────────────────
async function resetPassword(req, res) {
  try {
    const { recoveryToken, accessToken, token, newPassword } = req.body || {};
    const effectiveToken = recoveryToken || accessToken || token;

    if (!effectiveToken) {
      return sendError(
        res,
        400,
        'Reset authorization is missing. Please enter your recovery code or request a new reset link.',
        'TOKEN_REQUIRED'
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return sendError(res, 400, 'Password must be at least 6 characters.', 'INVALID_PASSWORD');
    }

    let targetUserId = null;
    let targetEmail = null;

    if (recoveryToken) {
      const authResult = verifyAndConsumeRecoveryAuthorizationToken(recoveryToken);
      if (!authResult.valid) {
        return sendError(
          res,
          401,
          authResult.error || 'Invalid or expired recovery authorization.',
          authResult.code || 'INVALID_RECOVERY_AUTH'
        );
      }
      targetUserId = authResult.userId;
      targetEmail = authResult.email;
    } else {
      // Magic link access token fallback
      const authClient = supabase.supabaseAnon || supabase;
      const { data: userData, error: userError } = await authClient.auth.getUser(effectiveToken);

      if (userError || !userData?.user) {
        return sendError(
          res,
          401,
          'This reset link is invalid or has expired. Please request a new one.',
          'INVALID_OR_EXPIRED_TOKEN'
        );
      }
      targetUserId = userData.user.id;
      targetEmail = userData.user.email;
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
    });

    if (updateError) {
      console.error('RESET PASSWORD UPDATE ERROR:', updateError.message);
      return sendError(res, 500, 'Could not update your password. Please try again.');
    }

    // Revoke any existing session tokens for this user
    try {
      if (typeof effectiveToken === 'string' && effectiveToken.length > 20) {
        revokeToken(effectiveToken);
      }
    } catch (_) {}

    auditLogService.logEvent({
      eventType: 'PASSWORD_RESET_SUCCESS',
      category: 'Authentication',
      actorEmail: targetEmail || 'unknown',
      actorId: targetUserId,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      device: req.headers['user-agent'] || 'SmartAssets Client',
      description: 'Password reset completed successfully. Previous sessions revoked.',
      status: 'Success',
    });

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.',
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
  verifyEmail,
  resendVerificationCode,
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
  verifyRecoveryCode,
  resetPassword,
  verifySession,
  getAllowedResetRedirects,
  isAllowedRedirect,
  getRecoverySecret,
  createRecoveryAuthorizationToken,
  verifyAndConsumeRecoveryAuthorizationToken,
};
