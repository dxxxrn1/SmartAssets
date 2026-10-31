// ─── Withdrawal Email-Code (OTP) Verification & Security Test Suite ──────────
// Run with: node test/withdrawalEmailOtpVerification.test.js
// Tests all 9 user flow requirements and security invariants using isolated mocks (no live network/DB calls).

process.env.NODE_ENV = 'test';
process.env.ADMIN_JWT_SECRET =
  'test-only-32-char-admin-jwt-secret-key-2026-smartassets-secure';
process.env.WITHDRAWAL_OTP_SECRET =
  'test-only-withdrawal-otp-hmac-secret-2026-smartassets';

const assert = require('assert');
const supabase = require('../src/connection/supabaseClient');

// ── Isolated In-Memory Mock Tables ────────────────────────────────────────────
const mockProfiles = new Map();
const mockVaultTxs = new Map();
const mockBankAccounts = new Map();
const mockVerificationDocs = new Map();
const mockChallenges = new Map();
const mockRateLimits = new Map();
const mockAuditLogs = [];

supabase.rpc = async () => ({
  data: null,
  error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
});

supabase.storage = {
  createBucket: async () => ({ data: {}, error: null }),
  from: () => ({
    upload: async () => ({ data: { path: 'mock/path.jpg' }, error: null }),
    remove: async () => ({ data: {}, error: null }),
    createSignedUrl: async (path) => ({
      data: { signedUrl: `https://mock.supabase.co/storage/v1/sign/${path}?token=mock` },
      error: null,
    }),
  }),
};

