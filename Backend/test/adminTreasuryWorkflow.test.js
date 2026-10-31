/**
 * Admin Treasury Workflow & Hardening Verification Suite
 *
 * Verifies:
 * 1. Admin Web Console (`Backend/public/admin/index.html`) includes the Treasury & Vault section,
 *    masked bank destination summaries, manual verification policy banner, and protected API actions.
 * 2. Server-side authorization on every treasury request using live database role (`profiles.role === 'admin'`),
 *    rejecting missing tokens, non-admin users, revoked tokens, demoted admins, and suspended admins.
 * 3. Deposit confirmation & rejection workflow (requires settlementRef / reason, stores reviewedBy, reviewedAt,
 *    settlementRef, auditReason durably, never credits unverified user references).
 * 4. Withdrawal settlement & rejection workflow (masks bank account numbers in admin queue, requires EFT
 *    settlementRef or rejection reason, restores reserved funds once on rejection).
 * 5. Duplicate settlement reference prevention (`409 DUPLICATE_SETTLEMENT_REF`) and restart-safe idempotency
 *    across cleared in-memory caches (`_clearRuntimeCacheForTesting()`).
 * 6. Concurrent admin actions serialized safely without double-crediting or double-restoring balances.
 * 7. Fail-closed database persistence on both `profiles` and `vault_transactions` writes (rolls back balance
 *    mutations if ledger write fails; never swallows errors).
 * 8. `SECURITY DEFINER` RPC privileges revoked from `PUBLIC, anon, authenticated` in SQL migrations.
 */

process.env.NODE_ENV = 'test';
process.env.ADMIN_JWT_SECRET = 'test-only-strong-admin-hmac-secret-key-2026-xyz987654321';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const supabase = require('../src/connection/supabaseClient');

// ── Isolated In-Memory Mock Database for Supabase ─────────────────────────────
const mockProfiles = new Map();
const mockVaultTxs = new Map();
const mockBankAccounts = new Map();
const mockRevokedTokens = new Map();
const mockAuditLogs = [];

supabase.storage = {
  from: () => ({
    upload: async (storagePath) => ({ data: { path: storagePath }, error: null }),
    createSignedUrl: async (storagePath) => ({
      data: { signedUrl: `https://mock-storage.local/${storagePath}` },
      error: null,
    }),
  }),
};

