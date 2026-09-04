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
 * Fetch live exchange rates (GBP to Sepolia ETH) and escrow address.
 */
export async function getPaymentRatesApi() {
  return apiRequest('/payments/rates', { method: 'GET' });
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
