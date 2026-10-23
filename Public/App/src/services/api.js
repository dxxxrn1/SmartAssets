// ─── SmartAssets API Service ──────────────────────────────────────────────────
// Handles all HTTP communication between the React Native app and the backend.

import { Platform, NativeModules } from 'react-native';
import {
  saveVaultCache,
  getVaultCache,
  saveMarketAssetsCache,
  getMarketAssetsCache,
  saveUserProfile,
  getUserProfile,
} from './storage';

// Extract the live LAN IP that Metro Bundler is serving from on physical mobile devices
function getMetroLanBaseUrl() {
  try {
    const scriptURL = NativeModules?.SourceCode?.scriptURL;
    if (scriptURL && typeof scriptURL === 'string') {
      const match = scriptURL.match(/^https?:\/\/([^/:]+)(?::\d+)?\//i);
      if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        return `http://${match[1]}:5000/api`;
      }
    }
  } catch (_) {}
  return null;
}

// ── Base URL — auto-detects live Metro LAN IP on physical mobile devices ──────
export const getBaseUrl = () => {
  if (Platform.OS === 'web') {
    const host = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : 'localhost';
    return `http://${host}:5000/api`;
  }
  // Prefer live Metro bundler LAN host on physical Android/iOS devices so Wi-Fi IP changes never break fetch
  const metroBase = getMetroLanBaseUrl();
  if (metroBase) {
    return metroBase;
  }
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL.replace('10.10.0.18', '10.10.0.23');
  }
  if (Platform.OS === 'android') {
    return 'http://10.10.0.23:5000/api';
  }
  return 'http://localhost:5000/api';
};

export let API_BASE_URL = getBaseUrl();

function getFallbackBaseUrls() {
  const candidates = [
    API_BASE_URL,
    getMetroLanBaseUrl(),
    'http://10.10.0.23:5000/api',
    process.env.EXPO_PUBLIC_API_BASE_URL,
    Platform.OS === 'android' ? 'http://10.0.2.2:5000/api' : 'http://localhost:5000/api',
  ].filter(Boolean);
  return [...new Set(candidates)];
}

let onUnauthorizedCallback = null;

export function setUnauthorizedHandler(callback) {
  onUnauthorizedCallback = callback;
}

// ── Generic request helper with automatic LAN host failover ──────────────────
async function apiRequest(endpoint, options = {}, token = null) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('No internet connection. Please connect to the internet to continue.');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const candidates = getFallbackBaseUrls();
  let lastError = null;

  for (const base of candidates) {
    const url = `${base}${endpoint}`;
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        // Trigger global 401 session expiration handler if not a standard login failure
        if (
          response.status === 401 &&
          endpoint !== '/auth/login' &&
          endpoint !== '/auth/register' &&
          endpoint !== '/auth/wallet-login' &&
          typeof onUnauthorizedCallback === 'function'
        ) {
          onUnauthorizedCallback(data.error || 'Your session has expired. Please log in again.');
        }

        const httpErr = new Error(data.rejectionReason || data.error || data.message || 'Something went wrong');
        httpErr.isHttpResponse = true;
        httpErr.status = response.status;
        httpErr.code = data.code;
        throw httpErr;
      }
      // Lock onto the working base URL for subsequent requests
      if (API_BASE_URL !== base) {
        API_BASE_URL = base;
      }
      return data;
    } catch (error) {
      if (error.isHttpResponse) {
        throw error;
      }
      lastError = error;
    }
  }

  if (
    lastError?.message === 'Network request failed' ||
    lastError?.message?.includes('NetworkError') ||
    lastError?.message?.includes('Failed to fetch') ||
    lastError?.message?.includes('Host unreachable') ||
    lastError?.message?.includes('NoRouteToHostException')
  ) {
    throw new Error(
      `Cannot connect to server at ${API_BASE_URL}. Make sure the backend is running on port 5000.`
    );
  }
  throw lastError || new Error('Network error');
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

/**
 * Request a password reset email.
 * @param {{ email: string, redirectTo?: string }} params
 */
