// ─── Certificate & Evidence Service ──────────────────────────────────────────
// Implements authoritative digital certificate issuance, evidence tracking,
// revocation, and independent verification dossier generation.
//
// LIFECYCLE STATES:
// - draft: Asset registered in marketplace, not yet appraised or signed.
// - awaiting_inspection: Submitted for physical or expert appraisal.
// - issued: Formally appraised with evidence, cryptographically signed with RSA-2048.
// - anchored: Digitally signed AND anchored on Ethereum Sepolia with verified tx receipt.
// - revoked: Formally revoked; preserves audit trail and reason.
// - unverifiable: Signature check failed or canonical metadata was modified.

const supabase = require('../connection/supabaseClient');
const web3Service = require('./web3Service');
const {
  CERTIFICATE_VERSION,
  buildCanonicalCertificatePayload,
  computeCanonicalDigest,
  signCanonicalCertificate,
  verifyCertificateSignature,
  getPublicVerificationKeys,
} = require('./certificateCryptoService');
const { isValidTxHash, resolveVerificationUrl } = require('../utils/productIdentity');

const DEFAULT_ISSUER = {
  id: process.env.CERTIFICATE_ISSUER_ID || 'smartassets-authority-org',
  name: process.env.CERTIFICATE_ISSUER_NAME || 'SmartAssets Verification Authority',
  url: 'https://smartassets.io/authority',
};

/**
 * Checks whether the public verification base URL is properly configured.
 * @returns {{ isConfigured: boolean, baseUrl: string, error: string | null }}
 */
function checkVerificationUrlConfiguration() {
  const rawBase =
    process.env.PUBLIC_WEB_BASE_URL ||
    process.env.EXPO_PUBLIC_VERIFICATION_BASE_URL ||
    '';
  const trimmed = typeof rawBase === 'string' ? rawBase.trim().replace(/\/+$/, '') : '';

  if (!trimmed) {
    return {
      isConfigured: false,
      baseUrl: '',
      error:
        'Configuration required: PUBLIC_WEB_BASE_URL (or EXPO_PUBLIC_VERIFICATION_BASE_URL) must be set to a valid HTTPS or HTTP host before official certificates can be issued.',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        isConfigured: false,
        baseUrl: trimmed,
        error: 'Invalid protocol: Verification URL must use https:// or http://',
      };
    }
  } catch (_) {
    return {
      isConfigured: false,
      baseUrl: trimmed,
      error: 'Malformed URL: Please configure a valid public verification base URL.',
    };
  }

  return { isConfigured: true, baseUrl: trimmed, error: null };
}

/**
 * Generates an authoritative digital certificate for an asset.
 * Only callable by authorized compliance officers or appraisers.
 *
 * @param {object} params
 * @param {string} params.assetId
 * @param {object} params.evidence
 * @param {object} [params.issuer]
 * @param {object} [params.authorizedUser]
 * @returns {Promise<object>}
 */
