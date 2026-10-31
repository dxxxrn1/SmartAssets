// ─── SmartAssets Withdrawal Email-Code (OTP) Verification Service ────────────
// Enforces bank-account confirmation + single-use 6-digit email OTP verification
// (120-second server-clock expiry, strictly 1 attempt per challenge) before any
// user withdrawal reserves funds or enters the admin treasury review queue.

const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const supabase = require('../connection/supabaseClient');
const auditLogService = require('./auditLogService');
const complianceService = require('./complianceService');
const vaultTxService = require('./vaultTransactionService');
const { WITHDRAWAL_OTP_EMAIL_TEMPLATE } = require('../config/emailTemplates');

const CHALLENGE_TTL_SECONDS = 120; // Strictly 2 minutes (120 seconds)
const CHALLENGE_TTL_MS = CHALLENGE_TTL_SECONDS * 1000;
const MAX_SINGLE_WITHDRAWAL_ZAR = 5000000; // R5,000,000

// Rate-limit thresholds (per 15-minute window)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_CHALLENGE_SENDS_PER_USER_WINDOW = 5;
const MAX_CHALLENGE_SENDS_PER_IP_WINDOW = 10;
const MAX_VERIFY_ATTEMPTS_PER_USER_WINDOW = 8;
const MAX_VERIFY_ATTEMPTS_PER_IP_WINDOW = 15;

// Hot cache synced with Supabase `public.withdrawal_verification_challenges` & `public.withdrawal_otp_rate_limits`
const challengesCache = new Map(); // challengeId -> row
const rateLimitsCache = new Map(); // rateKey -> { window_start, request_count, last_attempt_at }
const userChallengeLocks = new Map(); // userId -> Promise mutex

// Test hooks (never expose OTPs in production)
let customClockFn = null;
let customEmailTransportFn = null;

function nowMs() {
  if (typeof customClockFn === 'function') {
    return Number(customClockFn());
  }
  return Date.now();
}

function nowIso() {
  return new Date(nowMs()).toISOString();
}

function _setClockForTesting(fn) {
  customClockFn = typeof fn === 'function' ? fn : null;
}

function _setEmailTransportForTesting(fn) {
  customEmailTransportFn = typeof fn === 'function' ? fn : null;
}

function _clearRuntimeCacheForTesting() {
  challengesCache.clear();
  rateLimitsCache.clear();
  userChallengeLocks.clear();
}

/**
 * Per-user async mutex to serialize challenge creation, cancellation, and verification.
 */
async function withUserChallengeLock(userId, fn) {
  const key = String(userId || 'global');
  const prev = userChallengeLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  userChallengeLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userChallengeLocks.get(key) === next) {
      userChallengeLocks.delete(key);
    }
  }
}

