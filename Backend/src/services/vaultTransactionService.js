// ─── Vault Transaction Service ───────────────────────────────────────────────
// Handles user vault balance, verified deposits, pending bank deposits,
// atomic withdrawal reservations to approved bank accounts, and transaction history.
// Supabase profiles.balance / reserved_balance and vault_transactions are the source of truth.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const auditLogService = require('./auditLogService');
const stripeService = require('./stripeService');

// In-memory runtime cache synced with Supabase
const transactionsMap = new Map();       // id -> tx
const balancesMap = new Map();           // userId -> total balance number
const reservedBalancesMap = new Map();   // userId -> reserved withdrawal balance number
const idempotencyStore = new Map();      // idempotencyKey -> cached response
const creditedProviderRefs = new Set();  // providerRef / paymentIntentId / settlementRef -> credited once
const userVaultLocks = new Map();        // userId -> Promise chain mutex

let hydrated = false;

const MAX_SINGLE_DEPOSIT_ZAR = 10000000;    // R10,000,000
const MAX_SINGLE_WITHDRAWAL_ZAR = 5000000;  // R5,000,000

const INTERNAL_SETTLED_PAYOUT_METHODS = new Set([
  'Outright Buyout Payout',
  'Outright Sale Proceeds',
  'Share Redemption Proceeds',
  'Buyout Settlement',
  'Marketplace Sale Proceeds',
  'Seller Delisting Redemption',
]);

/**
 * Per-user async mutex lock to serialize concurrent balance/withdrawal operations.
 */
async function withUserVaultLock(userId, fn) {
  const key = String(userId || 'global');
  const prev = userVaultLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  userVaultLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userVaultLocks.get(key) === next) {
      userVaultLocks.delete(key);
    }
  }
}

/**
 * Format currency amount into South African Rand (R) string
 */
function formatZar(num) {
  return 'R' + Number(num || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function isUuid(id) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(id || ''));
}

/**
 * Masks any bank destination string so full account numbers are never exposed in logs or admin queues.
 * Example: "First National Bank (FNB) (6289100022)" -> "First National Bank (FNB) (****0022)"
 */
function maskBankDestination(dest, bankObj = null) {
  if (bankObj && (bankObj.bank_name || bankObj.bankName)) {
    const bName = String(bankObj.bank_name || bankObj.bankName).trim();
    const rawAcc = String(bankObj.account_number || bankObj.accountNumber || '').replace(/\s+/g, '');
    const last4 = rawAcc.length >= 4 ? `****${rawAcc.slice(-4)}` : '****';
    return `${bName} (${last4})`;
  }
  if (!dest) return null;
  return String(dest).replace(/\b\d{6,}\b/g, (match) => `****${match.slice(-4)}`);
}

/**
 * Clears in-memory runtime caches to test restart-safety against PostgreSQL persistence.
 */
function _clearRuntimeCacheForTesting() {
  transactionsMap.clear();
  balancesMap.clear();
  reservedBalancesMap.clear();
  idempotencyStore.clear();
  creditedProviderRefs.clear();
  hydrated = false;
}

/**
 * Maps a Supabase vault_transactions DB row to a standardized transaction object.
 */
function mapDbRowToTx(row) {
  const isDep = row.type === 'deposit' || row.type === 'sale';
  const isPurchase = row.type === 'purchase';
  const status = row.status || 'pending_review';
  let title = 'Vault Transaction';

  if (row.type === 'deposit') {
    if (
      (row.method && String(row.method).toLowerCase().includes('sale')) ||
      (row.method && String(row.method).toLowerCase().includes('payout')) ||
      (row.method && String(row.method).toLowerCase().includes('proceeds')) ||
      (row.notes && String(row.notes).toLowerCase().includes('proceeds'))
    ) {
      title = 'Marketplace Sale Proceeds';
    } else if (status === 'pending_review') {
      title = 'Deposit Request (Pending Verification)';
    } else if (status === 'rejected' || status === 'failed') {
      title = 'Vault Deposit (Rejected)';
    } else {
      title = 'Vault Cash Deposit';
    }
  } else if (row.type === 'withdraw') {
    if (status === 'pending_review') {
      title = 'Withdrawal Request (Pending Review)';
    } else if (status === 'settlement_processing') {
      title = 'Withdrawal (Payout Processing)';
    } else if (status === 'cancelled') {
      title = 'Withdrawal Request (Cancelled)';
    } else if (status === 'rejected' || status === 'failed') {
      title = 'Withdrawal Request (Rejected)';
    } else {
      title = 'Vault Cash Withdrawal';
    }
  } else if (isPurchase) {
    title = 'Marketplace Purchase';
  } else if (row.type === 'sale') {
    title = 'Marketplace Sale Proceeds';
  }

  const amt = Number(row.amount) || 0;
  const formatted =
    row.amount_formatted ||
    row.amountFormatted ||
    (isDep ? `+${formatZar(amt)}` : `-${formatZar(amt)}`);

  const maskedDest = maskBankDestination(
    row.destination_summary || row.destinationSummary || row.destination || null
  );

  return {
    id: row.id,
    userId: row.user_id || row.userId,
    type: row.type || 'deposit',
    title,
    amount: amt,
    amountFormatted: formatted,
    method: row.method || 'Manual Bank EFT',
    destination: maskedDest,
    destinationSummary: maskedDest,
    bankAccountId: row.bank_account_id || row.bankAccountId || null,
    reference: row.reference || null,
    providerRef: row.provider_ref || row.providerRef || null,
    settlementRef: row.settlement_ref || row.settlementRef || null,
    auditReason: row.audit_reason || row.auditReason || null,
    idempotencyKey: row.idempotency_key || row.idempotencyKey || null,
    notes: row.notes || null,
    status,
    positive: isDep,
    reviewedBy: row.reviewed_by || row.reviewedBy || null,
    reviewedAt: row.reviewed_at || row.reviewedAt || null,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || row.created_at || row.createdAt || new Date().toISOString(),
  };
}

/**
 * Hydrate transactionsMap from Supabase vault_transactions table.
 */
async function hydrateTransactionsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('vault_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!error && Array.isArray(data)) {
      data.forEach((row) => {
        if (!row || !row.id) return;
        const mapped = mapDbRowToTx(row);
        transactionsMap.set(row.id, mapped);
        if (mapped.providerRef && mapped.status === 'completed') {
          creditedProviderRefs.add(mapped.providerRef);
        }
        if (mapped.settlementRef && mapped.status === 'completed') {
          creditedProviderRefs.add(mapped.settlementRef);
        }
      });
      hydrated = true;
    }
  } catch (_) {}
}

// Kick off initial hydration in background
hydrateTransactionsFromSupabase();

/**
 * Restart-safe lookup for a transaction by ID (checks in-memory map, then Supabase vault_transactions).
 */
async function resolveTransactionById(transactionId) {
  if (!transactionId) return null;
  let tx = transactionsMap.get(transactionId);
  try {
    const { data, error } = await supabase
      .from('vault_transactions')
      .select('*')
      .eq('id', transactionId)
      .maybeSingle();
    if (!error && data && data.id) {
      tx = mapDbRowToTx(data);
      transactionsMap.set(tx.id, tx);
      if (tx.settlementRef && tx.status === 'completed') {
        creditedProviderRefs.add(tx.settlementRef);
      }
      if (tx.providerRef && tx.status === 'completed') {
        creditedProviderRefs.add(tx.providerRef);
      }
    }
  } catch (_) {}
  return tx || null;
}

/**
 * Restart-safe check whether an idempotencyKey has already been processed in memory or DB.
 */
async function lookupIdempotencyRecord(idempotencyKey, userId) {
  if (!idempotencyKey) return null;
  if (idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached.userId && String(cached.userId) !== String(userId)) {
      const err = new Error('Idempotency key belongs to a different user.');
      err.code = 'IDEMPOTENCY_USER_MISMATCH';
      err.statusCode = 403;
      throw err;
    }
    return { ...cached, duplicate: true };
  }

  // Query vault_transactions by idempotency_key (survives server restarts)
  try {
    const { data, error } = await supabase
      .from('vault_transactions')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (!error && data && data.id) {
      const txOwner = data.user_id || data.userId;
      if (txOwner && String(txOwner) !== String(userId)) {
        const err = new Error('Idempotency key belongs to a different user.');
        err.code = 'IDEMPOTENCY_USER_MISMATCH';
        err.statusCode = 403;
        throw err;
      }
      const mapped = mapDbRowToTx(data);
      transactionsMap.set(mapped.id, mapped);
      const balDetails = await getUserBalanceDetails(userId);
      const reconstructed = {
        userId,
        transaction: mapped,
        status: mapped.status,
        credited: mapped.type === 'deposit' && mapped.status === 'completed',
        destination: mapped.destination,
        bankAccountId: mapped.bankAccountId,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
        totalBalanceNum: balDetails.totalBalanceNum,
        reservedBalanceNum: balDetails.reservedBalanceNum,
        reservedBalanceFormatted: balDetails.reservedBalanceFormatted,
        duplicate: true,
      };
      idempotencyStore.set(idempotencyKey, reconstructed);
      return reconstructed;
    }
  } catch (err) {
    if (err.code === 'IDEMPOTENCY_USER_MISMATCH') throw err;
  }

  return null;
}

