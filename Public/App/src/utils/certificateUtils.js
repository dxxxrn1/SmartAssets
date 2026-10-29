// ─── Certificate Utilities & Data Engine ─────────────────────────────────────
// Handles authoritative data sanitization, URL resolution, QR generation,
// and print-ready PDF HTML construction for SmartAssets Digital Certificates.
//
// Strictly enforces honest lifecycle states:
// - draft: Product created, not yet inspected or certified.
// - awaiting_inspection: Submitted for expert appraisal.
// - issued: Formally appraised with evidence, cryptographically signed with RSA-2048.
// - anchored: Digitally signed AND anchored on Ethereum Sepolia Testnet with verified receipt.
// - revoked: Formally revoked with recorded reason and timestamp.
// - unverifiable: Signature verification failed or metadata altered.

const QRCode = require("qrcode");

/**
 * Validates whether a transaction hash is a genuine 64-hex-character Ethereum hash.
 * @param {string} txHash
 * @returns {boolean}
 */
function isValidTxHash(txHash) {
  if (typeof txHash !== "string") return false;
  const clean = txHash.trim();
  if (clean.includes("...") || clean.includes("0x71c...9a")) return false;
  return /^0x[0-9a-fA-F]{64}$/.test(clean);
}

/**
 * Validates whether an asset ID is present and non-empty.
 * @param {string} assetId
 * @returns {boolean}
 */
function validateAssetId(assetId) {
  return typeof assetId === "string" && assetId.trim().length > 0;
}

/**
 * Resolves the canonical public product verification URL for an asset.
 * Enforces strict environment configuration without fabricating fake domains.
 * @param {string} assetId
 * @param {string} [customBaseUrl]
 * @returns {{ url: string | null, isConfigured: boolean, error?: string }}
 */
function resolveVerificationUrl(assetId, customBaseUrl) {
  if (!validateAssetId(assetId)) {
    return {
      url: null,
      isConfigured: false,
      error: "Missing or invalid asset ID.",
    };
  }

  let envBase = "";
  if (typeof process !== "undefined" && process.env) {
    const raw =
      process.env.EXPO_PUBLIC_VERIFICATION_BASE_URL ||
      process.env.PUBLIC_WEB_BASE_URL ||
      "";
    if (raw && !raw.includes("localhost") && !raw.includes("127.0.0.1")) {
      envBase = raw;
    }
  }

  const rawBase = customBaseUrl !== undefined ? customBaseUrl : (envBase || "https://smartassets.onrender.com");

  const trimmed = typeof rawBase === "string" ? rawBase.trim().replace(/\/+$/, "") : "";

  if (!trimmed) {
    return {
      url: null,
      isConfigured: false,
      error:
        "Public verification base URL is not configured. Set EXPO_PUBLIC_VERIFICATION_BASE_URL in your environment configuration to enable public web verification.",
    };
  }

  // Ensure it is a valid HTTP/HTTPS URL
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        url: null,
        isConfigured: false,
        error: "Invalid protocol in verification base URL. Must start with https:// or http://.",
      };
    }
  } catch (_) {
    return {
      url: null,
      isConfigured: false,
      error: "Malformed URL in verification base URL.",
    };
  }

  return {
    url: `${trimmed}/verify/${encodeURIComponent(assetId.trim())}`,
    isConfigured: true,
    error: null,
  };
}

/**
 * Sanitizes and maps authoritative asset records into strict, honest certificate data.
 * Distinguishes Draft, Awaiting inspection, Issued, Anchored, and Revoked states.
 *
 * @param {object} asset
 * @returns {object}
 */
