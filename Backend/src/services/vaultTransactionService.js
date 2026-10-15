// ─── Vault Transaction Service ───────────────────────────────────────────────
// Handles user vault balance, deposit, withdrawal operations, and transaction history.
// Syncs to Supabase profiles/vault_transactions with persistent JSON backup.

const fs = require('fs');
const path = require('path');
const supabase = require('../connection/supabaseClient');

const DATA_DIR = path.resolve(__dirname, '../data');
const TX_FILE = path.join(DATA_DIR, 'vaultTransactions.json');
const BALANCES_FILE = path.join(DATA_DIR, 'vaultBalances.json');

const transactionsMap = new Map(); // id -> tx
const balancesMap = new Map();     // userId -> number

function initStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(TX_FILE)) {
      const txs = JSON.parse(fs.readFileSync(TX_FILE, 'utf8'));
      if (Array.isArray(txs)) {
        txs.forEach((tx) => {
          if (tx && tx.id) transactionsMap.set(tx.id, tx);
        });
      }
    }
    if (fs.existsSync(BALANCES_FILE)) {
      const bals = JSON.parse(fs.readFileSync(BALANCES_FILE, 'utf8'));
      if (typeof bals === 'object' && bals !== null) {
        Object.entries(bals).forEach(([uid, val]) => {
          balancesMap.set(uid, Number(val) || 0);
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ [VaultTxService] Storage init warning:', err.message);
  }
}

function persistStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const txArr = Array.from(transactionsMap.values());
    fs.writeFileSync(TX_FILE, JSON.stringify(txArr, null, 2), 'utf8');

    const balObj = {};
    for (const [uid, val] of balancesMap.entries()) {
      balObj[uid] = val;
    }
    fs.writeFileSync(BALANCES_FILE, JSON.stringify(balObj, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ [VaultTxService] Persistence error:', err.message);
  }
}

initStorage();

/**
 * Format currency amount into South African Rand string
 */
function formatZar(num) {
  return 'R' + Number(num || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Get available cash balance for a user.
 */
async function getUserBalance(userId) {
  if (!userId) return 0;

  // 1. Try fetching from Supabase profiles table
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data && data.balance !== null && data.balance !== undefined) {
      const bal = Number(data.balance);
      balancesMap.set(userId, bal);
      persistStorage();
      return bal;
    }
  } catch (err) {
    console.warn('⚠️ [VaultTxService] DB balance fetch warning:', err.message);
  }

  // 2. Fallback to local balancesMap (default starter R15,000 for verified collectors)
  if (!balancesMap.has(userId)) {
    const defaultStarter = 15000;
    balancesMap.set(userId, defaultStarter);
    persistStorage();
  }
  return balancesMap.get(userId) || 0;
}

/**
 * Deposit funds into the user's available vault balance.
 */
async function depositFunds({ userId, amount, method = 'card', reference = null, notes = null }) {
  const depositNum = Number(amount);
  if (isNaN(depositNum) || depositNum <= 0) {
    throw new Error('Please specify a valid deposit amount greater than R0.');
  }

  const currentBal = await getUserBalance(userId);
  const newBal = currentBal + depositNum;

  // 1. Update DB profile balance
  try {
    await supabase
      .from('profiles')
      .update({ balance: newBal })
      .eq('id', userId);
  } catch (err) {
    console.warn('⚠️ [VaultTxService] DB balance update warning:', err.message);
  }

  // 2. Update local map
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
  persistStorage();

  // Try logging to Supabase vault_transactions table if available
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
      status: 'completed',
      created_at: now,
    });
  } catch (_e) {
    // If table doesn't exist yet, local file persistence is active
  }

  console.log(`💰 [VaultTxService] Deposit of ${formatZar(depositNum)} for user ${userId}. New Balance: ${formatZar(newBal)}`);

  return {
    transaction: txRecord,
    newBalanceNum: newBal,
    newBalanceFormatted: formatZar(newBal),
  };
}

/**
 * Withdraw funds from user's available vault balance.
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

  // 1. Update DB profile balance
  try {
    await supabase
      .from('profiles')
      .update({ balance: newBal })
      .eq('id', userId);
  } catch (err) {
    console.warn('⚠️ [VaultTxService] DB balance update warning:', err.message);
  }

  // 2. Update local map
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
  persistStorage();

  // Try logging to Supabase vault_transactions table if available
  try {
    await supabase.from('vault_transactions').insert({
      id: txId,
      user_id: userId,
      type: 'withdraw',
      amount: withdrawNum,
      amount_formatted: txRecord.amountFormatted,
      method: txRecord.method,
      reference: txRecord.reference,
      notes: txRecord.notes,
      status: 'completed',
      created_at: now,
    });
  } catch (_e) {
    // If table doesn't exist yet, local file persistence is active
  }

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
  const list = [];
  for (const tx of transactionsMap.values()) {
    if (tx.userId === userId) {
      list.push(tx);
    }
  }
  // Sort descending by created date
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  formatZar,
  getUserBalance,
  depositFunds,
  withdrawFunds,
  getUserTransactions,
};

