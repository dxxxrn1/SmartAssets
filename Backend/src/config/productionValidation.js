// ─── Production Startup Environment & Configuration Validator ──────────────────
// Validates all critical production environment variables at server boot before
// accepting traffic. Fails closed immediately if secrets or configs are missing or malformed.
// NEVER logs secret values or confidential credentials.

const crypto = require('crypto');

class ProductionConfigurationError extends Error {
  constructor(errors = []) {
    const header = '🚨 [FATAL] SmartAssets production environment configuration error(s):\n';
    const bulletList = errors.map((err, i) => `   ${i + 1}. ${err}`).join('\n');
    super(header + bulletList);
    this.name = 'ProductionConfigurationError';
    this.errors = errors;
  }
}

/**
 * Validates production environment configuration.
 * @param {object} [options]
 * @param {boolean} [options.forceProduction=false]
 * @param {boolean} [options.silent=false]
 * @returns {{ valid: boolean, env: string, features: object, errors: string[] }}
 */
function validateProductionConfig(options = {}) {
  const isProduction = options.forceProduction || process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];
  const features = {};

  // 1. Supabase URL
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  if (!supabaseUrl) {
    errors.push('SUPABASE_URL is missing. Must be set to your project endpoint (e.g. https://xyz.supabase.co).');
  } else if (!supabaseUrl.startsWith('https://')) {
    if (isProduction) {
      errors.push('SUPABASE_URL must use HTTPS protocol in production.');
    } else {
      warnings.push('SUPABASE_URL does not use HTTPS protocol.');
    }
  }

  // 2. Supabase Service Role Key
  const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseServiceKey) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is missing. Required for authoritative backend operations.');
  } else if (supabaseServiceKey.length < 20) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is suspiciously short (< 20 characters).');
  }

  // 3. Administrator Authentication Secret (ADMIN_JWT_SECRET)
  const adminSecret = (process.env.ADMIN_JWT_SECRET || '').trim();
  const prohibitedSecrets = [
    'default-smartassets-admin-jwt-secret-key-change-in-production',
    'secret',
    'admin',
    'password',
    'Admin@SmartAssets2026',
    'SmartAssets2026!',
    'smartassets-secret',
    'supersecret',
  ];

  if (!adminSecret) {
    errors.push('ADMIN_JWT_SECRET is missing. Set to a strong HMAC-SHA256 secret (min 32 chars).');
  } else if (adminSecret.length < 32) {
    errors.push(`ADMIN_JWT_SECRET is too short (${adminSecret.length} chars). Minimum requirement is 32 characters.`);
  } else if (prohibitedSecrets.includes(adminSecret)) {
    errors.push('ADMIN_JWT_SECRET uses a known insecure default secret. Generate a unique 256-bit secret.');
  } else if (supabaseServiceKey && adminSecret === supabaseServiceKey) {
    errors.push('ADMIN_JWT_SECRET must NOT reuse the Supabase service role key.');
  }

  // 4. Certificate Signing Private Key (RSA-2048+)
  const certPrivKeyRaw = (process.env.CERTIFICATE_SIGNING_PRIVATE_KEY || '').trim();
  const certPrivKey = certPrivKeyRaw.replace(/\\n/g, '\n');
  const certPubKeyRaw = (process.env.CERTIFICATE_SIGNING_PUBLIC_KEY || '').trim();
  const certPubKey = certPubKeyRaw.replace(/\\n/g, '\n');

  if (!certPrivKey) {
    if (isProduction) {
      errors.push(
        'CERTIFICATE_SIGNING_PRIVATE_KEY is missing in production. ' +
        'A persistent RSA private key PEM is required so certificates survive server restarts.'
      );
    } else {
      warnings.push('CERTIFICATE_SIGNING_PRIVATE_KEY not set. Falling back to local disk/dev keystore.');
    }
  } else {
    try {
      const privKeyObj = crypto.createPrivateKey(certPrivKey);
      if (privKeyObj.asymmetricKeyType !== 'rsa') {
        errors.push(`CERTIFICATE_SIGNING_PRIVATE_KEY must be an RSA key (found '${privKeyObj.asymmetricKeyType}').`);
      }

      // Check consistency with CERTIFICATE_SIGNING_PUBLIC_KEY if provided
      if (certPubKey) {
        try {
          const derivedPubPem = crypto.createPublicKey(privKeyObj).export({ type: 'spki', format: 'pem' }).trim();
          const cleanPubPem = crypto.createPublicKey(certPubKey).export({ type: 'spki', format: 'pem' }).trim();
          if (derivedPubPem !== cleanPubPem) {
            errors.push('CERTIFICATE_SIGNING_PUBLIC_KEY does not match CERTIFICATE_SIGNING_PRIVATE_KEY.');
          }
        } catch (pubErr) {
          errors.push(`CERTIFICATE_SIGNING_PUBLIC_KEY is malformed: ${pubErr.message}`);
        }
      }
    } catch (keyErr) {
      errors.push(`CERTIFICATE_SIGNING_PRIVATE_KEY is malformed: ${keyErr.message}`);
    }
  }

  // 5. Canonical Public Web Base URL
  const publicWebBase = (process.env.PUBLIC_WEB_BASE_URL || '').trim();
  if (!publicWebBase) {
    if (isProduction) {
      errors.push(
        'PUBLIC_WEB_BASE_URL is missing in production. ' +
        'Set to your canonical HTTPS domain (e.g. https://api.smartassets.io or https://smartassets-backend.onrender.com).'
      );
    } else {
      warnings.push('PUBLIC_WEB_BASE_URL not set. Falling back to local server URL.');
    }
  } else {
    try {
      const parsedUrl = new URL(publicWebBase);
      if (isProduction && parsedUrl.protocol !== 'https:') {
        errors.push(`PUBLIC_WEB_BASE_URL must use HTTPS protocol in production (found '${parsedUrl.protocol}').`);
      }
    } catch (_) {
      errors.push(`PUBLIC_WEB_BASE_URL '${publicWebBase}' is not a valid URL.`);
    }
  }

  // 6. Production CORS Allowed Origins
  const corsOriginsRaw = (process.env.CORS_ALLOWED_ORIGINS || '').trim();
  if (isProduction) {
    if (!corsOriginsRaw) {
      errors.push(
        'CORS_ALLOWED_ORIGINS is missing in production. ' +
        'Set to comma-separated allowed web domains (e.g. https://app.smartassets.io,https://admin.smartassets.io).'
      );
    } else if (corsOriginsRaw.includes('*')) {
      errors.push('CORS_ALLOWED_ORIGINS must not contain wildcard (*) when credentials are supported.');
    }
  }

  // ── Optional Feature Status Audit (Logged safely without leaking secrets) ─────
  // Stripe
  const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  features.stripe = {
    configured: Boolean(stripeKey && stripeKey.length > 10),
    mode: stripeKey.startsWith('sk_live_') ? 'live' : stripeKey.startsWith('sk_test_') ? 'test' : 'disabled',
  };

  // Cloudinary
  const cName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const cKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const cSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  features.cloudinary = {
    configured: Boolean(cName && cKey && cSecret),
  };

  // Blockchain Relayer
  const rpcUrl = (process.env.SEPOLIA_RPC_URL || process.env.ETH_RPC_URL || '').trim();
  const relayerKey = (process.env.SEPOLIA_RELAYER_PRIVATE_KEY || '').trim();
  features.blockchain = {
    rpcConfigured: Boolean(rpcUrl),
    relayerConfigured: Boolean(relayerKey && relayerKey.length >= 64),
    mode: relayerKey ? 'read-write' : 'read-only',
  };

  // Tripo 3D AI
  const tripoKey = (process.env.TRIPO_API_KEY || '').trim();
  features.tripo = {
    configured: Boolean(tripoKey),
  };

  // SerpApi Market Intelligence
  const serpKey = (process.env.SERPAPI_KEY || '').trim();
  features.serpApi = {
    configured: Boolean(serpKey),
  };

  if (!options.silent) {
    if (isProduction) {
      console.log('🔒 [Config] Validating SmartAssets production configuration...');
      console.log(`   • Payments (Stripe):     ${features.stripe.configured ? `Enabled (${features.stripe.mode})` : 'Disabled (credentials absent)'}`);
      console.log(`   • Media (Cloudinary):    ${features.cloudinary.configured ? 'Enabled (cloud storage)' : 'Local fallback only'}`);
      console.log(`   • Blockchain Relayer:    ${features.blockchain.relayerConfigured ? 'Active (on-chain anchoring)' : 'Read-only / Unanchored'}`);
      console.log(`   • 3D Model Generation:   ${features.tripo.configured ? 'Active' : 'Disabled (no TRIPO_API_KEY)'}`);
      console.log(`   • Market Oracle:         ${features.serpApi.configured ? 'Active' : 'Using internal valuation model'}`);
    }
  }

  if (isProduction && errors.length > 0) {
    throw new ProductionConfigurationError(errors);
  }

  return {
    valid: errors.length === 0,
    env: isProduction ? 'production' : 'development',
    features,
    errors,
    warnings,
  };
}

module.exports = {
  ProductionConfigurationError,
  validateProductionConfig,
};