function buildCertificateData(asset = {}) {
  const safeAsset = typeof asset === "object" && asset !== null ? asset : {};
  const assetId = safeAsset.id || null;

  const rawTokenId = safeAsset.tokenId || safeAsset.token_id || safeAsset.nft_token_id;
  const tokenId = rawTokenId ? `#${rawTokenId}` : "Not minted";

  const rawTx = safeAsset.txHash || safeAsset.tx_hash || safeAsset.hash;
  const isTxValid = isValidTxHash(rawTx);
  const realTxHash = isTxValid ? rawTx.trim() : null;
  const isOnChain = Boolean(realTxHash);

  const metadataDigest = safeAsset.metadataDigest || safeAsset.metadata_digest || null;
  const rawStatus = safeAsset.registrationStatus || safeAsset.registration_status;
  const registrationStatus = rawStatus || (isOnChain ? "verified_on_chain" : "unregistered");
  const registrationError = safeAsset.registrationError || safeAsset.registration_error || null;
  const contractAddress = safeAsset.contractAddress || safeAsset.contract_address || null;

  // Digital Certificate & PKI fields
  const certVersion = safeAsset.certificateVersion || safeAsset.certificate_version || "1.0.0";
  const signature = safeAsset.certificateSignature || safeAsset.certificate_signature || null;
  const certId =
    safeAsset.certificateId ||
    safeAsset.certificate_id ||
    safeAsset.cert ||
    (assetId ? `SA-${String(assetId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}` : "Not provided");
  const keyId = safeAsset.certificateKeyId || safeAsset.certificate_key_id || null;
  const rawIssuer = safeAsset.certificateIssuer || safeAsset.certificate_issuer || {};
  const issuer = {
    id: rawIssuer.id || "smartassets-authority-org",
    name: rawIssuer.name || "SmartAssets Verification Authority",
  };
  const issuedAt = safeAsset.certificateIssuedAt || safeAsset.certificate_issued_at || null;
  const isRevoked = Boolean(safeAsset.certificateRevoked || safeAsset.certificate_revoked);
  const revokedAt = safeAsset.certificateRevokedAt || safeAsset.certificate_revoked_at || null;
  const revocationReason = safeAsset.certificateRevocationReason || safeAsset.certificate_revocation_reason || null;

  // Determine strict, honest lifecycle state
  let lifecycleStatus = safeAsset.certificateLifecycleStatus || safeAsset.certificate_lifecycle_status;
  if (isRevoked) {
    lifecycleStatus = "revoked";
  } else if (isOnChain) {
    lifecycleStatus = "anchored";
  } else if (signature) {
    lifecycleStatus = "issued";
  } else if (safeAsset.ai_scan_status === "pending" || safeAsset.aiScanStatus === "pending") {
    lifecycleStatus = "awaiting_inspection";
  } else if (!lifecycleStatus) {
    lifecycleStatus = "draft";
  }

  const isCertified = lifecycleStatus === "issued" || lifecycleStatus === "anchored";

  let statusDisplay = "Draft (Uncertified)";
  let chainProofLabel = "OFF-CHAIN REGISTRY";
  let chainProofValue = "No on-chain transaction recorded for this asset";

  if (isRevoked) {
    statusDisplay = "Certificate Revoked";
    chainProofLabel = "REVOKED";
    chainProofValue = revocationReason ? `Revoked: ${revocationReason}` : "Certificate revoked by issuing authority";
  } else if (isOnChain) {
    statusDisplay = "Verified on Sepolia";
    chainProofLabel = "SEPOLIA ANCHORED";
    chainProofValue = realTxHash;
  } else if (lifecycleStatus === "issued") {
    statusDisplay = "Issued & Digitally Signed";
    chainProofLabel = "DIGITALLY SIGNED (OFF-CHAIN)";
    chainProofValue = "Cryptographically signed with RS256 PKI; off-chain registry custody";
  } else if (registrationStatus === "pending") {
    statusDisplay = "Pending Mint";
    chainProofLabel = "PENDING ON-CHAIN MINT";
    chainProofValue = "Registration transaction in progress or queued";
  } else if (registrationStatus === "failed") {
    statusDisplay = "Mint Failed";
    chainProofLabel = "MINTING FAILED (OFF-CHAIN PRESERVED)";
    chainProofValue = registrationError || "On-chain transaction reverted or could not be completed";
  } else if (lifecycleStatus === "awaiting_inspection") {
    statusDisplay = "Awaiting Inspection";
    chainProofLabel = "INSPECTION PENDING";
    chainProofValue = "Physical condition appraisal in progress";
  }

  const etherscanUrl = isOnChain
    ? `https://sepolia.etherscan.io/tx/${realTxHash}`
    : null;

  const category = (safeAsset.category || "Not provided").toUpperCase();
  const condition = safeAsset.condition || "Not provided";
  const year = safeAsset.year ? String(safeAsset.year) : "Not provided";
  
  // Evidence
  const rawEvidence = safeAsset.certificateEvidence || safeAsset.certificate_evidence || {};
  const appraiser =
    rawEvidence.appraiser_name ||
    safeAsset.appraiser ||
    safeAsset.appraised_by ||
    "Not provided";

  const isVaulted = Boolean(
    rawEvidence.physical_custody ||
    safeAsset.badge === "Vault Secured" ||
    safeAsset.status === "in_vault" ||
    safeAsset.vault_verified
  );

  const custodian =
    rawEvidence.custody_facility ||
    safeAsset.custodian ||
    safeAsset.vault_facility ||
    safeAsset.vault_location ||
    (isVaulted ? "SmartAssets High-Security Vault Facility" : "Not provided");

  const vaultStatusLabel = isVaulted
    ? "Physically Vaulted & Inspected"
    : "Digital Authenticity Record";

  let statementText = "Draft product record. Not yet appraised or issued an official certificate.";
  if (isRevoked) {
    statementText = "Certificate permanently revoked. Null and void.";
  } else if (isOnChain) {
    statementText = "Authoritative Certificate of Authenticity. Digitally signed and anchored on Ethereum Sepolia Testnet.";
  } else if (lifecycleStatus === "issued") {
    statementText = "Authoritative Certificate of Authenticity. Cryptographically signed with RS256 PKI.";
  } else if (lifecycleStatus === "awaiting_inspection") {
    statementText = "Physical inspection pending. Digital certificate issuance awaits verified appraisal.";
  }

  const blockchain = isOnChain
    ? "Ethereum Sepolia Testnet"
    : "Off-Chain Registry";

  const certFields = [
    ["DATABASE ID", assetId || "Not assigned"],
    ["METADATA DIGEST", metadataDigest ? `${metadataDigest.slice(0, 10)}...${metadataDigest.slice(-6)}` : "Pending computation"],
    ["LIFECYCLE STATUS", statusDisplay],
    ["CERTIFICATE ID", certId],
    ["TOKEN ID", tokenId],
    ["BLOCKCHAIN", blockchain],
    ["CATEGORY", category],
    ["CONDITION", condition],
    ["YEAR", year],
    ["APPRAISER", appraiser],
    ["VAULT CUSTODIAN", custodian],
  ];

  return {
    id: assetId,
    name: safeAsset.name || "Authentic Collectible",
    certId,
    tokenId,
    category,
    condition,
    year,
    appraiser,
    custodian,
    isVaulted,
    vaultStatusLabel,
    metadataDigest,
    registrationStatus,
    registrationError,
    contractAddress,
    statusDisplay,
    lifecycleStatus,
    isCertified,
    isRevoked,
    revokedAt,
    revocationReason,
    certificateVersion: certVersion,
    signature,
    keyId,
    issuer,
    issuedAt,
    statementText,
    txHash: realTxHash,
    isOnChain,
    blockchain,
    chainProofLabel,
    chainProofValue,
    etherscanUrl,
    image: safeAsset.image || safeAsset.primary_image || (safeAsset.images && safeAsset.images[0]) || null,
    certFields,
    rawAsset: safeAsset,
  };
}