export async function forgotPasswordApi({ email, redirectTo }) {
  return apiRequest('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  });
}

/**
 * Complete a password reset using the access_token from the reset email link.
 * @param {{ accessToken: string, newPassword: string }} params
 */
export async function resetPasswordApi({ accessToken, newPassword }) {
  return apiRequest('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ accessToken, newPassword }),
  });
}

/**
 * Revoke the user session and log out from the backend.
 * @param {string} token
 */
export async function logoutUserApi(token) {
  try {
    return await apiRequest('/auth/logout', { method: 'POST' }, token);
  } catch (err) {
    console.warn('[api] Backend logout warning:', err.message);
    return { success: true };
  }
}

/**
 * Verify whether an access token is active and unexpired.
 * @param {string} token
 */
export async function verifySessionApi(token) {
  return apiRequest('/auth/session', { method: 'GET' }, token);
}

// ── User-Isolated Data API ───────────────────────────────────────────────────

let clientVaultCache = null;
let clientVaultCacheTime = 0;
let clientVaultCacheToken = null;
let inFlightVaultPromise = null;
const CLIENT_VAULT_CACHE_TTL = 10 * 1000; // 10 seconds

export function invalidateVaultCache() {
  clientVaultCache = null;
  clientVaultCacheTime = 0;
  clientVaultCacheToken = null;
  inFlightVaultPromise = null;
}

/**
 * Fetch strictly the authenticated user's vault holdings and stats.
 * @param {string} token - User's Supabase JWT access token
 * @param {boolean} [forceRefresh]
 */
export async function getUserVault(token, forceRefresh = false) {
  if (
    !forceRefresh &&
    token &&
    clientVaultCache &&
    clientVaultCacheToken === token &&
    Date.now() - clientVaultCacheTime < CLIENT_VAULT_CACHE_TTL
  ) {
    return clientVaultCache;
  }

  if (!forceRefresh && inFlightVaultPromise && clientVaultCacheToken === token) {
    return inFlightVaultPromise;
  }

  clientVaultCacheToken = token;
  inFlightVaultPromise = (async () => {
    try {
      const data = await apiRequest('/user/vault', { method: 'GET' }, token);
      if (data?.success) {
        clientVaultCache = data;
        clientVaultCacheTime = Date.now();
        saveVaultCache({
          summary: data.summary,
          holdings: data.holdings,
          transactions: data.transactions,
        }).catch(() => {});
      }
      return data;
    } catch (err) {
      const cached = await getVaultCache();
      if (cached) {
        return {
          success: true,
          summary: cached.summary,
          holdings: cached.holdings || [],
          transactions: cached.transactions || [],
          isOffline: true,
          cachedAt: cached.cachedAt,
        };
      }
      throw err;
    } finally {
      inFlightVaultPromise = null;
    }
  })();

  return inFlightVaultPromise;
}

/**
 * Add a new asset holding to the user's personal vault.
 * @param {string} token
 * @param {object} holdingData
 */
export async function addUserHolding(token, holdingData) {
  invalidateVaultCache();
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
  invalidateVaultCache();
  return apiRequest('/user/seed-starter', { method: 'POST' }, token);
}

// ── Dynamic Marketplace & Provenance History API ────────────────────────────

// Client-side in-memory cache to prevent draining Supabase egress on repeated visits
let clientMarketAssetsCache = null;
let clientMarketAssetsCacheTime = 0;
const CLIENT_MARKET_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export function invalidateMarketAssetsCache() {
  clientMarketAssetsCache = null;
  clientMarketAssetsCacheTime = 0;
}

/**
 * Fetch all marketplace assets with optional category or search query.
 * Uses client-side caching for default queries to eliminate egress overhead.
 * @param {string} [category]
 * @param {string} [searchQuery]
 * @param {boolean} [forceRefresh]
 */