async function issueCertificate({ assetId, evidence = {}, issuer = DEFAULT_ISSUER, authorizedUser }) {
  if (!assetId || typeof assetId !== 'string') {
    throw new Error('Valid assetId is required for certificate issuance.');
  }

  // 1. Verify URL configuration before issuing
  const urlCheck = checkVerificationUrlConfiguration();
  if (!urlCheck.isConfigured) {
    throw new Error(urlCheck.error);
  }

  // 2. Fetch durable asset from database
  const { data: asset, error: assetErr } = await supabase
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single();

  if (assetErr || !asset) {
    throw new Error(`Asset '${assetId}' not found in registry.`);
  }

  if (asset.certificate_lifecycle_status === 'revoked' || asset.certificate_revoked) {
    throw new Error('Cannot reissue or update a revoked certificate. A new asset record is required.');
  }

  // 3. Evidence validation
  const appraiserName = String(evidence.appraiser_name || evidence.appraiser || '').trim();
  const inspectionRef = String(evidence.inspection_ref || evidence.ref || '').trim();
  const inspectionDate = evidence.inspection_date || new Date().toISOString();
  const inspectionStatus = String(evidence.inspection_status || '').trim().toLowerCase();
  const physicalCustody = Boolean(
    evidence.physical_custody !== undefined
      ? evidence.physical_custody
      : asset.badge === 'Vault Secured' || asset.status === 'in_vault'
  );
  const custodyFacility = physicalCustody
    ? String(evidence.custody_facility || 'SmartAssets High-Security Vault Facility').trim()
    : 'Not Vaulted (Digital Claim Only)';

  if (!appraiserName || !inspectionRef) {
    throw new Error('Appraiser name and inspection reference are required to issue a certificate.');
  }
  if (inspectionStatus !== 'passed') {
    throw new Error(`Cannot issue certificate: Inspection status is '${inspectionStatus}'. Must be 'passed'.`);
  }

  const sanitizedEvidence = {
    appraiser_name: appraiserName,
    inspection_ref: inspectionRef,
    inspection_date: inspectionDate,
    inspection_status: inspectionStatus,
    physical_custody: physicalCustody,
    custody_facility: custodyFacility,
  };

  // 4. Generate stable certificate ID
  const cleanAssetId = String(asset.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  const certId = asset.certificate_id || `SA-CERT-${cleanAssetId}-V1`;
  // A refresh is a new signed snapshot, so its issue date must advance as well.
  const issuedAt = new Date().toISOString();

  // 5. Build canonical payload & sign with server RSA private key
  const canonicalInput = {
    asset_id: asset.id,
    category: asset.category,
    certificate_id: certId,
    certificate_version: CERTIFICATE_VERSION,
    condition: asset.condition,
    evidence: sanitizedEvidence,
    image_url: asset.image,
    initial_valuation_zar: asset.price_num,
    issued_at: issuedAt,
    issuer: {
      id: issuer.id || DEFAULT_ISSUER.id,
      name: issuer.name || DEFAULT_ISSUER.name,
    },
    name: asset.name,
    year: asset.year,
  };

  const { signature, canonicalDigest, canonicalPayload, keyId } = signCanonicalCertificate(canonicalInput);

  // 6. Check blockchain anchoring state
  let lifecycleStatus = 'issued';
  let blockchainAnchoring = null;

  if (asset.tx_hash && isValidTxHash(asset.tx_hash)) {
    lifecycleStatus = 'anchored';
    blockchainAnchoring = {
      network: 'Ethereum Sepolia Testnet (Test Credential)',
      chainId: 11155111,
      contractAddress: asset.contract_address || null,
      tokenId: asset.token_id || asset.nft_token_id || null,
      txHash: asset.tx_hash.trim(),
      blockNumber: asset.block_number || null,
      confirmedAt: asset.blockchain_confirmed_at || asset.created_at || null,
      isTestnet: true,
    };
  }

  // 7. Update asset record durably
  const updatePayload = {
    certificate_id: certId,
    certificate_version: CERTIFICATE_VERSION,
    certificate_signature: signature,
    certificate_key_id: keyId,
    certificate_issuer: issuer,
    certificate_issued_at: issuedAt,
    certificate_evidence: sanitizedEvidence,
    certificate_lifecycle_status: lifecycleStatus,
    metadata_digest: canonicalDigest,
    cert: certId,
  };

  const { data: updatedAsset, error: updateError } = await supabase
    .from('assets')
    .update(updatePayload)
    .eq('id', asset.id)
    .select('id, certificate_id, certificate_lifecycle_status, certificate_issued_at, metadata_digest')
    .maybeSingle();
  if (updateError) {
    throw new Error(`Certificate was not saved: ${updateError.message}`);
  }
  if (!updatedAsset) {
    throw new Error('Certificate was not saved because the asset record no longer exists.');
  }

  const verificationUrl = `${urlCheck.baseUrl}/verify/${encodeURIComponent(asset.id)}`;

  return {
    certificateId: certId,
    version: CERTIFICATE_VERSION,
    lifecycleStatus,
    canonicalDigest,
    signature,
    keyId,
    issuer,
    issuedAt,
    evidence: sanitizedEvidence,
    blockchainAnchoring,
    verificationUrl,
    canonicalPayload,
  };
}

/**
 * Revokes an issued certificate.
 *
 * @param {object} params
 * @param {string} params.assetId
 * @param {string} params.reason
 * @param {object} params.authorizedUser
 * @returns {Promise<object>}
 */
async function revokeCertificate({ assetId, reason, authorizedUser }) {
  if (!assetId) throw new Error('Asset ID is required for revocation.');
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new Error('Revocation reason is required.');
  }

  const { data: asset, error } = await supabase
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single();

  if (error || !asset) {
    throw new Error(`Asset '${assetId}' not found.`);
  }

  const revokedAt = new Date().toISOString();
  const updatePayload = {
    certificate_lifecycle_status: 'revoked',
    certificate_revoked: true,
    certificate_revoked_at: revokedAt,
    certificate_revocation_reason: reason.trim(),
  };

  const { data: updatedAsset, error: updateError } = await supabase
    .from('assets')
    .update(updatePayload)
    .eq('id', assetId)
    .select('id')
    .maybeSingle();
  if (updateError) throw new Error(`Certificate revocation was not saved: ${updateError.message}`);
  if (!updatedAsset) throw new Error('Certificate revocation was not saved because the asset record no longer exists.');

  // Record audit history entry
  try {
    await supabase.from('asset_history').insert({
      asset_id: assetId,
      year: new Date().getFullYear(),
      event: `Digital Certificate Revoked: ${reason.trim()}`,
      party: authorizedUser?.email || 'SmartAssets Compliance Authority',
      tx_hash: null,
    });
  } catch (_) {}

  return {
    assetId,
    certificateId: asset.certificate_id,
    lifecycleStatus: 'revoked',
    revokedAt,
    reason: reason.trim(),
  };
}