function formatZar(num) {
  return (
    'R' +
    Number(num || 0).toLocaleString('en-ZA', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

function maskEmailAddress(email) {
  const clean = String(email || '').trim();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 0) return '***@***';
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  if (local.length <= 2) {
    return `${local[0] || '*'}***@${domain}`;
  }
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}

function maskAccountNumber(accNum) {
  const clean = String(accNum || '').replace(/\s+/g, '');
  if (!clean) return '****';
  if (clean.length <= 4) return `****${clean}`;
  return `****${clean.slice(-4)}`;
}

/**
 * Computes a deterministic cryptographic version hash of the user's approved bank account record.
 * Any change to bank ID, bank name, account number, branch code, account holder, or approval status
 * produces a different hash and invalidates any previously issued withdrawal challenge.
 */
function computeBankVersionHash(bankRecord) {
  if (!bankRecord) return '';
  const id = String(bankRecord.id || '').trim();
  const bankName = String(bankRecord.bank_name || bankRecord.bankName || '').trim().toLowerCase();
  const accNum = String(bankRecord.account_number || bankRecord.accountNumber || '').replace(/\s+/g, '');
  const branchCode = String(bankRecord.branch_code || bankRecord.branchCode || '').trim();
  const holder = String(bankRecord.account_holder || bankRecord.accountHolder || '').trim().toLowerCase();
  const status = String(bankRecord.status || '').trim().toLowerCase();
  const payload = `${id}|${bankName}|${accNum}|${branchCode}|${holder}|${status}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Resolves the server-side HMAC pepper for OTP hashing.
 */
function getOtpHmacSecret() {
  return (
    process.env.WITHDRAWAL_OTP_SECRET ||
    process.env.ADMIN_JWT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'smartassets-withdrawal-otp-hmac-pepper-v1'
  );
}

/**
 * Computes a salted HMAC-SHA256 hash of the 6-digit OTP bound to the exact challenge parameters.
 * Plaintext OTP is never stored.
 */
function computeOtpHash({
  code,
  salt,
  challengeId,
  userId,
  attemptId,
  amount,
  currency = 'ZAR',
  bankAccountId,
  bankVersionHash,
}) {
  const normalizedCode = String(code || '').trim();
  const normalizedAmount = Number(amount).toFixed(2);
  const normalizedCurrency = String(currency || 'ZAR').toUpperCase();
  const bindingPayload = [
    String(salt || ''),
    String(challengeId || ''),
    String(userId || ''),
    String(attemptId || ''),
    normalizedAmount,
    normalizedCurrency,
    String(bankAccountId || ''),
    String(bankVersionHash || ''),
    normalizedCode,
  ].join('|');

  return crypto
    .createHmac('sha256', getOtpHmacSecret())
    .update(bindingPayload, 'utf8')
    .digest('hex');
}

/**
 * Constant-time comparison of two hex SHA-256 digests.
 */
function timingSafeHashMatch(expectedHex, actualHex) {
  if (typeof expectedHex !== 'string' || typeof actualHex !== 'string') return false;
  if (expectedHex.length !== actualHex.length || expectedHex.length === 0) return false;
  try {
    const bufA = Buffer.from(expectedHex, 'hex');
    const bufB = Buffer.from(actualHex, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (_) {
    return false;
  }
}

/**
 * Built-in SMTP email transport using Node `net` / `tls` and configured SMTP environment variables
 * (`SMTP_HOST`, `SMTP_PORT`, `CONSUMER_KEY` / `SMTP_USER`, `CONSUMER_SECRET` / `SMTP_PASS`, `SMTP_SENDER_EMAIL`).
 */
async function sendEmailViaConfiguredSmtp({ to, subject, html, text }) {
  if (typeof customEmailTransportFn === 'function') {
    return await customEmailTransportFn({ to, subject, html, text });
  }

  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.CONSUMER_KEY || process.env.SMTP_USER || '').trim();
  const pass = String(process.env.CONSUMER_SECRET || process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_SENDER_EMAIL || 'no-reply@smartassets.co.za').trim();

  if (!host || !user || !pass) {
    const err = new Error('SMTP email delivery is not configured on the server.');
    err.code = 'EMAIL_DELIVERY_FAILED';
    err.statusCode = 503;
    throw err;
  }

  return new Promise((resolve, reject) => {
    let socket = null;
    let settled = false;
    let buffer = '';

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      try {
        if (socket && !socket.destroyed) socket.destroy();
      } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    const timeout = setTimeout(() => {
      const err = new Error('SMTP connection timed out while sending verification code.');
      err.code = 'EMAIL_DELIVERY_FAILED';
      err.statusCode = 503;
      finish(err);
    }, 10000);

    let step = 0;
    const commands = [];

    const readResponse = (line) => {
      // Wait until final line of multi-line SMTP response (3 digits followed by space)
      if (!/^\d{3} /.test(line)) return;
      const code = parseInt(line.slice(0, 3), 10);
      if (code >= 400) {
        clearTimeout(timeout);
        const err = new Error(`SMTP error (${code}) during withdrawal verification email delivery.`);
        err.code = 'EMAIL_DELIVERY_FAILED';
        err.statusCode = 503;
        return finish(err);
      }

      if (step < commands.length) {
        const nextCmd = commands[step++];
        socket.write(nextCmd + '\r\n');
      } else {
        clearTimeout(timeout);
        finish(null, { delivered: true, messageId: `smtp-${Date.now()}` });
      }
    };

    const attachListeners = (sock) => {
      sock.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          readResponse(line);
        }
      });
      sock.on('error', (err) => {
        clearTimeout(timeout);
        const wrap = new Error(`SMTP socket error: ${err.message}`);
        wrap.code = 'EMAIL_DELIVERY_FAILED';
        wrap.statusCode = 503;
        finish(wrap);
      });
    };

    const boundary = `----=_SmartAssetsPart_${crypto.randomBytes(8).toString('hex')}`;
    const mimeBody = [
      `From: SmartAssets Security <${from}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="utf-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      text,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="utf-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      html,
      ``,
      `--${boundary}--`,
      `.`,
    ].join('\r\n');

    commands.push(
      `EHLO smartassets.co.za`,
      `AUTH LOGIN`,
      Buffer.from(user, 'utf8').toString('base64'),
      Buffer.from(pass, 'utf8').toString('base64'),
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${to}>`,
      `DATA`,
      mimeBody,
      `QUIT`
    );

    if (port === 465) {
      socket = tls.connect({ host, port, servername: host }, () => {});
      attachListeners(socket);
    } else {
      socket = net.connect({ host, port }, () => {});
      attachListeners(socket);
    }
  });
}

/**
 * Durable rate-limit check & increment backed by Supabase `public.withdrawal_otp_rate_limits`.
 */
async function checkAndIncrementRateLimit(rateKey, maxAllowed) {
  if (!rateKey) return;
  const currentMs = nowMs();
  let record = rateLimitsCache.get(rateKey) || null;

  // Query Supabase for durable rate limit across server restarts
  try {
    const { data, error } = await supabase
      .from('withdrawal_otp_rate_limits')
      .select('*')
      .eq('rate_key', rateKey)
      .maybeSingle();

    if (!error && data && data.rate_key) {
      record = {
        rate_key: data.rate_key,
        window_start: data.window_start,
        request_count: Number(data.request_count) || 0,
        last_attempt_at: data.last_attempt_at,
      };
      rateLimitsCache.set(rateKey, record);
    }
  } catch (_) {}

  const windowStartMs = record && record.window_start ? Date.parse(record.window_start) : 0;
  const isExpiredWindow = !windowStartMs || currentMs - windowStartMs >= RATE_LIMIT_WINDOW_MS;

  if (!record || isExpiredWindow) {
    const fresh = {
      rate_key: rateKey,
      window_start: new Date(currentMs).toISOString(),
      request_count: 1,
      last_attempt_at: new Date(currentMs).toISOString(),
    };
    rateLimitsCache.set(rateKey, fresh);
    try {
      await supabase.from('withdrawal_otp_rate_limits').upsert(fresh, { onConflict: 'rate_key' });
    } catch (_) {}
    return;
  }

  if (record.request_count >= maxAllowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStartMs + RATE_LIMIT_WINDOW_MS - currentMs) / 1000)
    );
    const err = new Error(
      `Too many withdrawal verification requests. Please wait ${retryAfterSeconds} seconds before trying again.`
    );
    err.code = 'OTP_RATE_LIMIT_EXCEEDED';
    err.statusCode = 429;
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }

  const updated = {
    ...record,
    request_count: record.request_count + 1,
    last_attempt_at: new Date(currentMs).toISOString(),
  };
  rateLimitsCache.set(rateKey, updated);
  try {
    await supabase.from('withdrawal_otp_rate_limits').upsert(updated, { onConflict: 'rate_key' });
  } catch (_) {}
}

/**
 * Authoritatively resolves the user's verified email address and eligibility from Supabase & complianceService.
 * Never accepts a destination email from the client request body.
 */
async function resolveAuthoritativeUserAndBank(userId, sessionEmail = null) {
  if (!userId) {
    const err = new Error('Authenticated user ID is required.');
    err.code = 'UNAUTHORIZED';
    err.statusCode = 401;
    throw err;
  }

  let dbProfile = null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) {
      dbProfile = data;
    }
  } catch (_) {}

  const compliance = complianceService.getUserCompliance(userId, sessionEmail || dbProfile?.email);

  // 1. Check account suspension
  if (
    compliance?.isSuspended ||
    compliance?.accountStatus === 'suspended' ||
    dbProfile?.is_suspended === true ||
    dbProfile?.status === 'suspended'
  ) {
    const err = new Error('Account Suspended by Compliance. Withdrawals are blocked.');
    err.code = 'ACCOUNT_SUSPENDED';
    err.statusCode = 403;
    throw err;
  }

  // 2. Check KYC verification status
  const isKycVerified =
    compliance?.kycStatus === 'verified' ||
    compliance?.verification_status === 'verified' ||
    dbProfile?.verification_status === 'verified';

  if (!isKycVerified) {
    const err = new Error(
      'Account verification required. All 3 KYC documents must be approved before withdrawing funds.'
    );
    err.code = 'KYC_REQUIRED';
    err.statusCode = 403;
    throw err;
  }

  // 3. Resolve authoritative verified email from profile / authenticated user token
  const authoritativeEmail = String(dbProfile?.email || sessionEmail || compliance?.userEmail || '').trim();
  if (!authoritativeEmail || !authoritativeEmail.includes('@')) {
    const err = new Error('No verified email address found on your authenticated account.');
    err.code = 'VERIFIED_EMAIL_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  // 4. Resolve authoritative approved bank account on file (DB + complianceService)
  let bankRecord = complianceService.getUserBankAccount(userId, authoritativeEmail);
  try {
    const { data: dbBank } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dbBank && dbBank.id) {
      bankRecord = {
        ...bankRecord,
        ...dbBank,
        id: String(dbBank.id),
      };
    }
  } catch (_) {}

  if (!bankRecord || bankRecord.status !== 'approved') {
    const err = new Error(
      'Approved bank account required. Please submit your bank details and wait for admin approval before withdrawing funds.'
    );
    err.code = 'BANK_APPROVAL_REQUIRED';
    err.statusCode = 403;
    throw err;
  }

  const bankName = String(bankRecord.bank_name || bankRecord.bankName || '').trim();
  const accountNumber = String(bankRecord.account_number || bankRecord.accountNumber || '').replace(/\s+/g, '');
  const accountHolder = String(bankRecord.account_holder || bankRecord.accountHolder || '').trim();
  const branchCode = String(bankRecord.branch_code || bankRecord.branchCode || '').trim();
  const accountType = String(bankRecord.account_type || bankRecord.accountType || 'Cheque / Current').trim();
  const maskedAccountNumber = maskAccountNumber(accountNumber);
  const destinationSummary = `${bankName} (${maskedAccountNumber})`;
  const bankVersionHash = computeBankVersionHash(bankRecord);

  return {
    userId,
    authoritativeEmail,
    maskedEmail: maskEmailAddress(authoritativeEmail),
    bankRecord: {
      id: String(bankRecord.id),
      bankName,
      accountHolder,
      accountNumber,
      maskedAccountNumber,
      branchCode,
      accountType,
      status: bankRecord.status,
      destinationSummary,
      bankVersionHash,
    },
  };
}

/**
 * Validates that the client request body does not attempt to override bank details, crypto wallets, or destination email.
 */
function assertNoClientDestinationOrEmailOverride(body = {}, authoritativeBank, authoritativeEmail) {
  if (!body || typeof body !== 'object') return;

  // Reject client destination email override attempts
  const suppliedEmail = body.email || body.destinationEmail || body.recipientEmail || body.otpEmail;
  if (suppliedEmail !== undefined && suppliedEmail !== null) {
    const err = new Error(
      'Security violation: Destination email address cannot be supplied or overridden by the client.'
    );
    err.code = 'CLIENT_EMAIL_OVERRIDE_FORBIDDEN';
    err.statusCode = 400;
    throw err;
  }

  // Reject crypto wallet or non-bank withdrawal methods
  if (body.walletAddress || (body.method && String(body.method).toLowerCase().includes('crypto'))) {
    const err = new Error(
      'Unapproved withdrawal destination: Crypto wallet withdrawals are not supported. Withdrawals can only be sent to your approved South African bank account on file.'
    );
    err.code = 'UNAPPROVED_DESTINATION';
    err.statusCode = 403;
    throw err;
  }

  // Reject any attempt to supply or replace bank details in the withdrawal request
  if (body.bankDetails || body.accountNumber || body.bankName || body.branchCode) {
    const bd = body.bankDetails && typeof body.bankDetails === 'object' ? body.bankDetails : body;
    if (bd.accountNumber) {
      const cleanSupplied = String(bd.accountNumber).replace(/\s+/g, '');
      if (cleanSupplied !== authoritativeBank.accountNumber) {
        const err = new Error(
          'Unapproved withdrawal destination: Supplied account number does not match your approved bank account on file.'
        );
        err.code = 'UNAPPROVED_DESTINATION';
        err.statusCode = 403;
        throw err;
      }
    }
    if (bd.bankName) {
      const cleanBank = String(bd.bankName).trim().toLowerCase();
      if (cleanBank !== authoritativeBank.bankName.toLowerCase()) {
        const err = new Error(
          'Unapproved withdrawal destination: Supplied bank name does not match your approved bank account on file.'
        );
        err.code = 'UNAPPROVED_DESTINATION';
        err.statusCode = 403;
        throw err;
      }
    }
    if (body.replaceBankDetails || body.overrideBankDetails) {
      const err = new Error(
        'Unapproved withdrawal destination: Replacing destination bank details during withdrawal is not permitted.'
      );
      err.code = 'UNAPPROVED_DESTINATION';
      err.statusCode = 403;
      throw err;
    }
  }

  if (body.bankAccountId && String(body.bankAccountId) !== String(authoritativeBank.id)) {
    const err = new Error(
      'Unapproved withdrawal destination: Supplied bankAccountId does not match your approved bank account on file.'
    );
    err.code = 'UNAPPROVED_DESTINATION';
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Fetches a challenge by ID from Supabase (or hot cache if DB not mocked for that row),
 * ensuring full persistence across server restarts.
 */
async function resolveChallengeById(challengeId) {
  if (!challengeId) return null;
  const cleanId = String(challengeId).trim();
  let row = challengesCache.get(cleanId) || null;

  try {
    const { data, error } = await supabase
      .from('withdrawal_verification_challenges')
      .select('*')
      .eq('id', cleanId)
      .maybeSingle();

    if (!error && data && data.id) {
      row = { ...data, id: String(data.id) };
      challengesCache.set(row.id, row);
    }
  } catch (_) {}

  return row;
}

/**
 * Persists a challenge row insert to Supabase `withdrawal_verification_challenges` (fails closed on DB error).
 */
async function persistChallengeInsert(row) {
  const { error } = await supabase.from('withdrawal_verification_challenges').insert(row);
  if (error) {
    const dbErr = new Error(`Failed to persist withdrawal verification challenge: ${error.message}`);
    dbErr.code = 'DB_WRITE_FAILED';
    dbErr.statusCode = 500;
    throw dbErr;
  }
  challengesCache.set(String(row.id), { ...row });
}

/**
 * Persists a challenge row update to Supabase `withdrawal_verification_challenges` (fails closed on DB error).
 */
async function persistChallengeUpdate(challengeId, updatePayload) {
  const existing = challengesCache.get(String(challengeId)) || {};
  const merged = { ...existing, ...updatePayload, id: String(challengeId) };
  const { error } = await supabase
    .from('withdrawal_verification_challenges')
    .update(updatePayload)
    .eq('id', String(challengeId));
  if (error) {
    const dbErr = new Error(`Failed to update withdrawal verification challenge: ${error.message}`);
    dbErr.code = 'DB_WRITE_FAILED';
    dbErr.statusCode = 500;
    throw dbErr;
  }
  challengesCache.set(String(challengeId), merged);
  return merged;
}

/**
 * Invalidates all existing `pending` challenges for a user when a new challenge is requested.
 */
async function invalidatePriorPendingChallenges(userId, reason = 'superseded_by_new_challenge') {
  const timestamp = nowIso();
  for (const [cid, ch] of challengesCache.entries()) {
    if (String(ch.user_id) === String(userId) && ch.status === 'pending') {
      challengesCache.set(cid, {
        ...ch,
        status: 'cancelled',
        cancelled_at: timestamp,
        cancellation_reason: reason,
        updated_at: timestamp,
      });
    }
  }

  try {
    await supabase
      .from('withdrawal_verification_challenges')
      .update({
        status: 'cancelled',
        cancelled_at: timestamp,
        cancellation_reason: reason,
        updated_at: timestamp,
      })
      .eq('user_id', userId)
      .eq('status', 'pending');
  } catch (_) {}
}

/**
 * Step 1-3: Request a new single-use 6-digit email verification challenge after the user
 * confirms their masked approved bank details ("Are these your bank details?").
 */
async function requestWithdrawalChallenge({
  userId,
  userEmail = null,
  amount,
  currency = 'ZAR',
  confirmedBankDetails = false,
  attemptId = null,
  idempotencyKey = null,
  requestIp = '127.0.0.1',
  rawBody = {},
}) {
  // 1. Validate destination/email overrides first
  const { authoritativeEmail, maskedEmail, bankRecord } = await resolveAuthoritativeUserAndBank(
    userId,
    userEmail
  );
  assertNoClientDestinationOrEmailOverride(rawBody, bankRecord, authoritativeEmail);

  // 2. Require explicit confirmation of the masked bank details ("Are these your bank details?")
  if (confirmedBankDetails !== true) {
    const err = new Error(
      'Please confirm that the displayed approved bank account details are yours before requesting a withdrawal verification code.'
    );
    err.code = 'BANK_CONFIRMATION_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  // 3. Validate withdrawal amount & currency
  const withdrawNum = Number(amount);
  if (!Number.isFinite(withdrawNum) || withdrawNum <= 0) {
    const err = new Error('Please specify a valid withdrawal amount greater than R0.');
    err.code = 'INVALID_AMOUNT';
    err.statusCode = 400;
    throw err;
  }
  if (withdrawNum > MAX_SINGLE_WITHDRAWAL_ZAR) {
    const err = new Error(
      `Withdrawal amount exceeds maximum single transaction limit of ${formatZar(MAX_SINGLE_WITHDRAWAL_ZAR)}.`
    );
    err.code = 'AMOUNT_LIMIT_EXCEEDED';
    err.statusCode = 400;
    throw err;
  }
  if (currency && String(currency).toUpperCase() !== 'ZAR') {
    const err = new Error(`Unsupported withdrawal currency "${currency}". Withdrawals must be in ZAR.`);
    err.code = 'UNSUPPORTED_CURRENCY';
    err.statusCode = 400;
    throw err;
  }

  return withUserChallengeLock(userId, async () => {
    // 4. Verify available spendable balance BEFORE sending OTP
    const balDetails = await vaultTxService.getUserBalanceDetails(userId);
    if (withdrawNum > balDetails.availableBalanceNum) {
      const err = new Error(
        `Insufficient vault balance. You requested ${formatZar(withdrawNum)} but your available spendable balance is ${balDetails.availableBalanceFormatted}.`
      );
      err.code = 'INSUFFICIENT_FUNDS';
      err.statusCode = 400;
      throw err;
    }

    // 5. Enforce durable rate limits by account and IP
    await checkAndIncrementRateLimit(
      `send:user:${userId}`,
      MAX_CHALLENGE_SENDS_PER_USER_WINDOW
    );
    if (requestIp) {
      await checkAndIncrementRateLimit(
        `send:ip:${requestIp}`,
        MAX_CHALLENGE_SENDS_PER_IP_WINDOW
      );
    }

    // 6. Invalidate any previous active challenge for this user
    await invalidatePriorPendingChallenges(userId, 'superseded_by_new_challenge');

    // 7. Generate cryptographically random 6-digit single-use OTP and salted HMAC-SHA256 hash
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const challengeId = crypto.randomUUID();
    const effectiveAttemptId =
      attemptId && String(attemptId).trim()
        ? `${String(attemptId).trim()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
        : `WTH-ATT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const otpSalt = crypto.randomBytes(16).toString('hex');

    const otpHash = computeOtpHash({
      code: otpCode,
      salt: otpSalt,
      challengeId,
      userId,
      attemptId: effectiveAttemptId,
      amount: withdrawNum,
      currency: 'ZAR',
      bankAccountId: bankRecord.id,
      bankVersionHash: bankRecord.bankVersionHash,
    });

    const createdMs = nowMs();
    const expiresMs = createdMs + CHALLENGE_TTL_MS;
    const createdAtIso = new Date(createdMs).toISOString();
    const expiresAtIso = new Date(expiresMs).toISOString();

    const challengeRow = {
      id: challengeId,
      attempt_id: effectiveAttemptId,
      user_id: userId,
      email_masked: maskedEmail,
      amount: withdrawNum,
      currency: 'ZAR',
      bank_account_id: bankRecord.id,
      bank_version_hash: bankRecord.bankVersionHash,
      destination_summary: bankRecord.destinationSummary,
      otp_hash: otpHash,
      otp_salt: otpSalt,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 1,
      idempotency_key: idempotencyKey || null,
      request_ip: requestIp || '127.0.0.1',
      expires_at: expiresAtIso,
      consumed_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      withdrawal_tx_id: null,
      created_at: createdAtIso,
      updated_at: createdAtIso,
    };

    await persistChallengeInsert(challengeRow);

    auditLogService.logEvent({
      eventType: 'WITHDRAWAL_CHALLENGE_REQUESTED',
      actorId: userId,
      actorEmail: authoritativeEmail,
      category: 'Vault',
      ip: requestIp,
      description: `User ${userId} confirmed bank details (${bankRecord.destinationSummary}) and requested withdrawal OTP challenge ${challengeId} (Attempt: ${effectiveAttemptId}) for ${formatZar(withdrawNum)}.`,
      status: 'Pending',
    });

    // 8. Deliver 6-digit code to the user's verified email (FAIL CLOSED if delivery fails)
    const renderedEmail = WITHDRAWAL_OTP_EMAIL_TEMPLATE.render({
      code: otpCode,
      amountFormatted: formatZar(withdrawNum),
      maskedDestination: bankRecord.destinationSummary,
      attemptId: effectiveAttemptId,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    });

    try {
      await sendEmailViaConfiguredSmtp({
        to: authoritativeEmail,
        subject: renderedEmail.subject,
        html: renderedEmail.html,
        text: renderedEmail.plainText,
      });
    } catch (emailErr) {
      const failTime = nowIso();
      await persistChallengeUpdate(challengeId, {
        status: 'delivery_failed',
        cancelled_at: failTime,
        cancellation_reason: 'email_delivery_failed',
        updated_at: failTime,
      }).catch(() => {});

      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_DELIVERY_FAILED',
        actorId: userId,
        actorEmail: authoritativeEmail,
        category: 'Vault',
        ip: requestIp,
        description: `Withdrawal OTP email delivery failed for challenge ${challengeId} (Attempt: ${effectiveAttemptId}, Amount: ${formatZar(withdrawNum)}). Challenge invalidated.`,
        status: 'Failure',
      });

      const err = new Error(
        'Unable to send verification code to your registered email address. For your security, this withdrawal attempt was not submitted. Please try again later.'
      );
      err.code = 'EMAIL_DELIVERY_FAILED';
      err.statusCode = 503;
      throw err;
    }

    auditLogService.logEvent({
      eventType: 'WITHDRAWAL_CHALLENGE_DELIVERED',
      actorId: userId,
      actorEmail: authoritativeEmail,
      category: 'Vault',
      ip: requestIp,
      description: `Withdrawal OTP email delivered to ${maskedEmail} for challenge ${challengeId} (Attempt: ${effectiveAttemptId}, Amount: ${formatZar(withdrawNum)}, Expires: ${expiresAtIso}).`,
      status: 'Success',
    });

    // NEVER return the OTP code or hash in the response
    return {
      challengeId,
      attemptId: effectiveAttemptId,
      status: 'pending',
      amount: withdrawNum,
      amountFormatted: formatZar(withdrawNum),
      currency: 'ZAR',
      maskedEmail,
      destinationSummary: bankRecord.destinationSummary,
      bankAccount: {
        id: bankRecord.id,
        bankName: bankRecord.bankName,
        accountHolder: bankRecord.accountHolder,
        accountNumberMasked: bankRecord.maskedAccountNumber,
        branchCode: bankRecord.branchCode,
        accountType: bankRecord.accountType,
        status: bankRecord.status,
      },
      expiresAt: expiresAtIso,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
      maxAttempts: 1,
    };
  });
}

/**
 * Cancels an active withdrawal verification challenge (or records user rejection of bank details).
 * Never reserves funds or creates a withdrawal transaction.
 */
async function cancelWithdrawalChallenge({
  challengeId = null,
  userId,
  userEmail = null,
  reason = 'user_cancelled',
  requestIp = '127.0.0.1',
}) {
  if (!userId) {
    const err = new Error('Authenticated user ID is required.');
    err.code = 'UNAUTHORIZED';
    err.statusCode = 401;
    throw err;
  }

  return withUserChallengeLock(userId, async () => {
    const cleanReason = String(reason || 'user_cancelled').trim();

    // If user declined at the "Are these your bank details?" step before a challengeId was created
    if (!challengeId) {
      await invalidatePriorPendingChallenges(userId, cleanReason);
      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_CANCELLED',
        actorId: userId,
        actorEmail: userEmail || 'collector@smartassets.io',
        category: 'Vault',
        ip: requestIp,
        description: `User ${userId} cancelled withdrawal before code generation (${cleanReason}). No funds reserved.`,
        status: 'Cancelled',
      });
      return {
        cancelled: true,
        status: 'cancelled',
        reason: cleanReason,
      };
    }

    const challenge = await resolveChallengeById(challengeId);
    if (!challenge) {
      const err = new Error('Withdrawal verification challenge not found.');
      err.code = 'CHALLENGE_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (String(challenge.user_id) !== String(userId)) {
      const err = new Error('Forbidden: You cannot cancel another user’s withdrawal verification challenge.');
      err.code = 'CHALLENGE_USER_MISMATCH';
      err.statusCode = 403;
      throw err;
    }

    if (challenge.status === 'verified') {
      const err = new Error('This withdrawal verification challenge has already been verified and consumed.');
      err.code = 'CHALLENGE_ALREADY_CONSUMED';
      err.statusCode = 409;
      throw err;
    }

    if (challenge.status === 'pending') {
      const cancelTime = nowIso();
      await persistChallengeUpdate(challenge.id, {
        status: 'cancelled',
        cancelled_at: cancelTime,
        cancellation_reason: cleanReason,
        updated_at: cancelTime,
      });
    }

    auditLogService.logEvent({
      eventType: 'WITHDRAWAL_CHALLENGE_CANCELLED',
      actorId: userId,
      actorEmail: userEmail || challenge.email_masked,
      category: 'Vault',
      ip: requestIp,
      description: `User ${userId} cancelled withdrawal OTP challenge ${challenge.id} (Attempt: ${challenge.attempt_id}). Reason: ${cleanReason}. No funds reserved.`,
      status: 'Cancelled',
    });

    return {
      challengeId: challenge.id,
      attemptId: challenge.attempt_id,
      cancelled: true,
      status: 'cancelled',
      reason: cleanReason,
    };
  });
}

/**
 * Step 5-8: Verifies the 6-digit email OTP code and, only upon single-use verification and
 * full server-side re-validation, atomically reserves funds and submits a `pending_review`
 * withdrawal to the admin treasury queue.
 */
async function verifyWithdrawalChallengeAndSubmit({
  challengeId,
  code,
  userId,
  userEmail = null,
  amount = null,
  currency = 'ZAR',
  notes = null,
  idempotencyKey = null,
  requestIp = '127.0.0.1',
  rawBody = {},
}) {
  if (!userId) {
    const err = new Error('Authenticated user ID is required.');
    err.code = 'UNAUTHORIZED';
    err.statusCode = 401;
    throw err;
  }

  // 1. Validate destination/email overrides first so unapproved destination attacks are caught immediately
  const { authoritativeEmail, bankRecord } = await resolveAuthoritativeUserAndBank(
    userId,
    userEmail
  );
  assertNoClientDestinationOrEmailOverride(rawBody, bankRecord, authoritativeEmail);

  // 2. Require challengeId and 6-digit code
  if (!challengeId || !String(challengeId).trim()) {
    const err = new Error(
      'Email verification required: Please confirm your approved bank account details and verify the 6-digit email code before submitting a withdrawal.'
    );
    err.code = 'WITHDRAWAL_OTP_REQUIRED';
    err.statusCode = 403;
    throw err;
  }

  const rawCodeStr = code !== undefined && code !== null ? String(code).trim() : '';
  if (!rawCodeStr) {
    const err = new Error('Please enter the 6-digit verification code sent to your email address.');
    err.code = 'WITHDRAWAL_OTP_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  return withUserChallengeLock(userId, async () => {
    // 3. Enforce verification rate limits by account and IP
    await checkAndIncrementRateLimit(
      `verify:user:${userId}`,
      MAX_VERIFY_ATTEMPTS_PER_USER_WINDOW
    );
    if (requestIp) {
      await checkAndIncrementRateLimit(
        `verify:ip:${requestIp}`,
        MAX_VERIFY_ATTEMPTS_PER_IP_WINDOW
      );
    }

    // 4. Load durable challenge from Supabase
    const challenge = await resolveChallengeById(challengeId);
    if (!challenge) {
      const err = new Error('Withdrawal verification challenge not found or invalid.');
      err.code = 'CHALLENGE_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // 5. Verify challenge belongs to the authenticated user
    if (String(challenge.user_id) !== String(userId)) {
      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_USER_MISMATCH',
        actorId: userId,
        actorEmail: authoritativeEmail,
        category: 'Security',
        ip: requestIp,
        description: `User ${userId} attempted to verify withdrawal challenge ${challenge.id} belonging to user ${challenge.user_id}.`,
        status: 'Blocked',
      });
      const err = new Error('Forbidden: Withdrawal verification challenge belongs to a different user.');
      err.code = 'CHALLENGE_USER_MISMATCH';
      err.statusCode = 403;
      throw err;
    }

    const effectiveIdemKey = idempotencyKey || challenge.idempotency_key || null;

    // 6. Check idempotent replay if already verified with the same idempotencyKey
    if (challenge.status === 'verified' && challenge.withdrawal_tx_id) {
      if (effectiveIdemKey && challenge.idempotency_key === effectiveIdemKey) {
        const existingIdem = await vaultTxService.fetchUserTransactions(userId);
        const foundTx = existingIdem.find((t) => t.id === challenge.withdrawal_tx_id);
        const balDetails = await vaultTxService.getUserBalanceDetails(userId);
        return {
          userId,
          transaction: foundTx || {
            id: challenge.withdrawal_tx_id,
            userId,
            type: 'withdraw',
            amount: Number(challenge.amount),
            status: 'pending_review',
            destination: challenge.destination_summary,
            destinationSummary: challenge.destination_summary,
          },
          status: 'pending_review',
          destination: challenge.destination_summary,
          bankAccountId: challenge.bank_account_id,
          newBalanceNum: balDetails.availableBalanceNum,
          newBalanceFormatted: balDetails.availableBalanceFormatted,
          totalBalanceNum: balDetails.totalBalanceNum,
          reservedBalanceNum: balDetails.reservedBalanceNum,
          reservedBalanceFormatted: balDetails.reservedBalanceFormatted,
          duplicate: true,
          idempotent: true,
          challengeId: challenge.id,
          attemptId: challenge.attempt_id,
        };
      }

      const err = new Error(
        'This withdrawal verification code has already been used. Each code is valid for a single withdrawal only.'
      );
      err.code = 'CHALLENGE_ALREADY_CONSUMED';
      err.statusCode = 409;
      throw err;
    }

    // 7. Reject if challenge is already cancelled, expired, or has already had 1 attempt
    if (challenge.status !== 'pending' || Number(challenge.attempt_count || 0) >= 1) {
      const isExpired = challenge.status === 'expired';
      const err = new Error(
        isExpired
          ? 'Verification code expired after 2 minutes. This withdrawal attempt was cancelled and no funds were reserved.'
          : 'This verification challenge has been cancelled and can no longer be used. Please start a new withdrawal.'
      );
      err.code = isExpired ? 'CHALLENGE_EXPIRED' : 'CHALLENGE_INVALIDATED';
      err.statusCode = isExpired ? 410 : 409;
      throw err;
    }

    // 8. Enforce 120-second server-clock expiry BEFORE comparing the code
    const currentMs = nowMs();
    const expiresAtMs = Date.parse(challenge.expires_at);
    if (!Number.isFinite(expiresAtMs) || currentMs >= expiresAtMs) {
      const expiredTime = new Date(currentMs).toISOString();
      await persistChallengeUpdate(challenge.id, {
        status: 'expired',
        cancelled_at: expiredTime,
        cancellation_reason: 'expired_120s',
        updated_at: expiredTime,
      });

      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_EXPIRED',
        actorId: userId,
        actorEmail: authoritativeEmail,
        category: 'Vault',
        ip: requestIp,
        description: `Withdrawal OTP challenge ${challenge.id} (Attempt: ${challenge.attempt_id}, Amount: ${formatZar(challenge.amount)}) expired after 120s. Attempt marked expired/cancelled; no funds reserved.`,
        status: 'Expired',
      });

      const err = new Error(
        'Verification code expired (2-minute limit reached). This withdrawal attempt was cancelled and no funds were reserved.'
      );
      err.code = 'CHALLENGE_EXPIRED';
      err.statusCode = 410;
      throw err;
    }

    // 9. Verify challenge binding to amount and currency if supplied by caller
    const challengeAmount = Number(challenge.amount);
    if (amount !== null && amount !== undefined) {
      const requestedAmount = Number(amount);
      if (!Number.isFinite(requestedAmount) || Math.abs(requestedAmount - challengeAmount) > 0.001) {
        const cancelTime = new Date(currentMs).toISOString();
        await persistChallengeUpdate(challenge.id, {
          attempt_count: 1,
          status: 'cancelled',
          cancelled_at: cancelTime,
          cancellation_reason: 'amount_binding_mismatch',
          updated_at: cancelTime,
        });

        auditLogService.logEvent({
          eventType: 'WITHDRAWAL_CHALLENGE_CANCELLED',
          actorId: userId,
          actorEmail: authoritativeEmail,
          category: 'Security',
          ip: requestIp,
          description: `Withdrawal OTP challenge ${challenge.id} invalidated due to amount mismatch (challenge: ${formatZar(challengeAmount)}, submitted: ${formatZar(requestedAmount)}).`,
          status: 'Blocked',
        });

        const err = new Error(
          'Security binding mismatch: Withdrawal amount does not match the amount confirmed for this verification challenge. Challenge cancelled.'
        );
        err.code = 'CHALLENGE_BINDING_MISMATCH';
        err.statusCode = 400;
        throw err;
      }
    }

    if (currency && String(currency).toUpperCase() !== String(challenge.currency || 'ZAR').toUpperCase()) {
      const cancelTime = new Date(currentMs).toISOString();
      await persistChallengeUpdate(challenge.id, {
        attempt_count: 1,
        status: 'cancelled',
        cancelled_at: cancelTime,
        cancellation_reason: 'currency_binding_mismatch',
        updated_at: cancelTime,
      });

      const err = new Error('Security binding mismatch: Currency does not match challenge.');
      err.code = 'CHALLENGE_BINDING_MISMATCH';
      err.statusCode = 400;
      throw err;
    }

    // 10. Strictly ONE submission attempt per challenge:
    //     Compute expected HMAC using challenge's stored bindings and compare in constant time.
    const candidateHash = computeOtpHash({
      code: rawCodeStr,
      salt: challenge.otp_salt,
      challengeId: challenge.id,
      userId: challenge.user_id,
      attemptId: challenge.attempt_id,
      amount: challengeAmount,
      currency: challenge.currency || 'ZAR',
      bankAccountId: challenge.bank_account_id,
      bankVersionHash: challenge.bank_version_hash,
    });

    const isCodeValid =
      /^\d{6}$/.test(rawCodeStr) && timingSafeHashMatch(challenge.otp_hash, candidateHash);

    if (!isCodeValid) {
      const failTime = new Date(currentMs).toISOString();
      await persistChallengeUpdate(challenge.id, {
        attempt_count: 1,
        status: 'cancelled',
        cancelled_at: failTime,
        cancellation_reason: 'invalid_code_single_attempt_exhausted',
        updated_at: failTime,
      });

      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_INCORRECT',
        actorId: userId,
        actorEmail: authoritativeEmail,
        category: 'Security',
        ip: requestIp,
        description: `Incorrect OTP code submitted for withdrawal challenge ${challenge.id} (Attempt: ${challenge.attempt_id}, Amount: ${formatZar(challengeAmount)}). Challenge immediately invalidated and marked cancelled after 1 attempt. No funds reserved.`,
        status: 'Cancelled',
      });

      const err = new Error(
        'Incorrect verification code. Only 1 attempt is allowed per code—this withdrawal attempt has been cancelled and no funds were reserved.'
      );
      err.code = 'INVALID_OTP_CODE';
      err.statusCode = 400;
      throw err;
    }

    // 11. Code is valid! Re-verify approved bank account binding & version hash
    if (
      String(bankRecord.id) !== String(challenge.bank_account_id) ||
      String(bankRecord.bankVersionHash) !== String(challenge.bank_version_hash)
    ) {
      const cancelTime = new Date(currentMs).toISOString();
      await persistChallengeUpdate(challenge.id, {
        attempt_count: 1,
        status: 'cancelled',
        cancelled_at: cancelTime,
        cancellation_reason: 'bank_account_changed_since_challenge',
        updated_at: cancelTime,
      });

      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_CANCELLED',
        actorId: userId,
        actorEmail: authoritativeEmail,
        category: 'Security',
        ip: requestIp,
        description: `Withdrawal challenge ${challenge.id} cancelled at verification because user's approved bank account details or version changed after challenge creation.`,
        status: 'Blocked',
      });

      const err = new Error(
        'Your bank account details changed or were modified after this verification code was issued. For your security, this withdrawal was cancelled.'
      );
      err.code = 'BANK_DETAILS_CHANGED';
      err.statusCode = 403;
      throw err;
    }

    // 12. Consume challenge ONCE and atomically reserve funds + create `pending_review` withdrawal
    const consumedTime = new Date(currentMs).toISOString();
    await persistChallengeUpdate(challenge.id, {
      attempt_count: 1,
      status: 'verified',
      consumed_at: consumedTime,
      idempotency_key: effectiveIdemKey,
      updated_at: consumedTime,
    });

    let withdrawalResult;
    try {
      withdrawalResult = await vaultTxService.withdrawFunds({
        userId,
        userEmail: authoritativeEmail,
        amount: challengeAmount,
        method: 'Approved Bank EFT',
        notes:
          notes ||
          `Email-verified withdrawal (${challenge.attempt_id}) pending manual treasury EFT payout to ${bankRecord.destinationSummary} (${bankRecord.accountHolder})`,
        idempotencyKey: effectiveIdemKey || `wth-otp-${challenge.id}`,
        approvedBank: {
          id: bankRecord.id,
          bank_name: bankRecord.bankName,
          account_number: bankRecord.accountNumber,
          account_holder: bankRecord.accountHolder,
          branch_code: bankRecord.branchCode,
          account_type: bankRecord.accountType,
          status: 'approved',
        },
      });
    } catch (wthErr) {
      // If reservation/balance check fails (e.g. insufficient balance at verification time),
      // mark the challenge cancelled so it cannot be re-used and propagate the error cleanly.
      await persistChallengeUpdate(challenge.id, {
        attempt_count: 1,
        status: 'cancelled',
        cancelled_at: nowIso(),
        cancellation_reason: wthErr.code || 'withdrawal_reservation_failed',
        updated_at: nowIso(),
      }).catch(() => {});

      auditLogService.logEvent({
        eventType: 'WITHDRAWAL_CHALLENGE_CANCELLED',
        actorId: userId,
        actorEmail: authoritativeEmail,
        category: 'Vault',
        ip: requestIp,
        description: `Withdrawal challenge ${challenge.id} failed post-OTP eligibility/reservation check (${wthErr.code || wthErr.message}). No funds reserved.`,
        status: 'Failed',
      });
      throw wthErr;
    }

    const txId = withdrawalResult?.transaction?.id || null;
    if (txId) {
      await persistChallengeUpdate(challenge.id, {
        withdrawal_tx_id: txId,
        updated_at: nowIso(),
      }).catch(() => {});
    }

    auditLogService.logEvent({
      eventType: 'WITHDRAWAL_CHALLENGE_VERIFIED',
      actorId: userId,
      actorEmail: authoritativeEmail,
      category: 'Vault',
      ip: requestIp,
      description: `User ${userId} verified withdrawal OTP challenge ${challenge.id} (Attempt: ${challenge.attempt_id}) and submitted pending_review withdrawal ${txId} for ${formatZar(challengeAmount)} to ${bankRecord.destinationSummary}.`,
      status: 'Success',
    });

    return {
      ...withdrawalResult,
      status: 'pending_review',
      challengeId: challenge.id,
      attemptId: challenge.attempt_id,
      emailVerified: true,
    };
  });
}

module.exports = {
  CHALLENGE_TTL_SECONDS,
  CHALLENGE_TTL_MS,
  computeBankVersionHash,
  computeOtpHash,
  maskEmailAddress,
  requestWithdrawalChallenge,
  cancelWithdrawalChallenge,
  verifyWithdrawalChallengeAndSubmit,
  resolveChallengeById,
  _setClockForTesting,
  _setEmailTransportForTesting,
  _clearRuntimeCacheForTesting,
};
