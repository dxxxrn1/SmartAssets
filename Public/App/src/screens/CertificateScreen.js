// ─── CertificateScreen ────────────────────────────────────────────────────────
// Digital Asset Certificate of Authenticity — Authoritative Asset Record
// Loads durable product records, displays scannable QR verification,
// generates real PDF certificates, and enforces honest on-chain verification.

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Image,
  Alert,
  Share,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import QRCodeSvg from "react-native-qrcode-svg";
import { resolveImageUrl, getAssetDetails, getCertificateDossierApi, getBaseUrl } from "../services/api";
import {
  buildCertificateData,
  resolveVerificationUrl,
  generateQrDataUriAsync,
  generateCertificatePdfAsync,
} from "../utils/certificateUtils";

const CANVAS_MESH = [
  "#e4e0ffff", // Soft luminous lavender
  "#e0daffff", // Soft purple aura
  "#f5dfefff", // Soft lilac-pink
  "#fff5efff", // Soft peach aura
  "#ffffffff", // Ambient cream
];

export default function CertificateScreen({ navigation, route }) {
  const initialAsset = route?.params?.asset || null;
  const targetAssetId =
    route?.params?.assetId ||
    route?.params?.asset?.id ||
    route?.params?.id ||
    null;

  const [assetRecord, setAssetRecord] = useState(initialAsset);
  const [loading, setLoading] = useState(!initialAsset && Boolean(targetAssetId));
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    !targetAssetId ? "Missing Asset Identifier: No product ID was supplied." : null
  );
  const [qrDataUri, setQrDataUri] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  // Authoritative data loading from backend
  const loadAuthoritativeRecord = useCallback(
    async (isRefresh = false) => {
      if (!targetAssetId) return;

      if (isRefresh) {
        setRefreshing(true);
      } else if (!assetRecord) {
        setLoading(true);
      }

      try {
        setErrorMessage(null);
        let loaded = null;

        // 1. Try querying full certificate dossier first
        try {
          const certRes = await getCertificateDossierApi(targetAssetId);
          if (certRes && certRes.success && certRes.dossier && certRes.dossier.found) {
            const d = certRes.dossier;
            loaded = {
              ...(d.product || {}),
              ...(d.certificate || {}),
              certificateLifecycleStatus: d.lifecycleStatus,
              certificateEvidence: d.evidence,
              certificateIssuer: d.certificate?.issuer,
              certificateSignature: d.certificate?.signature,
              certificateKeyId: d.certificate?.keyId,
              certificateVersion: d.certificate?.version,
              certificateIssuedAt: d.certificate?.issuedAt,
              certificateRevoked: d.certificate?.revocation?.revoked,
              certificateRevokedAt: d.certificate?.revocation?.revokedAt,
              certificateRevocationReason: d.certificate?.revocation?.reason,
              contractAddress: d.blockchainAnchoring?.contractAddress,
              tokenId: d.blockchainAnchoring?.tokenId,
              txHash: d.blockchainAnchoring?.txHash,
              metadataDigest: d.certificate?.metadataDigest,
            };
          }
        } catch (_) {}

        // 2. Fall back to standard getAssetDetails
        if (!loaded) {
          const res = await getAssetDetails(targetAssetId);
          if (res && res.success && res.asset) {
            loaded = res.asset;
          } else if (res && res.asset) {
            loaded = res.asset;
          } else {
            throw new Error("Asset record could not be found in the registry.");
          }
        }

        setAssetRecord(loaded);
      } catch (err) {
        console.warn("[CertificateScreen] Authoritative fetch error:", err.message);
        // Only show blocking error if we don't even have initial navigation snapshot
        if (!assetRecord) {
          setErrorMessage(
            err.message || "Failed to load authoritative product certificate."
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [targetAssetId, assetRecord]
  );

  useEffect(() => {
    if (targetAssetId) {
      loadAuthoritativeRecord(false);
    }
  }, [targetAssetId]);

  // Derive verification base URL: explicit env variable first, then fallback to live Render web URL
  const activeVerificationBase = (() => {
    // 1. Explicit environment variable if configured
    if (typeof process !== "undefined" && process.env && process.env.EXPO_PUBLIC_VERIFICATION_BASE_URL) {
      const explicit = process.env.EXPO_PUBLIC_VERIFICATION_BASE_URL.trim();
      // If developer configured a non-localhost domain, honor it
      if (explicit && !explicit.includes("localhost") && !explicit.includes("127.0.0.1")) {
        return explicit;
      }
    }
    // 2. If running in a web browser on a live remote host (e.g., Render)
    if (typeof window !== "undefined" && window.location?.origin) {
      const origin = window.location.origin;
      if (
        !origin.includes("localhost") &&
        !origin.includes("127.0.0.1") &&
        !origin.includes("192.168.") &&
        !origin.includes("10.")
      ) {
        return origin;
      }
    }
    // 3. Fallback to active API host if it's a remote URL
    try {
      const apiBase = typeof getBaseUrl === "function" ? getBaseUrl() : "";
      if (apiBase) {
        const stripped = apiBase.replace(/\/api\/?$/, "");
        if (
          stripped &&
          !stripped.includes("localhost") &&
          !stripped.includes("127.0.0.1") &&
          !stripped.includes("10.0.2.2") &&
          !stripped.includes("192.168.") &&
          !stripped.includes("10.")
        ) {
          return stripped;
        }
      }
    } catch (_) {}
    // 4. Default to authoritative live Render deployment verification URL
    return "https://smartassets.onrender.com";
  })();

  // Build sanitized, authoritative certificate data
  const certData = buildCertificateData(assetRecord || {});
  const { url: verificationUrl, isConfigured: isUrlConfigured, error: configError } =
    resolveVerificationUrl(certData.id || targetAssetId || "", activeVerificationBase);

  // Generate real QR code image data URI whenever verification URL resolves
  useEffect(() => {
    let active = true;
    if (isUrlConfigured && verificationUrl) {
      generateQrDataUriAsync(verificationUrl)
        .then((uri) => {
          if (active) setQrDataUri(uri);
        })
        .catch((err) => {
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[CertificateScreen] QR generation error:", err.message);
          }
          if (active) setQrDataUri(null);
        });
    } else {
      setQrDataUri(null);
    }
    return () => {
      active = false;
    };
  }, [isUrlConfigured, verificationUrl]);

  // Primary image
  const primaryImage = resolveImageUrl(
    certData.image ||
      (certData.rawAsset?.images && certData.rawAsset.images[0]) ||
      null
  );

  // Download PDF handler
  const handleDownloadPdf = async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
      // Ensure we have a QR data URI; generate if missing
      let activeQrUri = qrDataUri;
      if (!activeQrUri && verificationUrl) {
        try {
          activeQrUri = await generateQrDataUriAsync(verificationUrl);
        } catch (_) {}
      }

      const { uri, base64 } = await generateCertificatePdfAsync(
        certData,
        activeQrUri,
        verificationUrl,
        Print,
        Platform.OS === "android"
      );

      if (Platform.OS === "web") {
        Alert.alert(
          "Certificate Ready",
          "The print dialog is open. Choose Save as PDF to download the certificate."
        );
        return;
      }

      let shareUri = uri;
      if (Platform.OS === "android") {
        if (!base64 || !FileSystem.cacheDirectory) {
          throw new Error("Could not prepare a shareable PDF file on this device.");
        }
        const safeCertId = String(certData.certId || "product")
          .replace(/[^a-zA-Z0-9-]/g, "-")
          .slice(0, 48);
        shareUri = `${FileSystem.cacheDirectory}SmartAssets-Certificate-${safeCertId}-${Date.now()}.pdf`;
        await FileSystem.writeAsStringAsync(shareUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(shareUri, {
          UTI: ".pdf",
          mimeType: "application/pdf",
          dialogTitle: `SmartAssets Certificate — ${certData.certId}`,
        });
      } else {
        Alert.alert(
          "Certificate Generated",
          `Digital certificate PDF saved at: ${shareUri}`
        );
      }
    } catch (err) {
      console.error("[CertificateScreen] PDF export failed:", err);
      Alert.alert(
        "Export Failed",
        `Could not generate digital certificate PDF: ${err.message || "Unknown error"}`
      );
    } finally {
      setIsExporting(false);
    }
  };

  // Share link handler
  const handleShare = async () => {
    if (!isUrlConfigured || !verificationUrl) {
      Alert.alert(
        "Verification Link Unavailable",
        configError ||
          "Public verification base URL is not configured. Please set EXPO_PUBLIC_VERIFICATION_BASE_URL in your environment configuration to enable link sharing."
      );
      return;
    }

    try {
      if (Platform.OS === "web") {
        if (typeof window !== "undefined" && window.open) {
          window.open(verificationUrl, "_blank");
        }
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(verificationUrl);
        }
        return;
      }

      const shareResult = await Share.share(
        {
          message: `Verify authenticity of ${certData.name} on the SmartAssets Authoritative Registry:\n${verificationUrl}`,
          url: verificationUrl,
          title: `SmartAssets Certificate — ${certData.name}`,
        },
        {
          dialogTitle: `Share Certificate for ${certData.name}`,
        }
      );

      if (shareResult.action === Share.sharedAction) {
        // Shared successfully
      }
    } catch (err) {
      try {
        await Linking.openURL(verificationUrl);
      } catch (_) {
        Alert.alert("Share Failed", err.message || "Could not share certificate link.");
      }
    }
  };

  // Etherscan CTA handler
  const handleEtherscanPress = () => {
    if (certData.isOnChain && certData.etherscanUrl) {
      Linking.openURL(certData.etherscanUrl).catch(() => {
        Alert.alert("Navigation Error", "Could not open Sepolia Etherscan link.");
      });
    } else {
      Alert.alert(
        "Off-Chain Registry Record",
        "This asset is recorded and authenticated directly in the SmartAssets Custodial Ledger. It has not been minted or transferred on Ethereum Sepolia."
      );
    }
  };

  return (
    <View style={styles.root}>
      {/* ── Background Mesh Gradient ── */}
      <LinearGradient
        colors={CANVAS_MESH}
        locations={[0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
        {/* ── Top Header Bar / Breadcrumb ── */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={18} color="#0F172A" />
          </TouchableOpacity>

          <View style={styles.breadcrumbWrap}>
            <Text style={styles.breadcrumbMuted}>Marketplace</Text>
            <Feather
              name="chevron-right"
              size={13}
              color="#94A3B8"
              style={{ marginHorizontal: 4 }}
            />
            <Text style={styles.breadcrumbActive}>Digital Certificate</Text>
          </View>

          <TouchableOpacity
            style={styles.shareBtn}
            activeOpacity={0.8}
            onPress={handleShare}
            accessibilityLabel="Share certificate link"
          >
            <Feather name="share-2" size={16} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* ── Loading State ── */}
        {loading && !assetRecord ? (
          <View style={styles.stateCenterContainer}>
            <ActivityIndicator size="large" color="#6C47FF" />
            <Text style={styles.stateTitle}>Loading Authoritative Record</Text>
            <Text style={styles.stateSubtitle}>
              Querying durable product specifications and provenance history...
            </Text>
          </View>
        ) : errorMessage && !assetRecord ? (
          /* ── Error / Missing ID State ── */
          <View style={styles.stateCenterContainer}>
            <View style={styles.errorIconWrap}>
              <Feather name="alert-triangle" size={28} color="#DC2626" />
            </View>
            <Text style={styles.stateTitle}>Certificate Unavailable</Text>
            <Text style={styles.stateSubtitle}>{errorMessage}</Text>
            {targetAssetId ? (
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => loadAuthoritativeRecord(true)}
              >
                <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.retryBtnText}>Retry Connection</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.retryBtnText}>Go Back</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ══════════════════════════════════════════════════════════════════════
                AUTHENTICITY CERTIFICATE CARD (Physical Passport Style)
            ══════════════════════════════════════════════════════════════════════ */}
            <View style={styles.certCard}>
              {/* Top Purple Brand Ribbon */}
              <LinearGradient
                colors={
                  certData.isRevoked
                    ? ["#E11D48", "#F43F5E"]
                    : certData.isCertified
                    ? ["#6C47FF", "#976af0", "#00fbff"]
                    : ["#F59E0B", "#FCD34D"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.certRibbon}
              />

              <View style={styles.certInner}>
                {/* Seal & Verified Header */}
                <View style={styles.certHeader}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.certKicker,
                        certData.isRevoked && { color: "#E11D48" },
                        !certData.isCertified && !certData.isRevoked && { color: "#B45309" },
                      ]}
                    >
                      {certData.isRevoked
                        ? "STATUS: FORMALLY REVOKED"
                        : certData.isCertified
                        ? "SMARTASSETS VERIFIED CANONICAL"
                        : "SMARTASSETS DRAFT DOSSIER"}
                    </Text>
                    <Text style={styles.certTitle}>
                      {certData.isRevoked
                        ? "Certificate Revoked"
                        : certData.isCertified
                        ? "Certificate of Authenticity"
                        : "Product Dossier (Uncertified)"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.sealCircle,
                      certData.isRevoked && { backgroundColor: "#FFF1F2", borderColor: "#FECDD3" },
                      !certData.isCertified && !certData.isRevoked && { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
                    ]}
                  >
                    <Ionicons
                      name={
                        certData.isRevoked
                          ? "close-circle"
                          : certData.isCertified
                          ? "shield-checkmark"
                          : "document-text"
                      }
                      size={22}
                      color={
                        certData.isRevoked
                          ? "#E11D48"
                          : certData.isCertified
                          ? "#10B981"
                          : "#B45309"
                      }
                    />
                  </View>
                </View>

                {/* Revoked Banner */}
                {certData.isRevoked ? (
                  <View style={styles.revokedBanner}>
                    <Text style={styles.revokedBannerTitle}>⚠️ CERTIFICATE REVOKED BY ISSUING AUTHORITY</Text>
                    <Text style={styles.revokedBannerText}>
                      Reason: {certData.revocationReason || "Formally revoked by compliance."}
                    </Text>
                  </View>
                ) : null}

                {/* Draft / Uncertified Banner */}
                {!certData.isCertified && !certData.isRevoked ? (
                  <View style={styles.draftBanner}>
                    <Text style={styles.draftBannerTitle}>ℹ️ DRAFT RECORD — NO CERTIFICATE ISSUED</Text>
                    <Text style={styles.draftBannerText}>
                      {certData.statementText}
                    </Text>
                  </View>
                ) : null}

                {/* Asset Spotlight Hero Row */}
                <View style={styles.assetSpotlightRow}>
                  {primaryImage ? (
                    <Image
                      source={{ uri: primaryImage }}
                      style={styles.assetThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.assetThumb, styles.thumbFallback]}>
                      <Feather name="package" size={24} color="#94A3B8" />
                    </View>
                  )}
                  <View style={styles.assetSpotlightText}>
                    <Text style={styles.assetName} numberOfLines={2}>
                      {certData.name}
                    </Text>
                    <View style={styles.verifiedTag}>
                      <Ionicons
                        name={certData.isVaulted ? "shield-checkmark" : "document-text"}
                        size={12}
                        color={certData.isVaulted ? "#16A34A" : "#6C47FF"}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.verifiedTagText,
                          !certData.isVaulted && { color: "#6C47FF" },
                        ]}
                      >
                        {certData.vaultStatusLabel}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 2x4 Specifications Grid */}
                <View style={styles.fieldsGrid}>
                  {certData.certFields.map(([label, value]) => (
                    <View key={label} style={styles.fieldBox}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <Text style={styles.fieldVal} numberOfLines={1}>
                        {value}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* QR / Canonical Product Verification Section */}
                <View style={styles.qrVerificationBox}>
                  <View style={styles.qrHeaderRow}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="qr-code-outline" size={16} color="#6C47FF" />
                      <Text style={styles.qrHeaderTitle}>CANONICAL PRODUCT QR</Text>
                    </View>
                    <Text
                      style={[
                        styles.qrHeaderBadge,
                        !isUrlConfigured && styles.qrHeaderBadgeMuted,
                      ]}
                    >
                      {isUrlConfigured ? "SCANNABLE VERIFICATION" : "UNCONFIGURED"}
                    </Text>
                  </View>

                  <View style={styles.qrBodyRow}>
                    {isUrlConfigured && verificationUrl ? (
                      <View style={styles.qrImageFrame}>
                        <QRCodeSvg value={verificationUrl} size={88} />
                      </View>
                    ) : (
                      <View style={styles.qrImagePlaceholder}>
                        <Feather name="link-2" size={24} color="#94A3B8" />
                        <Text style={styles.qrPlaceholderText}>
                          {isUrlConfigured ? "Generating..." : "Config Required"}
                        </Text>
                      </View>
                    )}

                    <View style={styles.qrTextCol}>
                      <Text style={styles.qrHelpTitle}>
                        {isUrlConfigured
                          ? "Scan to inspect authoritative product dossier"
                          : "Public verification URL not configured"}
                      </Text>
                      <Text style={styles.qrHelpDesc}>
                        {isUrlConfigured
                          ? "Mobile cameras or external scanners open the standalone HTTPS verification record for this asset."
                          : "Set EXPO_PUBLIC_VERIFICATION_BASE_URL to generate the public verification QR and web dossier link."}
                      </Text>
                      {isUrlConfigured && verificationUrl ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <TouchableOpacity
                            style={[styles.urlCopyChip, { flex: 1, marginTop: 0 }]}
                            onPress={handleShare}
                            activeOpacity={0.8}
                          >
                            <Feather name="copy" size={11} color="#6C47FF" style={{ marginRight: 4 }} />
                            <Text style={styles.urlCopyText} numberOfLines={1}>
                              {verificationUrl}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.urlOpenChip}
                            onPress={() => Linking.openURL(verificationUrl).catch(() => {})}
                            activeOpacity={0.8}
                            accessibilityLabel="Open public verification record in browser"
                          >
                            <Feather name="external-link" size={12} color="#6C47FF" />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>

                {/* Canonical Metadata Digest Box (SHA-256) */}
                {certData.metadataDigest ? (
                  <View style={styles.digestBox}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.hashHeaderRow}>
                        <Text style={styles.digestLabel}>CANONICAL METADATA DIGEST</Text>
                        <Text style={styles.digestStatus}>SHA-256 SEALED</Text>
                      </View>
                      <Text style={styles.digestValue} numberOfLines={2} selectable>
                        {certData.metadataDigest}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* On-Chain Record / Registry Proof Box */}
                <View style={styles.hashBox}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.hashHeaderRow}>
                      <Text style={styles.hashLabel}>ON-CHAIN RECORD PROOF</Text>
                      <Text
                        style={[
                          styles.hashStatus,
                          !certData.isOnChain && styles.hashStatusOffChain,
                        ]}
                      >
                        {certData.chainProofLabel}
                      </Text>
                    </View>
                    <Text style={styles.hashValue} numberOfLines={2}>
                      {certData.chainProofValue}
                    </Text>
                  </View>
                </View>

                {/* Security Statement */}
                <View style={styles.statementRow}>
                  <Feather
                    name="lock"
                    size={12}
                    color="#64748B"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.statementText}>
                    {certData.statementText}
                  </Text>
                </View>
              </View>

              {/* Bottom Brand Ribbon */}
              <LinearGradient
                colors={
                  certData.isRevoked
                    ? ["#F43F5E", "#E11D48"]
                    : certData.isCertified
                    ? ["#00fbff", "#976af0", "#6C47FF"]
                    : ["#FCD34D", "#F59E0B"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.certRibbon}
              />
            </View>

            {/* ══════════════════════════════════════════════════════════════════════
                ACTION BUTTONS
            ══════════════════════════════════════════════════════════════════════ */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleDownloadPdf}
                activeOpacity={0.8}
                disabled={isExporting}
              >
                {isExporting ? (
                  <ActivityIndicator size="small" color="#0F172A" style={{ marginRight: 8 }} />
                ) : (
                  <Feather
                    name="download"
                    size={16}
                    color="#0F172A"
                    style={{ marginRight: 8 }}
                  />
                )}
                <Text style={styles.secondaryBtnText}>
                  {isExporting ? "Generating PDF..." : "Download PDF"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleShare}
                activeOpacity={0.8}
              >
                <Feather
                  name="share-2"
                  size={16}
                  color="#0F172A"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.secondaryBtnText}>Share Link</Text>
              </TouchableOpacity>
            </View>

            {/* ── Primary Etherscan CTA ── */}
            <TouchableOpacity
              style={[
                styles.primaryEtherscanBtn,
                !certData.isOnChain && styles.disabledEtherscanBtn,
              ]}
              onPress={handleEtherscanPress}
              activeOpacity={certData.isOnChain ? 0.85 : 0.95}
            >
              <Ionicons
                name={certData.isOnChain ? "open-outline" : "shield-outline"}
                size={18}
                color={certData.isOnChain ? "#FFFFFF" : "#64748B"}
                style={{ marginRight: 8 }}
              />
              <Text
                style={[
                  styles.primaryEtherscanText,
                  !certData.isOnChain && styles.disabledEtherscanText,
                ]}
              >
                {certData.isOnChain
                  ? "View on Sepolia Etherscan"
                  : "On-Chain Explorer Unavailable (Off-chain registry)"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  breadcrumbWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  breadcrumbMuted: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "600",
  },
  breadcrumbActive: {
    fontSize: 13,
    color: "#0F172A",
    fontWeight: "800",
  },
  shareBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },

  // State Center (Loading / Error)
  stateCenterContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  errorIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },
  stateSubtitle: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6C47FF",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Certificate Card
  certCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#1E1B4B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  certRibbon: {
    height: 6,
    width: "100%",
  },
  certInner: {
    padding: 20,
    gap: 18,
  },
  certHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 14,
  },
  certKicker: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C47FF",
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  certTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  sealCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ECFDF5",
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },

  // Asset Spotlight
  assetSpotlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  assetThumb: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
  },
  thumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  assetSpotlightText: {
    flex: 1,
    gap: 4,
  },
  assetName: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  verifiedTag: {
    flexDirection: "row",
    alignItems: "center",
  },
  verifiedTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16A34A",
  },

  // 2x4 Grid
  fieldsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  fieldBox: {
    width: "48%",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94A3B8",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  fieldVal: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },

  // Scannable QR Verification Box
  qrVerificationBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    padding: 14,
    gap: 12,
  },
  qrHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qrHeaderTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C47FF",
    letterSpacing: 0.8,
  },
  qrHeaderBadge: {
    fontSize: 9,
    fontWeight: "800",
    color: "#10B981",
    backgroundColor: "#ECFDF5",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  qrHeaderBadgeMuted: {
    color: "#64748B",
    backgroundColor: "#F1F5F9",
  },
  qrBodyRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  qrImageFrame: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  qrImagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    gap: 4,
  },
  qrPlaceholderText: {
    fontSize: 9,
    color: "#64748B",
    fontWeight: "700",
    textAlign: "center",
  },
  qrTextCol: {
    flex: 1,
    gap: 4,
  },
  qrHelpTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0F172A",
  },
  qrHelpDesc: {
    fontSize: 11,
    color: "#64748B",
    lineHeight: 15,
  },
  urlCopyChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  urlOpenChip: {
    backgroundColor: "#F5F3FF",
    borderWidth: 1,
    borderColor: "#DDD6FE",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  urlCopyText: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#6C47FF",
    flex: 1,
  },

  // Canonical Metadata Digest Box
  digestBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  digestLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#166534",
    letterSpacing: 0.8,
  },
  digestStatus: {
    fontSize: 9,
    fontWeight: "800",
    color: "#15803D",
  },
  digestValue: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#14532D",
    lineHeight: 15,
  },

  // Blockchain Hash / Registry Box
  hashBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F5F3FF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  hashHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hashLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#6C47FF",
    letterSpacing: 0.8,
  },
  hashStatus: {
    fontSize: 9,
    fontWeight: "800",
    color: "#10B981",
  },
  hashStatusOffChain: {
    color: "#64748B",
  },
  hashValue: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "700",
    color: "#1E1B4B",
    marginTop: 2,
  },
  statementRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
  },
  statementText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#64748B",
    textAlign: "center",
  },

  // Action Buttons
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "rgba(226, 232, 240, 0.9)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },

  // Primary Etherscan CTA
  primaryEtherscanBtn: {
    backgroundColor: "#6C47FF",
    borderRadius: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6C47FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryEtherscanText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  disabledEtherscanBtn: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledEtherscanText: {
    color: "#64748B",
    fontWeight: "700",
    fontSize: 13,
  },
  revokedBanner: {
    backgroundColor: "#FFF1F2",
    borderWidth: 1,
    borderColor: "#FECDD3",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  revokedBannerTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#BE123C",
    marginBottom: 4,
  },
  revokedBannerText: {
    fontSize: 11,
    color: "#9F1239",
    lineHeight: 15,
  },
  draftBanner: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  draftBannerTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
    marginBottom: 4,
  },
  draftBannerText: {
    fontSize: 11,
    color: "#B45309",
    lineHeight: 15,
  },
});
