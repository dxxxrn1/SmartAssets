// ─── Vault Transaction Service ───────────────────────────────────────────────
// Handles user vault balance, deposit, withdrawal operations, and transaction history.
// Supabase profiles.balance and vault_transactions are the source of truth.

const supabase = require('../connection/supabaseClient');

// In-memory runtime cache synced with Supabase
const transactionsMap = new Map(); // id -> tx
const balancesMap = new Map();     // userId -> number
let hydrated = false;

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
        if (!transactionsMap.has(row.id)) {
          const isDep = row.type === 'deposit';
          transactionsMap.set(row.id, {
            id: row.id,
            userId: row.user_id,
            type: row.type || 'deposit',
            title: isDep ? 'Vault Cash Deposit' : 'Vault Cash Withdrawal',
            amount: Number(row.amount) || 0,
            amountFormatted:
              row.amount_formatted ||
              (isDep ? `+${formatZar(row.amount)}` : `-${formatZar(row.amount)}`),
            method: row.method || 'Bank EFT',
            reference: row.reference || null,
            notes: row.notes || null,
            status: row.status || 'completed',
            positive: isDep,
            createdAt: row.created_at || new Date().toISOString(),
          });
        }
      });
      hydrated = true;
    }
  } catch (_) {}
}

// Kick off initial hydration in background
hydrateTransactionsFromSupabase();

/**
 * Get available cash balance for a user strictly from Supabase profiles table.
 * New users strictly default to 0. Never substitutes starter funds.
 */
async function getUserBalance(userId) {
  if (!userId) return 0;

  // 1. Fetch strictly from Supabase profiles table for real UUID user accounts
  if (isUuid(userId)) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('❌ [VaultTxService] DB balance fetch error:', error.message);
        throw new Error(`Failed to read balance from database: ${error.message}`);
      }

      if (data && data.balance !== null && data.balance !== undefined) {
        const bal = Number(data.balance) || 0;
        balancesMap.set(userId, bal);
        return bal;
      }

      if (balancesMap.has(userId)) {
        return balancesMap.get(userId);
      }

      balancesMap.set(userId, 0);
      return 0;
    } catch (err) {
      if (err.message && err.message.startsWith('Failed to read balance from database')) {
        throw err;
      }
      console.error('❌ [VaultTxService] DB balance fetch exception:', err.message);
      throw new Error(`Failed to read balance from database: ${err.message}`);
    }
  }

  // 2. Non-UUID identifiers (e.g. test suite stubs) use in-memory state
  if (balancesMap.has(userId)) {
    return balancesMap.get(userId) || 0;
  }

  // 3. New user strictly starts at R0.00
  balancesMap.set(userId, 0);
  return 0;
}

/**
 * Deposit funds into the user's available vault balance in Supabase.
 */
async function depositFunds({ userId, amount, method = 'card', reference = null, notes = null }) {
  const depositNum = Number(amount);
  if (isNaN(depositNum) || depositNum <= 0) {
    throw new Error('Please specify a valid deposit amount greater than R0.');
  }

  const currentBal = await getUserBalance(userId);
  const newBal = currentBal + depositNum;

  // 1. Update DB profile balance if userId is a valid UUID - fail closed if write fails
  if (isUuid(userId)) {
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ balance: newBal })
        .eq('id', userId);

      if (updateError) {
        console.error('❌ [VaultTxService] DB balance update error:', updateError.message);
        throw new Error(`Failed to update balance in database: ${updateError.message}`);
      }
    } catch (err) {
      console.error('❌ [VaultTxService] DB balance update exception:', err.message);
      throw new Error(`Failed to update balance in database: ${err.message}`);
    }
  }

  // 2. Update in-memory runtime cache
  balancesMap.set(userId, newBal);

  // 3. Create transaction record
  const txId = 'TXN-DEP-' + Math.floor(100000 + Math.random() * 900000);
  const now = new Date().toISOString();
  const txRecord = {
    id: txId,
    userId,
    type: 'deposit',
    title: 'Vault Cash Deposit',
    amount: depositNum,
    amountFormatted: `+${formatZar(depositNum)}`,
    method: method || 'Instant EFT / Card',
    reference: reference || `REF-${Math.floor(10000000 + Math.random() * 90000000)}`,
    notes: notes || 'Deposited into Vault liquid balance',
    status: 'completed',
    positive: true,
    createdAt: now,
  };

  transactionsMap.set(txId, txRecord);

  // 4. Log to Supabase vault_transactions table
  try {
    await supabase.from('vault_transactions').insert({
      id: txId,
      user_id: isUuid(userId) ? userId : null,
      type: 'deposit',
      amount: depositNum,
      amount_formatted: txRecord.amountFormatted,
      method: txRecord.method,
      reference: txRecord.reference,
      notes: txRecord.notes,
      status: 'completed',
      created_at: now,
    });
  } catch (_e) {}

  console.log(`💰 [VaultTxService] Deposit of ${formatZar(depositNum)} for user ${userId}. New Balance: ${formatZar(newBal)}`);

  return {
    transaction: txRecord,
    newBalanceNum: newBal,
    newBalanceFormatted: formatZar(newBal),
  };
}