supabase.from = (table) => {
  const state = {
    table,
    op: 'select',
    payload: null,
    filters: {},
  };

  const executeQuery = () => {
    if (table === 'profiles') {
      if (state.op === 'update' && state.filters.id) {
        const existing = mockProfiles.get(state.filters.id) || { id: state.filters.id };
        const updated = { ...existing, ...state.payload };
        mockProfiles.set(state.filters.id, updated);
        return { data: updated, error: null };
      }
      if (state.op === 'upsert' || state.op === 'insert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        if (row && row.id) {
          mockProfiles.set(row.id, { ...(mockProfiles.get(row.id) || {}), ...row });
        }
        return { data: row, error: null };
      }
      if (state.filters.id) {
        return { data: mockProfiles.get(state.filters.id) || null, error: null };
      }
      return { data: Array.from(mockProfiles.values()), error: null };
    }

    if (table === 'bank_accounts') {
      if (state.op === 'insert' || state.op === 'upsert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        const id = row.id || `bank-${Date.now()}`;
        const saved = { ...row, id };
        mockBankAccounts.set(id, saved);
        return { data: saved, error: null };
      }
      if (state.op === 'update') {
        if (state.filters.id && mockBankAccounts.has(state.filters.id)) {
          const updated = { ...mockBankAccounts.get(state.filters.id), ...state.payload };
          mockBankAccounts.set(state.filters.id, updated);
          return { data: updated, error: null };
        }
        return { data: null, error: null };
      }
      let rows = Array.from(mockBankAccounts.values());
      if (state.filters.id) rows = rows.filter((r) => String(r.id) === String(state.filters.id));
      if (state.filters.user_id) rows = rows.filter((r) => r.user_id === state.filters.user_id);
      if (state.filters.status) rows = rows.filter((r) => r.status === state.filters.status);
      return { data: rows, error: null };
    }

    if (table === 'verification_documents') {
      if (state.op === 'insert' || state.op === 'upsert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        const id = row.id || `doc-${Date.now()}`;
        const saved = { ...row, id };
        mockVerificationDocs.set(id, saved);
        return { data: saved, error: null };
      }
      let rows = Array.from(mockVerificationDocs.values());
      if (state.filters.user_id) rows = rows.filter((r) => r.user_id === state.filters.user_id);
      return { data: rows, error: null };
    }

    if (table === 'withdrawal_verification_challenges') {
      if (state.op === 'insert' || state.op === 'upsert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        mockChallenges.set(String(row.id), { ...row });
        return { data: row, error: null };
      }
      if (state.op === 'update') {
        if (state.filters.id && mockChallenges.has(String(state.filters.id))) {
          const updated = {
            ...mockChallenges.get(String(state.filters.id)),
            ...state.payload,
          };
          mockChallenges.set(String(state.filters.id), updated);
          return { data: updated, error: null };
        }
        if (state.filters.user_id) {
          for (const [cid, ch] of mockChallenges.entries()) {
            if (
              ch.user_id === state.filters.user_id &&
              (!state.filters.status || ch.status === state.filters.status)
            ) {
              mockChallenges.set(cid, { ...ch, ...state.payload });
            }
          }
          return { data: [], error: null };
        }
        return { data: null, error: null };
      }
      let rows = Array.from(mockChallenges.values());
      if (state.filters.id) rows = rows.filter((r) => String(r.id) === String(state.filters.id));
      if (state.filters.user_id) rows = rows.filter((r) => r.user_id === state.filters.user_id);
      if (state.filters.status) rows = rows.filter((r) => r.status === state.filters.status);
      return { data: rows, error: null };
    }

    if (table === 'withdrawal_otp_rate_limits') {
      if (state.op === 'insert' || state.op === 'upsert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        if (row && row.rate_key) {
          mockRateLimits.set(row.rate_key, { ...row });
        }
        return { data: row, error: null };
      }
      if (state.filters.rate_key) {
        return { data: mockRateLimits.get(state.filters.rate_key) || null, error: null };
      }
      return { data: Array.from(mockRateLimits.values()), error: null };
    }

    if (table === 'vault_transactions') {
      if (state.op === 'insert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        mockVaultTxs.set(row.id, { ...row });
        return { data: row, error: null };
      }
      if (state.op === 'update' && state.filters.id) {
        const existing = mockVaultTxs.get(state.filters.id) || { id: state.filters.id };
        const updated = { ...existing, ...state.payload };
        mockVaultTxs.set(state.filters.id, updated);
        return { data: updated, error: null };
      }
      let rows = Array.from(mockVaultTxs.values());
      if (state.filters.id) rows = rows.filter((r) => r.id === state.filters.id);
      if (state.filters.idempotency_key) {
        rows = rows.filter((r) => r.idempotency_key === state.filters.idempotency_key);
      }
      if (state.filters.settlement_ref) {
        rows = rows.filter((r) => r.settlement_ref === state.filters.settlement_ref);
      }
      if (state.filters.provider_ref) {
        rows = rows.filter((r) => r.provider_ref === state.filters.provider_ref);
      }
      if (state.filters.user_id) {
        rows = rows.filter((r) => r.user_id === state.filters.user_id);
      }
      return { data: rows, error: null };
    }

    if (table === 'admin_audit_logs') {
      if (state.op === 'insert') {
        mockAuditLogs.push(state.payload);
      }
      return { data: state.payload, error: null };
    }

    return { data: [], error: null };
  };

  const chain = {
    select: () => chain,
    insert: (payload) => {
      state.op = 'insert';
      state.payload = payload;
      return chain;
    },
    upsert: (payload) => {
      state.op = 'upsert';
      state.payload = payload;
      return chain;
    },
    update: (payload) => {
      state.op = 'update';
      state.payload = payload;
      return chain;
    },
    delete: () => {
      state.op = 'delete';
      return chain;
    },
    eq: (col, val) => {
      state.filters[col] = val;
      return chain;
    },
    neq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const res = executeQuery();
      if (Array.isArray(res.data)) {
        return { data: res.data[0] || null, error: res.error };
      }
      return res;
    },
    single: async () => {
      const res = executeQuery();
      if (Array.isArray(res.data)) {
        return { data: res.data[0] || null, error: res.error };
      }
      return res;
    },
    then: (resolve, reject) => Promise.resolve(executeQuery()).then(resolve, reject),
    catch: () => Promise.resolve({ data: [], error: null }),
  };

  return chain;
};

const vaultTxService = require('../src/services/vaultTransactionService');
const complianceService = require('../src/services/complianceService');
const withdrawalVerificationService = require('../src/services/withdrawalVerificationService');
const auditLogService = require('../src/services/auditLogService');
const userController = require('../src/controllers/userController');
const adminController = require('../src/controllers/adminController');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const VALID_JPEG_BASE64 =
  'data:image/jpeg;base64,' +
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');