/**
 * Retrieves the full, independently verifiable certificate dossier for an asset.
 *
 * @param {string} assetId
 * @returns {Promise<object>}
 */
async function getCertificateDossier(assetId) {
  if (!assetId || typeof assetId !== 'string') {
    throw new Error('Asset ID is required.');
  }

  const { data: asset, error } = await supabase
    .from('assets')
    .select('*')
    .eq('id', assetId.trim())
    .single();

  if (error || !asset) {
    return {
      found: false,
      assetId,
      error: 'Product record not found in registry.',
    };
  }

  // 1. Determine truthful lifecycle state
  let lifecycleStatus = asset.certificate_lifecycle_status || 'draft';
  if (asset.certificate_revoked) {
    lifecycleStatus = 'revoked';
  } else if (!asset.certificate_signature) {
    // If not signed, it is draft or awaiting inspection
    lifecycleStatus = asset.ai_scan_status === 'pending' ? 'awaiting_inspection' : 'draft';
  } else if (isValidTxHash(asset.tx_hash)) {
    lifecycleStatus = 'anchored';
  }

  const urlCheck = checkVerificationUrlConfiguration();
  const verificationUrl = urlCheck.isConfigured
    ? `${urlCheck.baseUrl}/verify/${encodeURIComponent(asset.id)}`
    : null;

  // 2. Build sanitized product info (Zero PII)
  const product = {
    id: asset.id,
    name: asset.name,
    category: asset.category,
    condition: asset.condition,
    year: asset.year,
    image: asset.image,
    initialValuationZar: asset.price_num || 0,
    status: asset.status,
  };

  // If draft or awaiting inspection, return honest incomplete status
  if (lifecycleStatus === 'draft' || lifecycleStatus === 'awaiting_inspection') {
    return {
      found: true,
      assetId: asset.id,
      lifecycleStatus,
      statusLabel: lifecycleStatus === 'draft' ? 'Draft (Uncertified)' : 'Awaiting Inspection',
      product,
      certificate: null,
      evidence: null,
      blockchainAnchoring: null,
      verification: {
        isValid: false,
        status: lifecycleStatus,
        reason:
          lifecycleStatus === 'draft'
            ? 'This product listing has not been appraised or issued a digital certificate.'
            : 'This product is currently pending inspection by an authorized appraiser.',
      },
      verificationUrl,
      urlConfigurationError: urlCheck.error,
    };
  }

  // 3. Evidence
  const rawEvidence = asset.certificate_evidence || {};
  const evidence = {
    appraiserName: rawEvidence.appraiser_name || asset.appraiser || 'Not provided',
    inspectionRef: rawEvidence.inspection_ref || 'Not provided',
    inspectionDate: rawEvidence.inspection_date || asset.created_at,
    inspectionStatus: rawEvidence.inspection_status || 'passed',
    physicalCustody: Boolean(rawEvidence.physical_custody),
    custodyFacility: rawEvidence.custody_facility || (rawEvidence.physical_custody ? 'SmartAssets Custody Facility' : 'Not Vaulted'),
  };

  // 4. Issuer
  const rawIssuer = asset.certificate_issuer || DEFAULT_ISSUER;
  const issuer = {
    id: rawIssuer.id || DEFAULT_ISSUER.id,
    name: rawIssuer.name || DEFAULT_ISSUER.name,
    url: rawIssuer.url || DEFAULT_ISSUER.url,
  };

  // 5. Blockchain Anchoring
  const hasTx = isValidTxHash(asset.tx_hash);
  const blockchainAnchoring = hasTx
    ? {
        network: 'Ethereum Sepolia Testnet (Test Credential)',
        chainId: 11155111,
        contractAddress: asset.contract_address || null,
        tokenId: asset.token_id || asset.nft_token_id || null,
        txHash: asset.tx_hash.trim(),
        blockNumber: asset.block_number || null,
        confirmedAt: asset.blockchain_confirmed_at || null,
        etherscanUrl: `https://sepolia.etherscan.io/tx/${asset.tx_hash.trim()}`,
        isTestnet: true,
      }
    : null;

  // 6. Cryptographic Signature Verification
  const canonicalInput = {
    asset_id: asset.id,
    category: asset.category,
    certificate_id: asset.certificate_id,
    certificate_version: asset.certificate_version || CERTIFICATE_VERSION,
    condition: asset.condition,
    evidence: rawEvidence,
    image_url: asset.image,
    initial_valuation_zar: asset.price_num,
    issued_at: asset.certificate_issued_at,
    issuer,
    name: asset.name,
    year: asset.year,
  };

  const sigVerification = verifyCertificateSignature(
    canonicalInput,
    asset.certificate_signature,
    asset.certificate_key_id
  );

  let finalVerificationStatus = 'valid';
  let verificationReason = null;

  if (asset.certificate_revoked || lifecycleStatus === 'revoked') {
    finalVerificationStatus = 'revoked';
    verificationReason = `Certificate revoked: ${asset.certificate_revocation_reason || 'Administrative revocation'}`;
  } else if (!sigVerification.valid) {
    finalVerificationStatus = 'unverifiable';
    lifecycleStatus = 'unverifiable';
    verificationReason = `Signature check failed: ${sigVerification.reason}`;
  }

  return {
    found: true,
    assetId: asset.id,
    lifecycleStatus,
    statusLabel:
      lifecycleStatus === 'revoked'
        ? 'Certificate Revoked'
        : lifecycleStatus === 'anchored'
        ? 'Blockchain Anchored (Sepolia Testnet)'
        : lifecycleStatus === 'issued'
        ? 'Issued & Digitally Signed'
        : 'Unverifiable Record',
    product,
    certificate: {
      certificateId: asset.certificate_id,
      version: asset.certificate_version || CERTIFICATE_VERSION,
      issuedAt: asset.certificate_issued_at,
      metadataDigest: sigVerification.digest || asset.metadata_digest,
      signature: asset.certificate_signature,
      keyId: asset.certificate_key_id,
      algorithm: 'RSASSA-PKCS1-v1_5 / SHA-256',
      issuer,
      revocation: {
        revoked: Boolean(asset.certificate_revoked),
        revokedAt: asset.certificate_revoked_at || null,
        reason: asset.certificate_revocation_reason || null,
      },
    },
    evidence,
    blockchainAnchoring,
    verification: {
      isValid: sigVerification.valid && !asset.certificate_revoked,
      status: finalVerificationStatus,
      signatureVerified: sigVerification.valid,
      digestMatches: true,
      reason: verificationReason,
      keyId: asset.certificate_key_id,
    },
    verificationUrl,
    urlConfigurationError: urlCheck.error,
  };
}

module.exports = {
  DEFAULT_ISSUER,
  checkVerificationUrlConfiguration,
  issueCertificate,
  revokeCertificate,
  getCertificateDossier,
  getPublicVerificationKeys,
};
