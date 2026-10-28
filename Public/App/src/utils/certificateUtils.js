// ─── Certificate Utilities & Data Engine ─────────────────────────────────────
// Handles authoritative data sanitization, URL resolution, QR generation,
// and print-ready PDF HTML construction for SmartAssets Digital Certificates.

const QRCode = require("qrcode");

/**
 * Validates whether a transaction hash is a genuine 64-hex-character Ethereum hash.
 * @param {string} txHash
 * @returns {boolean}
 */
function isValidTxHash(txHash) {
  if (typeof txHash !== "string") return false;
  const clean = txHash.trim();
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

  const rawBase =
    customBaseUrl !== undefined
      ? customBaseUrl
      : (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_VERIFICATION_BASE_URL) || "";

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
        error: "Invalid protocol in EXPO_PUBLIC_VERIFICATION_BASE_URL. Must start with https:// or http://.",
      };
    }
  } catch (_) {
    return {
      url: null,
      isConfigured: false,
      error: "Malformed URL in EXPO_PUBLIC_VERIFICATION_BASE_URL.",
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
 * Replaces fabricated defaults with 'Not provided' or appropriate unverified indicators.
 * @param {object} asset
 * @returns {object}
 */
function buildCertificateData(asset = {}) {
  const safeAsset = typeof asset === "object" && asset !== null ? asset : {};
  const assetId = safeAsset.id || null;

  const certId =
    safeAsset.cert ||
    (assetId ? `SA-${String(assetId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}` : "Not provided");

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

  const blockchain = isOnChain
    ? (safeAsset.network || "Ethereum Sepolia")
    : "Off-Chain Registry";

  let chainProofLabel = "OFF-CHAIN REGISTRY";
  let chainProofValue = "No on-chain transaction recorded for this asset";

  if (isOnChain) {
    chainProofLabel = "SEPOLIA ANCHORED";
    chainProofValue = realTxHash;
  } else if (registrationStatus === "pending") {
    chainProofLabel = "PENDING ON-CHAIN MINT";
    chainProofValue = "Registration transaction in progress or queued";
  } else if (registrationStatus === "failed") {
    chainProofLabel = "MINTING FAILED (OFF-CHAIN PRESERVED)";
    chainProofValue = registrationError || "On-chain transaction reverted or could not be completed";
  }

  const etherscanUrl = isOnChain
    ? `https://sepolia.etherscan.io/tx/${realTxHash}`
    : null;

  const category = (safeAsset.category || "Not provided").toUpperCase();
  const condition = safeAsset.condition || "Not provided";
  const year = safeAsset.year ? String(safeAsset.year) : "Not provided";
  const appraiser = safeAsset.appraiser || safeAsset.appraised_by || "Not provided";
  
  const isVaulted = Boolean(
    safeAsset.badge === "Vault Secured" ||
    safeAsset.status === "in_vault" ||
    safeAsset.vault_verified
  );
  
  const custodian =
    safeAsset.custodian ||
    safeAsset.vault_facility ||
    safeAsset.vault_location ||
    (isVaulted ? "SmartAssets Custody Facility" : "Not provided");

  const vaultStatusLabel = isVaulted
    ? "Physically Vaulted & Inspected"
    : "Digital Authenticity Record";

  let statusDisplay = "Off-Chain Sealed";
  if (registrationStatus === "verified_on_chain") statusDisplay = "Verified on Sepolia";
  else if (registrationStatus === "pending") statusDisplay = "Pending Mint";
  else if (registrationStatus === "failed") statusDisplay = "Mint Failed";

  const certFields = [
    ["DATABASE ID", assetId || "Not assigned"],
    ["METADATA DIGEST", metadataDigest ? `${metadataDigest.slice(0, 10)}...${metadataDigest.slice(-6)}` : "Uncomputed"],
    ["REGISTRATION STATUS", statusDisplay],
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
  return QRCode.toDataURL(payload, {
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
 * Avoids misleading 'cryptographically signed' statements.
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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SmartAssets Certificate of Authenticity — ${escapeHtml(certData.certId)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      padding: 10px;
    }
    .cert-card {
      border: 2px solid #E2E8F0;
      border-radius: 20px;
      overflow: hidden;
      background: #FFFFFF;
    }
    .ribbon {
      height: 8px;
      background: linear-gradient(90deg, #6C47FF 0%, #976af0 50%, #00F5D4 100%);
    }
    .content {
      padding: 28px 32px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid #F1F5F9;
      padding-bottom: 18px;
      margin-bottom: 22px;
    }
    .brand-kicker {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1.2px;
      color: #6C47FF;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .title {
      font-size: 24px;
      font-weight: 900;
      color: #0F172A;
      letter-spacing: -0.5px;
    }
    .badge-seal {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      background: #ECFDF5;
      border: 1.5px solid #10B981;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #10B981;
      font-size: 22px;
      font-weight: bold;
    }
    .asset-row {
      display: flex;
      gap: 18px;
      align-items: center;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 22px;
    }
    .asset-info {
      flex: 1;
    }
    .asset-title {
      font-size: 18px;
      font-weight: 800;
      color: #0F172A;
      margin-bottom: 6px;
    }
    .asset-id-label {
      font-size: 11px;
      color: #64748B;
      font-family: monospace;
    }
    .status-pill {
      display: inline-block;
      background: #ECFDF5;
      color: #15803D;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      margin-top: 6px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 22px;
    }
    .field-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 10px 14px;
    }
    .field-label {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: #64748B;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .field-val {
      font-size: 13px;
      font-weight: 700;
      color: #0F172A;
    }
    .proof-box {
      background: #FAF5FF;
      border: 1.5px solid #E9D5FF;
      border-radius: 14px;
      padding: 14px 18px;
      margin-bottom: 22px;
    }
    .proof-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .proof-title {
      font-size: 11px;
      font-weight: 800;
      color: #6B21A8;
      letter-spacing: 0.8px;
    }
    .proof-badge {
      font-size: 10px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 6px;
      background: #ECFDF5;
      color: #047857;
    }
    .proof-badge.offchain {
      background: #F1F5F9;
      color: #475569;
    }
    .proof-hash {
      font-family: monospace;
      font-size: 11px;
      color: #581C87;
      background: rgba(255,255,255,0.85);
      border: 1px solid #E9D5FF;
      padding: 8px 10px;
      border-radius: 6px;
      word-break: break-all;
    }
    .qr-row {
      display: flex;
      gap: 20px;
      align-items: center;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 20px;
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
      font-size: 11px;
      color: #64748B;
      text-align: center;
    }
    .qr-info {
      flex: 1;
    }
    .qr-title {
      font-size: 13px;
      font-weight: 800;
      color: #0F172A;
      margin-bottom: 4px;
    }
    .qr-desc {
      font-size: 11px;
      color: #64748B;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .verify-url {
      font-family: monospace;
      font-size: 10px;
      color: #6C47FF;
      word-break: break-all;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      padding: 6px 8px;
      border-radius: 6px;
    }
    .verify-url.muted {
      color: #94A3B8;
    }
    .footer-note {
      text-align: center;
      font-size: 10px;
      color: #64748B;
      line-height: 1.5;
      padding-top: 10px;
      border-top: 1px solid #F1F5F9;
    }
  </style>
</head>
<body>
  <div class="cert-card">
    <div class="ribbon"></div>
    <div class="content">
      <div class="header-row">
        <div>
          <div class="brand-kicker">SMARTASSETS OFFICIAL ASSET RECORD</div>
          <div class="title">Certificate of Authenticity</div>
        </div>
        <div class="badge-seal">✓</div>
      </div>

      <div class="asset-row">
        <div class="asset-info">
          <div class="asset-title">${escapeHtml(certData.name)}</div>
          <div class="asset-id-label">STABLE ASSET ID: ${escapeHtml(certData.id || "N/A")}</div>
          <div class="status-pill">${escapeHtml(certData.vaultStatusLabel)}</div>
        </div>
      </div>

      <div class="grid">
        ${fieldsHtml}
      </div>

      ${certData.metadataDigest ? `
      <div class="proof-box" style="background:#F0FDF4; border-color:#BBF7D0; margin-bottom:14px;">
        <div class="proof-header">
          <div class="proof-title" style="color:#166534;">CANONICAL METADATA DIGEST (SHA-256)</div>
          <div class="proof-badge" style="background:#DCFCE7; color:#15803D;">CRYPTOGRAPHIC SEAL</div>
        </div>
        <div class="proof-hash" style="color:#14532D; border-color:#86EFAC;">${escapeHtml(certData.metadataDigest)}</div>
      </div>
      ` : ''}

      <div class="proof-box">
        <div class="proof-header">
          <div class="proof-title">PROVENANCE &amp; REGISTRY RECORD</div>
          <div class="proof-badge ${certData.isOnChain ? "" : "offchain"}">
            ${escapeHtml(certData.chainProofLabel)}
          </div>
        </div>
        <div class="proof-hash">${escapeHtml(certData.chainProofValue)}</div>
      </div>

      <div class="qr-row">
        ${qrSection}
        <div class="qr-info">
          <div class="qr-title">SCAN TO VERIFY CANONICAL RECORD</div>
          <div class="qr-desc">
            Point your mobile camera at this QR code to load the official real-time provenance dossier on the SmartAssets public verification registry.
          </div>
          ${verificationUrlText}
        </div>
      </div>

      <div class="footer-note">
        Official Digital Certificate of Authenticity issued by SmartAssets Registry &bull; Date of Generation: ${new Date().toISOString().split("T")[0]}<br />
        This certificate reflects authoritative records stored in the SmartAssets durable registry. Not a standalone cryptographic token.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates a real PDF file from certificate data using expo-print.
 * @param {object} certData
 * @param {string} qrDataUri
 * @param {string} verificationUrl
 * @param {object} [printModule] - Optional dependency injection for testing
 * @returns {Promise<{ uri: string }>}
 */
async function generateCertificatePdfAsync(certData, qrDataUri, verificationUrl, printModule) {
  const Print = printModule || require("expo-print");
  const html = generateCertificateHtml(certData, qrDataUri, verificationUrl);
  return Print.printToFileAsync({
    html,
    base64: false,
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