/**
 * Restart-safe check whether a settlementRef or providerRef has already been used on another transaction.
 */
async function isSettlementOrProviderRefUsed(ref, excludeTxId = null) {
  if (!ref) return false;
  const clean = String(ref).trim();
  if (!clean) return false;

  // Check in-memory transactions first
  for (const tx of transactionsMap.values()) {
    if (excludeTxId && tx.id === excludeTxId) continue;
    if (
      tx.status === 'completed' &&
      (tx.settlementRef === clean || tx.providerRef === clean || tx.reference === clean)
    ) {
      return true;
    }
  }

  if (!excludeTxId && creditedProviderRefs.has(clean)) {
    return true;
  }

  // Check Supabase vault_transactions for restart-safe deduplication
  try {
    const { data: bySettlement } = await supabase
      .from('vault_transactions')
      .select('id, status, settlement_ref, provider_ref, reference')
      .eq('settlement_ref', clean);

    if (Array.isArray(bySettlement)) {
      const conflict = bySettlement.find((r) => r && r.id && r.id !== excludeTxId);
      if (conflict) {
        creditedProviderRefs.add(clean);
        return true;
      }
    }

    const { data: byProvider } = await supabase
      .from('vault_transactions')
      .select('id, status, settlement_ref, provider_ref, reference')
      .eq('provider_ref', clean);

    if (Array.isArray(byProvider)) {
      const conflict = byProvider.find((r) => r && r.id && r.id !== excludeTxId && r.status === 'completed');
      if (conflict) {
        creditedProviderRefs.add(clean);
        return true;
      }
    }
  } catch (_) {}

  return false;
}

/**
 * Get detailed balance breakdown (total, reserved, spendable) for a user.
 */
async function getUserBalanceDetails(userId) {
  if (!userId) {
    return {
      availableBalanceNum: 0,
      totalBalanceNum: 0,
      reservedBalanceNum: 0,
      availableBalanceFormatted: formatZar(0),
      totalBalanceFormatted: formatZar(0),
      reservedBalanceFormatted: formatZar(0),
    };
  }

  let totalBal = balancesMap.get(userId) || 0;
  let reservedBal = reservedBalancesMap.get(userId) || 0;

  if (isUuid(userId)) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('❌ [VaultTxService] DB balance fetch error:', error.message);
        throw new Error(`Failed to read balance from database: ${error.message}`);
      }

      if (data) {
        if (data.balance !== null && data.balance !== undefined) {
          totalBal = Number(data.balance) || 0;
          balancesMap.set(userId, totalBal);
        }
        if (data.reserved_balance !== null && data.reserved_balance !== undefined) {
          reservedBal = Number(data.reserved_balance) || 0;
          reservedBalancesMap.set(userId, reservedBal);
        }
      } else {
        if (!balancesMap.has(userId)) balancesMap.set(userId, 0);
        if (!reservedBalancesMap.has(userId)) reservedBalancesMap.set(userId, 0);
      }
    } catch (err) {
      if (err.message && err.message.startsWith('Failed to read balance from database')) {
        throw err;
      }
      console.error('❌ [VaultTxService] DB balance fetch exception:', err.message);
      throw new Error(`Failed to read balance from database: ${err.message}`);
    }
  } else {
    if (!balancesMap.has(userId)) balancesMap.set(userId, 0);
    if (!reservedBalancesMap.has(userId)) reservedBalancesMap.set(userId, 0);
  }

  const availableBal = Math.max(0, totalBal - reservedBal);
  return {
    availableBalanceNum: availableBal,
    totalBalanceNum: totalBal,
    reservedBalanceNum: reservedBal,
    spendableBalance: availableBal,
    totalBalance: totalBal,
    reservedBalance: reservedBal,
    availableBalanceFormatted: formatZar(availableBal),
    totalBalanceFormatted: formatZar(totalBal),
    reservedBalanceFormatted: formatZar(reservedBal),
  };
}

/**
 * Get available spendable cash balance for a user strictly from Supabase profiles table.
 * Spendable balance = total balance - reserved pending withdrawals.
 * New users strictly default to 0. Never substitutes starter funds.
 */
async function getUserBalance(userId) {
  const details = await getUserBalanceDetails(userId);
  return details.availableBalanceNum;
}

/**
 * Persist total and reserved balance updates to Supabase profiles table (fail closed on error).
 */
async function persistUserBalancesToDb(userId, totalBalance, reservedBalance, simulateDbError = false) {
  if (simulateDbError) {
    const err = new Error('Failed to update balance in database: Simulated database write failure.');
    err.code = 'DB_WRITE_FAILED';
    err.statusCode = 500;
    throw err;
  }
  if (!isUuid(userId)) return;

  try {
    // First attempt with reserved_balance column (post-migration)
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ balance: totalBalance, reserved_balance: reservedBalance })
      .eq('id', userId);

    if (updateErr) {
      // If reserved_balance column is not yet applied on hosted DB, update balance with spendable amount
      if (String(updateErr.message || '').includes('reserved_balance')) {
        const spendable = Math.max(0, totalBalance - reservedBalance);
        const { error: fallbackErr } = await supabase
          .from('profiles')
          .update({ balance: spendable })
          .eq('id', userId);
        if (fallbackErr) {
          const dbErr = new Error(`Failed to update balance in database: ${fallbackErr.message}`);
          dbErr.code = 'DB_WRITE_FAILED';
          dbErr.statusCode = 500;
          throw dbErr;
        }
      } else {
        const dbErr = new Error(`Failed to update balance in database: ${updateErr.message}`);
        dbErr.code = 'DB_WRITE_FAILED';
        dbErr.statusCode = 500;
        throw dbErr;
      }
    }
  } catch (err) {
    if (err.code === 'DB_WRITE_FAILED') throw err;
    const dbErr = new Error(
      err.message && err.message.startsWith('Failed to update balance in database')
        ? err.message
        : `Failed to update balance in database: ${err.message}`
    );
    dbErr.code = 'DB_WRITE_FAILED';
    dbErr.statusCode = 500;
    throw dbErr;
  }
}

/**
 * Persist a new vault_transactions row to Supabase.
 * Fails closed and throws DB_WRITE_FAILED if the insert returns an error (never swallows errors).
 */
async function persistVaultTransactionInsert(rowPayload, { userId, simulateTxDbError = false }) {
  if (simulateTxDbError) {
    const err = new Error('Failed to persist vault transaction in database: Simulated ledger write failure.');
    err.code = 'DB_WRITE_FAILED';
    err.statusCode = 500;
    throw err;
  }
  if (!isUuid(userId)) return;

  const { error } = await supabase.from('vault_transactions').insert(rowPayload);
  if (error) {
    const msg = String(error.message || '');
    // Handle pre-migration schema fallback if extended columns are not yet applied
    if (
      msg.includes('column') &&
      (msg.includes('provider_ref') ||
        msg.includes('settlement_ref') ||
        msg.includes('destination_summary') ||
        msg.includes('bank_account_id') ||
        msg.includes('audit_reason') ||
        msg.includes('idempotency_key') ||
        msg.includes('reviewed_by') ||
        msg.includes('reviewed_at'))
    ) {
      const basePayload = {
        id: rowPayload.id,
        user_id: rowPayload.user_id,
        type: rowPayload.type,
        amount: rowPayload.amount,
        amount_formatted: rowPayload.amount_formatted,
        method: rowPayload.method,
        reference: rowPayload.reference,
        notes: rowPayload.notes,
        status: rowPayload.status,
        created_at: rowPayload.created_at,
      };
      const { error: fallbackErr } = await supabase.from('vault_transactions').insert(basePayload);
      if (fallbackErr) {
        const dbErr = new Error(`Failed to persist vault transaction in database: ${fallbackErr.message}`);
        dbErr.code = 'DB_WRITE_FAILED';
        dbErr.statusCode = 500;
        throw dbErr;
      }
      return;
    }

    if (msg.includes('idx_vault_tx_settlement_ref_unique') || msg.includes('duplicate key')) {
      const dupErr = new Error('Duplicate settlement or provider reference detected in database.');
      dupErr.code = 'DUPLICATE_SETTLEMENT_REF';
      dupErr.statusCode = 409;
      throw dupErr;
    }

    const dbErr = new Error(`Failed to persist vault transaction in database: ${msg}`);
    dbErr.code = 'DB_WRITE_FAILED';
    dbErr.statusCode = 500;
    throw dbErr;
  }
}

/**
 * Persist a status/audit update on an existing vault_transactions row in Supabase.
 * Fails closed and throws DB_WRITE_FAILED if the update returns an error (never swallows errors).
 */
