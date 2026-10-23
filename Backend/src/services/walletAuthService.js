// ─── Wallet Authentication & Nonce Challenge Service ────────────────────────
// Implements EIP-191 cryptographic challenge-response authentication for MetaMask.
// Nonces expire in 5 minutes, are single-use, and prevent replay attacks.

const crypto = require('crypto');
const { ethers } = require('ethers');
const supabase = require('../connection/supabaseClient');

// In-memory fallback nonce cache in case database table migration is pending
const inMemoryNonces = new Map();

// Periodically clean up expired in-memory nonces
setInterval(() => {
  const now = Date.now();
  for (const [nonce, item] of inMemoryNonces.entries()) {
    if (now >= item.expiresAt) {
      inMemoryNonces.delete(nonce);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Generates a unique, single-use nonce challenge for a wallet address.
 * @param {string} walletAddress
 * @returns {Promise<{ nonce: string, message: string, expiresAt: Date }>}
 */
async function createNonceChallenge(walletAddress) {
  const cleanAddress = walletAddress.trim().toLowerCase();
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

  const message =
    `Sign this message to authenticate with SMARTASSETS.\n\n` +
    `Wallet: ${cleanAddress}\n` +
    `Nonce: ${nonce}\n` +
    `Timestamp: ${new Date().toISOString()}\n\n` +
    `This request will expire in 5 minutes and does not trigger any blockchain transaction or gas fee.`;

  // 1. Try persisting to Supabase wallet_nonces table
  try {
    const { error } = await supabase.from('wallet_nonces').insert({
      wallet_address: cleanAddress,
      nonce,
      message,
      expires_at: expiresAt.toISOString(),
      used: false,
    });

    if (error) {
      console.warn('Notice: wallet_nonces table insert fallback to cache:', error.message);
    }
  } catch (err) {
    console.warn('Notice: wallet_nonces exception, using memory store:', err.message);
  }

  // 2. Also keep in memory map as fallback
  inMemoryNonces.set(nonce, {
    walletAddress: cleanAddress,
    message,
    expiresAt: expiresAt.getTime(),
    used: false,
  });

  return { nonce, message, expiresAt };
}

/**
 * Validates a signature against a previously issued nonce for a wallet address.
 * Marks the nonce as used so it cannot be replayed.
 * @param {string} walletAddress
 * @param {string} signature
 * @param {string} nonce
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
async function verifyWalletSignature(walletAddress, signature, nonce) {
  if (!walletAddress || !signature || !nonce) {
    return { valid: false, error: 'Wallet address, signature, and nonce are required.' };
  }

  const cleanAddress = walletAddress.trim().toLowerCase();

  // 1. Retrieve nonce from database
  let nonceRecord = null;
  try {
    const { data, error } = await supabase
      .from('wallet_nonces')
      .select('*')
      .eq('wallet_address', cleanAddress)
      .eq('nonce', nonce)
      .maybeSingle();

    if (!error && data) {
      nonceRecord = {
        message: data.message,
        expiresAt: new Date(data.expires_at).getTime(),
        used: data.used,
      };
    }
  } catch (_) {}

  // Check in-memory store if DB didn't find it
  if (!nonceRecord && inMemoryNonces.has(nonce)) {
    const mem = inMemoryNonces.get(nonce);
    if (mem.walletAddress === cleanAddress) {
      nonceRecord = mem;
    }
  }

  if (!nonceRecord) {
    return { valid: false, error: 'Invalid or unrecognized challenge nonce.' };
  }

  if (nonceRecord.used) {
    return { valid: false, error: 'This challenge nonce has already been used. Please request a new one.' };
  }

  if (Date.now() > nonceRecord.expiresAt) {
    return { valid: false, error: 'Challenge nonce has expired (5-minute limit). Please request a new one.' };
  }

  // 2. Cryptographic signature verification using ethers
  let recoveredAddress = null;
  try {
    recoveredAddress = ethers.verifyMessage(nonceRecord.message, signature);
  } catch (err) {
    return { valid: false, error: `Cryptographic signature verification failed: ${err.message}` };
  }

  if (!recoveredAddress || recoveredAddress.trim().toLowerCase() !== cleanAddress) {
    return {
      valid: false,
      error: 'Signature does not match the provided wallet address. Verification failed.',
    };
  }

  // 3. Mark nonce as used
  nonceRecord.used = true;
  inMemoryNonces.delete(nonce);
  try {
    await supabase
      .from('wallet_nonces')
      .update({ used: true })
      .eq('wallet_address', cleanAddress)
      .eq('nonce', nonce);
  } catch (_) {}

  return { valid: true };
}

/**
 * Creates or retrieves a valid Supabase JWT session for an existing user account.
 * Uses magic link OTP exchange to issue authentic Supabase tokens without needing passwords.
 * @param {string} email
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_at: number }>}
 */
async function generateSessionForUser(email) {
  try {
    // 1. Generate magiclink OTP token
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email.trim().toLowerCase(),
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      throw new Error(linkErr?.message || 'Could not generate session link for account.');
    }

    // 2. Exchange token hash for full session
    const { data: sessionData, error: sessionErr } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });

    if (sessionErr || !sessionData?.session) {
      throw new Error(sessionErr?.message || 'Could not verify session for account.');
    }

    return {
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_at: sessionData.session.expires_at,
    };
  } catch (err) {
    console.error('generateSessionForUser error:', err.message);
    throw err;
  }
}

module.exports = {
  createNonceChallenge,
  verifyWalletSignature,
  generateSessionForUser,
};
