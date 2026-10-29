// ─── Certificate Cryptographic & PKI Service ─────────────────────────────────
// Manages RSA-2048 / RS256 server-side signing keys, deterministic canonicalization,
// cryptographic SHA-256 digests, and independent signature verification.
//
// PRIVACY & SECURITY:
// - Private keys NEVER leave this service and are NEVER sent to clients or logged.
// - Canonical payloads strictly exclude user PII (emails, phones, KYC, secrets).
// - Public keys are published via getPublicVerificationKeys() for independent verification.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CERTIFICATE_VERSION = '1.0.0';
const DEFAULT_KEY_ID = 'sa-cert-key-2026-v1';
const KEYSTORE_DIR = path.resolve(__dirname, '../config/keys');
const KEYSTORE_FILE = path.join(KEYSTORE_DIR, 'certificate_authority_keystore.json');

// In-memory keystore cache
let keystoreCache = null;

/**
 * Resets keystore cache (test-isolation hook).
 */
function _resetKeystoreCache() {
  keystoreCache = null;
}

/**
 * Initializes or loads the server-side RSA keypair.
 * Precedence:
 * 1. Environment variables: CERTIFICATE_SIGNING_PRIVATE_KEY & CERTIFICATE_SIGNING_KEY_ID
 * 2. Persistent disk keystore: Backend/src/config/keys/certificate_authority_keystore.json (non-prod only)
 * 3. Autonomous secure generation on first boot (non-prod only; NEVER in production)
 */