async function persistVaultTransactionUpdate(txId, updatePayload, { userId, simulateTxDbError = false }) {
  if (simulateTxDbError) {
    const err = new Error('Failed to update vault transaction in database: Simulated ledger update failure.');
    err.code = 'DB_WRITE_FAILED';
    err.statusCode = 500;
    throw err;
  }
  if (!isUuid(userId)) return;

  const { error } = await supabase
    .from('vault_transactions')
    .update(updatePayload)
    .eq('id', txId);

  if (error) {
    const msg = String(error.message || '');
    if (
      msg.includes('column') &&
      (msg.includes('provider_ref') ||
        msg.includes('settlement_ref') ||
        msg.includes('audit_reason') ||
        msg.includes('reviewed_by') ||
        msg.includes('reviewed_at') ||
        msg.includes('updated_at'))
    ) {
      const baseUpdate = {
        status: updatePayload.status,
        reference: updatePayload.reference,
        notes: updatePayload.notes,
      };
      const { error: fallbackErr } = await supabase
        .from('vault_transactions')
        .update(baseUpdate)
        .eq('id', txId);
      if (fallbackErr) {
        const dbErr = new Error(`Failed to update vault transaction in database: ${fallbackErr.message}`);
        dbErr.code = 'DB_WRITE_FAILED';
        dbErr.statusCode = 500;
        throw dbErr;
      }
      return;
    }

    if (msg.includes('idx_vault_tx_settlement_ref_unique') || msg.includes('duplicate key')) {
      const dupErr = new Error('Duplicate settlement reference detected in database.');
      dupErr.code = 'DUPLICATE_SETTLEMENT_REF';
      dupErr.statusCode = 409;
      throw dupErr;
    }

    const dbErr = new Error(`Failed to update vault transaction in database: ${msg}`);
    dbErr.code = 'DB_WRITE_FAILED';
    dbErr.statusCode = 500;
    throw dbErr;
  }
}

/**
 * Helper to attempt a PostgreSQL atomic RPC when available.
 * Returns null if the RPC is not yet installed in the database schema cache so the caller can execute the DB fallback.
 */
async function tryVaultAtomicRpc(fnName, params) {
  if (typeof supabase.rpc !== 'function') return null;
  try {
    const { data, error } = await supabase.rpc(fnName, params);
    if (error) {
      const msg = String(error.message || '');
      const code = String(error.code || '');
      // Function not yet deployed in schema cache or offline environment
      if (
        code === 'PGRST202' ||
        code === '42883' ||
        msg.includes('Could not find the function') ||
        msg.includes('does not exist') ||
        msg.includes('fetch failed')
      ) {
        return null;
      }
      // Application-level exception raised inside the PostgreSQL RPC
      const appErr = new Error(msg || `Database RPC ${fnName} failed.`);
      if (msg.includes('DUPLICATE_SETTLEMENT_REF') || msg.includes('Duplicate settlement reference')) {
        appErr.code = 'DUPLICATE_SETTLEMENT_REF';
        appErr.statusCode = 409;
      } else if (msg.includes('SETTLEMENT_REF_REQUIRED')) {
        appErr.code = 'SETTLEMENT_REF_REQUIRED';
        appErr.statusCode = 400;
      } else if (msg.includes('REASON_REQUIRED')) {
        appErr.code = 'REASON_REQUIRED';
        appErr.statusCode = 400;
      } else if (msg.includes('INSUFFICIENT_FUNDS')) {
        appErr.code = 'INSUFFICIENT_FUNDS';
        appErr.statusCode = 400;
      } else if (msg.includes('BANK_APPROVAL_REQUIRED')) {
        appErr.code = 'BANK_APPROVAL_REQUIRED';
        appErr.statusCode = 400;
      } else if (msg.includes('CANCELLATION_LOCKED')) {
        appErr.code = 'CANCELLATION_LOCKED';
        appErr.statusCode = 409;
      } else if (msg.includes('FORBIDDEN') || msg.includes('UNAUTHORIZED_CALLER')) {
        appErr.code = 'FORBIDDEN';
        appErr.statusCode = 403;
      }
      throw appErr;
    }
    if (data && typeof data === 'object' && (data.tx_id || data.status)) {
      return data;
    }
    return null;
  } catch (err) {
    if (err.code || err.statusCode) throw err;
    return null;
  }
}

/**
 * Deposit funds or record a pending deposit request.
 *
 * CRITICAL SECURITY INVARIANT:
 * - User-initiated deposits NEVER increase spendable balance unless an external payment
 *   provider settlement (`paymentIntentId` / `providerRef` with `isVerifiedSettlement: true`)
 *   is independently verified, OR it is an internal custodial buyout/redemption payout.
 * - Unverified bank transfers / EFT references create a `pending_review` deposit record
 *   and leave the spendable balance unchanged until `confirmDeposit` is called by an admin.
 */
