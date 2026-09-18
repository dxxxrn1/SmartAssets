// ─── SmartAssets API Service ──────────────────────────────────────────────────
// Handles all HTTP communication between the React Native app and the backend.

import { Platform } from 'react-native';

// ── Base URL — configured via EXPO_PUBLIC_API_BASE_URL in .env ───────────────
// Team members: update EXPO_PUBLIC_API_BASE_URL in .env with your computer's IP!
const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000/api';
  }
  return 'http://localhost:5000/api';
};

const API_BASE_URL = getBaseUrl();

// ── Generic request helper ───────────────────────────────────────────────────
async function apiRequest(endpoint, options = {}, token = null) {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong');
    }
    return data;
  } catch (error) {
    if (error.message === 'Network request failed') {
      throw new Error(
        `Cannot connect to server at ${API_BASE_URL}.\nMake sure the backend is running and your IP in .env is correct.`
      );
    }
    throw error;
  }
}

// ── Auth API ─────────────────────────────────────────────────────────────────

/**
 * Register a new user.
 * @param {{ email: string, password: string, fullName: string }} params
 */
export async function registerUser({ email, password, fullName }) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, fullName }),
  });
}

/**
 * Sign in an existing user.
 * @param {{ email: string, password: string }} params
 */
export async function loginUser({ email, password }) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Sign in or register using a MetaMask wallet address.
 * @param {string} walletAddress
 */