/**
 * Withdraw funds from user's available vault balance in Supabase.
 */
async function withdrawFunds({ userId, amount, method = 'bank', bankDetails = null, walletAddress = null, notes = null }) {
  const withdrawNum = Number(amount);
  if (isNaN(withdrawNum) || withdrawNum <= 0) {
    throw new Error('Please specify a valid withdrawal amount greater than R0.');
  }

  const currentBal = await getUserBalance(userId);
  if (withdrawNum > currentBal) {
    throw new Error(
      `Insufficient vault balance. You requested ${formatZar(withdrawNum)} but your available balance is ${formatZar(currentBal)}.`
    );
  }

  const newBal = currentBal - withdrawNum;

  // 1. Update DB profile balance if userId is a valid UUID - fail closed if write fails
  if (isUuid(userId)) {
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ balance: newBal })
        .eq('id', userId);

      if (updateError) {
        console.error('❌ [VaultTxService] DB balance update error:', updateError.message);
        throw new Error(`Failed to update balance in database: ${updateError.message}`);
      }
    } catch (err) {
      console.error('❌ [VaultTxService] DB balance update exception:', err.message);
      throw new Error(`Failed to update balance in database: ${err.message}`);
    }
  }

  // 2. Update in-memory runtime cache
  balancesMap.set(userId, newBal);

  // 3. Create transaction record
  const txId = 'TXN-WTH-' + Math.floor(100000 + Math.random() * 900000);
  const now = new Date().toISOString();

  let destinationDesc = 'Bank Account';
  if (bankDetails) {
    destinationDesc = `${bankDetails.bankName || 'Bank'} (${bankDetails.accountNumber ? '...' + String(bankDetails.accountNumber).slice(-4) : 'Direct EFT'})`;
  } else if (walletAddress) {
    destinationDesc = `Web3 Wallet (${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)})`;
  }

  const txRecord = {
    id: txId,
    userId,
    type: 'withdraw',
    title: 'Vault Cash Withdrawal',
    amount: withdrawNum,
    amountFormatted: `-${formatZar(withdrawNum)}`,
    method: method || 'Bank EFT',
    destination: destinationDesc,
    reference: `WTH-${Math.floor(10000000 + Math.random() * 90000000)}`,
    notes: notes || `Payout dispatched to ${destinationDesc}`,
    status: 'completed',
    positive: false,
    createdAt: now,
  };

  transactionsMap.set(txId, txRecord);

  // 4. Log to Supabase vault_transactions table
  try {
    await supabase.from('vault_transactions').insert({
      id: txId,
      user_id: isUuid(userId) ? userId : null,
      type: 'withdraw',
      amount: withdrawNum,
      amount_formatted: txRecord.amountFormatted,
      method: txRecord.method,
      reference: txRecord.reference,
      notes: txRecord.notes,
      status: 'completed',
      created_at: now,
    });
  } catch (_e) {}

  console.log(`💸 [VaultTxService] Withdrawal of ${formatZar(withdrawNum)} for user ${userId}. New Balance: ${formatZar(newBal)}`);

  return {
    transaction: txRecord,
    newBalanceNum: newBal,
    newBalanceFormatted: formatZar(newBal),
  };
}

/**
 * Get all transactions for a user.
 */
function getUserTransactions(userId) {
  if (!userId) return [];
  if (!hydrated) {
    hydrateTransactionsFromSupabase().catch(() => {});
  }
  const list = [];
  for (const tx of transactionsMap.values()) {
    if (tx.userId === userId) {
      list.push(tx);
    }
  }
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
  depositFunds,
  withdrawFunds,
  getUserTransactions,
  getAllTransactions,
  hydrateTransactionsFromSupabase,
};
