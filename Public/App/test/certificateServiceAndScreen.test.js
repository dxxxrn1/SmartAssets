// ─── Digital Certificate & QR Verification Test Suite ────────────────────────
// Tests QR payload construction, PDF content generation, sharing behavior,
// missing product/config data, absent/invalid transaction data, and error handling.

const assert = require("assert");
const {
  isValidTxHash,
  validateAssetId,
  resolveVerificationUrl,
  buildCertificateData,
  generateQrDataUriAsync,
  generateCertificateHtml,
  generateCertificatePdfAsync,
} = require("../src/utils/certificateUtils");

async function runCertificateTests() {
  console.log("\n======================================================");
  console.log("   SMARTASSETS • Digital Certificate Test Suite       ");
  console.log("======================================================");

  // ── TEST 1: QR Payload Construction & Stable Asset ID Binding ──────
  console.log("\n🧪 [TEST 1] Testing QR Payload Construction & Stable Asset ID Binding...");
  {
    const assetId = "ast-rolex-5513-uuid-1234";
    const baseUrl = "https://verify.smartassets.io";
    const result = resolveVerificationUrl(assetId, baseUrl);

    assert.strictEqual(result.isConfigured, true, "Should mark as configured with valid URL");
    assert.strictEqual(
      result.url,
      "https://verify.smartassets.io/verify/ast-rolex-5513-uuid-1234",
      "URL must be based on immutable product asset ID, not merely a transaction hash"
    );
    assert.strictEqual(result.error, null);

    // Trailing slash normalization
    const trailingSlashResult = resolveVerificationUrl(assetId, "https://verify.smartassets.io///");
    assert.strictEqual(
      trailingSlashResult.url,
      "https://verify.smartassets.io/verify/ast-rolex-5513-uuid-1234",
      "Trailing slashes must be stripped cleanly"
    );

    console.log("   ✅ Stable product verification URL correctly constructed from asset ID.");
  }

  // ── TEST 2: Missing Configuration & Safe Fallback (No Fake Domains) ─
  console.log("\n🧪 [TEST 2] Testing Unconfigured Base URL Handling (No Fabricated Domains)...");
  {
    const assetId = "ast-patek-5711";
    
    // Explicit empty / whitespace / missing
    const emptyResult = resolveVerificationUrl(assetId, "");
    assert.strictEqual(emptyResult.isConfigured, false);
    assert.strictEqual(emptyResult.url, null);
    assert.ok(
      emptyResult.error.includes("EXPO_PUBLIC_VERIFICATION_BASE_URL"),
      "Error must inform developer to configure EXPO_PUBLIC_VERIFICATION_BASE_URL"
    );

    const nullResult = resolveVerificationUrl(assetId, null);
    assert.strictEqual(nullResult.isConfigured, false);
    assert.strictEqual(nullResult.url, null);

    // Malformed protocol
    const badProto = resolveVerificationUrl(assetId, "ftp://bad-domain.com");
    assert.strictEqual(badProto.isConfigured, false);
    assert.ok(badProto.error.includes("Must start with https:// or http://"));

    console.log("   ✅ Unconfigured or invalid base URL safely fails closed without inventing domains.");
  }

  // ── TEST 3: Removal of Fabricated Certificate Defaults ─────────────
  console.log("\n🧪 [TEST 3] Testing Removal of Fabricated Data & Default Sanitization...");
  {
    // Pass empty / bare minimum asset record
    const bareAsset = {
      id: "4444-5555-6666-7777",
      name: "Vintage Cartier Tank",
    };

    const certData = buildCertificateData(bareAsset);

    // Verify fabricated defaults are eliminated
    assert.notStrictEqual(certData.tokenId, "#1", "Must not default token ID to #1");
    assert.strictEqual(certData.tokenId, "Not minted", "Missing token ID must display 'Not minted'");

    assert.notStrictEqual(certData.condition, "Grade A+ (Mint)", "Must not default condition to Grade A+ (Mint)");
    assert.strictEqual(certData.condition, "Not provided", "Missing condition must display 'Not provided'");

    assert.notStrictEqual(certData.year, "2019", "Must not default year to 2019");
    assert.strictEqual(certData.year, "Not provided", "Missing year must display 'Not provided'");

    assert.notStrictEqual(certData.appraiser, "SmartAssets Oracle Bureau", "Must not fabricate Oracle Bureau");
    assert.strictEqual(certData.appraiser, "Not provided", "Missing appraiser must display 'Not provided'");

    assert.notStrictEqual(certData.custodian, "London Vault Facility #4", "Must not fabricate London Vault #4");
    assert.strictEqual(certData.custodian, "Not provided", "Missing custodian must display 'Not provided'");

    assert.strictEqual(certData.certId, "SA-44445555", "Deterministic certificate ID generated from real ID");
    assert.strictEqual(certData.vaultStatusLabel, "Digital Authenticity Record", "Unvaulted asset reflects honesty");

    // Real values are preserved when present
    const richAsset = {
      id: "8888-9999",
      name: "1968 Omega Speedmaster",
      condition: "Very Good / Original Patina",
      year: 1968,
      appraiser: "Horological Institute of Geneva",
      custodian: "Geneva FreePort Vault #2",
      badge: "Vault Secured",
      tokenId: "42",
      category: "Watches",
    };

    const richCert = buildCertificateData(richAsset);
    assert.strictEqual(richCert.condition, "Very Good / Original Patina");
    assert.strictEqual(richCert.year, "1968");
    assert.strictEqual(richCert.appraiser, "Horological Institute of Geneva");
    assert.strictEqual(richCert.custodian, "Geneva FreePort Vault #2");
    assert.strictEqual(richCert.tokenId, "#42");
    assert.strictEqual(richCert.category, "WATCHES");
    assert.strictEqual(richCert.vaultStatusLabel, "Physically Vaulted & Inspected");

    console.log("   ✅ Fabricated defaults removed; real attributes preserved truthfully.");
  }

  // ── TEST 4: Absent or Invalid Transaction Data & Etherscan Guard ───
  console.log("\n🧪 [TEST 4] Testing On-Chain Validation & Etherscan Fallback Prevention...");
  {
    // Test 4a: Pseudo-hashes and truncated hashes must be rejected
    assert.strictEqual(isValidTxHash(undefined), false);
    assert.strictEqual(isValidTxHash(null), false);
    assert.strictEqual(isValidTxHash("0x"), false);
    assert.strictEqual(isValidTxHash("0x7a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c"), false, "32-char pseudo-hash rejected");
    assert.strictEqual(isValidTxHash("0x" + "1234-abcd".replace(/-/g, "")), false, "UUID pseudo-hash rejected");
    assert.strictEqual(isValidTxHash("not-a-hash"), false);

    // Test 4b: Genuine 64-hex Ethereum transaction hash
    const validTx = "0x" + "a".repeat(64);
    assert.strictEqual(isValidTxHash(validTx), true, "64-character hex hash accepted");

    // Test 4c: Asset with invalid hash shows off-chain state and null Etherscan link
    const offChainAsset = {
      id: "test-off-chain",
      name: "Rolex Explorer",
      txHash: "0x7a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c", // Fake truncated hash
    };
    const offChainCert = buildCertificateData(offChainAsset);
    assert.strictEqual(offChainCert.isOnChain, false);
    assert.strictEqual(offChainCert.chainProofLabel, "OFF-CHAIN REGISTRY");
    assert.strictEqual(offChainCert.chainProofValue, "No on-chain transaction recorded for this asset");
    assert.strictEqual(offChainCert.etherscanUrl, null, "Etherscan URL must be null for invalid/absent hash");

    // Test 4d: Asset with genuine hash shows Sepolia Anchored and exact tx link
    const onChainAsset = {
      id: "test-on-chain",
      name: "Rolex Explorer",
      txHash: validTx,
      network: "Ethereum Sepolia",
    };
    const onChainCert = buildCertificateData(onChainAsset);
    assert.strictEqual(onChainCert.isOnChain, true);
    assert.strictEqual(onChainCert.chainProofLabel, "SEPOLIA ANCHORED");
    assert.strictEqual(onChainCert.chainProofValue, validTx);
    assert.strictEqual(
      onChainCert.etherscanUrl,
      `https://sepolia.etherscan.io/tx/${validTx}`,
      "Must link directly to exact tx on Sepolia Etherscan"
    );

    console.log("   ✅ Strict validation blocks fake Sepolia claims and prevents generic explorer fallbacks.");
  }

  // ── TEST 5: QR Code Data URI Generation ────────────────────────────
  console.log("\n🧪 [TEST 5] Testing Scannable QR Code Data URI Generation...");
  {
    const testPayload = "https://verify.smartassets.io/verify/asset-uuid-123";
    const qrDataUri = await generateQrDataUriAsync(testPayload);

    assert.ok(typeof qrDataUri === "string", "Must return string");
    assert.ok(qrDataUri.startsWith("data:image/png;base64,"), "Must be PNG base64 data URI");
    assert.ok(qrDataUri.length > 200, "Must contain actual base64 image data");

    // Rejection on empty payload
    await assert.rejects(
      async () => generateQrDataUriAsync(""),
      /Payload is required/,
      "Empty payload must throw"
    );

    console.log("   ✅ Scannable PNG QR code generated successfully.");
  }

  // ── TEST 6: PDF HTML Content & Honest Statements ───────────────────
  console.log("\n🧪 [TEST 6] Testing PDF HTML Content & Non-Misleading Statements...");
  {
    const sampleAsset = {
      id: "c7b5a1e2-3f4a-5b6c-7d8e-9f0a1b2c3d4e",
      name: "1974 Rolex Submariner Ref. 5513",
      category: "Watches",
      condition: "Collector Grade / Unpolished",
      year: 1974,
      appraiser: "Rolex Certified Horologist",
      custodian: "London Secured Vault #1",
      badge: "Vault Secured",
      txHash: "0x" + "b".repeat(64),
    };

    const certData = buildCertificateData(sampleAsset);
    const verificationUrl = "https://verify.smartassets.io/verify/" + sampleAsset.id;
    const qrUri = await generateQrDataUriAsync(verificationUrl);

    const html = generateCertificateHtml(certData, qrUri, verificationUrl);

    assert.ok(html.includes("1974 Rolex Submariner Ref. 5513"), "Must contain product name");
    assert.ok(html.includes(sampleAsset.id), "Must contain stable asset ID");
    assert.ok(html.includes(certData.certId), "Must contain certificate ID");
    assert.ok(html.includes(verificationUrl), "Must contain public verification URL");
    assert.ok(html.includes(qrUri), "Must embed the exact same scannable QR data URI");

    // Critical Requirement 8 Check: NO 'cryptographically signed' claim
    assert.strictEqual(
      html.includes("cryptographically signed"),
      false,
      "Must NOT describe PDF as cryptographically signed without actual cryptographic signing"
    );
    assert.ok(
      html.includes("Official Digital Certificate of Authenticity"),
      "Uses honest, authoritative registry description"
    );

    console.log("   ✅ PDF template contains canonical product attributes and honest wording.");
  }

  // ── TEST 7: PDF Generation Flow via Print Module ───────────────────
  console.log("\n🧪 [TEST 7] Testing PDF Generation Invocation via Expo Print...");
  {
    let printCalledWith = null;
    const mockPrintModule = {
      printToFileAsync: async (options) => {
        printCalledWith = options;
        return { uri: "file:///mock/storage/smartassets_cert.pdf" };
      },
    };

    const certData = buildCertificateData({ id: "ast-test-1", name: "Test Asset" });
    const qrUri = "data:image/png;base64,mock";
    const verificationUrl = "https://verify.smartassets.io/verify/ast-test-1";

    const pdfResult = await generateCertificatePdfAsync(
      certData,
      qrUri,
      verificationUrl,
      mockPrintModule
    );

    assert.strictEqual(pdfResult.uri, "file:///mock/storage/smartassets_cert.pdf");
    assert.ok(printCalledWith, "Print module was called");
    assert.strictEqual(printCalledWith.base64, false);
    assert.ok(printCalledWith.html.includes("Test Asset"));

    console.log("   ✅ PDF generation flow cleanly interfaces with Expo Print.");
  }

  // ── TEST 8: Missing Product ID Validation & Error Handling ─────────
  console.log("\n🧪 [TEST 8] Testing Missing Product ID Validation & Error Handling...");
  {
    assert.strictEqual(validateAssetId(""), false);
    assert.strictEqual(validateAssetId(null), false);
    assert.strictEqual(validateAssetId(undefined), false);
    assert.strictEqual(validateAssetId("   "), false);
    assert.strictEqual(validateAssetId("valid-id-123"), true);

    const invalidResult = resolveVerificationUrl("");
    assert.strictEqual(invalidResult.isConfigured, false);
    assert.strictEqual(invalidResult.error, "Missing or invalid asset ID.");

    console.log("   ✅ Missing product identifier properly intercepted and handled.");
  }

  console.log("\n======================================================");
  console.log("🎉 ALL 8 DIGITAL CERTIFICATE & VERIFICATION TESTS PASSED!");
  console.log("======================================================\n");
}

if (require.main === module) {
  runCertificateTests().catch((err) => {
    console.error("❌ Certificate test suite failed:", err);
    process.exit(1);
  });
}

module.exports = { runCertificateTests };