export async function loginWithWalletApi(walletAddress) {
  return apiRequest('/auth/wallet-login', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
}

// ── User-Isolated Data API ───────────────────────────────────────────────────

/**
 * Fetch strictly the authenticated user's vault holdings and stats.
 * @param {string} token - User's Supabase JWT access token
 */
export async function getUserVault(token) {
  return apiRequest('/user/vault', { method: 'GET' }, token);
}

/**
 * Add a new asset holding to the user's personal vault.
 * @param {string} token
 * @param {object} holdingData
 */
export async function addUserHolding(token, holdingData) {
  return apiRequest(
    '/user/vault',
    {
      method: 'POST',
      body: JSON.stringify(holdingData),
    },
    token
  );
}

/**
 * Seed starter sample assets for user's personal portfolio demo
 * @param {string} token
 */
export async function seedUserStarter(token) {
  return apiRequest('/user/seed-starter', { method: 'POST' }, token);
}

// ── Dynamic Marketplace & Provenance History API ────────────────────────────

/**
 * Fetch all marketplace assets with optional category or search query.
 * @param {string} [category]
 * @param {string} [searchQuery]
 */
export async function getMarketAssets(category = 'All', searchQuery = '') {
  const params = new URLSearchParams();
  if (category && category !== 'All') params.append('category', category);
  if (searchQuery && searchQuery.trim()) params.append('q', searchQuery.trim());
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/assets${qs}`, { method: 'GET' });
}

/**
 * Fetch single asset details along with its provenance history.
 * @param {string} assetId
 */
export async function getAssetDetails(assetId) {
  return apiRequest(`/assets/${assetId}`, { method: 'GET' });
}

/**
 * Create a new asset listing with picture and provenance history.
 * @param {object} assetData - { name, category, askingPrice, year, condition, description, image, history }
 * @param {string} token - User's Supabase JWT access token
 */
export async function createAssetApi(assetData, token) {
  return apiRequest(
    '/assets',
    {
      method: 'POST',
      body: JSON.stringify(assetData),
    },
    token
  );
}

// ── Multi-Rail Payment Gateway API ──────────────────────────────────────────

/**
 * Fetch live exchange rates (ZAR to Sepolia ETH), escrow address, and Stripe config.
 */
export async function getPaymentRatesApi() {
  return apiRequest('/payments/rates', { method: 'GET' });
}

/**
 * Create a Stripe PaymentIntent on the backend.
 * Returns { clientSecret, paymentIntentId, publishableKey, mode }.
 * @param {{ amount: number, currency?: string, assetId?: string, assetName?: string }} data
 * @param {string} token - User's JWT
 */
export async function createPaymentIntentApi(data, token) {
  return apiRequest(
    '/payments/create-intent',
    { method: 'POST', body: JSON.stringify(data) },
    token
  );
}

/**
 * Tokenize a card directly with Stripe's API (PCI-safe client-side tokenization).
 * Uses the publishable key — card data never touches our server.
 * @param {string} publishableKey - pk_test_... key from backend /rates
 * @param {{ number: string, exp_month: number, exp_year: number, cvc: string, name?: string }} card
 * @returns {{ id: string, card: { brand, last4 } }} The Stripe PaymentMethod
 */
export async function createStripePaymentMethod(publishableKey, card) {
  const response = await fetch('https://api.stripe.com/v1/payment_methods', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: [
      'type=card',
      `card[number]=${card.number.replace(/\s+/g, '')}`,
      `card[exp_month]=${card.exp_month}`,
      `card[exp_year]=${card.exp_year}`,
      `card[cvc]=${card.cvc}`,
      card.name ? `billing_details[name]=${encodeURIComponent(card.name)}` : '',
    ].filter(Boolean).join('&'),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'Stripe card tokenization failed');
  }
  return data;
}

/**
 * Confirm a PaymentIntent client-side using Stripe's API.
 * Called after creating a PaymentMethod (tokenization).
 * @param {string} publishableKey - pk_test_... key
 * @param {string} clientSecret - pi_xxx_secret_yyy from createPaymentIntent
 * @param {string} paymentMethodId - pm_xxx from createStripePaymentMethod
 */
export async function confirmStripePayment(publishableKey, clientSecret, paymentMethodId) {
  const intentId = clientSecret.split('_secret_')[0];
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `payment_method=${paymentMethodId}`,
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'Stripe payment confirmation failed');
  }
  return data;
}

/**
 * Process asset purchase via MetaMask, Card, or Bank Wire.
 * @param {object} paymentData - { assetId, paymentMethod, paymentDetails, amountGbp }
 * @param {string} token - User's Supabase JWT access token
 */
export async function processPaymentApi(paymentData, token) {
  return apiRequest(
    '/payments/process',
    {
      method: 'POST',
      body: JSON.stringify(paymentData),
    },
    token
  );
}

// ── Smart Contract Escrow API ────────────────────────────────────────────────

/**
 * Initialize escrow order and lock payment on-chain.
 */
export async function createEscrowApi(escrowPayload, token) {
  return apiRequest(
    '/escrow/create',
    {
      method: 'POST',
      body: JSON.stringify(escrowPayload),
    },
    token
  );
}

/**
 * Get live status and timeline of an escrow order.
 */
export async function getEscrowOrderApi(orderId) {
  return apiRequest(`/escrow/order/${orderId}`, { method: 'GET' });
}

/**
 * Release escrow funds to seller upon delivery/inspection confirmation.
 */
export async function releaseEscrowApi(orderId, token) {
  return apiRequest(
    '/escrow/release',
    {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    },
    token
  );
}

/**
 * Refund escrow funds to buyer if asset fails inspection.
 */
export async function refundEscrowApi(orderId, reason, token) {
  return apiRequest(
    '/escrow/refund',
    {
      method: 'POST',
      body: JSON.stringify({ orderId, reason }),
    },
    token
  );
}

/**
 * Progress escrow order through its verification stages (Step 2 or 3).
 */
export async function progressEscrowStepApi(orderId, step, note, token) {
  return apiRequest(
    '/escrow/progress',
    {
      method: 'POST',
      body: JSON.stringify({ orderId, step, note }),
    },
    token
  );
}

/**
 * Retrieve all escrow orders for the logged-in user.
 */
export async function getMyEscrowOrdersApi(token) {
  return apiRequest('/escrow/my-orders', { method: 'GET' }, token);
}