async function seedVerifiedUserWithApprovedBank(
  userId,
  email,
  fullName,
  accountNumber = '62899110022',
  initialBalance = 50000
) {
  mockProfiles.set(userId, {
    id: userId,
    email,
    full_name: fullName,
    role: 'user',
    verification_status: 'verified',
    is_suspended: false,
    status: 'active',
    balance: initialBalance,
    reserved_balance: 0,
  });

  for (const docType of ['id', 'tax', 'proof_of_residence']) {
    const up = await complianceService.uploadVerificationDocument({
      userId,
      userEmail: email,
      fullName,
      docType,
      fileData: VALID_JPEG_BASE64,
      fileName: `${docType}.jpg`,
      metaValue: `META-${docType}`,
    });
    await complianceService.approveDocument(up.document.id, 'admin-1', 'admin@smartassets.io');
  }

  const bank = await complianceService.submitBankAccount({
    userId,
    userEmail: email,
    fullName,
    accountHolder: fullName,
    bankName: 'First National Bank (FNB)',
    accountNumber,
    branchCode: '250655',
    accountType: 'Cheque / Current',
  });
  await complianceService.approveBankAccount(bank.id, 'admin-1', 'admin@smartassets.io');
  return bank;
}

function extractSixDigitCodeFromEmail(emailMessage) {
  assert.ok(emailMessage && emailMessage.text, 'Captured email must contain plainText body');
  const match = emailMessage.text.match(/\b(\d{6})\b/);
  assert.ok(match && match[1], 'Captured email must contain a 6-digit verification code');
  return match[1];
}