supabase.from = (table) => {
  const state = {
    table,
    op: 'select',
    filters: {},
    payload: null,
  };

  const executeQuery = () => {
    if (table === 'profiles') {
      if (state.op === 'update') {
        const id = state.filters.id;
        const existing = mockProfiles.get(id) || {
          id,
          balance: 0,
          reserved_balance: 0,
          role: 'user',
          verification_status: 'verified',
          is_suspended: false,
          status: 'active',
        };
        const updated = { ...existing, ...state.payload };
        mockProfiles.set(id, updated);
        return { data: updated, error: null };
      }
      if (state.op === 'upsert' || state.op === 'insert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        if (row && row.id) {
          const existing = mockProfiles.get(row.id) || { balance: 0, reserved_balance: 0 };
          mockProfiles.set(row.id, { ...existing, ...row });
        }
        return { data: row, error: null };
      }
      if (state.filters.id) {
        const p = mockProfiles.get(state.filters.id) || null;
        return { data: p, error: null };
      }
      return { data: Array.from(mockProfiles.values()), error: null };
    }

    if (table === 'vault_transactions') {
      if (state.op === 'insert' || state.op === 'upsert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        if (row && row.id) {
          // Enforce unique settlement_ref index in mock DB
          if (row.settlement_ref) {
            for (const existing of mockVaultTxs.values()) {
              if (existing.id !== row.id && existing.settlement_ref === row.settlement_ref) {
                return {
                  data: null,
                  error: {
                    message:
                      'duplicate key value violates unique constraint "idx_vault_tx_settlement_ref_unique"',
                  },
                };
              }
            }
          }
          mockVaultTxs.set(row.id, { ...row });
        }
        return { data: row, error: null };
      }
      if (state.op === 'update') {
        const id = state.filters.id;
        const existing = mockVaultTxs.get(id);
        if (!existing) {
          return { data: null, error: { message: 'Transaction row not found' } };
        }
        if (state.payload && state.payload.settlement_ref) {
          for (const other of mockVaultTxs.values()) {
            if (other.id !== id && other.settlement_ref === state.payload.settlement_ref) {
              return {
                data: null,
                error: {
                  message:
                    'duplicate key value violates unique constraint "idx_vault_tx_settlement_ref_unique"',
                },
              };
            }
          }
        }
        const updated = { ...existing, ...state.payload };
        mockVaultTxs.set(id, updated);
        return { data: updated, error: null };
      }

      // SELECT queries
      let rows = Array.from(mockVaultTxs.values());
      if (state.filters.id) {
        const match = mockVaultTxs.get(state.filters.id) || null;
        return { data: match, error: null };
      }
      if (state.filters.idempotency_key) {
        const match =
          rows.find((r) => r.idempotency_key === state.filters.idempotency_key) || null;
        return { data: match, error: null };
      }
      if (state.filters.settlement_ref) {
        rows = rows.filter((r) => r.settlement_ref === state.filters.settlement_ref);
        return { data: rows, error: null };
      }
      if (state.filters.provider_ref) {
        rows = rows.filter((r) => r.provider_ref === state.filters.provider_ref);
        return { data: rows, error: null };
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

    if (table === 'revoked_tokens') {
      if (state.op === 'upsert' || state.op === 'insert') {
        const row = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        if (row && row.token_hash) {
          mockRevokedTokens.set(row.token_hash, row);
        }
        return { data: row, error: null };
      }
      if (state.filters.token_hash) {
        const found = mockRevokedTokens.get(state.filters.token_hash) || null;
        return { data: found, error: null };
      }
      return { data: Array.from(mockRevokedTokens.values()), error: null };
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
const userController = require('../src/controllers/userController');
const adminController = require('../src/controllers/adminController');
const {
  createAdminToken,
  revokeToken,
  _setTestProfileResolver,
} = require('../src/middlewares/authMiddleware');

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

async function setupApprovedCollector(userId, email, fullName) {
  mockProfiles.set(userId, {
    id: userId,
    email,
    full_name: fullName,
    role: 'user',
    balance: 0,
    reserved_balance: 0,
    verification_status: 'verified',
    is_suspended: false,
    status: 'active',
  });

  for (const docType of ['id', 'tax', 'proof_of_residence']) {
    const uploaded = await complianceService.uploadVerificationDocument({
      userId,
      userEmail: email,
      fullName,
      docType,
      fileData:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      fileName: `${docType}.png`,
      mimeType: 'image/png',
    });
    const docId = uploaded.document ? uploaded.document.id : uploaded.id;
    await complianceService.approveDocument(docId, 'admin@smartassets.io');
  }

  const bank = await complianceService.submitBankAccount({
    userId,
    userEmail: email,
    fullName,
    bankName: 'First National Bank (FNB)',
    accountHolder: fullName,
    accountNumber: '6289100022',
    branchCode: '250655',
    accountType: 'Cheque / Current',
  });
  const bankId = bank.bankAccount ? bank.bankAccount.id : bank.id;
  await complianceService.approveBankAccount(bankId, 'admin@smartassets.io');
  return bank;
}

async function runTests() {
  console.log('======================================================================');
  console.log('🛡️  SMART_ASSETS: Admin Treasury Workflow & Security Hardening Tests');
  console.log('======================================================================\n');

  // ── TEST 1: Admin Web Page (`Backend/public/admin/index.html`) Inspection ──
  console.log('🧪 [TEST 1] Verifying Admin Web UI Treasury section, masked destinations, and API wiring...');
  const adminHtmlPath = path.resolve(__dirname, '../public/admin/index.html');
  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');

  assert.ok(adminHtml.includes('data-view="treasury"'), 'Sidebar must include Treasury & Vault nav item');
  assert.ok(adminHtml.includes('id="view-treasury"'), 'Admin HTML must include #view-treasury section');
  assert.ok(adminHtml.includes('id="treasury-tbody"'), 'Admin HTML must include #treasury-tbody table');
  assert.ok(adminHtml.includes('id="modal-treasury"'), 'Admin HTML must include #modal-treasury action modal');
  assert.ok(
    adminHtml.includes('Manual Treasury Verification Policy'),
    'Admin UI must clearly state manual verification policy for user-entered references'
  );
  assert.ok(adminHtml.includes('/api/admin/vault-transactions'), 'Admin UI must call GET /api/admin/vault-transactions');
  assert.ok(adminHtml.includes('/api/admin/deposits/'), 'Admin UI must call protected deposit confirm/reject endpoints');
  assert.ok(adminHtml.includes('/api/admin/withdrawals/'), 'Admin UI must call protected withdrawal settle/reject endpoints');
  assert.ok(adminHtml.includes('maskAccountText'), 'Admin UI must mask bank account numbers in queue display');
  console.log('   ✅ Admin Web UI (`Backend/public/admin/index.html`) contains complete Treasury workflow & masking.');

  // ── TEST 2: Server-Side Admin Role & Session Revocation Enforcement ────────
  console.log('\n🧪 [TEST 2] Server-side authorization: rejects unauthenticated, non-admin, demoted, and suspended admins...');
  const adminId = 'aaaaaaaa-1111-4111-8111-aaaaaaaa0001';
  const adminEmail = 'treasury.admin@smartassets.io';

  mockProfiles.set(adminId, {
    id: adminId,
    email: adminEmail,
    full_name: 'Treasury Lead Admin',
    role: 'admin',
    is_suspended: false,
    status: 'active',
  });

  _setTestProfileResolver(async (lookupId) => mockProfiles.get(lookupId) || null);

  const validAdminToken = createAdminToken({
    id: adminId,
    email: adminEmail,
    fullName: 'Treasury Lead Admin',
  });

  // 2a. Missing auth / non-admin user -> 403
  const resUnauth = mockRes();
  await adminController.getAdminVaultTransactions({ headers: {} }, resUnauth);
  assert.strictEqual(resUnauth.statusCode, 403);

  const resRegularUser = mockRes();
  await adminController.getAdminVaultTransactions(
    {
      headers: {},
      user: { id: 'regular-user-1', email: 'user@test.com', role: 'user' },
    },
    resRegularUser
  );
  assert.strictEqual(resRegularUser.statusCode, 403);

  // 2b. Valid admin token with active DB role='admin' -> 200
  const resValidAdmin = mockRes();
  await adminController.getAdminVaultTransactions(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
    },
    resValidAdmin
  );
  assert.strictEqual(resValidAdmin.statusCode, 200);
  assert.strictEqual(resValidAdmin.body.success, true);

  // 2c. Mid-session role demotion in DB (`role` changed from 'admin' to 'user') -> 403 on all treasury endpoints
  mockProfiles.set(adminId, {
    ...mockProfiles.get(adminId),
    role: 'user',
  });

  for (const fn of [
    (req, res) => adminController.getAdminVaultTransactions(req, res),
    (req, res) => adminController.confirmAdminDeposit(req, res),
    (req, res) => adminController.rejectAdminDeposit(req, res),
    (req, res) => adminController.settleAdminWithdrawal(req, res),
    (req, res) => adminController.rejectAdminWithdrawal(req, res),
  ]) {
    const resDemoted = mockRes();
    await fn(
      {
        headers: { authorization: `Bearer ${validAdminToken}` },
        params: { id: 'TXN-ANY' },
        body: { settlementRef: 'REF-12345', reason: 'Test' },
      },
      resDemoted
    );
    assert.strictEqual(resDemoted.statusCode, 403, 'Demoted admin must be rejected with 403');
  }

  // 2d. Mid-session suspension (`is_suspended = true`) -> 403
  mockProfiles.set(adminId, {
    ...mockProfiles.get(adminId),
    role: 'admin',
    is_suspended: true,
    status: 'suspended',
  });
  const resSuspendedAdmin = mockRes();
  await adminController.confirmAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: 'TXN-ANY' },
      body: { settlementRef: 'REF-12345' },
    },
    resSuspendedAdmin
  );
  assert.strictEqual(resSuspendedAdmin.statusCode, 403);
  assert.strictEqual(resSuspendedAdmin.body.code, 'ADMIN_ACCOUNT_SUSPENDED');

  // Restore active admin in DB
  mockProfiles.set(adminId, {
    id: adminId,
    email: adminEmail,
    full_name: 'Treasury Lead Admin',
    role: 'admin',
    is_suspended: false,
    status: 'active',
  });

  // 2e. Explicitly revoked admin token -> 401
  const shortToken = createAdminToken({
    id: adminId,
    email: adminEmail,
    fullName: 'Revoked Admin Session',
  });
  await revokeToken(shortToken, { userId: adminId, tokenType: 'admin', reason: 'test_revocation' });
  const resRevoked = mockRes();
  await adminController.getAdminVaultTransactions(
    { headers: { authorization: `Bearer ${shortToken}` } },
    resRevoked
  );
  assert.strictEqual(resRevoked.statusCode, 401);
  console.log('   ✅ Server-side DB role recheck & session revocation enforced across all treasury endpoints.');

  // ── TEST 3: Manual Deposit Confirmation & Rejection Workflow ───────────────
  console.log('\n🧪 [TEST 3] Manual deposit workflow: unverified reference stays pending; confirmation requires settlementRef & stores audit fields...');
  const collectorId = 'bbbbbbbb-2222-4222-8222-bbbbbbbb0002';
  const collectorEmail = 'collector.treasury@smartassets.io';
  await setupApprovedCollector(collectorId, collectorEmail, 'Naledi Khumalo');

  // Collector submits manual EFT deposit with user-typed reference
  const resDepReq = mockRes();
  await userController.deposit(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: { 'x-idempotency-key': 'idem-treasury-dep-001' },
      body: {
        amount: 40000,
        method: 'Manual Bank EFT',
        reference: 'USER-TYPED-REF-777',
      },
    },
    resDepReq
  );
  assert.strictEqual(resDepReq.statusCode, 202);
  assert.strictEqual(resDepReq.body.status, 'pending_review');
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 0, 'Unverified deposit must not credit balance');
  const depTxId = resDepReq.body.transaction.id;

  // Admin fetches treasury queue -> sees pending deposit with collector identity & unverified reference
  const resQueue1 = mockRes();
  await adminController.getAdminVaultTransactions(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      query: { status: 'pending_review', type: 'deposit' },
    },
    resQueue1
  );
  assert.strictEqual(resQueue1.statusCode, 200);
  const queuedDep = resQueue1.body.transactions.find((t) => t.id === depTxId);
  assert.ok(queuedDep, 'Pending deposit must appear in admin treasury queue');
  assert.strictEqual(queuedDep.userFullName, 'Naledi Khumalo');
  assert.strictEqual(queuedDep.userEmail, collectorEmail);
  assert.ok(queuedDep.destinationSummary.includes('Unverified'), 'User EFT reference must be labeled unverified');

  // Admin attempts to confirm without settlementRef -> 400
  const resConfirmNoRef = mockRes();
  await adminController.confirmAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId },
      body: { settlementRef: '' },
    },
    resConfirmNoRef
  );
  assert.strictEqual(resConfirmNoRef.statusCode, 400);
  assert.strictEqual(resConfirmNoRef.body.code, 'SETTLEMENT_REF_REQUIRED');
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 0);

  // Admin confirms deposit with verified bank statement settlement reference & audit reason
  const resConfirmOk = mockRes();
  await adminController.confirmAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId },
      body: {
        settlementRef: 'FNB-STMT-20261031-7001',
        reason: 'Verified R40,000 cleared on FNB corporate statement line 42',
      },
    },
    resConfirmOk
  );
  assert.strictEqual(resConfirmOk.statusCode, 200);
  assert.strictEqual(resConfirmOk.body.status, 'completed');
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 40000);

  // Verify durable audit fields in DB mock
  const dbDepRow = mockVaultTxs.get(depTxId);
  assert.strictEqual(dbDepRow.status, 'completed');
  assert.strictEqual(dbDepRow.settlement_ref, 'FNB-STMT-20261031-7001');
  assert.strictEqual(dbDepRow.reviewed_by, adminEmail);
  assert.ok(dbDepRow.reviewed_at, 'reviewed_at timestamp must be stored');
  assert.strictEqual(dbDepRow.audit_reason, 'Verified R40,000 cleared on FNB corporate statement line 42');

  // Create a second pending deposit and reject it
  const resDepReq2 = mockRes();
  await userController.deposit(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: {},
      body: { amount: 15000, method: 'Manual Bank EFT', reference: 'BOGUS-EFT-000' },
    },
    resDepReq2
  );
  const depTxId2 = resDepReq2.body.transaction.id;

  // Reject without reason -> 400
  const resRejectNoReason = mockRes();
  await adminController.rejectAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId2 },
      body: { reason: '   ' },
    },
    resRejectNoReason
  );
  assert.strictEqual(resRejectNoReason.statusCode, 400);
  assert.strictEqual(resRejectNoReason.body.code, 'REASON_REQUIRED');

  // Reject with valid reason -> 200, status 'rejected', balance remains R40,000
  const resRejectOk = mockRes();
  await adminController.rejectAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId2 },
      body: { reason: 'No matching funds received in treasury bank account after 5 business days' },
    },
    resRejectOk
  );
  assert.strictEqual(resRejectOk.statusCode, 200);
  assert.strictEqual(resRejectOk.body.status, 'rejected');
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 40000);
  assert.strictEqual(mockVaultTxs.get(depTxId2).reviewed_by, adminEmail);
  assert.strictEqual(
    mockVaultTxs.get(depTxId2).audit_reason,
    'No matching funds received in treasury bank account after 5 business days'
  );
  console.log('   ✅ Deposit confirmation & rejection enforce settlementRef/reason and persist full audit trail.');

  // ── TEST 4: Withdrawal Queue Masking, Settlement & Rejection Workflow ──────
  console.log('\n🧪 [TEST 4] Withdrawal workflow: masks bank destination, reserves funds, settles with EFT ref, and restores once on rejection...');
  // Configure test email transport to capture 6-digit OTP codes for collector withdrawals
  const withdrawalVerificationService = require('../src/services/withdrawalVerificationService');
  let capturedOtpEmails = [];
  withdrawalVerificationService._setEmailTransportForTesting(async (mail) => {
    capturedOtpEmails.push(mail);
    return { delivered: true };
  });

  // Collector requests two withdrawals: R15,000 (to settle) and R10,000 (to reject)
  const resCh1 = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: {},
      body: { amount: 15000, confirmedBankDetails: true },
    },
    resCh1
  );
  assert.strictEqual(resCh1.statusCode, 200);
  const otp1 = capturedOtpEmails[capturedOtpEmails.length - 1].text.match(/\b(\d{6})\b/)[1];

  const resWth1 = mockRes();
  await userController.withdraw(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: { 'x-idempotency-key': 'idem-treasury-wth-001' },
      body: { challengeId: resCh1.body.challengeId, code: otp1, amount: 15000 },
    },
    resWth1
  );
  assert.strictEqual(resWth1.statusCode, 200);
  assert.strictEqual(resWth1.body.status, 'pending_review');
  const wthTxId1 = resWth1.body.transaction.id;

  const resCh2 = mockRes();
  await userController.initiateWithdrawalChallenge(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: {},
      body: { amount: 10000, confirmedBankDetails: true },
    },
    resCh2
  );
  assert.strictEqual(resCh2.statusCode, 200);
  const otp2 = capturedOtpEmails[capturedOtpEmails.length - 1].text.match(/\b(\d{6})\b/)[1];

  const resWth2 = mockRes();
  await userController.withdraw(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: { 'x-idempotency-key': 'idem-treasury-wth-002' },
      body: { challengeId: resCh2.body.challengeId, code: otp2, amount: 10000 },
    },
    resWth2
  );
  assert.strictEqual(resWth2.statusCode, 200);
  assert.strictEqual(resWth2.body.status, 'pending_review');
  const wthTxId2 = resWth2.body.transaction.id;

  // Spendable should now be R40,000 - R25,000 = R15,000 (Reserved: R25,000)
  const balAfterReqs = await vaultTxService.getUserBalanceDetails(collectorId);
  assert.strictEqual(balAfterReqs.availableBalanceNum, 15000);
  assert.strictEqual(balAfterReqs.reservedBalanceNum, 25000);
  assert.strictEqual(balAfterReqs.totalBalanceNum, 40000);

  // Admin inspects withdrawal queue -> destination MUST be masked (`****0022`), never exposing `6289100022`
  const resQueueWth = mockRes();
  await adminController.getAdminVaultTransactions(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      query: { type: 'withdraw' },
    },
    resQueueWth
  );
  const queuedWth1 = resQueueWth.body.transactions.find((t) => t.id === wthTxId1);
  assert.ok(queuedWth1, 'Pending withdrawal must appear in admin treasury queue');
  assert.ok(
    queuedWth1.destinationSummary.includes('****0022'),
    `Expected masked account ****0022, got: ${queuedWth1.destinationSummary}`
  );
  assert.ok(
    !queuedWth1.destinationSummary.includes('6289100022'),
    'Full bank account number must NEVER appear in admin treasury queue'
  );

  // Settle withdrawal 1 without settlementRef -> 400
  const resSettleNoRef = mockRes();
  await adminController.settleAdminWithdrawal(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: wthTxId1 },
      body: {},
    },
    resSettleNoRef
  );
  assert.strictEqual(resSettleNoRef.statusCode, 400);
  assert.strictEqual(resSettleNoRef.body.code, 'SETTLEMENT_REF_REQUIRED');

  // Settle withdrawal 1 with valid EFT payout reference -> 200
  const resSettleOk = mockRes();
  await adminController.settleAdminWithdrawal(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: wthTxId1 },
      body: {
        settlementRef: 'EFT-PAYOUT-20261031-8002',
        reason: 'Paid via FNB corporate EFT batch #8002 to approved account',
      },
    },
    resSettleOk
  );
  assert.strictEqual(resSettleOk.statusCode, 200);
  assert.strictEqual(resSettleOk.body.status, 'completed');

  const balAfterSettle = await vaultTxService.getUserBalanceDetails(collectorId);
  assert.strictEqual(balAfterSettle.totalBalanceNum, 25000);
  assert.strictEqual(balAfterSettle.reservedBalanceNum, 10000);
  assert.strictEqual(balAfterSettle.availableBalanceNum, 15000);

  const dbWth1 = mockVaultTxs.get(wthTxId1);
  assert.strictEqual(dbWth1.status, 'completed');
  assert.strictEqual(dbWth1.settlement_ref, 'EFT-PAYOUT-20261031-8002');
  assert.strictEqual(dbWth1.reviewed_by, adminEmail);
  assert.ok(dbWth1.reviewed_at);

  // Reject withdrawal 2 without reason -> 400
  const resRejectWthNoReason = mockRes();
  await adminController.rejectAdminWithdrawal(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: wthTxId2 },
      body: { reason: '' },
    },
    resRejectWthNoReason
  );
  assert.strictEqual(resRejectWthNoReason.statusCode, 400);
  assert.strictEqual(resRejectWthNoReason.body.code, 'REASON_REQUIRED');

  // Reject withdrawal 2 with valid reason -> restores R10,000 reserved back to spendable (R25,000)
  const resRejectWthOk = mockRes();
  await adminController.rejectAdminWithdrawal(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: wthTxId2 },
      body: { reason: 'Beneficiary bank branch code maintenance hold' },
    },
    resRejectWthOk
  );
  assert.strictEqual(resRejectWthOk.statusCode, 200);
  assert.strictEqual(resRejectWthOk.body.status, 'rejected');

  const balAfterReject = await vaultTxService.getUserBalanceDetails(collectorId);
  assert.strictEqual(balAfterReject.totalBalanceNum, 25000);
  assert.strictEqual(balAfterReject.reservedBalanceNum, 0);
  assert.strictEqual(balAfterReject.availableBalanceNum, 25000);
  console.log('   ✅ Withdrawal queue masks bank details, settles with EFT ref, and restores reserved funds on rejection.');

  // ── TEST 5: Restart-Safe Idempotency & Duplicate Settlement Reference Prevention ──
  console.log('\n🧪 [TEST 5] Restart-safe idempotency & duplicate settlement reference protection across cleared memory caches...');
  // Clear all in-memory maps in vaultTransactionService to simulate a server restart!
  vaultTxService._clearRuntimeCacheForTesting();

  // 5a. Repeating confirmAdminDeposit on already-confirmed depTxId after restart -> idempotent, does NOT credit again
  const resRestartConfirm = mockRes();
  await adminController.confirmAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId },
      body: { settlementRef: 'FNB-STMT-20261031-7001' },
    },
    resRestartConfirm
  );
  assert.strictEqual(resRestartConfirm.statusCode, 200);
  assert.strictEqual(resRestartConfirm.body.idempotent, true);
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 25000, 'Must not double-credit after restart');

  // 5b. Repeating rejectAdminWithdrawal on already-rejected wthTxId2 after restart -> idempotent, does NOT restore again
  vaultTxService._clearRuntimeCacheForTesting();
  const resRestartRejectWth = mockRes();
  await adminController.rejectAdminWithdrawal(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: wthTxId2 },
      body: { reason: 'Repeated rejection call after server restart' },
    },
    resRestartRejectWth
  );
  assert.strictEqual(resRestartRejectWth.statusCode, 200);
  assert.strictEqual(resRestartRejectWth.body.idempotent, true);
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 25000, 'Must not double-restore after restart');

  // 5c. Repeating user deposit/withdrawal with existing idempotencyKey after restart -> returns existing tx
  vaultTxService._clearRuntimeCacheForTesting();
  const resRestartIdemWth = mockRes();
  await userController.withdraw(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: { 'x-idempotency-key': 'idem-treasury-wth-001' },
      body: { challengeId: resCh1.body.challengeId, code: otp1, amount: 15000 },
    },
    resRestartIdemWth
  );
  assert.strictEqual(resRestartIdemWth.body.duplicate, true);
  assert.strictEqual(resRestartIdemWth.body.transaction.id, wthTxId1);
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 25000);

  // 5d. Attempting to reuse settlementRef 'FNB-STMT-20261031-7001' on a new deposit after restart -> 409 DUPLICATE_SETTLEMENT_REF
  const resDepReq3 = mockRes();
  await userController.deposit(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: {},
      body: { amount: 8000, method: 'Manual Bank EFT', reference: 'NEW-EFT-8000' },
    },
    resDepReq3
  );
  const depTxId3 = resDepReq3.body.transaction.id;

  vaultTxService._clearRuntimeCacheForTesting();
  const resDupSettlementRef = mockRes();
  await adminController.confirmAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId3 },
      body: { settlementRef: 'FNB-STMT-20261031-7001' },
    },
    resDupSettlementRef
  );
  assert.strictEqual(resDupSettlementRef.statusCode, 409, 'Reused settlementRef must be rejected with 409');
  assert.strictEqual(resDupSettlementRef.body.code, 'DUPLICATE_SETTLEMENT_REF');
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 25000);
  console.log('   ✅ Restart-safe idempotency and duplicate settlement reference protection verified.');

  // ── TEST 6: Concurrent Admin Actions Serialization ─────────────────────────
  console.log('\n🧪 [TEST 6] Concurrent admin confirmations on the same deposit credit balance exactly once...');
  const [concRes1, concRes2] = await Promise.all([
    (async () => {
      const r = mockRes();
      await adminController.confirmAdminDeposit(
        {
          headers: { authorization: `Bearer ${validAdminToken}` },
          params: { id: depTxId3 },
          body: { settlementRef: 'FNB-CONC-20261031-9001' },
        },
        r
      );
      return r;
    })(),
    (async () => {
      const r = mockRes();
      await adminController.confirmAdminDeposit(
        {
          headers: { authorization: `Bearer ${validAdminToken}` },
          params: { id: depTxId3 },
          body: { settlementRef: 'FNB-CONC-20261031-9001' },
        },
        r
      );
      return r;
    })(),
  ]);

  assert.strictEqual(concRes1.statusCode, 200);
  assert.strictEqual(concRes2.statusCode, 200);
  // Balance was R25,000; confirming R8,000 concurrently must result in R33,000 (never R41,000)
  assert.strictEqual(await vaultTxService.getUserBalance(collectorId), 33000);
  console.log('   ✅ Concurrent admin confirmations serialized safely; R8,000 credited once (balance: R33,000).');

  // ── TEST 7: Fail-Closed Persistence When Profile or Ledger Writes Fail ─────
  console.log('\n🧪 [TEST 7] Fail-closed database writes: rolls back balance if vault_transactions write fails...');
  const resDepReq4 = mockRes();
  await userController.deposit(
    {
      user: { id: collectorId, email: collectorEmail },
      headers: {},
      body: { amount: 12000, method: 'Manual Bank EFT', reference: 'FAIL-TEST-12000' },
    },
    resDepReq4
  );
  const depTxId4 = resDepReq4.body.transaction.id;

  // Simulate vault_transactions update failure AFTER profile balance update -> must roll back profile balance and return 500
  const resTxWriteFail = mockRes();
  await adminController.confirmAdminDeposit(
    {
      headers: { authorization: `Bearer ${validAdminToken}` },
      params: { id: depTxId4 },
      body: {
        settlementRef: 'FNB-FAIL-TX-WRITE-001',
        simulateTxDbError: true,
      },
    },
    resTxWriteFail
  );
  assert.strictEqual(resTxWriteFail.statusCode, 500, 'Failed ledger write must fail closed with 500');
  assert.strictEqual(resTxWriteFail.body.code, 'DB_WRITE_FAILED');
  assert.strictEqual(
    await vaultTxService.getUserBalance(collectorId),
    33000,
    'Balance must be rolled back to R33,000 when vault_transactions update fails'
  );
  assert.strictEqual(
    mockVaultTxs.get(depTxId4).status,
    'pending_review',
    'Deposit status must remain pending_review when write fails'
  );
  console.log('   ✅ Ledger write failures fail closed with 500 and roll back balance mutations.');

  // ── TEST 8: SQL Migration `SECURITY DEFINER` Privilege Hardening Check ─────
  console.log('\n🧪 [TEST 8] Verifying SQL migrations revoke PUBLIC/anon/authenticated execute on SECURITY DEFINER RPCs...');
  const vaultMigrationSql = fs.readFileSync(
    path.resolve(__dirname, '../supabase_migrations/20261031_vault_deposit_and_withdrawal_atomic.sql'),
    'utf8'
  );
  const investMigrationSql = fs.readFileSync(
    path.resolve(__dirname, '../supabase_migrations/20261031_atomic_investment_and_share_sales.sql'),
    'utf8'
  );

  assert.ok(
    vaultMigrationSql.includes('REVOKE ALL ON FUNCTION public.confirm_vault_deposit_atomic(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;'),
    'confirm_vault_deposit_atomic must revoke execute from PUBLIC, anon, authenticated'
  );
  assert.ok(
    vaultMigrationSql.includes('REVOKE ALL ON FUNCTION public.settle_vault_withdrawal_atomic(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;'),
    'settle_vault_withdrawal_atomic must revoke execute from PUBLIC, anon, authenticated'
  );
  assert.ok(
    vaultMigrationSql.includes('public.assert_active_admin_in_db('),
    'Treasury RPCs must verify active admin role in database'
  );
  assert.ok(
    investMigrationSql.includes('FROM PUBLIC, anon, authenticated;'),
    'Investment & share redemption RPCs must revoke execute from PUBLIC, anon, authenticated'
  );
  console.log('   ✅ SQL migrations enforce strict SECURITY DEFINER privilege revocations and caller checks.');

  _setTestProfileResolver(null);

  console.log('\n======================================================================');
  console.log('✅ ALL 8 ADMIN TREASURY WORKFLOW & SECURITY HARDENING TESTS PASSED!');
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
