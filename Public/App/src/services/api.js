// ─── SmartAssets API Service ──────────────────────────────────────────────────
// Handles all HTTP communication between the React Native app and the backend.

import { Platform, NativeModules } from "react-native";
import {
  saveVaultCache,
  getVaultCache,
  saveMarketAssetsCache,
  getMarketAssetsCache,
  saveUserProfile,
  getUserProfile,
} from "./storage";

// Extract the live LAN IP that Metro Bundler is serving from on physical mobile devices
function getMetroLanBaseUrl() {
  try {
    const scriptURL = NativeModules?.SourceCode?.scriptURL;
    if (scriptURL && typeof scriptURL === "string") {
      const match = scriptURL.match(/^https?:\/\/([^/:]+)(?::\d+)?\//i);
      if (
        match &&
        match[1] &&
        match[1] !== "localhost" &&
        match[1] !== "127.0.0.1"
      ) {
        return `http://${match[1]}:5000/api`;
      }
    }
  } catch (_) {}
  return null;
}

/// ── Base URL — auto-detects live Metro LAN IP on physical mobile devices ──────
export const getBaseUrl = () => {
  if (Platform.OS === "web") {
    if (process.env.EXPO_PUBLIC_API_BASE_URL) {
      return process.env.EXPO_PUBLIC_API_BASE_URL;
    }
    const host =
      typeof window !== "undefined" && window.location?.hostname
        ? window.location.hostname
        : "localhost";
    if (host !== "localhost" && host !== "127.0.0.1") {
      return `${window.location.origin}/api`;
    }
    return `http://${host}:5000/api`;
  }
  const metroBase = getMetroLanBaseUrl();
  if (metroBase) return metroBase;
  if (process.env.EXPO_PUBLIC_API_BASE_URL)
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  if (Platform.OS === "android") return "http://10.0.2.2:5000/api";
  return "https://smartassets.onrender.com/api";
};

export let API_BASE_URL = getBaseUrl();

function getFallbackBaseUrls() {
  if (!__DEV__)
    return [
      process.env.EXPO_PUBLIC_API_BASE_URL,
      "https://smartassets.onrender.com/api",
      API_BASE_URL,
    ].filter(Boolean);

  const candidates = [
    API_BASE_URL, // 🚀 Try the one that last worked FIRST
    getMetroLanBaseUrl(), // Then live Metro bundler IP
    process.env.EXPO_PUBLIC_API_BASE_URL, // Then .env config
    "https://smartassets.onrender.com/api", // Then live Render deployment
    Platform.OS === "android"
      ? "http://10.0.2.2:5000/api"
      : "http://localhost:5000/api",
  ].filter(Boolean);

  return [...new Set(candidates)];
}

let onUnauthorizedCallback = null;

export function setUnauthorizedHandler(callback) {
  onUnauthorizedCallback = callback;
}

const REQUEST_TIMEOUT_MS = 15000;

// ── Generic request helper with automatic LAN host failover ──────────────────
async function apiRequest(endpoint, options = {}, token = null) {
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    !navigator.onLine
  ) {
    throw new Error(
      "No internet connection. Please connect to the internet to continue.",
    );
  }

  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...fetchOptions.headers,
  };

  const candidates = getFallbackBaseUrls();
  let lastError = null;

  for (const base of candidates) {
    const url = `${base}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Trigger global 401 session expiration handler if not a standard login failure
        if (
          response.status === 401 &&
          endpoint !== "/auth/login" &&
          endpoint !== "/auth/register" &&
          endpoint !== "/auth/wallet-login" &&
          typeof onUnauthorizedCallback === "function"
        ) {
          onUnauthorizedCallback(
            data.error || "Your session has expired. Please log in again.",
          );
        }

        const httpErr = new Error(
          data.rejectionReason ||
            data.error ||
            data.message ||
            "Something went wrong",
        );
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
      lastError =
        error.name === "AbortError"
          ? new Error(`Request timed out after ${timeoutMs / 1000}s.`)
          : error;
    } finally {
      clearTimeout(timer);
    }
  }

  if (
    (lastError?.message || "").includes("ConnectException") ||
    (lastError?.message || "").includes("Failed to connect") ||
    (lastError?.message || "").includes("ECONNREFUSED") ||
    (lastError?.message || "").includes("ETIMEDOUT") ||
    (lastError?.message || "").includes("timed out") ||
    lastError?.message === "Network request failed" ||
    lastError?.message?.includes("NetworkError") ||
    lastError?.message?.includes("Failed to fetch") ||
    lastError?.message?.includes("Host unreachable") ||
    lastError?.message?.includes("NoRouteToHostException")
  ) {
    throw new Error(
      `Cannot connect to SmartAssets backend (${API_BASE_URL}). Make sure your backend server is running ('npm run dev' in Backend) and your phone is on the same Wi-Fi.`,
    );
  }
  throw lastError || new Error("Network error");
}

// ── Auth API ─────────────────────────────────────────────────────────────────

/**
 * Register a new user.
 * @param {{ email: string, password: string, fullName: string }} params
 */
export async function registerUser({ email, password, fullName }) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, fullName }),
  });
}

/**
 * Sign in an existing user.
 * @param {{ email: string, password: string }} params
 */
export async function loginUser({ email, password }) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Generate a single-use 5-minute cryptographic challenge nonce for a wallet.
 * @param {string} walletAddress
 */
export async function getWalletNonceApi(walletAddress) {
  return apiRequest("/auth/wallet/nonce", {
    method: "POST",
    body: JSON.stringify({ walletAddress }),
  });
}

/**
 * Link a verified MetaMask wallet to the currently logged in user profile.
 * @param {{ walletAddress: string, signature: string, nonce: string }} params
 * @param {string} token - User's JWT token
 */
export async function linkWalletApi(
  { walletAddress, signature, nonce },
  token,
) {
  return apiRequest(
    "/auth/wallet/link",
    {
      method: "POST",
      body: JSON.stringify({ walletAddress, signature, nonce }),
    },
    token,
  );
}

/**
 * Sign in using a verified MetaMask wallet.
 * @param {string|{ walletAddress: string, signature?: string, nonce?: string }} params
 */
export async function loginWithWalletApi(params) {
  const payload =
    typeof params === "string" ? { walletAddress: params } : params;
  return apiRequest("/auth/wallet/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Disconnect/unlink the current user's wallet.
 * @param {string} token
 */
export async function unlinkWalletApi(token) {
  return apiRequest(
    "/auth/wallet/unlink",
    {
      method: "POST",
    },
    token,
  );
}

/**
 * Create a new user profile with real details linked to a verified wallet.
 * @param {{ walletAddress: string, signature: string, nonce: string, email: string, fullName: string, password?: string }} params
 */
export async function completeWalletProfileApi(params) {
  return apiRequest("/auth/wallet/complete-profile", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export const registerWalletApi = completeWalletProfileApi;

/**
 * Verify signup email or wallet email with 6-digit OTP code.
 * @param {{ email: string, code?: string, token?: string, type?: string, verificationToken?: string }} params
 */
export async function verifyEmailApi({ email, code, token, type = 'signup', verificationToken }) {
  return apiRequest('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ email, code, token, type, verificationToken }),
  });
}

/**
 * Resend verification OTP code for unconfirmed account.
 * @param {{ email: string, type?: string }} params
 */
export async function resendVerificationCodeApi({ email, type = 'signup' }) {
  return apiRequest('/auth/resend-code', {
    method: 'POST',
    body: JSON.stringify({ email, type }),
  });
}

/**
 * Request a password reset code or email link.
 * @param {{ email: string, redirectTo?: string }} params
 */
export async function forgotPasswordApi({ email, redirectTo }) {
  return apiRequest("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email, redirectTo }),
  });
}

/**
 * Verify a 6-digit password recovery code.
 * @param {{ email: string, code: string }} params
 */
export async function verifyRecoveryCodeApi({ email, code }) {
  return apiRequest('/auth/verify-recovery-code', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

/**
 * Complete a password reset using single-use recoveryToken or link-based accessToken/token.
 * @param {{ recoveryToken?: string, accessToken?: string, token?: string, newPassword: string }} params
 */
export async function resetPasswordApi({ recoveryToken, accessToken, token, newPassword }) {
  return apiRequest("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ recoveryToken, accessToken, token, newPassword }),
  });
}

/**
 * Revoke the user session and log out from the backend.
 * @param {string} token
 */
export async function logoutUserApi(token) {
  try {
    return await apiRequest("/auth/logout", { method: "POST" }, token);
  } catch (err) {
    console.warn("[api] Backend logout warning:", err.message);
    return { success: true };
  }
}

/**
 * Verify whether an access token is active and unexpired.
 * @param {string} token
 */
export async function verifySessionApi(token) {
  return apiRequest("/auth/session", { method: "GET" }, token);
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

  if (
    !forceRefresh &&
    inFlightVaultPromise &&
    clientVaultCacheToken === token
  ) {
    return inFlightVaultPromise;
  }

  clientVaultCacheToken = token;
  inFlightVaultPromise = (async () => {
    try {
      const data = await apiRequest("/user/vault", { method: "GET" }, token);
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
    "/user/vault",
    {
      method: "POST",
      body: JSON.stringify(holdingData),
    },
    token,
  );
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
export async function getMarketAssets(
  category = "All",
  searchQuery = "",
  forceRefresh = false,
  includeSold = false,
) {
  const isDefaultQuery =
    (!category || category === "All") && (!searchQuery || !searchQuery.trim()) && !includeSold;

  if (
    !forceRefresh &&
    isDefaultQuery &&
    clientMarketAssetsCache &&
    Date.now() - clientMarketAssetsCacheTime < CLIENT_MARKET_CACHE_TTL
  ) {
    return { success: true, assets: clientMarketAssetsCache, cached: true };
  }

  try {
    const params = new URLSearchParams();
    if (category && category !== "All") params.append("category", category);
    if (searchQuery && searchQuery.trim())
      params.append("q", searchQuery.trim());
    if (includeSold) params.append("includeSold", "true");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const data = await apiRequest(`/assets${qs}`, { method: "GET" });

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
      if (category && category !== "All") {
        filtered = filtered.filter((a) => a.category === category);
      }
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(
          (a) =>
            a.name?.toLowerCase().includes(q) ||
            a.category?.toLowerCase().includes(q),
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
  return apiRequest(`/assets/${assetId}`, { method: "GET" });
}

/**
 * Fetch authoritative digital certificate dossier and cryptographic verification status.
 * @param {string} assetId
 */
export async function getCertificateDossierApi(assetId) {
  return apiRequest(`/certificates/${assetId}`, { method: "GET" });
}

/**
 * Fetch authoritative AI Vision & Market Oracle Health Report for an asset.
 * @param {string} assetId
 */
export async function getAssetHealthReportApi(assetId) {
  return apiRequest(`/assets/${assetId}/health-report`, { method: "GET" });
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
    "/assets",
    {
      method: "POST",
      body: JSON.stringify(assetData),
      timeoutMs: 60000,
    },
    token,
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
    "/assets/verify-upload",
    {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 60000,
    },
    token,
  );
}

/**
 * Query live SerpApi Market Oracle for real-time South African valuation comps.
 * @param {{ name: string, category?: string, condition?: string }} params
 * @param {string} [token]
 */
export async function getMarketOracleApi(
  { name, category, condition },
  token = null,
) {
  const query = new URLSearchParams({
    name: name || "",
    category: category || "",
    condition: condition || "",
  }).toString();
  return apiRequest(`/assets/market-oracle?${query}`, { method: "GET" }, token);
}

/**
 * Unified Scan & Know: Gemini Vision + live ZAR Market Oracle + Vault ERC-721 match.
 * @param {{ image: string, vaultItems?: object[] }} payload
 * @param {string} token
 */
export async function scanAndKnowApi(payload, token) {
  return apiRequest(
    "/assets/scan-and-know",
    {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 60000,
    },
    token,
  );
}

/**
 * Request a delist & investor redemption quote for an asset.
 * @param {string} assetId
 * @param {string} token
 */
export async function getDelistQuoteApi(assetId, token) {
  return apiRequest(`/assets/${assetId}/delist-quote`, { method: "GET" }, token);
}

/**
 * Execute seller delist and investor redemption.
 * @param {string} assetId
 * @param {object} payload - { payoutSource: { paymentIntentId, method, ... } }
 * @param {string} token
 */
export async function delistAssetApi(assetId, payload = {}, token) {
  invalidateMarketAssetsCache();
  return apiRequest(
    `/assets/${assetId}/delist`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

// ── Multi-Rail Payment Gateway API ──────────────────────────────────────────

/**
 * Fetch live exchange rates (ZAR to Sepolia ETH), escrow address, and Stripe config.
 */
export async function getPaymentRatesApi() {
  return apiRequest("/payments/rates", { method: "GET" });
}

/**
 * Create a Stripe PaymentIntent on the backend.
 * Returns { clientSecret, paymentIntentId, publishableKey, mode }.
 * @param {{ amount: number, currency?: string, assetId?: string, assetName?: string }} data
 * @param {string} token - User's JWT
 */
export async function createPaymentIntentApi(data, token) {
  return apiRequest(
    "/payments/create-intent",
    { method: "POST", body: JSON.stringify(data) },
    token,
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
  const response = await fetch("https://api.stripe.com/v1/payment_methods", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: [
      "type=card",
      `card[number]=${card.number.replace(/\s+/g, "")}`,
      `card[exp_month]=${card.exp_month}`,
      `card[exp_year]=${card.exp_year}`,
      `card[cvc]=${card.cvc}`,
      card.name ? `billing_details[name]=${encodeURIComponent(card.name)}` : "",
    ]
      .filter(Boolean)
      .join("&"),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || "Stripe card tokenization failed");
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
export async function confirmStripePayment(
  publishableKey,
  clientSecret,
  paymentMethodId,
) {
  const intentId = clientSecret.split("_secret_")[0];
  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents/${intentId}/confirm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `payment_method=${paymentMethodId}`,
    },
  );
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || "Stripe payment confirmation failed");
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
    "/payments/process",
    {
      method: "POST",
      body: JSON.stringify(paymentData),
    },
    token,
  );
}

// ── Smart Contract Escrow API ────────────────────────────────────────────────

/**
 * Initialize escrow order and lock payment on-chain.
 */
export async function createEscrowApi(escrowPayload, token) {
  return apiRequest(
    "/escrow/create",
    {
      method: "POST",
      body: JSON.stringify(escrowPayload),
    },
    token,
  );
}

/**
 * Get live status and timeline of an escrow order (protected by role authorization).
 */
export async function getEscrowOrderApi(orderId, token) {
  return apiRequest(`/escrow/order/${orderId}`, { method: "GET" }, token);
}

/**
 * Release escrow funds to seller upon delivery and buyer acceptance.
 */
export async function releaseEscrowApi(orderId, token) {
  return apiRequest(
    "/escrow/release",
    {
      method: "POST",
      body: JSON.stringify({ orderId }),
    },
    token,
  );
}

/**
 * Refund escrow funds to buyer (authorized by seller or admin).
 */
export async function refundEscrowApi(orderId, reason, token) {
  return apiRequest(
    "/escrow/refund",
    {
      method: "POST",
      body: JSON.stringify({ orderId, reason }),
    },
    token,
  );
}

/**
 * Open an auditable dispute on an escrow order.
 */
export async function disputeEscrowApi(orderId, reason, evidence, token) {
  return apiRequest(
    "/escrow/dispute",
    {
      method: "POST",
      body: JSON.stringify({ orderId, reason, evidence }),
    },
    token,
  );
}

/**
 * Progress escrow order through its verification stages.
 */
export async function progressEscrowStepApi(orderId, step, details = {}, token) {
  const payload = typeof details === "string"
    ? { orderId, step, note: details }
    : { orderId, step, ...details };

  return apiRequest(
    "/escrow/progress",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function postSellerEscrowUpdateApi(orderId, details, token) {
  return apiRequest('/escrow/update', {
    method: 'POST',
    body: JSON.stringify({ orderId, ...details }),
  }, token);
}

/**
 * Retrieve all escrow orders for the logged-in user.
 */
export async function getMyEscrowOrdersApi(token) {
  return apiRequest("/escrow/my-orders", { method: "GET" }, token);
}

/**
 * Retrieve all escrow orders where the logged-in user is the seller.
 */
export async function getSellerEscrowOrdersApi(token) {
  return apiRequest("/escrow/seller-orders", { method: "GET" }, token);
}

// ── User Profile & Account Management API ────────────────────────────────────

/**
 * Fetch full profile data for authenticated user.
 */
/**
 * Fetch aggregated analytics for authenticated user since joining.
 */
export async function getUserAnalyticsApi(token) {
  return apiRequest("/user/analytics", { method: "GET" }, token);
}

export async function getUserProfileApi(token) {
  try {
    const data = await apiRequest("/user/profile", { method: "GET" }, token);
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
    "/user/profile",
    {
      method: "PUT",
      body: JSON.stringify(profileData),
    },
    token,
  );
}

/**
 * Permanently delete authenticated user's account and personal holdings.
 */
export async function deleteAccountApi(token) {
  return apiRequest("/user/account", { method: "DELETE" }, token);
}

// ── Support Tickets API ──────────────────────────────────────────────────────

/**
 * Lodge a support ticket or inquiry.
 */
export async function lodgeSupportTicketApi(ticketData, token) {
  return apiRequest(
    "/user/support",
    {
      method: "POST",
      body: JSON.stringify(ticketData),
    },
    token,
  );
}

/**
 * Get ticket history for authenticated user.
 */
export async function getUserSupportTicketsApi(token) {
  return apiRequest("/user/support", { method: "GET" }, token);
}

// ── Vault Balance, Deposits & Withdrawals API ────────────────────────────────

/**
 * Deposit funds into user's vault balance.
 * @param {{ amount: number, method?: string, reference?: string, notes?: string }} depositData
 */
export async function depositFundsApi(depositData, token) {
  invalidateVaultCache();
  return apiRequest(
    "/user/deposit",
    {
      method: "POST",
      body: JSON.stringify(depositData),
    },
    token,
  );
}

/**
 * Withdraw funds from user's vault balance.
 * @param {{ amount: number, method?: string, bankDetails?: object, walletAddress?: string, notes?: string }} withdrawData
 */
export async function withdrawFundsApi(withdrawData, token) {
  invalidateVaultCache();
  return apiRequest(
    "/user/withdraw",
    {
      method: "POST",
      body: JSON.stringify(withdrawData),
    },
    token,
  );
}

/**
 * Fetch all transaction records (deposits, withdrawals, payouts) for user.
 */
export async function getVaultTransactionsApi(token) {
  return apiRequest("/user/transactions", { method: "GET" }, token);
}

/**
 * Safely resolves an image URI for React Native Image component.
 * If the URI is a relative path (/uploads/...) or points to an outdated IP,
 * rewrites it using API_BASE_URL's active server origin.
 */
export function resolveImageUrl(
  imageUri,
  fallback = null,
) {
  if (!imageUri || typeof imageUri !== "string" || !imageUri.trim()) {
    return fallback;
  }
  if (imageUri.startsWith("data:image/")) return imageUri;

  const uploadsMatch = imageUri.match(
    /\/uploads\/(?:assets|avatars)\/[^"'\s?#]+/i,
  );
  if (uploadsMatch) {
    const baseOrigin = API_BASE_URL.replace(/\/api\/?$/, "");
    return `${baseOrigin}${uploadsMatch[0]}`;
  }

  // Also catch and rewrite any stale LAN IP URLs (e.g. 10.250.x.x:5000)
  if (imageUri.includes(":5000/uploads/")) {
    const baseOrigin = API_BASE_URL.replace(/\/api\/?$/, "");
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
    "/users/kyc-submit",
    {
      method: "POST",
      body: JSON.stringify(kycData),
    },
    token,
  );
}

/**
 * Retrieve user's KYC verification and compliance status.
 */
export async function getKycStatusApi(token) {
  return apiRequest("/users/kyc-status", { method: "GET" }, token);
}

/**
 * Retrieve user's notification preferences.
 */
export async function getNotificationPreferencesApi(token) {
  return apiRequest("/user/notifications/preferences", { method: "GET" }, token);
}

/**
 * Update user's notification preferences.
 */
export async function updateNotificationPreferencesApi(preferences, token) {
  return apiRequest(
    "/user/notifications/preferences",
    {
      method: "PUT",
      body: JSON.stringify({ preferences }),
    },
    token,
  );
}

/**
 * Logout session on backend to record audit trail.
 */
export async function logoutSessionApi(token, email = null) {
  try {
    return await apiRequest(
      "/auth/logout",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
      token,
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
    return await apiRequest("/auth/session-timeout", {
      method: "POST",
      body: JSON.stringify({ email, userId }),
    });
  } catch (_) {
    return { success: true };
  }
}

/**
 * Upload a single verification document (id | tax | proof_of_residence).
 * @param {{ docType: 'id'|'tax'|'proof_of_residence', fileData: string, fileName?: string, mimeType?: string, metaValue?: string }} payload
 * @param {string} token
 */
export async function uploadVerificationDocApi(payload, token) {
  return apiRequest(
    "/verification/documents",
    {
      method: "POST",
      body: JSON.stringify({
        doc_type: payload.docType || payload.doc_type,
        file_data: payload.fileData || payload.file_data,
        file_name: payload.fileName || payload.file_name,
        mime_type: payload.mimeType || payload.mime_type,
        meta_value: payload.metaValue || payload.meta_value,
      }),
      timeoutMs: 60000,
    },
    token,
  );
}

/**
 * Fetch the user's 3 document slots + overall verification_status + bank_account status.
 * @param {string} token
 */
export async function getVerificationStatusApi(token) {
  return apiRequest("/verification/status", { method: "GET" }, token);
}

/**
 * Submit or update user's bank account details for withdrawal approval.
 * @param {{ accountHolder: string, bankName: string, accountNumber: string, branchCode: string, accountType?: string }} bankData
 * @param {string} token
 */
export async function submitBankAccountApi(bankData, token) {
  return apiRequest(
    "/bank-accounts",
    {
      method: "POST",
      body: JSON.stringify({
        account_holder: bankData.accountHolder || bankData.account_holder,
        bank_name: bankData.bankName || bankData.bank_name,
        account_number: bankData.accountNumber || bankData.account_number,
        branch_code: bankData.branchCode || bankData.branch_code,
        account_type:
          bankData.accountType || bankData.account_type || "Cheque / Current",
      }),
    },
    token,
  );
}

/**
 * Get the user's current bank account approval status.
 * @param {string} token
 */
export async function getBankAccountApi(token) {
  return apiRequest("/bank-accounts", { method: "GET" }, token);
}

/**
 * Uploads a public media file (photos, models, certificates, avatars) to Cloudinary via backend.
 * @param {string} base64DataUri - The base64 data URI of the file
 * @param {'assets'|'avatars'|'models_3d'|'certificates'} folder
 * @param {string} token - Authenticated JWT
 * @returns {Promise<string>} Public HTTPS Cloudinary URL
 */
export async function uploadPublicMediaApi(
  base64DataUri,
  folder = "assets",
  token = null,
) {
  const res = await apiRequest(
    "/uploads/public",
    {
      method: "POST",
      body: JSON.stringify({ file: base64DataUri, folder }),
      timeoutMs: 60000,
    },
    token,
  );
  const url = res?.url || res?.secure_url;
  if (!url) throw new Error("Upload failed. No public URL returned by server.");
  return url;
}