export async function getMarketAssets(category = 'All', searchQuery = '', forceRefresh = false) {
  const isDefaultQuery = (!category || category === 'All') && (!searchQuery || !searchQuery.trim());

  if (!forceRefresh && isDefaultQuery && clientMarketAssetsCache && (Date.now() - clientMarketAssetsCacheTime < CLIENT_MARKET_CACHE_TTL)) {
    return { success: true, assets: clientMarketAssetsCache, cached: true };
  }

  try {
    const params = new URLSearchParams();
    if (category && category !== 'All') params.append('category', category);
    if (searchQuery && searchQuery.trim()) params.append('q', searchQuery.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await apiRequest(`/assets${qs}`, { method: 'GET' });

    if (isDefaultQuery && data?.assets) {
      clientMarketAssetsCache = data.assets;
      clientMarketAssetsCacheTime = Date.now();
      saveMarketAssetsCache(data.assets).catch(() => {});
    }

    return data;
  } catch (err) {
    const cachedAssets = await getMarketAssetsCache();
    if (cachedAssets && cachedAssets.length > 0) {
      let filtered = cachedAssets;
      if (category && category !== 'All') {
        filtered = filtered.filter((a) => a.category === category);
      }
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(
          (a) => a.name?.toLowerCase().includes(q) || a.category?.toLowerCase().includes(q)
        );
      }
      return {
        success: true,
        assets: filtered,
        isOffline: true,
      };
    }
    throw err;
  }
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
 * Automatically invalidates client marketplace cache so the new asset appears immediately.
 * @param {object} assetData - { name, category, askingPrice, year, condition, description, image, history }
 * @param {string} token - User's Supabase JWT access token
 */
export async function createAssetApi(assetData, token) {
  invalidateMarketAssetsCache();
  return apiRequest(
    '/assets',
    {
      method: 'POST',
      body: JSON.stringify(assetData),
    },
    token
  );
}

/**
 * Run mandatory 3-step asset upload verification pipeline:
 * Step 1: AI Vision Gatekeeper inspection & feature extraction.
 * Step 2: Live Market Oracle pricing comps & 30-day demand lookup.
 * Step 3: Valuation analysis against asking price.
 * @param {object} payload - { image, name?, category?, askingPrice?, condition?, description? }
 * @param {string} token - User's Supabase JWT access token
 */
export async function verifyAssetUploadApi(payload, token) {
  return apiRequest(
    '/assets/verify-upload',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

/**
 * Query live SerpApi Market Oracle for real-time South African valuation comps.
 * @param {{ name: string, category?: string, condition?: string }} params
 * @param {string} [token]
 */
export async function getMarketOracleApi({ name, category, condition }, token = null) {
  const query = new URLSearchParams({
    name: name || '',
    category: category || '',
    condition: condition || '',
  }).toString();
  return apiRequest(`/assets/market-oracle?${query}`, { method: 'GET' }, token);
}

/**
 * Unified Scan & Know: Gemini Vision + live ZAR Market Oracle + Vault ERC-721 match.
 * @param {{ image: string, vaultItems?: object[] }} payload
 * @param {string} token
 */
export async function scanAndKnowApi(payload, token) {
  return apiRequest(
    '/assets/scan-and-know',
    {
      method: 'POST',
      body: JSON.stringify(payload),
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

// ── User Profile & Account Management API ────────────────────────────────────

/**
 * Fetch full profile data for authenticated user.
 */
/**
 * Fetch aggregated analytics for authenticated user since joining.
 */
export async function getUserAnalyticsApi(token) {
  return apiRequest('/user/analytics', { method: 'GET' }, token);
}

export async function getUserProfileApi(token) {
  try {
    const data = await apiRequest('/user/profile', { method: 'GET' }, token);
    if (data?.success && data?.profile) {
      saveUserProfile(data.profile).catch(() => {});
    }
    return data;
  } catch (err) {
    const cached = await getUserProfile();
    if (cached) {
      return { success: true, profile: cached, isOffline: true };
    }
    throw err;
  }
}

/**
 * Update user profile details (fullName, avatarUrl, gender, dob, phone, password).
 */
export async function updateUserProfileApi(profileData, token) {
  return apiRequest(
    '/user/profile',
    {
      method: 'PUT',
      body: JSON.stringify(profileData),
    },
    token
  );
}

/**
 * Permanently delete authenticated user's account and personal holdings.
 */
export async function deleteAccountApi(token) {
  return apiRequest('/user/account', { method: 'DELETE' }, token);
}

// ── Support Tickets API ──────────────────────────────────────────────────────

/**
 * Lodge a support ticket or inquiry.
 */
export async function lodgeSupportTicketApi(ticketData, token) {
  return apiRequest(
    '/user/support',
    {
      method: 'POST',
      body: JSON.stringify(ticketData),
    },
    token
  );
}

/**
 * Get ticket history for authenticated user.
 */
export async function getUserSupportTicketsApi(token) {
  return apiRequest('/user/support', { method: 'GET' }, token);
}

// ── Vault Balance, Deposits & Withdrawals API ────────────────────────────────

/**
 * Deposit funds into user's vault balance.
 * @param {{ amount: number, method?: string, reference?: string, notes?: string }} depositData
 */
export async function depositFundsApi(depositData, token) {
  invalidateVaultCache();
  return apiRequest(
    '/user/deposit',
    {
      method: 'POST',
      body: JSON.stringify(depositData),
    },
    token
  );
}

/**
 * Withdraw funds from user's vault balance.
 * @param {{ amount: number, method?: string, bankDetails?: object, walletAddress?: string, notes?: string }} withdrawData
 */
export async function withdrawFundsApi(withdrawData, token) {
  invalidateVaultCache();
  return apiRequest(
    '/user/withdraw',
    {
      method: 'POST',
      body: JSON.stringify(withdrawData),
    },
    token
  );
}

/**
 * Fetch all transaction records (deposits, withdrawals, payouts) for user.
 */
export async function getVaultTransactionsApi(token) {
  return apiRequest('/user/transactions', { method: 'GET' }, token);
}

/**
 * Safely resolves an image URI for React Native Image component.
 * If the URI is a relative path (/uploads/...) or points to an outdated IP,
 * rewrites it using API_BASE_URL's active server origin.
 */
export function resolveImageUrl(
  imageUri,
  fallback = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800'
) {
  if (!imageUri || typeof imageUri !== 'string' || !imageUri.trim()) {
    return fallback;
  }
  // Clean replacement for corrupted red bundler error screenshot
  if (imageUri.includes('asset_6f80eb') || imageUri.includes('b1tmz')) {
    return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80';
  }
  if (imageUri.startsWith('data:image/')) return imageUri;

  const uploadsMatch = imageUri.match(/\/uploads\/(?:assets|kyc|avatars)\/[^"'\s?#]+/i);
  if (uploadsMatch) {
    const baseOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
    return `${baseOrigin}${uploadsMatch[0]}`;
  }

  // Also catch and rewrite any stale LAN IP URLs (e.g. 10.250.x.x:5000)
  if (imageUri.includes(':5000/uploads/')) {
    const baseOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
    return imageUri.replace(/^https?:\/\/[^/]+(:5000)?/, baseOrigin);
  }

  return imageUri;
}

// ── FICA / KYC Compliance API ────────────────────────────────────────────────

/**
 * Submit FICA / KYC compliance pack (SA ID, SARS Tax, Proof of Residence, Bank details).
 */
export async function submitKycApi(kycData, token) {
  return apiRequest(
    '/users/kyc-submit',
    {
      method: 'POST',
      body: JSON.stringify(kycData),
    },
    token
  );
}

/**
 * Retrieve user's KYC verification and compliance status.
 */
export async function getKycStatusApi(token) {
  return apiRequest('/users/kyc-status', { method: 'GET' }, token);
}

/**
 * Logout session on backend to record audit trail.
 */
export async function logoutSessionApi(token, email = null) {
  try {
    return await apiRequest(
      '/auth/logout',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
      token
    );
  } catch (_) {
    return { success: true };
  }
}

/**
 * Report 5-minute inactivity session timeout to backend audit ledger.
 */
export async function logSessionTimeoutApi(email = null, userId = null) {
  try {
    return await apiRequest('/auth/session-timeout', {
      method: 'POST',
      body: JSON.stringify({ email, userId }),
    });
  } catch (_) {
    return { success: true };
  }
}
