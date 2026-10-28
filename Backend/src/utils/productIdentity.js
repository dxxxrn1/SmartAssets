// ─── Product Identity & Canonical Metadata Digest ──────────────────────────
// Defines deterministic metadata normalization and cryptographic SHA-256
// digest computation for SmartAssets physical luxury collectibles.
// Enforces strict separation of:
// 1. Stable Database ID (UUID)
// 2. Cryptographic Metadata Digest (SHA-256)
// 3. NFT Token ID (uint256, if minted)
// 4. On-Chain Transaction Hash (0x... 64-hex, if mined)
// 5. Public Product Verification URL (HTTPS)

const crypto = require('crypto');

/**
 * Approved canonical product fields for cryptographic digest.
 * PRIVACY GUARANTEE:
 * - NO user emails, phone numbers, or physical addresses.
 * - NO KYC/FICA documents, tax identifiers, or bank accounts.
 * - NO wallet secrets or private keys.
 * - NO volatile metrics (e.g. shares sold, dynamic comps).
 */
const CANONICAL_FIELDS = [
  'asset_id',
  'category',
  'condition',
  'image_url',
  'initial_valuation_zar',
  'name',
  'seller_id',
  'year',
];

/**
 * Normalizes product attributes into a deterministic canonical object.
 * Keys are sorted lexicographically to guarantee idempotent serialization.
 * @param {object} product
 * @returns {object}
 */
function buildCanonicalMetadata(product = {}) {
  const assetId = String(product.id || product.asset_id || product.assetId || '').trim();
  const name = String(product.name || '').trim();
  const category = String(product.category || 'Uncategorised').trim().toUpperCase();
  const condition = String(product.condition || 'Not provided').trim();
  
  const rawYear = product.year;
  const year = rawYear !== null && rawYear !== undefined && !isNaN(Number(rawYear))
    ? Number(rawYear)
    : null;

  const imageUrl = String(product.image || product.image_url || product.primary_image || '').trim();
  
  const rawValuation = product.price_num || product.priceNum || product.initial_valuation_zar || 0;
  const initialValuationZar = Math.round(Number(rawValuation) || 0);

  const sellerId = String(product.seller_id || product.sellerId || product.user_id || product.userId || '').trim();

  const canonicalObj = {
    asset_id: assetId,
    category,
    condition,
    image_url: imageUrl,
    initial_valuation_zar: initialValuationZar,
    name,
    seller_id: sellerId,
    year,
  };

  // Sort keys lexicographically
  const sortedObj = {};
  Object.keys(canonicalObj)
    .sort()
    .forEach((k) => {
      sortedObj[k] = canonicalObj[k];
    });

  return sortedObj;
}

/**
 * Computes a standard SHA-256 cryptographic digest of the canonical product metadata.
 * Returns standard 64-hex-character string prefixed with '0x'.
 * @param {object} productOrMetadata
 * @returns {{ canonicalMetadata: object, canonicalJson: string, metadataDigest: string }}
 */
function computeMetadataDigest(productOrMetadata) {
  const canonicalMetadata = buildCanonicalMetadata(productOrMetadata);
  const canonicalJson = JSON.stringify(canonicalMetadata);
  const hashHex = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  const metadataDigest = `0x${hashHex}`;

  return {
    canonicalMetadata,
    canonicalJson,
    metadataDigest,
  };
}

/**
 * Validates whether a given metadata digest matches the current product record.
 * @param {object} product
 * @param {string} expectedDigest
 * @returns {boolean}
 */
function verifyMetadataDigest(product, expectedDigest) {
  if (!expectedDigest || typeof expectedDigest !== 'string') return false;
  const { metadataDigest } = computeMetadataDigest(product);
  return metadataDigest.toLowerCase() === expectedDigest.trim().toLowerCase();
}

/**
 * Strictly validates an Ethereum transaction hash (64 hex chars with 0x prefix).
 * Rejects placeholder hashes, abbreviated hashes, and pseudo-hashes.
 * @param {string} txHash
 * @returns {boolean}
 */
function isValidTxHash(txHash) {
  if (typeof txHash !== 'string') return false;
  const clean = txHash.trim();
  if (clean.includes('...') || clean.includes('0x71c...9a')) return false;
  return /^0x[0-9a-fA-F]{64}$/.test(clean);
}

/**
 * Resolves the canonical public product verification URL for an asset.
 * @param {string} assetId
 * @param {string} [customBaseUrl]
 * @returns {{ url: string | null, isConfigured: boolean, error: string | null }}
 */
function resolveVerificationUrl(assetId, customBaseUrl) {
  if (!assetId || typeof assetId !== 'string' || !assetId.trim()) {
    return {
      url: null,
      isConfigured: false,
      error: 'Missing or invalid asset ID.',
    };
  }

  const rawBase = customBaseUrl !== undefined
    ? customBaseUrl
    : (process.env.PUBLIC_WEB_BASE_URL || process.env.EXPO_PUBLIC_VERIFICATION_BASE_URL || '');

  const trimmed = typeof rawBase === 'string' ? rawBase.trim().replace(/\/+$/, '') : '';

  if (!trimmed) {
    return {
      url: null,
      isConfigured: false,
      error: 'Public verification base URL is not configured.',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        url: null,
        isConfigured: false,
        error: 'Invalid protocol. Must start with https:// or http://',
      };
    }
  } catch (_) {
    return {
      url: null,
      isConfigured: false,
      error: 'Malformed URL.',
    };
  }

  return {
    url: `${trimmed}/verify/${encodeURIComponent(assetId.trim())}`,
    isConfigured: true,
    error: null,
  };
}

module.exports = {
  CANONICAL_FIELDS,
  buildCanonicalMetadata,
  computeMetadataDigest,
  verifyMetadataDigest,
  isValidTxHash,
  resolveVerificationUrl,
};