async function depositFunds({
  userId,
  amount,
  currency = 'zar',
  method = 'Manual Bank EFT',
  reference = null,
  notes = null,
  paymentIntentId = null,
  providerRef = null,
  isVerifiedSettlement = false,
  idempotencyKey = null,
  simulateDbError = false,
  simulateTxDbError = false,
  stripeVerifier = null,
}) {
  if (!userId) {
    throw new Error('Authenticated user ID is required.');
  }

  const depositNum = Number(amount);
  if (!Number.isFinite(depositNum) || depositNum <= 0) {
    throw new Error('Please specify a valid deposit amount greater than R0.');
  }
  if (depositNum > MAX_SINGLE_DEPOSIT_ZAR) {
    throw new Error(`Deposit amount exceeds maximum single transaction limit of ${formatZar(MAX_SINGLE_DEPOSIT_ZAR)}.`);
  }
  if (currency && String(currency).toLowerCase() !== 'zar') {
    throw new Error(`Unsupported deposit currency "${currency}". Vault deposits must be denominated in ZAR.`);
  }

  if (idempotencyKey) {
    const existingIdem = await lookupIdempotencyRecord(idempotencyKey, userId);
    if (existingIdem) return existingIdem;
  }

  return withUserVaultLock(userId, async () => {
    if (idempotencyKey) {
      const existingIdem = await lookupIdempotencyRecord(idempotencyKey, userId);
      if (existingIdem) return existingIdem;
    }

    const isInternalPayout = INTERNAL_SETTLED_PAYOUT_METHODS.has(method);
    let verifiedSettlement = false;
    let authoritativeProviderRef = null;

    if (isInternalPayout) {
      verifiedSettlement = true;
      authoritativeProviderRef =
        providerRef || reference || `SYS-PAYOUT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    } else if (
      paymentIntentId ||
      String(method).toLowerCase().includes('stripe') ||
      String(method).toLowerCase() === 'card'
    ) {
      // Card / Stripe deposit: MUST verify settlement via Stripe API / verifier
      if (!paymentIntentId) {
        throw new Error('Card deposit requires a verified Stripe PaymentIntent ID. Raw or unverified card deposits are not permitted.');
      }

      if (await isSettlementOrProviderRefUsed(paymentIntentId)) {
        const err = new Error(`Duplicate provider payment reference: ${paymentIntentId} has already been credited.`);
        err.code = 'DUPLICATE_PROVIDER_REFERENCE';
        err.statusCode = 409;
        throw err;
      }

      const verifyFn = typeof stripeVerifier === 'function' ? stripeVerifier : stripeService.verifyPaymentIntent;
      const verification = await verifyFn(paymentIntentId, {
        amount: depositNum,
        currency: 'zar',
        userId,
      });

      if (!verification) {
        const err = new Error('Deposit payment verification failed: Provider returned empty verification result.');
        err.code = 'PAYMENT_NOT_SETTLED';
        err.statusCode = 402;
        throw err;
      }

      if (verification.verified === false) {
        const err = new Error(`Deposit payment verification failed: ${verification.reason || 'PaymentIntent not verified.'}`);
        if (verification.status === 'amount_mismatch') {
          err.code = 'AMOUNT_MISMATCH';
          err.statusCode = 400;
        } else if (verification.status === 'currency_mismatch') {
          err.code = 'CURRENCY_MISMATCH';
          err.statusCode = 400;
        } else if (verification.status === 'customer_mismatch') {
          err.code = 'USER_MISMATCH';
          err.statusCode = 403;
        } else {
          err.code = 'PAYMENT_NOT_SETTLED';
          err.statusCode = 402;
        }
        throw err;
      }

      if (verification.status && verification.status !== 'succeeded') {
        const err = new Error(`Deposit payment verification failed: PaymentIntent status is "${verification.status}", not "succeeded".`);
        err.code = 'PAYMENT_NOT_SETTLED';
        err.statusCode = 402;
        throw err;
      }

      if (verification.currency && String(verification.currency).toLowerCase() !== 'zar') {
        const err = new Error(`Deposit payment verification failed: Settled currency (${verification.currency}) does not match ZAR.`);
        err.code = 'CURRENCY_MISMATCH';
        err.statusCode = 400;
        throw err;
      }

      if (verification.amount !== undefined && Math.abs(Number(verification.amount) - depositNum) > 0.05) {
        const err = new Error(`Deposit payment verification failed: Settled amount (${verification.amount}) does not match expected (${depositNum}).`);
        err.code = 'AMOUNT_MISMATCH';
        err.statusCode = 400;
        throw err;
      }

      const metaUserId = verification.metadata?.userId || verification.userId;
      if (metaUserId && String(metaUserId) !== String(userId)) {
        const err = new Error('Deposit payment verification failed: PaymentIntent metadata user does not match authenticated user.');
        err.code = 'USER_MISMATCH';
        err.statusCode = 403;
        throw err;
      }

      verifiedSettlement = true;
      authoritativeProviderRef = verification.paymentIntentId || verification.id || paymentIntentId;
    } else if (isVerifiedSettlement === true) {
      const refToUse = providerRef || reference;
      if (!refToUse || String(refToUse).trim().length < 4) {
        throw new Error('Verified deposit settlement requires an authoritative provider reference.');
      }
      if (await isSettlementOrProviderRefUsed(refToUse)) {
        const err = new Error(`Duplicate provider payment reference: ${refToUse} has already been credited.`);
        err.code = 'DUPLICATE_PROVIDER_REFERENCE';
        err.statusCode = 409;
        throw err;
      }
      verifiedSettlement = true;
      authoritativeProviderRef = String(refToUse).trim();
    } else {
      // Manual Bank EFT / User-submitted reference: NEVER auto-credit!
      verifiedSettlement = false;
    }

    // Attempt PostgreSQL atomic RPC for unverified manual deposit when available
    if (!verifiedSettlement && isUuid(userId) && !simulateDbError && !simulateTxDbError) {
      const rpcRes = await tryVaultAtomicRpc('request_vault_deposit_atomic', {
        p_user_id: userId,
        p_amount: depositNum,
        p_method: method || 'Manual Bank EFT',
        p_reference: reference || null,
        p_notes: notes || null,
        p_idempotency_key: idempotencyKey || null,
      });

      if (rpcRes && rpcRes.tx_id) {
        const txRow = await resolveTransactionById(rpcRes.tx_id);
        const spendable = Number(rpcRes.spendable_balance) || 0;
        const total = Number(rpcRes.total_balance) || 0;
        const reserved = Number(rpcRes.reserved_balance) || 0;
        balancesMap.set(userId, total);
        reservedBalancesMap.set(userId, reserved);
        const rpcResponse = {
          userId,
          transaction:
            txRow ||
            mapDbRowToTx({
              id: rpcRes.tx_id,
              user_id: userId,
              type: 'deposit',
              amount: depositNum,
              method: method || 'Manual Bank EFT',
              reference,
              notes,
              status: 'pending_review',
            }),
          status: 'pending_review',
          credited: false,
          newBalanceNum: spendable,
          newBalanceFormatted: formatZar(spendable),
          totalBalanceNum: total,
          reservedBalanceNum: reserved,
          duplicate: Boolean(rpcRes.idempotent),
        };
        if (idempotencyKey) idempotencyStore.set(idempotencyKey, rpcResponse);
        return rpcResponse;
      }
    }

    const balDetails = await getUserBalanceDetails(userId);
    const currentTotal = balDetails.totalBalanceNum;
    const currentReserved = balDetails.reservedBalanceNum;
    const newTotal = verifiedSettlement ? currentTotal + depositNum : currentTotal;
    const newSpendable = Math.max(0, newTotal - currentReserved);

    if (verifiedSettlement) {
      await persistUserBalancesToDb(userId, newTotal, currentReserved, simulateDbError);
      balancesMap.set(userId, newTotal);
    } else if (simulateDbError) {
      const err = new Error('Failed to record deposit request in database: Simulated database write failure.');
      err.code = 'DB_WRITE_FAILED';
      err.statusCode = 500;
      throw err;
    }

    const txId =
      'TXN-DEP-' +
      Math.floor(100000 + Math.random() * 900000) +
      '-' +
      crypto.randomBytes(2).toString('hex').toUpperCase();
    const now = new Date().toISOString();
    const txStatus = verifiedSettlement ? 'completed' : 'pending_review';

    const rowPayload = {
      id: txId,
      user_id: userId,
      type: 'deposit',
      amount: depositNum,
      amount_formatted: `+${formatZar(depositNum)}`,
      method: method || 'Manual Bank EFT',
      reference: reference || authoritativeProviderRef || null,
      provider_ref: authoritativeProviderRef,
      settlement_ref: verifiedSettlement ? authoritativeProviderRef : null,
      idempotency_key: idempotencyKey || null,
      notes:
        notes ||
        (verifiedSettlement
          ? 'Verified settlement credited to Vault balance'
          : 'Pending treasury verification of bank receipt. Funds will be credited once confirmed.'),
      status: txStatus,
      created_at: now,
      updated_at: now,
    };

    try {
      await persistVaultTransactionInsert(rowPayload, { userId, simulateTxDbError });
    } catch (txErr) {
      // Roll back balance if verified settlement was already persisted
      if (verifiedSettlement) {
        balancesMap.set(userId, currentTotal);
        try {
          await persistUserBalancesToDb(userId, currentTotal, currentReserved, false);
        } catch (_) {}
      }
      throw txErr;
    }

    if (verifiedSettlement && authoritativeProviderRef) {
      creditedProviderRefs.add(authoritativeProviderRef);
    }

    const txRecord = mapDbRowToTx(rowPayload);
    transactionsMap.set(txId, txRecord);

    auditLogService.logEvent({
      eventType: verifiedSettlement ? 'VAULT_DEPOSIT_CREDITED' : 'VAULT_DEPOSIT_PENDING_REVIEW',
      actorId: userId,
      category: 'Vault',
      description: verifiedSettlement
        ? `Credited ${formatZar(depositNum)} to user ${userId} via ${txRecord.method} (Ref: ${authoritativeProviderRef}). Spendable balance: ${formatZar(newSpendable)}.`
        : `Recorded pending deposit request ${txId} of ${formatZar(depositNum)} for user ${userId} via ${txRecord.method} (User Ref: ${reference || 'N/A'}). Spendable balance unchanged at ${formatZar(newSpendable)}.`,
    });

    const responseObj = {
      userId,
      transaction: txRecord,
      status: txStatus,
      credited: verifiedSettlement,
      newBalanceNum: newSpendable,
      newBalanceFormatted: formatZar(newSpendable),
      totalBalanceNum: newTotal,
      reservedBalanceNum: currentReserved,
      duplicate: false,
    };

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, responseObj);
    }

    return responseObj;
  });
}

/**
 * Authorized Admin Confirmation of a Pending Deposit Request.
 * Credits the user's balance only after treasury/admin verifies bank statement receipt.
 */
async function confirmDeposit({
  transactionId,
  adminId,
  reviewer,
  settlementRef,
  reason = null,
  auditReason = null,
  simulateDbError = false,
  simulateTxDbError = false,
}) {
  const effectiveAdminId = adminId || reviewer;
  const effectiveReason = auditReason || reason || 'Treasury bank statement receipt verified';

  if (!transactionId) {
    throw new Error('Deposit transaction ID is required.');
  }
  if (!effectiveAdminId) {
    throw new Error('Authorized administrator ID is required to confirm a deposit.');
  }
  if (!settlementRef || String(settlementRef).trim().length < 4) {
    const err = new Error('An authoritative bank/treasury settlement reference (min 4 chars) is required to confirm a deposit.');
    err.code = 'SETTLEMENT_REF_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const cleanSettlementRef = String(settlementRef).trim();

  // Locate transaction in memory or Supabase (restart-safe)
  const tx = await resolveTransactionById(transactionId);
  if (!tx) {
    const err = new Error(`Deposit transaction "${transactionId}" not found.`);
    err.statusCode = 404;
    throw err;
  }
  if (tx.type !== 'deposit') {
    const err = new Error(`Transaction "${transactionId}" is not a deposit.`);
    err.statusCode = 400;
    throw err;
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = (await resolveTransactionById(transactionId)) || tx;

    // Idempotent return if already completed with the same reference
    if (currentTx.status === 'completed') {
      if (currentTx.settlementRef && currentTx.settlementRef !== cleanSettlementRef) {
        const err = new Error(
          `Deposit "${transactionId}" was already confirmed with a different settlement reference (${currentTx.settlementRef}).`
        );
        err.code = 'ALREADY_CONFIRMED_DIFFERENT_REF';
        err.statusCode = 409;
        throw err;
      }
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: 'completed',
        alreadyCompleted: true,
        idempotent: true,
        settlementRef: currentTx.settlementRef || cleanSettlementRef,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
        totalBalanceNum: balDetails.totalBalanceNum,
        reservedBalanceNum: balDetails.reservedBalanceNum,
      };
    }

    if (currentTx.status !== 'pending_review') {
      const err = new Error(`Cannot confirm deposit in status "${currentTx.status}". Only pending_review deposits can be confirmed.`);
      err.code = 'INVALID_STATUS_TRANSITION';
      err.statusCode = 409;
      throw err;
    }

    // Check duplicate settlement reference across all deposits & withdrawals (memory + DB)
    if (await isSettlementOrProviderRefUsed(cleanSettlementRef, currentTx.id)) {
      const err = new Error(`Duplicate settlement reference: "${cleanSettlementRef}" has already been used.`);
      err.code = 'DUPLICATE_SETTLEMENT_REF';
      err.statusCode = 409;
      throw err;
    }

    // Attempt PostgreSQL atomic RPC first if available
    if (isUuid(currentTx.userId) && !simulateDbError && !simulateTxDbError) {
      const rpcRes = await tryVaultAtomicRpc('confirm_vault_deposit_atomic', {
        p_tx_id: currentTx.id,
        p_admin_id: String(effectiveAdminId),
        p_settlement_ref: cleanSettlementRef,
        p_audit_reason: effectiveReason,
      });

      if (rpcRes && rpcRes.status === 'completed') {
        creditedProviderRefs.add(cleanSettlementRef);
        const refreshedTx = await resolveTransactionById(currentTx.id);
        const spendable = Number(rpcRes.spendable_balance) || 0;
        const total = Number(rpcRes.total_balance) || 0;
        balancesMap.set(currentTx.userId, total);
        return {
          transaction: refreshedTx || currentTx,
          status: 'completed',
          alreadyCompleted: Boolean(rpcRes.idempotent),
          idempotent: Boolean(rpcRes.idempotent),
          newBalanceNum: spendable,
          newBalanceFormatted: formatZar(spendable),
          totalBalanceNum: total,
          settlementRef: cleanSettlementRef,
        };
      }
    }

    const balDetails = await getUserBalanceDetails(currentTx.userId);
    const previousTotal = balDetails.totalBalanceNum;
    const currentReserved = balDetails.reservedBalanceNum;
    const newTotal = previousTotal + currentTx.amount;
    const newSpendable = Math.max(0, newTotal - currentReserved);

    // 1. Update DB profile balance first (fail closed on DB write failure)
    await persistUserBalancesToDb(currentTx.userId, newTotal, currentReserved, simulateDbError);

    const now = new Date().toISOString();
    const updatedNotes = `${currentTx.notes || 'Bank EFT Deposit'} | Verified by Admin (${effectiveAdminId}) Ref: ${cleanSettlementRef}${effectiveReason ? ` — ${effectiveReason}` : ''}`;

    const updatePayload = {
      status: 'completed',
      reference: currentTx.reference || cleanSettlementRef,
      provider_ref: cleanSettlementRef,
      settlement_ref: cleanSettlementRef,
      audit_reason: effectiveReason,
      notes: updatedNotes,
      reviewed_by: String(effectiveAdminId),
      reviewed_at: now,
      updated_at: now,
    };

    // 2. Persist status transition to vault_transactions — roll back balance if this fails!
    try {
      await persistVaultTransactionUpdate(currentTx.id, updatePayload, {
        userId: currentTx.userId,
        simulateTxDbError,
      });
    } catch (txErr) {
      balancesMap.set(currentTx.userId, previousTotal);
      try {
        await persistUserBalancesToDb(currentTx.userId, previousTotal, currentReserved, false);
      } catch (_) {}
      throw txErr;
    }

    balancesMap.set(currentTx.userId, newTotal);
    creditedProviderRefs.add(cleanSettlementRef);

    const updatedTx = mapDbRowToTx({
      ...currentTx,
      id: currentTx.id,
      user_id: currentTx.userId,
      type: 'deposit',
      amount: currentTx.amount,
      amount_formatted: currentTx.amountFormatted,
      method: currentTx.method,
      ...updatePayload,
      created_at: currentTx.createdAt,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    auditLogService.logEvent({
      eventType: 'VAULT_DEPOSIT_CONFIRMED_BY_ADMIN',
      actorId: effectiveAdminId,
      category: 'Vault',
      description: `Admin ${effectiveAdminId} confirmed deposit ${currentTx.id} (${formatZar(currentTx.amount)}) for user ${currentTx.userId}. Settlement Ref: ${cleanSettlementRef}. New spendable balance: ${formatZar(newSpendable)}.`,
    });

    return {
      transaction: updatedTx,
      status: 'completed',
      alreadyCompleted: false,
      idempotent: false,
      newBalanceNum: newSpendable,
      newBalanceFormatted: formatZar(newSpendable),
      totalBalanceNum: newTotal,
      reservedBalanceNum: currentReserved,
      settlementRef: cleanSettlementRef,
    };
  });
}

/**
 * Authorized Admin Rejection of a Pending Deposit Request.
 * Marks deposit rejected and never increases user balance.
 */
async function rejectDeposit({
  transactionId,
  adminId,
  reviewer,
  reason,
  simulateDbError = false,
  simulateTxDbError = false,
}) {
  const effectiveAdminId = adminId || reviewer;
  if (!transactionId) {
    throw new Error('Deposit transaction ID is required.');
  }
  if (!effectiveAdminId) {
    throw new Error('Authorized administrator ID is required to reject a deposit.');
  }
  if (!reason || !String(reason).trim()) {
    const err = new Error('A rejection reason is required when rejecting a deposit.');
    err.code = 'REASON_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const cleanReason = String(reason).trim();

  const tx = await resolveTransactionById(transactionId);
  if (!tx) {
    const err = new Error(`Deposit transaction "${transactionId}" not found.`);
    err.statusCode = 404;
    throw err;
  }
  if (tx.type !== 'deposit') {
    const err = new Error(`Transaction "${transactionId}" is not a deposit.`);
    err.statusCode = 400;
    throw err;
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = (await resolveTransactionById(transactionId)) || tx;

    if (currentTx.status === 'completed') {
      const err = new Error('Cannot reject a deposit that has already been confirmed and credited.');
      err.code = 'INVALID_STATUS_TRANSITION';
      err.statusCode = 409;
      throw err;
    }

    if (currentTx.status === 'rejected') {
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: 'rejected',
        alreadyRejected: true,
        idempotent: true,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
      };
    }

    if (simulateDbError) {
      const err = new Error('Failed to reject deposit in database: Simulated database write failure.');
      err.code = 'DB_WRITE_FAILED';
      err.statusCode = 500;
      throw err;
    }

    if (isUuid(currentTx.userId) && !simulateTxDbError) {
      const rpcRes = await tryVaultAtomicRpc('reject_vault_deposit_atomic', {
        p_tx_id: currentTx.id,
        p_admin_id: String(effectiveAdminId),
        p_reason: cleanReason,
      });
      if (rpcRes && rpcRes.status === 'rejected') {
        const refreshedTx = await resolveTransactionById(currentTx.id);
        const balDetails = await getUserBalanceDetails(currentTx.userId);
        return {
          transaction: refreshedTx || currentTx,
          status: 'rejected',
          alreadyRejected: Boolean(rpcRes.idempotent),
          idempotent: Boolean(rpcRes.idempotent),
          newBalanceNum: balDetails.availableBalanceNum,
          newBalanceFormatted: balDetails.availableBalanceFormatted,
        };
      }
    }

    const now = new Date().toISOString();
    const updatePayload = {
      status: 'rejected',
      audit_reason: cleanReason,
      notes: `Rejected by Admin (${effectiveAdminId}): ${cleanReason}`,
      reviewed_by: String(effectiveAdminId),
      reviewed_at: now,
      updated_at: now,
    };

    await persistVaultTransactionUpdate(currentTx.id, updatePayload, {
      userId: currentTx.userId,
      simulateTxDbError,
    });

    const updatedTx = mapDbRowToTx({
      ...currentTx,
      id: currentTx.id,
      user_id: currentTx.userId,
      amount_formatted: currentTx.amountFormatted,
      ...updatePayload,
      created_at: currentTx.createdAt,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    const balDetails = await getUserBalanceDetails(currentTx.userId);

    auditLogService.logEvent({
      eventType: 'VAULT_DEPOSIT_REJECTED_BY_ADMIN',
      actorId: effectiveAdminId,
      category: 'Vault',
      description: `Admin ${effectiveAdminId} rejected deposit ${currentTx.id} (${formatZar(currentTx.amount)}) for user ${currentTx.userId}. Reason: ${cleanReason}.`,
    });

    return {
      transaction: updatedTx,
      status: 'rejected',
      alreadyRejected: false,
      idempotent: false,
      newBalanceNum: balDetails.availableBalanceNum,
      newBalanceFormatted: balDetails.availableBalanceFormatted,
    };
  });
}

/**
 * Request a Vault Withdrawal.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. Never pays to unverified/arbitrary request-body bank details or crypto wallets.
 *    Always verifies and binds to the user's approved bank account on file.
 * 2. Atomically reserves funds (`reserved_balance += amount`), reducing spendable balance
 *    immediately so concurrent withdrawals cannot double-spend.
 * 3. Records status as `pending_review` (NEVER claims `completed` or `settled` at request time).
 */
async function withdrawFunds({
  userId,
  userEmail = null,
  amount,
  method = 'Approved Bank EFT',
  bankDetails = null,
  walletAddress = null,
  notes = null,
  idempotencyKey = null,
  approvedBank = null,
  simulateDbError = false,
  simulateTxDbError = false,
}) {
  if (!userId) {
    throw new Error('Authenticated user ID is required.');
  }

  const withdrawNum = Number(amount);
  if (!Number.isFinite(withdrawNum) || withdrawNum <= 0) {
    throw new Error('Please specify a valid withdrawal amount greater than R0.');
  }
  if (withdrawNum > MAX_SINGLE_WITHDRAWAL_ZAR) {
    throw new Error(`Withdrawal amount exceeds maximum single transaction limit of ${formatZar(MAX_SINGLE_WITHDRAWAL_ZAR)}.`);
  }

  // Block crypto wallet or non-bank withdrawal methods
  if (walletAddress || (method && String(method).toLowerCase().includes('crypto'))) {
    const err = new Error(
      'Unapproved withdrawal destination: Crypto wallet withdrawals are not supported. Withdrawals can only be sent to your approved South African bank account on file.'
    );
    err.code = 'UNAPPROVED_DESTINATION';
    err.statusCode = 400;
    throw err;
  }

  if (idempotencyKey) {
    const existingIdem = await lookupIdempotencyRecord(idempotencyKey, userId);
    if (existingIdem) return existingIdem;
  }

  // Resolve authoritative approved bank account on file
  const complianceService = require('./complianceService');
  const resolvedBank = approvedBank || complianceService.getUserBankAccount(userId, userEmail);

  if (!resolvedBank || resolvedBank.status !== 'approved') {
    const err = new Error(
      'Approved bank account required. Please submit your bank details and wait for admin approval before withdrawing funds.'
    );
    err.code = 'BANK_APPROVAL_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const authoritativeBankName = String(resolvedBank.bank_name || resolvedBank.bankName || '').trim();
  const authoritativeAccNum = String(resolvedBank.account_number || resolvedBank.accountNumber || '').replace(/\s+/g, '');
  const authoritativeHolder = String(resolvedBank.account_holder || resolvedBank.accountHolder || '').trim();

  // Reject any attempt in request body to override or redirect payout to a different account
  if (bankDetails && typeof bankDetails === 'object') {
    if (bankDetails.accountNumber) {
      const suppliedAccNum = String(bankDetails.accountNumber).replace(/\s+/g, '');
      if (suppliedAccNum !== authoritativeAccNum) {
        const err = new Error(
          'Unapproved withdrawal destination: Supplied account number does not match your approved bank account on file.'
        );
        err.code = 'UNAPPROVED_DESTINATION';
        err.statusCode = 400;
        throw err;
      }
    }
    if (bankDetails.bankName) {
      const suppliedBank = String(bankDetails.bankName).trim().toLowerCase();
      if (suppliedBank !== authoritativeBankName.toLowerCase()) {
        const err = new Error(
          'Unapproved withdrawal destination: Supplied bank name does not match your approved bank account on file.'
        );
        err.code = 'UNAPPROVED_DESTINATION';
        err.statusCode = 400;
        throw err;
      }
    }
  }

  return withUserVaultLock(userId, async () => {
    if (idempotencyKey) {
      const existingIdem = await lookupIdempotencyRecord(idempotencyKey, userId);
      if (existingIdem) return existingIdem;
    }

    const balDetails = await getUserBalanceDetails(userId);
    const spendableBal = balDetails.availableBalanceNum;
    const totalBal = balDetails.totalBalanceNum;
    const currentReserved = balDetails.reservedBalanceNum;

    if (withdrawNum > spendableBal) {
      const err = new Error(
        `Insufficient vault balance. You requested ${formatZar(withdrawNum)} but your available spendable balance is ${formatZar(spendableBal)}.`
      );
      err.code = 'INSUFFICIENT_FUNDS';
      err.statusCode = 400;
      throw err;
    }

    const newReserved = currentReserved + withdrawNum;
    const newSpendable = Math.max(0, totalBal - newReserved);

    // 1. Update DB profile reserved_balance first — fail closed if DB write fails
    await persistUserBalancesToDb(userId, totalBal, newReserved, simulateDbError);

    // 2. Create pending withdrawal transaction bound strictly to approved bank on file (masked destination)
    const txId =
      'TXN-WTH-' +
      Math.floor(100000 + Math.random() * 900000) +
      '-' +
      crypto.randomBytes(2).toString('hex').toUpperCase();
    const now = new Date().toISOString();
    const maskedAcc = authoritativeAccNum ? '****' + authoritativeAccNum.slice(-4) : '****';
    const destinationDesc = `${authoritativeBankName} (${maskedAcc})`;

    const rowPayload = {
      id: txId,
      user_id: userId,
      type: 'withdraw',
      amount: withdrawNum,
      amount_formatted: `-${formatZar(withdrawNum)}`,
      method: 'Approved Bank EFT',
      destination_summary: destinationDesc,
      bank_account_id: resolvedBank.id || null,
      reference: null,
      settlement_ref: null,
      idempotency_key: idempotencyKey || null,
      notes: notes || `Pending admin review & EFT payout to approved ${destinationDesc} (${authoritativeHolder})`,
      status: 'pending_review',
      created_at: now,
      updated_at: now,
    };

    // 3. Persist to Supabase vault_transactions — roll back reserved_balance if this fails!
    try {
      await persistVaultTransactionInsert(rowPayload, { userId, simulateTxDbError });
    } catch (txErr) {
      reservedBalancesMap.set(userId, currentReserved);
      balancesMap.set(userId, totalBal);
      try {
        await persistUserBalancesToDb(userId, totalBal, currentReserved, false);
      } catch (_) {}
      throw txErr;
    }

    reservedBalancesMap.set(userId, newReserved);
    balancesMap.set(userId, totalBal);

    const txRecord = mapDbRowToTx(rowPayload);
    transactionsMap.set(txId, txRecord);

    auditLogService.logEvent({
      eventType: 'VAULT_WITHDRAWAL_REQUESTED',
      actorId: userId,
      category: 'Vault',
      description: `User ${userId} requested withdrawal ${txId} of ${formatZar(withdrawNum)} to approved account ${destinationDesc}. Reserved: ${formatZar(newReserved)}, Spendable remaining: ${formatZar(newSpendable)}.`,
    });

    const responseObj = {
      userId,
      transaction: txRecord,
      status: 'pending_review',
      destination: destinationDesc,
      bankAccountId: resolvedBank.id || null,
      newBalanceNum: newSpendable,
      newBalanceFormatted: formatZar(newSpendable),
      totalBalanceNum: totalBal,
      reservedBalanceNum: newReserved,
      reservedBalanceFormatted: formatZar(newReserved),
      duplicate: false,
    };

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, responseObj);
    }

    return responseObj;
  });
}

/**
 * Transition a withdrawal from pending_review to settlement_processing (locks user cancellation).
 */
async function markWithdrawalProcessing({ transactionId, adminId, reviewer, simulateTxDbError = false }) {
  const effectiveAdminId = adminId || reviewer;
  if (!transactionId) throw new Error('Withdrawal transaction ID is required.');
  if (!effectiveAdminId) throw new Error('Authorized administrator ID is required.');

  const tx = await resolveTransactionById(transactionId);
  if (!tx) throw new Error(`Withdrawal transaction "${transactionId}" not found.`);
  if (tx.type !== 'withdraw') throw new Error(`Transaction "${transactionId}" is not a withdrawal.`);

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = (await resolveTransactionById(transactionId)) || tx;
    if (currentTx.status !== 'pending_review') {
      throw new Error(`Cannot mark withdrawal processing from status "${currentTx.status}".`);
    }
    const now = new Date().toISOString();
    const updatePayload = {
      status: 'settlement_processing',
      reviewed_by: String(effectiveAdminId),
      reviewed_at: now,
      updated_at: now,
    };

    await persistVaultTransactionUpdate(transactionId, updatePayload, {
      userId: currentTx.userId,
      simulateTxDbError,
    });

    const updatedTx = {
      ...currentTx,
      status: 'settlement_processing',
      title: 'Withdrawal (Payout Processing)',
      reviewedBy: effectiveAdminId,
      reviewedAt: now,
      updatedAt: now,
    };
    transactionsMap.set(transactionId, updatedTx);

    return { transaction: updatedTx, status: 'settlement_processing' };
  });
}

/**
 * Authorized Admin / Provider Settlement of a Pending Withdrawal.
 * Deducts the reserved funds from total balance and marks the withdrawal `completed`
 * ONLY after an authoritative payout settlement reference is recorded.
 */
async function settleWithdrawal({
  transactionId,
  adminId,
  reviewer,
  settlementRef,
  reason = null,
  auditReason = null,
  simulateDbError = false,
  simulateTxDbError = false,
}) {
  const effectiveAdminId = adminId || reviewer;
  const effectiveReason = auditReason || reason || 'Bank EFT payout executed to approved account on file';

  if (!transactionId) {
    throw new Error('Withdrawal transaction ID is required.');
  }
  if (!effectiveAdminId) {
    throw new Error('Authorized administrator ID is required to settle a withdrawal.');
  }
  if (!settlementRef || String(settlementRef).trim().length < 4) {
    const err = new Error('An authoritative bank EFT settlement reference (min 4 chars) is required to mark a withdrawal completed.');
    err.code = 'SETTLEMENT_REF_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const cleanRef = String(settlementRef).trim();

  const tx = await resolveTransactionById(transactionId);
  if (!tx) {
    const err = new Error(`Withdrawal transaction "${transactionId}" not found.`);
    err.statusCode = 404;
    throw err;
  }
  if (tx.type !== 'withdraw') {
    const err = new Error(`Transaction "${transactionId}" is not a withdrawal.`);
    err.statusCode = 400;
    throw err;
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = (await resolveTransactionById(transactionId)) || tx;

    if (currentTx.status === 'completed') {
      if (currentTx.settlementRef && currentTx.settlementRef !== cleanRef) {
        const err = new Error(
          `Withdrawal "${transactionId}" was already settled with a different reference (${currentTx.settlementRef}).`
        );
        err.code = 'ALREADY_SETTLED_DIFFERENT_REF';
        err.statusCode = 409;
        throw err;
      }
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: 'completed',
        alreadyCompleted: true,
        idempotent: true,
        settlementRef: currentTx.settlementRef || cleanRef,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
        totalBalanceNum: balDetails.totalBalanceNum,
        reservedBalanceNum: balDetails.reservedBalanceNum,
      };
    }

    if (!['pending_review', 'settlement_processing'].includes(currentTx.status)) {
      const err = new Error(`Cannot settle withdrawal in status "${currentTx.status}".`);
      err.code = 'INVALID_STATUS_TRANSITION';
      err.statusCode = 409;
      throw err;
    }

    // Prevent duplicate settlement reference across transactions (memory + DB)
    if (await isSettlementOrProviderRefUsed(cleanRef, currentTx.id)) {
      const err = new Error(`Duplicate settlement reference: "${cleanRef}" has already been used.`);
      err.code = 'DUPLICATE_SETTLEMENT_REF';
      err.statusCode = 409;
      throw err;
    }

    // Attempt PostgreSQL atomic RPC first if available
    if (isUuid(currentTx.userId) && !simulateDbError && !simulateTxDbError) {
      const rpcRes = await tryVaultAtomicRpc('settle_vault_withdrawal_atomic', {
        p_tx_id: currentTx.id,
        p_admin_id: String(effectiveAdminId),
        p_settlement_ref: cleanRef,
        p_audit_reason: effectiveReason,
      });

      if (rpcRes && rpcRes.status === 'completed') {
        creditedProviderRefs.add(cleanRef);
        const refreshedTx = await resolveTransactionById(currentTx.id);
        const spendable = Number(rpcRes.spendable_balance) || 0;
        const total = Number(rpcRes.total_balance) || 0;
        const reserved = Number(rpcRes.reserved_balance) || 0;
        balancesMap.set(currentTx.userId, total);
        reservedBalancesMap.set(currentTx.userId, reserved);
        return {
          transaction: refreshedTx || currentTx,
          status: 'completed',
          alreadyCompleted: Boolean(rpcRes.idempotent),
          idempotent: Boolean(rpcRes.idempotent),
          settlementRef: cleanRef,
          newBalanceNum: spendable,
          newBalanceFormatted: formatZar(spendable),
          totalBalanceNum: total,
          reservedBalanceNum: reserved,
        };
      }
    }

    const balDetails = await getUserBalanceDetails(currentTx.userId);
    const prevTotal = balDetails.totalBalanceNum;
    const prevReserved = balDetails.reservedBalanceNum;
    const newTotal = Math.max(0, prevTotal - currentTx.amount);
    const newReserved = Math.max(0, prevReserved - currentTx.amount);
    const newSpendable = Math.max(0, newTotal - newReserved);

    await persistUserBalancesToDb(currentTx.userId, newTotal, newReserved, simulateDbError);

    const now = new Date().toISOString();
    const updatedNotes = `${currentTx.notes || 'Vault Withdrawal'} | Settled by Admin (${effectiveAdminId}) EFT Ref: ${cleanRef}${effectiveReason ? ` — ${effectiveReason}` : ''}`;

    const updatePayload = {
      status: 'completed',
      reference: cleanRef,
      settlement_ref: cleanRef,
      audit_reason: effectiveReason,
      notes: updatedNotes,
      reviewed_by: String(effectiveAdminId),
      reviewed_at: now,
      updated_at: now,
    };

    try {
      await persistVaultTransactionUpdate(currentTx.id, updatePayload, {
        userId: currentTx.userId,
        simulateTxDbError,
      });
    } catch (txErr) {
      balancesMap.set(currentTx.userId, prevTotal);
      reservedBalancesMap.set(currentTx.userId, prevReserved);
      try {
        await persistUserBalancesToDb(currentTx.userId, prevTotal, prevReserved, false);
      } catch (_) {}
      throw txErr;
    }

    balancesMap.set(currentTx.userId, newTotal);
    reservedBalancesMap.set(currentTx.userId, newReserved);
    creditedProviderRefs.add(cleanRef);

    const updatedTx = mapDbRowToTx({
      ...currentTx,
      id: currentTx.id,
      user_id: currentTx.userId,
      type: 'withdraw',
      amount: currentTx.amount,
      amount_formatted: currentTx.amountFormatted,
      method: currentTx.method,
      destination_summary: currentTx.destination,
      bank_account_id: currentTx.bankAccountId,
      ...updatePayload,
      created_at: currentTx.createdAt,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    auditLogService.logEvent({
      eventType: 'VAULT_WITHDRAWAL_SETTLED',
      actorId: effectiveAdminId,
      category: 'Vault',
      description: `Admin ${effectiveAdminId} settled withdrawal ${currentTx.id} (${formatZar(currentTx.amount)}) for user ${currentTx.userId}. EFT Ref: ${cleanRef}.`,
    });

    return {
      transaction: updatedTx,
      status: 'completed',
      alreadyCompleted: false,
      idempotent: false,
      settlementRef: cleanRef,
      newBalanceNum: newSpendable,
      newBalanceFormatted: formatZar(newSpendable),
      totalBalanceNum: newTotal,
      reservedBalanceNum: newReserved,
    };
  });
}

/**
 * Cancel, Reject, or Fail a Pending Withdrawal and Restore Reserved Funds Exactly Once.
 */
async function cancelOrRejectWithdrawal({
  transactionId,
  actorId,
  newStatus = 'rejected',
  reason = null,
  simulateDbError = false,
  simulateTxDbError = false,
}) {
  if (!transactionId) {
    throw new Error('Withdrawal transaction ID is required.');
  }
  if (!actorId) {
    throw new Error('Actor ID is required.');
  }
  if (!['rejected', 'cancelled', 'failed'].includes(newStatus)) {
    throw new Error(`Invalid withdrawal reversal status "${newStatus}".`);
  }
  if (newStatus === 'rejected' && (!reason || !String(reason).trim())) {
    const err = new Error('A rejection reason is required when rejecting a withdrawal.');
    err.code = 'REASON_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  const cleanReason = reason ? String(reason).trim() : null;

  const tx = await resolveTransactionById(transactionId);
  if (!tx) {
    const err = new Error(`Withdrawal transaction "${transactionId}" not found.`);
    err.statusCode = 404;
    throw err;
  }
  if (tx.type !== 'withdraw') {
    const err = new Error(`Transaction "${transactionId}" is not a withdrawal.`);
    err.statusCode = 400;
    throw err;
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = (await resolveTransactionById(transactionId)) || tx;

    // Idempotent check: if already reversed, do NOT restore balance a second time!
    if (['rejected', 'cancelled', 'failed'].includes(currentTx.status)) {
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: currentTx.status,
        alreadyReversed: true,
        idempotent: true,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
        totalBalanceNum: balDetails.totalBalanceNum,
        reservedBalanceNum: balDetails.reservedBalanceNum,
      };
    }

    if (currentTx.status === 'completed') {
      const err = new Error('Cannot cancel or reject a withdrawal that has already settled.');
      err.code = 'CANCELLATION_LOCKED';
      err.statusCode = 409;
      throw err;
    }

    // If user is attempting to cancel after payout processing has started, block it
    if (newStatus === 'cancelled') {
      if (String(actorId) !== String(currentTx.userId)) {
        const err = new Error('Forbidden: Only the withdrawal owner may cancel their request.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }
      if (currentTx.status === 'settlement_processing') {
        const err = new Error('Cannot cancel withdrawal after payout settlement processing has started.');
        err.code = 'CANCELLATION_LOCKED';
        err.statusCode = 409;
        throw err;
      }
    }

    // Attempt PostgreSQL atomic RPC first if available
    if (isUuid(currentTx.userId) && !simulateDbError && !simulateTxDbError) {
      const rpcRes = await tryVaultAtomicRpc('cancel_or_reject_vault_withdrawal_atomic', {
        p_tx_id: currentTx.id,
        p_actor_id: isUuid(actorId) ? actorId : currentTx.userId,
        p_is_admin: newStatus !== 'cancelled',
        p_new_status: newStatus,
        p_reason: cleanReason,
        p_admin_identifier: String(actorId),
      });

      if (rpcRes && ['rejected', 'cancelled', 'failed'].includes(rpcRes.status)) {
        const refreshedTx = await resolveTransactionById(currentTx.id);
        const spendable = Number(rpcRes.spendable_balance) || 0;
        const total = Number(rpcRes.total_balance) || 0;
        const reserved = Number(rpcRes.reserved_balance) || 0;
        balancesMap.set(currentTx.userId, total);
        reservedBalancesMap.set(currentTx.userId, reserved);
        return {
          transaction: refreshedTx || currentTx,
          status: rpcRes.status,
          alreadyReversed: Boolean(rpcRes.idempotent),
          idempotent: Boolean(rpcRes.idempotent),
          newBalanceNum: spendable,
          newBalanceFormatted: formatZar(spendable),
          totalBalanceNum: total,
          reservedBalanceNum: reserved,
        };
      }
    }

    const balDetails = await getUserBalanceDetails(currentTx.userId);
    const totalBal = balDetails.totalBalanceNum;
    const prevReserved = balDetails.reservedBalanceNum;
    const newReserved = Math.max(0, prevReserved - currentTx.amount);
    const newSpendable = Math.max(0, totalBal - newReserved);

    await persistUserBalancesToDb(currentTx.userId, totalBal, newReserved, simulateDbError);

    const now = new Date().toISOString();
    const updatedNotes = cleanReason
      ? `${currentTx.notes || ''} | ${newStatus.toUpperCase()} (${actorId}): ${cleanReason}`
      : currentTx.notes;

    const updatePayload = {
      status: newStatus,
      audit_reason: cleanReason,
      notes: updatedNotes,
      reviewed_by: String(actorId),
      reviewed_at: now,
      updated_at: now,
    };

    try {
      await persistVaultTransactionUpdate(currentTx.id, updatePayload, {
        userId: currentTx.userId,
        simulateTxDbError,
      });
    } catch (txErr) {
      reservedBalancesMap.set(currentTx.userId, prevReserved);
      balancesMap.set(currentTx.userId, totalBal);
      try {
        await persistUserBalancesToDb(currentTx.userId, totalBal, prevReserved, false);
      } catch (_) {}
      throw txErr;
    }

    reservedBalancesMap.set(currentTx.userId, newReserved);
    balancesMap.set(currentTx.userId, totalBal);

    const updatedTx = mapDbRowToTx({
      ...currentTx,
      id: currentTx.id,
      user_id: currentTx.userId,
      type: 'withdraw',
      amount: currentTx.amount,
      amount_formatted: currentTx.amountFormatted,
      method: currentTx.method,
      destination_summary: currentTx.destination,
      bank_account_id: currentTx.bankAccountId,
      reference: currentTx.reference,
      ...updatePayload,
      created_at: currentTx.createdAt,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    auditLogService.logEvent({
      eventType: `VAULT_WITHDRAWAL_${newStatus.toUpperCase()}`,
      actorId,
      category: 'Vault',
      description: `Withdrawal ${currentTx.id} (${formatZar(currentTx.amount)}) ${newStatus} by ${actorId}. Reserved funds restored. Spendable balance: ${formatZar(newSpendable)}.`,
    });

    return {
      transaction: updatedTx,
      status: newStatus,
      alreadyReversed: false,
      idempotent: false,
      newBalanceNum: newSpendable,
      newBalanceFormatted: formatZar(newSpendable),
      totalBalanceNum: totalBal,
      reservedBalanceNum: newReserved,
    };
  });
}

/**
 * Records a generic transaction (such as a marketplace purchase or sale)
 * into Supabase vault_transactions table and updates in-memory state.
 */
async function recordTransaction({
  id = null,
  userId,
  type = 'purchase',
  amount,
  amountFormatted = null,
  method = 'Instant EFT / Card',
  reference = null,
  notes = null,
  status = 'completed',
  createdAt = null,
}) {
  const numAmount = Number(amount) || 0;
  const now = createdAt || new Date().toISOString();
  const txId = id || `TXN-${type.toUpperCase().slice(0, 3)}-${Math.floor(100000 + Math.random() * 900000)}`;
  const isPositive = type === 'deposit' || type === 'sale';
  const formatted =
    amountFormatted ||
    (isPositive ? `+${formatZar(numAmount)}` : `-${formatZar(numAmount)}`);

  const txRecord = mapDbRowToTx({
    id: txId,
    user_id: userId,
    type,
    amount: numAmount,
    amount_formatted: formatted,
    method,
    reference,
    notes,
    status,
    created_at: now,
  });

  transactionsMap.set(txId, txRecord);

  if (isUuid(userId)) {
    try {
      await supabase.from('vault_transactions').upsert(
        {
          id: txId,
          user_id: userId,
          type,
          amount: numAmount,
          amount_formatted: formatted,
          method,
          reference,
          notes,
          status,
          created_at: now,
        },
        { onConflict: 'id' }
      );
    } catch (err) {
      console.warn('⚠️ [VaultTxService] DB recordTransaction error:', err.message);
    }
  }

  return txRecord;
}

/**
 * Fetch fresh transactions for a specific user authoritatively from Supabase.
 */
async function fetchUserTransactions(userId) {
  if (!userId) return [];
  if (isUuid(userId)) {
    try {
      const { data, error } = await supabase
        .from('vault_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        data.forEach((row) => {
          if (!row || !row.id) return;
          transactionsMap.set(row.id, mapDbRowToTx(row));
        });
      }
    } catch (_) {}
  }

  return getUserTransactions(userId);
}

/**
 * Fetch all deposit and withdrawal transactions for the Admin Treasury Desk.
 * Queries Supabase directly (restart-safe) and enriches with collector identity and masked bank destinations.
 */
async function fetchAllTransactionsForAdmin({ status = null, type = null } = {}) {
  await hydrateTransactionsFromSupabase();

  // Build user identity lookup from profiles and complianceService
  const profileLookup = new Map();
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email');
    if (Array.isArray(profiles)) {
      profiles.forEach((p) => {
        if (p && p.id) {
          profileLookup.set(p.id, {
            fullName: p.full_name || '',
            email: p.email || '',
          });
        }
      });
    }
  } catch (_) {}

  let complianceService = null;
  try {
    complianceService = require('./complianceService');
  } catch (_) {}

  const allTxs = Array.from(transactionsMap.values())
    .filter((tx) => {
      if (type && type !== 'All' && tx.type !== type) return false;
      if (status && status !== 'All' && tx.status !== status) return false;
      return true;
    })
    .map((tx) => {
      const prof = profileLookup.get(tx.userId) || {};
      const comp = complianceService ? complianceService.getUserCompliance(tx.userId, prof.email) : {};
      const bank = complianceService ? complianceService.getUserBankAccount(tx.userId, prof.email) : null;

      const userEmail = prof.email || comp?.userEmail || '—';
      const userFullName =
        (prof.fullName && prof.fullName.trim()) ||
        comp?.fullName ||
        (userEmail !== '—' ? userEmail.split('@')[0] : 'Collector');

      // Mask destination summary — never expose full bank account numbers in treasury queue
      const maskedDest =
        tx.type === 'withdraw'
          ? maskBankDestination(tx.destination || tx.destinationSummary, bank) || 'Approved Bank Account (****)'
          : tx.reference
          ? `User EFT Ref: ${tx.reference} (Unverified)`
          : 'SmartAssets Treasury Account';

      return {
        ...tx,
        userFullName,
        userEmail,
        destination: maskedDest,
        destinationSummary: maskedDest,
      };
    });

  return allTxs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get all transactions for a user from in-memory cache (synchronous).
 */
function getUserTransactions(userId) {
  if (!userId) return [];
  if (!hydrated) {
    hydrateTransactionsFromSupabase().catch(() => {});
  }
  const list = [];
  for (const tx of transactionsMap.values()) {
    if (String(tx.userId) === String(userId)) {
      list.push(tx);
    }
  }
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get a single transaction by ID.
 */
function getTransactionById(txId) {
  return transactionsMap.get(txId) || null;
}

/**
 * Get all runtime transactions across all users.
 */
function getAllTransactions() {
  if (!hydrated) {
    hydrateTransactionsFromSupabase().catch(() => {});
  }
  const list = Array.from(transactionsMap.values());
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  formatZar,
  maskBankDestination,
  getUserBalance,
  getUserBalanceDetails,
  depositFunds,
  confirmDeposit,
  rejectDeposit,
  withdrawFunds,
  markWithdrawalProcessing,
  settleWithdrawal,
  cancelOrRejectWithdrawal,
  recordTransaction,
  fetchUserTransactions,
  fetchAllTransactionsForAdmin,
  getUserTransactions,
  getTransactionById,
  getAllTransactions,
  hydrateTransactionsFromSupabase,
  _clearRuntimeCacheForTesting,
};
