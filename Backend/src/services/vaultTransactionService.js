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
const creditedProviderRefs = new Set();  // providerRef / paymentIntentId -> credited once
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
    (isDep ? `+${formatZar(amt)}` : `-${formatZar(amt)}`);

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type || 'deposit',
    title,
    amount: amt,
    amountFormatted: formatted,
    method: row.method || 'Manual Bank EFT',
    destination: row.destination_summary || row.destination || null,
    bankAccountId: row.bank_account_id || row.bankAccountId || null,
    reference: row.reference || null,
    providerRef: row.provider_ref || row.providerRef || null,
    settlementRef: row.settlement_ref || row.settlementRef || null,
    notes: row.notes || null,
    status,
    positive: isDep,
    reviewedBy: row.reviewed_by || row.reviewedBy || null,
    reviewedAt: row.reviewed_at || row.reviewedAt || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
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
      });
      hydrated = true;
    }
  } catch (_) {}
}

// Kick off initial hydration in background
hydrateTransactionsFromSupabase();

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
          throw new Error(`Failed to update balance in database: ${fallbackErr.message}`);
        }
      } else {
        throw new Error(`Failed to update balance in database: ${updateErr.message}`);
      }
    }
  } catch (err) {
    if (err.message && err.message.startsWith('Failed to update balance in database')) {
      throw err;
    }
    throw new Error(`Failed to update balance in database: ${err.message}`);
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

  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached.userId && String(cached.userId) !== String(userId)) {
      throw new Error('Idempotency key belongs to a different user.');
    }
    return { ...cached, duplicate: true };
  }

  return withUserVaultLock(userId, async () => {
    if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
      return { ...idempotencyStore.get(idempotencyKey), duplicate: true };
    }

    const isInternalPayout = INTERNAL_SETTLED_PAYOUT_METHODS.has(method);
    let verifiedSettlement = false;
    let authoritativeProviderRef = null;

    if (isInternalPayout) {
      verifiedSettlement = true;
      authoritativeProviderRef = providerRef || reference || `SYS-PAYOUT-${Date.now()}-${ crypto.randomBytes(4).toString('hex') }`;
    } else if (paymentIntentId || String(method).toLowerCase().includes('stripe') || String(method).toLowerCase() === 'card') {
      // Card / Stripe deposit: MUST verify settlement via Stripe API / verifier
      if (!paymentIntentId) {
        throw new Error('Card deposit requires a verified Stripe PaymentIntent ID. Raw or unverified card deposits are not permitted.');
      }

      if (creditedProviderRefs.has(paymentIntentId)) {
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

      // Support both structured stripeService.verifyPaymentIntent result ({ verified, status, ... })
      // and direct PaymentIntent objects ({ id, status, amount, currency, metadata })
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
      // Explicit verified settlement (e.g. signed webhook or verified treasury credit)
      const refToUse = providerRef || reference;
      if (!refToUse || String(refToUse).trim().length < 4) {
        throw new Error('Verified deposit settlement requires an authoritative provider reference.');
      }
      if (creditedProviderRefs.has(refToUse)) {
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

    const balDetails = await getUserBalanceDetails(userId);
    const currentTotal = balDetails.totalBalanceNum;
    const currentReserved = balDetails.reservedBalanceNum;
    const newTotal = verifiedSettlement ? currentTotal + depositNum : currentTotal;
    const newSpendable = Math.max(0, newTotal - currentReserved);

    // If verified settlement, update DB profile balance first (fail closed on DB write failure)
    if (verifiedSettlement) {
      await persistUserBalancesToDb(userId, newTotal, currentReserved, simulateDbError);
      balancesMap.set(userId, newTotal);
      if (authoritativeProviderRef) {
        creditedProviderRefs.add(authoritativeProviderRef);
      }
    } else if (simulateDbError) {
      const err = new Error('Failed to record deposit request in database: Simulated database write failure.');
      err.code = 'DB_WRITE_FAILED';
      throw err;
    }

    const txId = 'TXN-DEP-' + Math.floor(100000 + Math.random() * 900000) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const now = new Date().toISOString();
    const txStatus = verifiedSettlement ? 'completed' : 'pending_review';

    const txRecord = mapDbRowToTx({
      id: txId,
      user_id: userId,
      type: 'deposit',
      amount: depositNum,
      amount_formatted: `+${formatZar(depositNum)}`,
      method: method || 'Manual Bank EFT',
      reference: reference || authoritativeProviderRef || null,
      provider_ref: authoritativeProviderRef,
      settlement_ref: verifiedSettlement ? authoritativeProviderRef : null,
      notes:
        notes ||
        (verifiedSettlement
          ? 'Verified settlement credited to Vault balance'
          : 'Pending treasury verification of bank receipt. Funds will be credited once confirmed.'),
      status: txStatus,
      created_at: now,
      updated_at: now,
    });

    // Persist to Supabase vault_transactions
    if (isUuid(userId)) {
      try {
        await supabase.from('vault_transactions').insert({
          id: txId,
          user_id: userId,
          type: 'deposit',
          amount: depositNum,
          amount_formatted: txRecord.amountFormatted,
          method: txRecord.method,
          reference: txRecord.reference,
          notes: txRecord.notes,
          status: txStatus,
          created_at: now,
        });
      } catch (_e) {}
    }

    transactionsMap.set(txId, txRecord);

    auditLogService.logEvent({
      eventType: verifiedSettlement ? 'VAULT_DEPOSIT_CREDITED' : 'VAULT_DEPOSIT_PENDING_REVIEW',
      actorId: userId,
      category: 'Vault',
      description: verifiedSettlement
        ? `Credited ${formatZar(depositNum)} to user ${userId} via ${txRecord.method} (Ref: ${authoritativeProviderRef}). Spendable balance: ${formatZar(newSpendable)}.`
        : `Recorded pending deposit request ${txId} of ${formatZar(depositNum)} for user ${userId} via ${txRecord.method} (User Ref: ${reference || 'N/A'}). Spendable balance unchanged at ${formatZar(newSpendable)}.`,
    });

    console.log(
      verifiedSettlement
        ? `💰 [VaultTxService] Verified deposit of ${formatZar(depositNum)} for user ${userId}. New Balance: ${formatZar(newSpendable)}`
        : `⏳ [VaultTxService] Pending deposit request ${txId} of ${formatZar(depositNum)} for user ${userId}. Balance unchanged: ${formatZar(newSpendable)}`
    );

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
  simulateDbError = false,
}) {
  const effectiveAdminId = adminId || reviewer;
  if (!transactionId) {
    throw new Error('Deposit transaction ID is required.');
  }
  if (!effectiveAdminId) {
    throw new Error('Authorized administrator ID is required to confirm a deposit.');
  }
  if (!settlementRef || String(settlementRef).trim().length < 4) {
    const err = new Error('An authoritative bank/treasury settlement reference (min 4 chars) is required to confirm a deposit.');
    err.code = 'SETTLEMENT_REF_REQUIRED';
    throw err;
  }

  const cleanSettlementRef = String(settlementRef).trim();

  // Locate transaction in memory or Supabase
  let tx = transactionsMap.get(transactionId);
  if (!tx) {
    try {
      const { data } = await supabase
        .from('vault_transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();
      if (data) {
        tx = mapDbRowToTx(data);
        transactionsMap.set(tx.id, tx);
      }
    } catch (_) {}
  }

  if (!tx) {
    throw new Error(`Deposit transaction "${transactionId}" not found.`);
  }
  if (tx.type !== 'deposit') {
    throw new Error(`Transaction "${transactionId}" is not a deposit.`);
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = transactionsMap.get(transactionId) || tx;

    // Idempotent return if already completed
    if (currentTx.status === 'completed') {
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: 'completed',
        alreadyCompleted: true,
        idempotent: true,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
      };
    }

    if (currentTx.status !== 'pending_review') {
      throw new Error(`Cannot confirm deposit in status "${currentTx.status}". Only pending_review deposits can be confirmed.`);
    }

    if (creditedProviderRefs.has(cleanSettlementRef)) {
      const err = new Error(`Duplicate settlement reference: "${cleanSettlementRef}" has already been used to credit a deposit.`);
      err.code = 'DUPLICATE_PROVIDER_REFERENCE';
      throw err;
    }

    const balDetails = await getUserBalanceDetails(currentTx.userId);
    const newTotal = balDetails.totalBalanceNum + currentTx.amount;
    const currentReserved = balDetails.reservedBalanceNum;
    const newSpendable = Math.max(0, newTotal - currentReserved);

    // Fail closed if DB update fails
    await persistUserBalancesToDb(currentTx.userId, newTotal, currentReserved, simulateDbError);
    balancesMap.set(currentTx.userId, newTotal);
    creditedProviderRefs.add(cleanSettlementRef);

    const now = new Date().toISOString();
    const updatedTx = mapDbRowToTx({
      id: currentTx.id,
      user_id: currentTx.userId,
      type: 'deposit',
      amount: currentTx.amount,
      amount_formatted: currentTx.amountFormatted,
      method: currentTx.method,
      reference: currentTx.reference || cleanSettlementRef,
      provider_ref: cleanSettlementRef,
      settlement_ref: cleanSettlementRef,
      notes: `${currentTx.notes || 'Bank EFT Deposit'} | Verified by Admin (${effectiveAdminId}) Ref: ${cleanSettlementRef}`,
      status: 'completed',
      reviewed_by: effectiveAdminId,
      reviewed_at: now,
      created_at: currentTx.createdAt,
      updated_at: now,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    if (isUuid(currentTx.userId)) {
      try {
        await supabase
          .from('vault_transactions')
          .update({
            status: 'completed',
            reference: updatedTx.reference,
            notes: updatedTx.notes,
          })
          .eq('id', currentTx.id);
      } catch (_e) {}
    }

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
async function rejectDeposit({ transactionId, adminId, reason = 'Bank transfer receipt could not be verified' }) {
  if (!transactionId) {
    throw new Error('Deposit transaction ID is required.');
  }
  if (!adminId) {
    throw new Error('Authorized administrator ID is required to reject a deposit.');
  }

  let tx = transactionsMap.get(transactionId);
  if (!tx) {
    try {
      const { data } = await supabase
        .from('vault_transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();
      if (data) {
        tx = mapDbRowToTx(data);
        transactionsMap.set(tx.id, tx);
      }
    } catch (_) {}
  }

  if (!tx) {
    throw new Error(`Deposit transaction "${transactionId}" not found.`);
  }
  if (tx.type !== 'deposit') {
    throw new Error(`Transaction "${transactionId}" is not a deposit.`);
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = transactionsMap.get(transactionId) || tx;
    if (currentTx.status === 'completed') {
      throw new Error('Cannot reject a deposit that has already been confirmed and credited.');
    }
    if (currentTx.status === 'rejected') {
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: 'rejected',
        alreadyRejected: true,
        newBalanceNum: balDetails.availableBalanceNum,
      };
    }

    const now = new Date().toISOString();
    const updatedTx = mapDbRowToTx({
      ...currentTx,
      user_id: currentTx.userId,
      amount_formatted: currentTx.amountFormatted,
      status: 'rejected',
      notes: `Rejected by Admin: ${reason}`,
      reviewed_by: adminId,
      reviewed_at: now,
      created_at: currentTx.createdAt,
      updated_at: now,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    if (isUuid(currentTx.userId)) {
      try {
        await supabase
          .from('vault_transactions')
          .update({
            status: 'rejected',
            notes: updatedTx.notes,
          })
          .eq('id', currentTx.id);
      } catch (_e) {}
    }

    const balDetails = await getUserBalanceDetails(currentTx.userId);

    auditLogService.logEvent({
      eventType: 'VAULT_DEPOSIT_REJECTED_BY_ADMIN',
      actorId: adminId,
      category: 'Vault',
      description: `Admin ${adminId} rejected deposit ${currentTx.id} (${formatZar(currentTx.amount)}) for user ${currentTx.userId}. Reason: ${reason}.`,
    });

    return {
      transaction: updatedTx,
      status: 'rejected',
      alreadyRejected: false,
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
    throw err;
  }

  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached.userId && String(cached.userId) !== String(userId)) {
      throw new Error('Idempotency key belongs to a different user.');
    }
    return { ...cached, duplicate: true };
  }

  // Resolve authoritative approved bank account on file
  const complianceService = require('./complianceService');
  const resolvedBank = approvedBank || complianceService.getUserBankAccount(userId, userEmail);

  if (!resolvedBank || resolvedBank.status !== 'approved') {
    const err = new Error(
      'Approved bank account required. Please submit your bank details and wait for admin approval before withdrawing funds.'
    );
    err.code = 'BANK_APPROVAL_REQUIRED';
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
        throw err;
      }
    }
  }

  return withUserVaultLock(userId, async () => {
    if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
      return { ...idempotencyStore.get(idempotencyKey), duplicate: true };
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

    // 2. Update in-memory runtime cache
    reservedBalancesMap.set(userId, newReserved);
    balancesMap.set(userId, totalBal);

    // 3. Create pending withdrawal transaction bound strictly to approved bank on file
    const txId = 'TXN-WTH-' + Math.floor(100000 + Math.random() * 900000) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const now = new Date().toISOString();
    const maskedAcc = authoritativeAccNum ? '...' + authoritativeAccNum.slice(-4) : 'Approved Account';
    const destinationDesc = `${authoritativeBankName} (${maskedAcc})`;

    const txRecord = mapDbRowToTx({
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
      notes: notes || `Pending admin review & EFT payout to approved ${destinationDesc} (${authoritativeHolder})`,
      status: 'pending_review',
      created_at: now,
      updated_at: now,
    });

    transactionsMap.set(txId, txRecord);

    // 4. Log to Supabase vault_transactions table
    if (isUuid(userId)) {
      try {
        await supabase.from('vault_transactions').insert({
          id: txId,
          user_id: userId,
          type: 'withdraw',
          amount: withdrawNum,
          amount_formatted: txRecord.amountFormatted,
          method: txRecord.method,
          reference: null,
          notes: txRecord.notes,
          status: 'pending_review',
          created_at: now,
        });
      } catch (_e) {}
    }

    auditLogService.logEvent({
      eventType: 'VAULT_WITHDRAWAL_REQUESTED',
      actorId: userId,
      category: 'Vault',
      description: `User ${userId} requested withdrawal ${txId} of ${formatZar(withdrawNum)} to approved account ${destinationDesc}. Reserved: ${formatZar(newReserved)}, Spendable remaining: ${formatZar(newSpendable)}.`,
    });

    console.log(
      `⏳ [VaultTxService] Withdrawal request ${txId} of ${formatZar(withdrawNum)} reserved for user ${userId}. Spendable Balance: ${formatZar(newSpendable)} (Reserved: ${formatZar(newReserved)})`
    );

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
async function markWithdrawalProcessing({ transactionId, adminId, reviewer }) {
  const effectiveAdminId = adminId || reviewer;
  if (!transactionId) throw new Error('Withdrawal transaction ID is required.');
  if (!effectiveAdminId) throw new Error('Authorized administrator ID is required.');

  const tx = transactionsMap.get(transactionId);
  if (!tx) throw new Error(`Withdrawal transaction "${transactionId}" not found.`);
  if (tx.type !== 'withdraw') throw new Error(`Transaction "${transactionId}" is not a withdrawal.`);

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = transactionsMap.get(transactionId);
    if (currentTx.status !== 'pending_review') {
      throw new Error(`Cannot mark withdrawal processing from status "${currentTx.status}".`);
    }
    const now = new Date().toISOString();
    const updatedTx = {
      ...currentTx,
      status: 'settlement_processing',
      title: 'Withdrawal (Payout Processing)',
      reviewedBy: effectiveAdminId,
      reviewedAt: now,
      updatedAt: now,
    };
    transactionsMap.set(transactionId, updatedTx);

    if (isUuid(currentTx.userId)) {
      try {
        await supabase
          .from('vault_transactions')
          .update({ status: 'settlement_processing' })
          .eq('id', transactionId);
      } catch (_e) {}
    }

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
  simulateDbError = false,
}) {
  const effectiveAdminId = adminId || reviewer;
  if (!transactionId) {
    throw new Error('Withdrawal transaction ID is required.');
  }
  if (!effectiveAdminId) {
    throw new Error('Authorized administrator ID is required to settle a withdrawal.');
  }
  if (!settlementRef || String(settlementRef).trim().length < 4) {
    const err = new Error('An authoritative bank EFT settlement reference (min 4 chars) is required to mark a withdrawal completed.');
    err.code = 'SETTLEMENT_REF_REQUIRED';
    throw err;
  }

  const cleanRef = String(settlementRef).trim();

  let tx = transactionsMap.get(transactionId);
  if (!tx) {
    try {
      const { data } = await supabase
        .from('vault_transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();
      if (data) {
        tx = mapDbRowToTx(data);
        transactionsMap.set(tx.id, tx);
      }
    } catch (_) {}
  }

  if (!tx) {
    throw new Error(`Withdrawal transaction "${transactionId}" not found.`);
  }
  if (tx.type !== 'withdraw') {
    throw new Error(`Transaction "${transactionId}" is not a withdrawal.`);
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = transactionsMap.get(transactionId) || tx;

    if (currentTx.status === 'completed') {
      const balDetails = await getUserBalanceDetails(currentTx.userId);
      return {
        transaction: currentTx,
        status: 'completed',
        alreadyCompleted: true,
        idempotent: true,
        newBalanceNum: balDetails.availableBalanceNum,
        newBalanceFormatted: balDetails.availableBalanceFormatted,
      };
    }

    if (!['pending_review', 'settlement_processing'].includes(currentTx.status)) {
      throw new Error(`Cannot settle withdrawal in status "${currentTx.status}".`);
    }

    const balDetails = await getUserBalanceDetails(currentTx.userId);
    const newTotal = Math.max(0, balDetails.totalBalanceNum - currentTx.amount);
    const newReserved = Math.max(0, balDetails.reservedBalanceNum - currentTx.amount);
    const newSpendable = Math.max(0, newTotal - newReserved);

    await persistUserBalancesToDb(currentTx.userId, newTotal, newReserved, simulateDbError);
    balancesMap.set(currentTx.userId, newTotal);
    reservedBalancesMap.set(currentTx.userId, newReserved);

    const now = new Date().toISOString();
    const updatedTx = mapDbRowToTx({
      id: currentTx.id,
      user_id: currentTx.userId,
      type: 'withdraw',
      amount: currentTx.amount,
      amount_formatted: currentTx.amountFormatted,
      method: currentTx.method,
      destination_summary: currentTx.destination,
      bank_account_id: currentTx.bankAccountId,
      reference: cleanRef,
      settlement_ref: cleanRef,
      notes: `${currentTx.notes || 'Vault Withdrawal'} | Settled via EFT Ref: ${cleanRef}`,
      status: 'completed',
      reviewed_by: effectiveAdminId,
      reviewed_at: now,
      created_at: currentTx.createdAt,
      updated_at: now,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    if (isUuid(currentTx.userId)) {
      try {
        await supabase
          .from('vault_transactions')
          .update({
            status: 'completed',
            reference: cleanRef,
            notes: updatedTx.notes,
          })
          .eq('id', currentTx.id);
      } catch (_e) {}
    }

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

  let tx = transactionsMap.get(transactionId);
  if (!tx) {
    try {
      const { data } = await supabase
        .from('vault_transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();
      if (data) {
        tx = mapDbRowToTx(data);
        transactionsMap.set(tx.id, tx);
      }
    } catch (_) {}
  }

  if (!tx) {
    throw new Error(`Withdrawal transaction "${transactionId}" not found.`);
  }
  if (tx.type !== 'withdraw') {
    throw new Error(`Transaction "${transactionId}" is not a withdrawal.`);
  }

  return withUserVaultLock(tx.userId, async () => {
    const currentTx = transactionsMap.get(transactionId) || tx;

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

    const balDetails = await getUserBalanceDetails(currentTx.userId);
    const totalBal = balDetails.totalBalanceNum;
    const newReserved = Math.max(0, balDetails.reservedBalanceNum - currentTx.amount);
    const newSpendable = Math.max(0, totalBal - newReserved);

    await persistUserBalancesToDb(currentTx.userId, totalBal, newReserved, simulateDbError);
    reservedBalancesMap.set(currentTx.userId, newReserved);
    balancesMap.set(currentTx.userId, totalBal);

    const now = new Date().toISOString();
    const updatedTx = mapDbRowToTx({
      id: currentTx.id,
      user_id: currentTx.userId,
      type: 'withdraw',
      amount: currentTx.amount,
      amount_formatted: currentTx.amountFormatted,
      method: currentTx.method,
      destination_summary: currentTx.destination,
      bank_account_id: currentTx.bankAccountId,
      reference: currentTx.reference,
      notes: reason ? `${currentTx.notes || ''} | ${newStatus.toUpperCase()}: ${reason}` : currentTx.notes,
      status: newStatus,
      reviewed_by: actorId,
      reviewed_at: now,
      created_at: currentTx.createdAt,
      updated_at: now,
    });

    transactionsMap.set(currentTx.id, updatedTx);

    if (isUuid(currentTx.userId)) {
      try {
        await supabase
          .from('vault_transactions')
          .update({
            status: newStatus,
            notes: updatedTx.notes,
          })
          .eq('id', currentTx.id);
      } catch (_e) {}
    }

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
  getUserTransactions,
  getTransactionById,
  getAllTransactions,
  hydrateTransactionsFromSupabase,
};