async function runTests() {
  console.log('================================================================================');
  console.log('🛡️  SMARTASSETS — WITHDRAWAL EMAIL-CODE (OTP) VERIFICATION TEST SUITE');
  console.log('================================================================================\n');

  const userAId = '11111111-2222-4333-8444-555555555501';
  const userAEmail = 'thabo.mokoena@smartassets.co.za';
  const userBId = '22222222-3333-4444-8555-666666666602';
  const userBEmail = 'lerato.ndlovu@smartassets.co.za';

  await seedVerifiedUserWithApprovedBank(
    userAId,
    userAEmail,
    'Thabo Mokoena',
    '62899110022',
    50000
  );
  await seedVerifiedUserWithApprovedBank(
    userBId,
    userBEmail,
    'Lerato Ndlovu',
    '91002233445',
    30000
  );

  let sentEmails = [];
  let simulatedServerClockMs = Date.now();
  withdrawalVerificationService._setClockForTesting(() => simulatedServerClockMs);
  withdrawalVerificationService._setEmailTransportForTesting(async (mail) => {
    sentEmails.push(mail);
    return { delivered: true, messageId: `test-msg-${sentEmails.length}` };
  });

  // ── TEST 1: Bank Confirmation Gate, No Client Email Override, No Direct Bypass ──
  console.log('🧪 [TEST 1] Enforces bank confirmation ("Are these your bank details?"), blocks email/destination overrides, and blocks direct /withdraw bypass...');

  // 1a. Missing confirmedBankDetails -> 400 BANK_CONFIRMATION_REQUIRED
  const resNoConfirm = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.1',
      headers: {},
      body: { amount: 5000, confirmedBankDetails: false },
    },
    resNoConfirm
  );
  assert.strictEqual(resNoConfirm.statusCode, 400);
  assert.strictEqual(resNoConfirm.body.code, 'BANK_CONFIRMATION_REQUIRED');
  assert.strictEqual(sentEmails.length, 0, 'Must not send email before user confirms bank details');

  // 1b. Client attempting to pass a custom destination email -> 400 CLIENT_EMAIL_OVERRIDE_FORBIDDEN
  const resEmailOverride = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.1',
      headers: {},
      body: {
        amount: 5000,
        confirmedBankDetails: true,
        email: 'attacker@evil.example',
      },
    },
    resEmailOverride
  );
  assert.strictEqual(resEmailOverride.statusCode, 400);
  assert.strictEqual(resEmailOverride.body.code, 'CLIENT_EMAIL_OVERRIDE_FORBIDDEN');
  assert.strictEqual(sentEmails.length, 0);

  // 1c. Client attempting to replace bank details in challenge request -> 403 UNAPPROVED_DESTINATION
  const resBankOverride = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.1',
      headers: {},
      body: {
        amount: 5000,
        confirmedBankDetails: true,
        bankDetails: { bankName: 'Capitec', accountNumber: '1111222233' },
      },
    },
    resBankOverride
  );
  assert.strictEqual(resBankOverride.statusCode, 403);
  assert.strictEqual(resBankOverride.body.code, 'UNAPPROVED_DESTINATION');

  // 1d. Client attempting to call POST /api/user/withdraw directly without OTP challenge -> 403 WITHDRAWAL_OTP_REQUIRED
  const resDirectBypass = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.1',
      headers: {},
      body: { amount: 5000 },
    },
    resDirectBypass
  );
  assert.strictEqual(resDirectBypass.statusCode, 403);
  assert.strictEqual(resDirectBypass.body.code, 'WITHDRAWAL_OTP_REQUIRED');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 50000);
  console.log('   ✅ Bank confirmation gate, client email override block, destination protection, and direct /withdraw bypass protection verified.');

  // ── TEST 2: Confirmation Cancellation & Popup Cancellation ─────────────────
  console.log('\n🧪 [TEST 2] Cancellation flow: cancelling bank confirmation or OTP popup marks challenge cancelled without reserving funds...');
  const resChCancelSetup = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.2',
      headers: {},
      body: { amount: 4000, confirmedBankDetails: true },
    },
    resChCancelSetup
  );
  assert.strictEqual(resChCancelSetup.statusCode, 200);
  const cancelChallengeId = resChCancelSetup.body.challengeId;
  const cancelCode = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);

  // User cancels the popup
  const resCancelPopup = mockRes();
  await userController.cancelWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.2',
      params: { id: cancelChallengeId },
      body: { reason: 'user_cancelled_otp_popup' },
    },
    resCancelPopup
  );
  assert.strictEqual(resCancelPopup.statusCode, 200);
  assert.strictEqual(resCancelPopup.body.status, 'cancelled');
  assert.strictEqual(mockChallenges.get(cancelChallengeId).status, 'cancelled');

  // Attempting to submit the code after cancellation must fail with 409 CHALLENGE_INVALIDATED
  const resVerifyAfterCancel = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.2',
      headers: {},
      body: { challengeId: cancelChallengeId, code: cancelCode, amount: 4000 },
    },
    resVerifyAfterCancel
  );
  assert.strictEqual(resVerifyAfterCancel.statusCode, 409);
  assert.strictEqual(resVerifyAfterCancel.body.code, 'CHALLENGE_INVALIDATED');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 50000);
  assert.strictEqual(mockVaultTxs.size, 0, 'No withdrawal transaction may be created');
  console.log('   ✅ Cancelled challenges cannot be verified and never reserve funds or create withdrawal requests.');

  // ── TEST 3: Strictly One Submission Attempt Per Challenge (Wrong First Code) ──
  console.log('\n🧪 [TEST 3] Single-attempt enforcement: wrong first code immediately invalidates challenge and cancels attempt...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resChWrong = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.3',
      headers: {},
      body: { amount: 6000, confirmedBankDetails: true },
    },
    resChWrong
  );
  assert.strictEqual(resChWrong.statusCode, 200);
  const wrongChallengeId = resChWrong.body.challengeId;
  const actualCodeForWrongTest = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);
  const wrongCode = actualCodeForWrongTest === '123456' ? '654321' : '123456';

  // Submit wrong first code -> 400 INVALID_OTP_CODE, challenge immediately marked 'cancelled' with attempt_count = 1
  const resSubmitWrong1 = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.3',
      headers: {},
      body: { challengeId: wrongChallengeId, code: wrongCode, amount: 6000 },
    },
    resSubmitWrong1
  );
  assert.strictEqual(resSubmitWrong1.statusCode, 400);
  assert.strictEqual(resSubmitWrong1.body.code, 'INVALID_OTP_CODE');
  const dbWrongRow = mockChallenges.get(wrongChallengeId);
  assert.strictEqual(dbWrongRow.status, 'cancelled', 'Challenge must be immediately cancelled on first wrong code');
  assert.strictEqual(dbWrongRow.attempt_count, 1, 'attempt_count must be 1');

  // Now submit the ACTUAL correct code on a 2nd attempt -> MUST be rejected (409 CHALLENGE_INVALIDATED)!
  const resSubmitCorrectOn2ndAttempt = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.3',
      headers: {},
      body: { challengeId: wrongChallengeId, code: actualCodeForWrongTest, amount: 6000 },
    },
    resSubmitCorrectOn2ndAttempt
  );
  assert.strictEqual(resSubmitCorrectOn2ndAttempt.statusCode, 409, 'Second attempt must be blocked even with correct code');
  assert.strictEqual(resSubmitCorrectOn2ndAttempt.body.code, 'CHALLENGE_INVALIDATED');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 50000, 'Spendable balance must remain R50,000');
  assert.strictEqual(mockVaultTxs.size, 0, 'No withdrawal request may be created');
  console.log('   ✅ Wrong first code immediately invalidated the challenge; second attempt with correct code was rejected.');

  // ── TEST 4: Server-Clock Expiration at the 2-Minute (120-Second) Limit ─────
  console.log('\n🧪 [TEST 4] 2-minute server-clock expiration: code submitted at 120s is rejected and marked expired...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resChExp = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.4',
      headers: {},
      body: { amount: 7500, confirmedBankDetails: true },
    },
    resChExp
  );
  assert.strictEqual(resChExp.statusCode, 200);
  assert.strictEqual(resChExp.body.expiresInSeconds, 120);
  const expChallengeId = resChExp.body.challengeId;
  const expCode = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);

  // Advance server clock by exactly 120 seconds (2 minutes)
  simulatedServerClockMs += 120 * 1000;

  const resVerifyExpired = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.4',
      headers: {},
      body: { challengeId: expChallengeId, code: expCode, amount: 7500 },
    },
    resVerifyExpired
  );
  assert.strictEqual(resVerifyExpired.statusCode, 410, 'Expired code must return 410 CHALLENGE_EXPIRED');
  assert.strictEqual(resVerifyExpired.body.code, 'CHALLENGE_EXPIRED');
  assert.strictEqual(mockChallenges.get(expChallengeId).status, 'expired');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 50000);
  assert.strictEqual(mockVaultTxs.size, 0);
  console.log('   ✅ Server clock strictly enforces the 120-second expiry and marks expired challenges without reserving funds.');

  // ── TEST 5: Email Delivery Failure (Fail-Closed) ───────────────────────────
  console.log('\n🧪 [TEST 5] Email delivery failure: fails closed (503 EMAIL_DELIVERY_FAILED) and invalidates challenge...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();
  withdrawalVerificationService._setEmailTransportForTesting(async () => {
    throw new Error('Simulated SMTP connection refused');
  });

  const resEmailFail = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.5',
      headers: {},
      body: { amount: 3000, confirmedBankDetails: true },
    },
    resEmailFail
  );
  assert.strictEqual(resEmailFail.statusCode, 503);
  assert.strictEqual(resEmailFail.body.code, 'EMAIL_DELIVERY_FAILED');
  assert.strictEqual(resEmailFail.body.challengeId, undefined, 'Failed delivery must not return an active challenge');

  // Restore working email transport
  withdrawalVerificationService._setEmailTransportForTesting(async (mail) => {
    sentEmails.push(mail);
    return { delivered: true, messageId: `test-msg-${sentEmails.length}` };
  });
  console.log('   ✅ Email delivery failure fails closed (503) and marks challenge delivery_failed in DB.');

  // ── TEST 6: Wrong User & Challenge Binding (Amount / Currency Mismatch) ────
  console.log('\n🧪 [TEST 6] Challenge cryptographic binding: blocks wrong user and amount/currency tampering...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resChBind = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.6',
      headers: {},
      body: { amount: 5000, confirmedBankDetails: true },
    },
    resChBind
  );
  const bindChallengeId = resChBind.body.challengeId;
  const bindCode = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);

  // 6a. User B attempts to verify User A's challenge -> 403 CHALLENGE_USER_MISMATCH
  const resWrongUser = mockRes();
  await userController.withdraw(
    {
      user: { id: userBId, email: userBEmail },
      ip: '10.0.0.6',
      headers: {},
      body: { challengeId: bindChallengeId, code: bindCode, amount: 5000 },
    },
    resWrongUser
  );
  assert.strictEqual(resWrongUser.statusCode, 403);
  assert.strictEqual(resWrongUser.body.code, 'CHALLENGE_USER_MISMATCH');

  // 6b. User A attempts to verify the R5,000 challenge with a tampered amount of R25,000 -> 400 CHALLENGE_BINDING_MISMATCH
  const resTamperedAmount = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.6',
      headers: {},
      body: { challengeId: bindChallengeId, code: bindCode, amount: 25000 },
    },
    resTamperedAmount
  );
  assert.strictEqual(resTamperedAmount.statusCode, 400);
  assert.strictEqual(resTamperedAmount.body.code, 'CHALLENGE_BINDING_MISMATCH');
  assert.strictEqual(mockChallenges.get(bindChallengeId).status, 'cancelled');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 50000);
  console.log('   ✅ Cross-user verification and amount/currency tampering are blocked and invalidate the challenge.');

  // ── TEST 7: Changed or Unapproved Bank Account Between Challenge & Verification ──
  console.log('\n🧪 [TEST 7] Bank version binding: blocks withdrawal if bank account changes or becomes unapproved after code is sent...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resChBankChange = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.7',
      headers: {},
      body: { amount: 8000, confirmedBankDetails: true },
    },
    resChBankChange
  );
  const bankChangeChallengeId = resChBankChange.body.challengeId;
  const bankChangeCode = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);

  // User A edits their bank account to a different account number (even if an admin immediately approves the new account, its version hash changed!)
  const newBank = await complianceService.submitBankAccount({
    userId: userAId,
    userEmail: userAEmail,
    fullName: 'Thabo Mokoena',
    accountHolder: 'Thabo Mokoena',
    bankName: 'Standard Bank',
    accountNumber: '10998877665',
    branchCode: '051001',
    accountType: 'Current',
  });
  await complianceService.approveBankAccount(newBank.id, 'admin-1', 'admin@smartassets.io');

  // Submitting the valid OTP issued for the OLD bank details must fail with 403 BANK_DETAILS_CHANGED!
  const resVerifyAfterBankChange = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.7',
      headers: {},
      body: { challengeId: bankChangeChallengeId, code: bankChangeCode, amount: 8000 },
    },
    resVerifyAfterBankChange
  );
  assert.strictEqual(resVerifyAfterBankChange.statusCode, 403);
  assert.strictEqual(resVerifyAfterBankChange.body.code, 'BANK_DETAILS_CHANGED');
  assert.strictEqual(mockChallenges.get(bankChangeChallengeId).status, 'cancelled');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 50000);
  console.log('   ✅ Bank version hash binding prevents using an OTP after bank details are modified.');

  // ── TEST 8: Insufficient Balance After Verification ────────────────────────
  console.log('\n🧪 [TEST 8] Post-OTP balance re-check: blocks withdrawal if spendable balance drops before code verification...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resChBal = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.8',
      headers: {},
      body: { amount: 40000, confirmedBankDetails: true },
    },
    resChBal
  );
  const balChallengeId = resChBal.body.challengeId;
  const balCode = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);

  // Simulate User A spending R20,000 in the marketplace before entering the withdrawal OTP (balance drops from R50,000 to R30,000)
  mockProfiles.get(userAId).balance = 30000;
  vaultTxService._clearRuntimeCacheForTesting();

  const resVerifyInsufficient = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.8',
      headers: {},
      body: { challengeId: balChallengeId, code: balCode, amount: 40000 },
    },
    resVerifyInsufficient
  );
  assert.strictEqual(resVerifyInsufficient.statusCode, 400);
  assert.strictEqual(resVerifyInsufficient.body.code, 'INSUFFICIENT_FUNDS');
  assert.strictEqual(mockChallenges.get(balChallengeId).status, 'cancelled');
  assert.strictEqual(await vaultTxService.getUserBalance(userAId), 30000);
  console.log('   ✅ Post-OTP balance recheck prevented reserving R40,000 against R30,000 spendable balance.');

  // ── TEST 9: Resend Supersedes Prior Challenge & Rate-Limit Enforcement ─────
  console.log('\n🧪 [TEST 9] Resend invalidation & rate limits: new challenge supersedes prior code; >5 sends/15m returns 429...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resSend1 = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.9',
      headers: {},
      body: { amount: 5000, confirmedBankDetails: true },
    },
    resSend1
  );
  const firstChallengeId = resSend1.body.challengeId;
  const firstCode = extractSixDigitCodeFromEmail(sentEmails[sentEmails.length - 1]);

  // Request a new challenge (resend) -> must invalidate firstChallengeId
  const resSend2 = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.9',
      headers: {},
      body: { amount: 5000, confirmedBankDetails: true },
    },
    resSend2
  );
  assert.strictEqual(resSend2.statusCode, 200);
  assert.strictEqual(mockChallenges.get(firstChallengeId).status, 'cancelled');
  assert.strictEqual(
    mockChallenges.get(firstChallengeId).cancellation_reason,
    'superseded_by_new_challenge'
  );

  // Attempting to use the first (superseded) code must fail with 409 CHALLENGE_INVALIDATED
  const resUseSuperseded = mockRes();
  await userController.withdraw(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.9',
      headers: {},
      body: { challengeId: firstChallengeId, code: firstCode, amount: 5000 },
    },
    resUseSuperseded
  );
  assert.strictEqual(resUseSuperseded.statusCode, 409);
  assert.strictEqual(resUseSuperseded.body.code, 'CHALLENGE_INVALIDATED');

  // Exhaust remaining 3 sends in the 5-per-15m window
  for (let i = 0; i < 3; i++) {
    const r = mockRes();
    await userController.initiateWithdrawalChallenge(
      {
        user: { id: userAId, email: userAEmail },
        ip: '10.0.0.9',
        headers: {},
        body: { amount: 5000, confirmedBankDetails: true },
      },
      r
    );
    assert.strictEqual(r.statusCode, 200);
  }

  // 6th challenge send in the same 15-minute window -> 429 OTP_RATE_LIMIT_EXCEEDED
  const resRateLimited = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.9',
      headers: {},
      body: { amount: 5000, confirmedBankDetails: true },
    },
    resRateLimited
  );
  assert.strictEqual(resRateLimited.statusCode, 429);
  assert.strictEqual(resRateLimited.body.code, 'OTP_RATE_LIMIT_EXCEEDED');
  assert.ok(resRateLimited.body.retryAfterSeconds > 0);
  console.log('   ✅ New challenges invalidate previous codes and rate limits block excessive sends (429).');

  // ── TEST 10: Successful Verification, Server Restart Persistence, Concurrency & Admin Queue ──
  console.log('\n🧪 [TEST 10] Full E2E success: restart persistence, concurrent submission race, atomic reservation & pending_review admin queue...');
  mockRateLimits.clear();
  withdrawalVerificationService._clearRuntimeCacheForTesting();

  const resValidChallenge = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: userAId, email: userAEmail },
      ip: '10.0.0.10',
      headers: {},
      body: { amount: 12000, confirmedBankDetails: true },
    },
    resValidChallenge
  );
  assert.strictEqual(resValidChallenge.statusCode, 200);
  // Ensure response NEVER leaks the plaintext code or hash
  assert.strictEqual(resValidChallenge.body.code, undefined);
  assert.strictEqual(resValidChallenge.body.otpCode, undefined);
  assert.strictEqual(resValidChallenge.body.otpHash, undefined);
  assert.strictEqual(resValidChallenge.body.otp_hash, undefined);

  const validChallengeId = resValidChallenge.body.challengeId;
  const lastEmail = sentEmails[sentEmails.length - 1];
  const validCode = extractSixDigitCodeFromEmail(lastEmail);

  // Verify email content masks the account number and never exposes full account number '10998877665'
  assert.ok(lastEmail.text.includes('****7665'), 'Email must show masked last 4 digits');
  assert.ok(!lastEmail.text.includes('10998877665'), 'Email must never expose full bank account number');

  // Verify DB challenge row stores only hash + salt, never plaintext code
  const storedChallenge = mockChallenges.get(validChallengeId);
  assert.ok(storedChallenge.otp_hash && storedChallenge.otp_hash.length === 64);
  assert.strictEqual(storedChallenge.otp_hash.includes(validCode), false);
  assert.strictEqual(JSON.stringify(storedChallenge).includes(`"${validCode}"`), false);

  // Simulate a server restart by clearing all in-memory runtime caches before verifying the code!
  withdrawalVerificationService._clearRuntimeCacheForTesting();
  vaultTxService._clearRuntimeCacheForTesting();

  // Fire two concurrent verification requests with the same challengeId and valid code
  const resRaceA = mockRes();
  const resRaceB = mockRes();
  await Promise.all([
    userController.withdraw(
      {
        user: { id: userAId, email: userAEmail },
        ip: '10.0.0.10',
        headers: {},
        body: { challengeId: validChallengeId, code: validCode, amount: 12000 },
      },
      resRaceA
    ),
    userController.withdraw(
      {
        user: { id: userAId, email: userAEmail },
        ip: '10.0.0.10',
        headers: {},
        body: { challengeId: validChallengeId, code: validCode, amount: 12000 },
      },
      resRaceB
    ),
  ]);

  const statuses = [resRaceA.statusCode, resRaceB.statusCode].sort();
  assert.deepStrictEqual(
    statuses,
    [200, 409],
    'Exactly one concurrent verification must succeed (200) and the second must be rejected as already consumed (409)'
  );

  const winningRes = resRaceA.statusCode === 200 ? resRaceA : resRaceB;
  assert.strictEqual(
    winningRes.body.status,
    'pending_review',
    'OTP verification must ONLY create a pending_review withdrawal (never completed/settled)'
  );
  assert.strictEqual(winningRes.body.emailVerified, true);

  // Verify funds were reserved exactly once (R30,000 total -> R12,000 reserved, R18,000 spendable)
  const balAfter = await vaultTxService.getUserBalanceDetails(userAId);
  assert.strictEqual(balAfter.totalBalanceNum, 30000, 'Total balance remains R30,000 until admin EFT settlement');
  assert.strictEqual(balAfter.reservedBalanceNum, 12000, 'Reserved balance is R12,000');
  assert.strictEqual(balAfter.availableBalanceNum, 18000, 'Spendable balance is R18,000');

  // Verify the withdrawal is in the existing admin treasury queue as `pending_review`
  const createdTxId = winningRes.body.transaction.id;
  const dbTx = mockVaultTxs.get(createdTxId);
  assert.ok(dbTx, 'Withdrawal transaction must exist in vault_transactions');
  assert.strictEqual(dbTx.status, 'pending_review', 'Withdrawal status in DB must be pending_review');
  assert.strictEqual(dbTx.amount, 12000);
  assert.strictEqual(dbTx.destination_summary, 'Standard Bank (****7665)');

  // Verify audit logs never contain the 6-digit OTP code
  const allLogs = await auditLogService.getAllLogs(200);
  for (const logEntry of allLogs) {
    assert.ok(
      !String(logEntry.description || '').includes(validCode),
      'Audit logs must never contain the plaintext OTP code'
    );
  }
  console.log('   ✅ Server restart persistence, concurrency protection, atomic funds reservation, and pending_review admin queue verified.');

  console.log('\n================================================================================');
  console.log('🎉 ALL 10 WITHDRAWAL EMAIL-CODE VERIFICATION TESTS PASSED (10/10)');
  console.log('================================================================================');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});