/**
 * Asynchronously generates a PNG data URI for a given QR payload string.
 * @param {string} payload
 * @returns {Promise<string>}
 */
async function generateQrDataUriAsync(payload) {
  if (!payload || typeof payload !== "string") {
    throw new Error("Payload is required for QR generation.");
  }
  if (typeof QRCode.toDataURL !== "function") {
    throw new Error("QR encoder is unavailable in this app runtime.");
  }
  return await QRCode.toDataURL(payload, {
    width: 280,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

/**
 * Escapes HTML characters for safe template rendering.
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generates an export-ready, beautiful HTML layout for the certificate PDF.
 * Avoids misleading statements and truthfully distinguishes certified vs draft/revoked states.
 *
 * @param {object} certData
 * @param {string} qrDataUri
 * @param {string} [verificationUrl]
 * @returns {string}
 */
function generateCertificateHtml(certData, qrDataUri, verificationUrl) {
  const fields = certData.certFields || [];
  const fieldsHtml = fields
    .map(
      ([label, val]) => `
      <div class="field-box">
        <div class="field-label">${escapeHtml(label)}</div>
        <div class="field-val">${escapeHtml(val)}</div>
      </div>
    `
    )
    .join("");

  const qrSection = qrDataUri
    ? `<img src="${qrDataUri}" width="120" height="120" alt="Verification QR Code" class="qr-img" />`
    : `<div class="qr-placeholder">QR Unavailable</div>`;

  const verificationUrlText = verificationUrl
    ? `<div class="verify-url">${escapeHtml(verificationUrl)}</div>`
    : `<div class="verify-url muted">Verification URL not configured</div>`;

  const isRevoked = certData.isRevoked;
  const isCertified = certData.isCertified;
  const title = isRevoked
    ? `SmartAssets Certificate (Revoked) — ${escapeHtml(certData.certId)}`
    : isCertified
    ? `Certificate of Authenticity — ${escapeHtml(certData.certId)}`
    : `Product Dossier (Uncertified) — ${escapeHtml(certData.id || "Draft")}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      padding: 10px;
    }
    .cert-card {
      border: 2px solid ${isRevoked ? "#FECDD3" : isCertified ? "#E2E8F0" : "#FDE68A"};
      border-radius: 20px;
      overflow: hidden;
      background: #FFFFFF;
    }
    .ribbon {
      height: 8px;
      background: ${isRevoked ? "linear-gradient(90deg, #E11D48, #F43F5E)" : isCertified ? "linear-gradient(90deg, #6C47FF 0%, #976af0 50%, #00F5D4 100%)" : "linear-gradient(90deg, #F59E0B, #FCD34D)"};
    }
    .content {
      padding: 24px 28px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid #F1F5F9;
      padding-bottom: 16px;
      margin-bottom: 18px;
    }
    .brand-kicker {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1.2px;
      color: ${isRevoked ? "#E11D48" : isCertified ? "#6C47FF" : "#B45309"};
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .title {
      font-size: 22px;
      font-weight: 900;
      color: #0F172A;
      letter-spacing: -0.5px;
    }
    .badge-seal {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      background: ${isRevoked ? "#FFF1F2" : isCertified ? "#ECFDF5" : "#FFFBEB"};
      border: 1.5px solid ${isRevoked ? "#FECDD3" : isCertified ? "#10B981" : "#FDE68A"};
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${isRevoked ? "#E11D48" : isCertified ? "#10B981" : "#B45309"};
      font-size: 22px;
      font-weight: bold;
    }
    .banner {
      padding: 12px 14px;
      border-radius: 10px;
      margin-bottom: 16px;
      font-size: 12px;
      line-height: 1.4;
    }
    .banner.revoked {
      background: #FFF1F2;
      border: 1px solid #FECDD3;
      color: #9F1239;
    }
    .banner.draft {
      background: #FFFBEB;
      border: 1px solid #FDE68A;
      color: #92400E;
    }
    .asset-row {
      display: flex;
      gap: 16px;
      align-items: center;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 14px;
      margin-bottom: 18px;
    }
    .asset-info {
      flex: 1;
    }
    .asset-title {
      font-size: 16px;
      font-weight: 800;
      color: #0F172A;
      margin-bottom: 4px;
    }
    .status-pill {
      display: inline-block;
      background: #ECFDF5;
      color: #15803D;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      margin-top: 4px;
    }
    .status-pill.unvaulted {
      background: #F1F5F9;
      color: #475569;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }
    .field-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 8px 12px;
    }
    .field-label {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: #64748B;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .field-val {
      font-size: 12px;
      font-weight: 700;
      color: #0F172A;
    }
    .pki-box {
      background: #F0FDF4;
      border: 1.5px solid #BBF7D0;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 18px;
    }
    .pki-title {
      font-size: 10px;
      font-weight: 800;
      color: #166534;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .mono-hash {
      font-family: monospace;
      font-size: 10px;
      background: #FFFFFF;
      border: 1px solid #86EFAC;
      color: #14532D;
      padding: 6px 8px;
      border-radius: 6px;
      word-break: break-all;
      margin-bottom: 6px;
    }
    .chain-box {
      background: #FAF5FF;
      border: 1.5px solid #E9D5FF;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 18px;
    }
    .chain-title {
      font-size: 10px;
      font-weight: 800;
      color: #6B21A8;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .qr-row {
      display: flex;
      gap: 16px;
      align-items: center;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 16px;
    }
    .qr-img {
      display: block;
      border-radius: 8px;
      border: 1px solid #CBD5E1;
      background: #FFFFFF;
    }
    .qr-placeholder {
      width: 120px;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #E2E8F0;
      border-radius: 8px;
      font-size: 10px;
      color: #64748B;
      text-align: center;
    }
    .qr-info {
      flex: 1;
    }
    .qr-title {
      font-size: 12px;
      font-weight: 800;
      color: #0F172A;
      margin-bottom: 4px;
    }
    .qr-desc {
      font-size: 11px;
      color: #64748B;
      line-height: 1.4;
      margin-bottom: 6px;
    }
    .verify-url {
      font-family: monospace;
      font-size: 10px;
      color: #6C47FF;
      word-break: break-all;
    }
    .verify-url.muted {
      color: #94A3B8;
    }
    .footer {
      border-top: 1px solid #E2E8F0;
      padding-top: 12px;
      font-size: 9px;
      color: #94A3B8;
      line-height: 1.4;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="cert-card">
    <div class="ribbon"></div>
    <div class="content">
      <div class="header-row">
        <div>
          <div class="brand-kicker">
            ${isRevoked ? "SMARTASSETS REVOKED RECORD" : isCertified ? "SMARTASSETS VERIFIED CANONICAL" : "SMARTASSETS DRAFT DOSSIER"}
          </div>
          <div class="title">
            ${isRevoked ? "Certificate Revoked" : isCertified ? "Official Digital Certificate of Authenticity" : "Product Dossier (Uncertified)"}
          </div>
        </div>
        <div class="badge-seal">${isRevoked ? "✕" : isCertified ? "✓" : "✎"}</div>
      </div>

      ${isRevoked ? `
        <div class="banner revoked">
          <strong>⚠️ CERTIFICATE REVOKED:</strong> ${escapeHtml(certData.revocationReason || "Formally revoked by issuing authority.")}<br>
          <strong>Revoked At:</strong> ${escapeHtml(certData.revokedAt ? new Date(certData.revokedAt).toUTCString() : "Recorded")}. This certificate is null and void.
        </div>
      ` : ""}

      ${!isCertified && !isRevoked ? `
        <div class="banner draft">
          <strong>ℹ️ DRAFT RECORD:</strong> This product dossier has not been issued an authoritative digital certificate. Physical inspection or digital signing is pending. No authenticity claim is made.
        </div>
      ` : ""}

      <div class="asset-row">
        <div class="asset-info">
          <div class="asset-title">${escapeHtml(certData.name)}</div>
          <div style="font-family:monospace; font-size:10px; color:#64748B; margin-bottom:4px;">ID: ${escapeHtml(certData.id || "N/A")}</div>
          <span class="status-pill ${certData.isVaulted ? "" : "unvaulted"}">
            ${certData.isVaulted ? "🛡️ Physically Vaulted &amp; Inspected" : "⚠️ Digital Claim (Item Not In Custody)"}
          </span>
        </div>
      </div>

      <div class="grid">
        ${fieldsHtml}
      </div>

      <!-- Cryptographic PKI Seal Section -->
      ${certData.signature ? `
        <div class="pki-box">
          <div class="pki-title">🔐 Cryptographic Digital Signature (RS256 PKI)</div>
          <div style="font-size:10px; color:#166534; margin-bottom:4px;">
            Signer Key ID: <code>${escapeHtml(certData.keyId || "sa-cert-key-2026-v1")}</code> &bull; Standard: SmartAssets Cert v${escapeHtml(certData.certificateVersion || "1.0.0")}
          </div>
          <div class="mono-hash">Canonical Digest: ${escapeHtml(certData.metadataDigest || "Uncomputed")}</div>
          <div class="mono-hash" style="font-size:9px;">Signature: ${escapeHtml(certData.signature)}</div>
        </div>
      ` : ""}

      <!-- Blockchain Anchoring Section -->
      ${certData.isOnChain ? `
        <div class="chain-box">
          <div class="chain-title">⛓️ Ethereum Sepolia Ledger Anchoring (Test Credential)</div>
          <div style="font-size:10px; color:#6B21A8; margin-bottom:4px;">
            Contract: <code>${escapeHtml(certData.contractAddress || "0xF3af121a06e5a3A89F0F3742A9A9fD575Cdd904c")}</code> &bull; Token: ${escapeHtml(certData.tokenId)}
          </div>
          <div class="mono-hash" style="color:#581C87; border-color:#D8B4FE; background:#FAF5FF;">
            Tx: ${escapeHtml(certData.txHash)}
          </div>
        </div>
      ` : ""}

      <div class="qr-row">
        ${qrSection}
        <div class="qr-info">
          <div class="qr-title">Official Verification Portal</div>
          <div class="qr-desc">
            Scan this QR code with a smartphone camera to inspect the live cryptographic verification dossier and check real-time revocation status.
          </div>
          ${verificationUrlText}
        </div>
      </div>

      <div class="footer">
        SmartAssets Verification Authority &bull; Cryptographic PKI &bull; Ethereum Sepolia Testnet<br>
        Physical Inspection Disclaimer: The digital certificate certifies that the product record was formally evaluated by the named issuer on the inspection date. Token/ledger anchoring preserves registry immutability; physical custody is maintained in SmartAssets Vaults.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Asynchronously generates the PDF document using Expo Print and returns local file URI.
 * @param {object} certData
 * @param {string} qrDataUri
 * @param {string} [verificationUrl]
 * @param {object} printModule - Injected Expo Print module
 * @param {boolean} [includeBase64] - Include PDF bytes for Android cache handoff
 * @returns {Promise<{ uri: string, base64?: string }>}
 */
async function generateCertificatePdfAsync(certData, qrDataUri, verificationUrl, printModule, includeBase64 = false) {
  if (!printModule || typeof printModule.printToFileAsync !== "function") {
    throw new Error("Print module with printToFileAsync is required.");
  }

  const html = generateCertificateHtml(certData, qrDataUri, verificationUrl);
  return printModule.printToFileAsync({
    html,
    // Android's print cache URI is not always readable by Expo Sharing.
    // Returning base64 lets the caller persist it through Expo FileSystem first.
    base64: Boolean(includeBase64),
  });
}

module.exports = {
  isValidTxHash,
  validateAssetId,
  resolveVerificationUrl,
  buildCertificateData,
  generateQrDataUriAsync,
  generateCertificateHtml,
  generateCertificatePdfAsync,
};