function initKeystore() {
  if (keystoreCache) return keystoreCache;

  const isProduction = process.env.NODE_ENV === 'production';
  const rawPrivKey = process.env.CERTIFICATE_SIGNING_PRIVATE_KEY;
  const rawPubKey = process.env.CERTIFICATE_SIGNING_PUBLIC_KEY;
  const envPrivKey = rawPrivKey ? String(rawPrivKey).replace(/\\n/g, '\n').trim() : '';
  const envPubKey = rawPubKey ? String(rawPubKey).replace(/\\n/g, '\n').trim() : '';
  const envKeyId = (process.env.CERTIFICATE_SIGNING_KEY_ID || DEFAULT_KEY_ID).trim();

  // Helper to ingest historical public keys
  function ingestHistoricalKeys(keysObj) {
    const historicalRaw = process.env.CERTIFICATE_HISTORICAL_PUBLIC_KEYS_JSON;
    if (!historicalRaw) return;
    try {
      const parsed = typeof historicalRaw === 'string' ? JSON.parse(historicalRaw) : historicalRaw;
      if (Array.isArray(parsed)) {
        parsed.forEach((h) => {
          if (h && h.keyId && h.publicKeyPem) {
            const hKeyId = String(h.keyId).trim();
            const hPubPem = String(h.publicKeyPem).replace(/\\n/g, '\n').trim();
            try {
              crypto.createPublicKey(hPubPem);
              keysObj[hKeyId] = {
                keyId: hKeyId,
                publicKeyPem: hPubPem,
                createdAt: h.createdAt || '2025-01-01T00:00:00.000Z',
                status: h.status || 'retired',
              };
            } catch (err) {
              console.warn(`⚠️ [Crypto] Invalid historical public key '${hKeyId}': ${err.message}`);
            }
          }
        });
      }
    } catch (e) {
      console.warn('⚠️ [Crypto] Could not parse CERTIFICATE_HISTORICAL_PUBLIC_KEYS_JSON:', e.message);
    }
  }

  // 1. Check environment variables
  if (envPrivKey && envPrivKey.includes('PRIVATE KEY')) {
    let privKeyObj;
    try {
      privKeyObj = crypto.createPrivateKey(envPrivKey);
    } catch (err) {
      throw new Error(`CERTIFICATE_SIGNING_CONFIG_ERROR: Malformed CERTIFICATE_SIGNING_PRIVATE_KEY: ${err.message}`);
    }

    let resolvedPubKey = '';
    try {
      const pubKeyObj = crypto.createPublicKey(privKeyObj);
      resolvedPubKey = pubKeyObj.export({ type: 'spki', format: 'pem' }).trim();
    } catch (err) {
      throw new Error(`CERTIFICATE_SIGNING_CONFIG_ERROR: Failed to derive public key from private key: ${err.message}`);
    }

    if (envPubKey) {
      try {
        const clientPubObj = crypto.createPublicKey(envPubKey);
        const clientPubPem = clientPubObj.export({ type: 'spki', format: 'pem' }).trim();
        if (clientPubPem !== resolvedPubKey) {
          throw new Error('CERTIFICATE_SIGNING_CONFIG_ERROR: CERTIFICATE_SIGNING_PUBLIC_KEY does not match CERTIFICATE_SIGNING_PRIVATE_KEY.');
        }
      } catch (err) {
        if (err.message.startsWith('CERTIFICATE_SIGNING_CONFIG_ERROR')) throw err;
        throw new Error(`CERTIFICATE_SIGNING_CONFIG_ERROR: Malformed CERTIFICATE_SIGNING_PUBLIC_KEY: ${err.message}`);
      }
    }

    const keys = {
      [envKeyId]: {
        keyId: envKeyId,
        privateKeyPem: envPrivKey,
        publicKeyPem: resolvedPubKey,
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
      },
    };

    ingestHistoricalKeys(keys);

    keystoreCache = {
      activeKeyId: envKeyId,
      keys,
    };
    return keystoreCache;
  }

  // In production, we FAIL CLOSED immediately if the environment key is missing or invalid.
  // Never auto-generate new keys or rely on ephemeral Render container disks in production.
  if (isProduction) {
    throw new Error(
      'CERTIFICATE_SIGNING_CONFIG_ERROR: CERTIFICATE_SIGNING_PRIVATE_KEY is missing or invalid in production environment. ' +
      'A persistent RSA-2048 private key must be configured in environment variables to prevent certificate invalidation on redeploys.'
    );
  }

  // 2. Check disk keystore (non-production only)
  if (fs.existsSync(KEYSTORE_FILE)) {
    try {
      const raw = fs.readFileSync(KEYSTORE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.activeKeyId && parsed.keys && parsed.keys[parsed.activeKeyId]) {
        ingestHistoricalKeys(parsed.keys);
        keystoreCache = parsed;
        return keystoreCache;
      }
    } catch (e) {
      console.warn('⚠️ [Crypto] Could not read existing keystore file:', e.message);
    }
  }

  // 3. Generate initial persistent 2048-bit RSA keypair (non-production only)
  if (!fs.existsSync(KEYSTORE_DIR)) {
    fs.mkdirSync(KEYSTORE_DIR, { recursive: true });
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const newKeys = {
    [DEFAULT_KEY_ID]: {
      keyId: DEFAULT_KEY_ID,
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      createdAt: new Date().toISOString(),
      status: 'active',
    },
  };
  ingestHistoricalKeys(newKeys);

  const newKeystore = {
    activeKeyId: DEFAULT_KEY_ID,
    keys: newKeys,
  };

  try {
    fs.writeFileSync(KEYSTORE_FILE, JSON.stringify(newKeystore, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn('⚠️ [Crypto] Could not persist generated keystore to disk:', e.message);
  }

  keystoreCache = newKeystore;
  return keystoreCache;
}

/**
 * Recursively sorts an object's keys lexicographically.
 * @param {*} value
 * @returns {*}
 */
function sortObjectKeys(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  const sorted = {};
  Object.keys(value)
    .sort()
    .forEach((k) => {
      sorted[k] = sortObjectKeys(value[k]);
    });
  return sorted;
}

/**
 * Builds the canonical representation of an authenticated product certificate.
 * Strictly whitelisted fields only. No PII, no volatile marketplace state.
 *
 * @param {object} input
 * @returns {object} Canonical object with deterministically sorted keys
 */
function buildCanonicalCertificatePayload(input = {}) {
  const assetId = String(input.asset_id || input.assetId || input.id || '').trim();
  const certId = String(input.certificate_id || input.certificateId || input.certId || input.cert || '').trim();
  const certVersion = String(input.certificate_version || input.certificateVersion || CERTIFICATE_VERSION).trim();
  const name = String(input.name || '').trim();
  const category = String(input.category || 'Uncategorised').trim().toUpperCase();
  const condition = String(input.condition || 'Not provided').trim();

  const rawYear = input.year;
  const year = rawYear !== null && rawYear !== undefined && !isNaN(Number(rawYear))
    ? Number(rawYear)
    : null;

  const rawValuation = input.initial_valuation_zar ?? input.price_num ?? input.priceNum ?? 0;
  const initialValuationZar = Math.round(Number(rawValuation) || 0);
  const imageUrl = String(input.image_url || input.image || input.primary_image || '').trim();
  const issuedAt = String(input.issued_at || input.issuedAt || '').trim();

  // Issuer sub-object
  const rawIssuer = input.issuer || {};
  const issuer = {
    id: String(rawIssuer.id || 'smartassets-authority').trim(),
    name: String(rawIssuer.name || 'SmartAssets Verification Authority').trim(),
  };

  // Evidence sub-object
  const rawEvidence = input.evidence || {};
  const evidence = {
    appraiser_name: String(rawEvidence.appraiser_name || rawEvidence.appraiser || 'Not provided').trim(),
    inspection_date: String(rawEvidence.inspection_date || rawEvidence.date || '').trim(),
    inspection_ref: String(rawEvidence.inspection_ref || rawEvidence.ref || '').trim(),
    inspection_status: String(rawEvidence.inspection_status || rawEvidence.status || 'passed').trim().toLowerCase(),
    physical_custody: Boolean(rawEvidence.physical_custody || rawEvidence.is_vaulted),
  };

  const payload = {
    asset_id: assetId,
    category,
    certificate_id: certId,
    certificate_version: certVersion,
    condition,
    evidence,
    image_url: imageUrl,
    initial_valuation_zar: initialValuationZar,
    issued_at: issuedAt,
    issuer,
    name,
    year,
  };

  return sortObjectKeys(payload);
}

/**
 * Computes deterministic SHA-256 cryptographic digest of canonical payload.
 * Returns standard 64-hex-character string prefixed with '0x'.
 *
 * @param {object} payload
 * @returns {{ canonicalPayload: object, canonicalJson: string, canonicalDigest: string }}
 */
function computeCanonicalDigest(payload) {
  const canonicalPayload = buildCanonicalCertificatePayload(payload);
  const canonicalJson = JSON.stringify(canonicalPayload);
  const hashHex = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  const canonicalDigest = `0x${hashHex}`;

  return {
    canonicalPayload,
    canonicalJson,
    canonicalDigest,
  };
}

/**
 * Signs a canonical certificate payload using the active server RSA private key.
 *
 * @param {object} payload
 * @param {string} [requestedKeyId]
 * @returns {{ signature: string, canonicalDigest: string, canonicalPayload: object, keyId: string, version: string }}
 */
function signCanonicalCertificate(payload, requestedKeyId) {
  const keystore = initKeystore();
  const keyId = requestedKeyId || keystore.activeKeyId;
  const keyRecord = keystore.keys[keyId];

  if (!keyRecord || !keyRecord.privateKeyPem) {
    throw new Error(`Signing key '${keyId}' not available on this server.`);
  }

  const { canonicalPayload, canonicalJson, canonicalDigest } = computeCanonicalDigest(payload);

  const signer = crypto.createSign('SHA256');
  signer.update(canonicalJson, 'utf8');
  signer.end();

  const signature = signer.sign(keyRecord.privateKeyPem, 'base64');

  return {
    signature,
    canonicalDigest,
    canonicalPayload,
    canonicalJson,
    keyId,
    version: canonicalPayload.certificate_version || CERTIFICATE_VERSION,
  };
}

/**
 * Independently verifies a digital signature against a canonical certificate payload.
 *
 * @param {object} payload
 * @param {string} signatureBase64
 * @param {string} keyId
 * @returns {{ valid: boolean, reason: string | null, digest: string, keyId: string }}
 */
function verifyCertificateSignature(payload, signatureBase64, keyId) {
  if (!signatureBase64 || typeof signatureBase64 !== 'string') {
    return { valid: false, reason: 'missing_signature', digest: null, keyId: null };
  }
  if (!keyId || typeof keyId !== 'string') {
    return { valid: false, reason: 'missing_key_id', digest: null, keyId: null };
  }

  const keystore = initKeystore();
  const keyRecord = keystore.keys[keyId.trim()];

  if (!keyRecord || !keyRecord.publicKeyPem) {
    return { valid: false, reason: 'unknown_key_id', digest: null, keyId };
  }

  const { canonicalJson, canonicalDigest } = computeCanonicalDigest(payload);

  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(canonicalJson, 'utf8');
    verifier.end();

    const isValid = verifier.verify(keyRecord.publicKeyPem, signatureBase64.trim(), 'base64');
    return {
      valid: Boolean(isValid),
      reason: isValid ? null : 'signature_mismatch',
      digest: canonicalDigest,
      keyId,
    };
  } catch (err) {
    return {
      valid: false,
      reason: `verification_exception: ${err.message}`,
      digest: canonicalDigest,
      keyId,
    };
  }
}

/**
 * Returns public keys for verifiers in PEM and JWKS formats.
 * Strictly excludes private keys.
 */
function getPublicVerificationKeys() {
  const keystore = initKeystore();
  const publicKeys = [];

  Object.values(keystore.keys).forEach((k) => {
    if (k.publicKeyPem) {
      publicKeys.push({
        kid: k.keyId,
        kty: 'RSA',
        alg: 'RS256',
        use: 'sig',
        issuer: 'SmartAssets Verification Authority',
        createdAt: k.createdAt,
        status: k.status || 'active',
        publicKeyPem: k.publicKeyPem,
      });
    }
  });

  return {
    activeKeyId: keystore.activeKeyId,
    keys: publicKeys,
  };
}

module.exports = {
  CERTIFICATE_VERSION,
  DEFAULT_KEY_ID,
  initKeystore,
  buildCanonicalCertificatePayload,
  computeCanonicalDigest,
  signCanonicalCertificate,
  verifyCertificateSignature,
  getPublicVerificationKeys,
  _resetKeystoreCache,
};
