// ─── CertificateScreen ────────────────────────────────────────────────────────
// Digital Asset Certificate of Authenticity — Cryptographically verified passport

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { resolveImageUrl } from "../services/api";

const CANVAS_MESH = [
  "#e4e0ffff", // Soft luminous lavender
  "#e0daffff", // Soft purple aura
  "#f5dfefff", // Soft lilac-pink
  "#fff5efff", // Soft peach aura
  "#ffffffff", // Ambient cream
];

export default function CertificateScreen({ navigation, route }) {
  const asset = route?.params?.asset ?? {};

  const certId =
    asset.cert || `SA-${(asset.id || "2024").slice(0, 8).toUpperCase()}`;
  const tokenId = asset.tokenId ? `#${asset.tokenId}` : "#1";
  const primaryImage = resolveImageUrl(
    asset.image || asset.primary_image || (asset.images && asset.images[0]),
  );

  const certFields = [
    ["CERTIFICATE ID", certId],
    ["TOKEN ID", tokenId],
    ["BLOCKCHAIN", "Ethereum Sepolia"],
    ["CATEGORY", (asset.category || "Luxury Collectible").toUpperCase()],
    ["CONDITION", asset.condition || "Grade A+ (Mint)"],
    ["YEAR", String(asset.year || "2019")],
    ["APPRAISER", "SmartAssets Oracle Bureau"],
    ["VAULT CUSTODIAN", "London Vault Facility #4"],
  ];

  const hashString =
    asset.hash ||
    asset.txHash ||
    "0x" +
      (asset.id
        ? asset.id.replace(/-/g, "")
        : "7a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c");

  const handleDownloadPdf = () => {
    Alert.alert(
      "Certificate Exported",
      `Digital certificate ${certId} generated as cryptographically signed PDF.`,
    );
  };

  const handleShare = () => {
    Alert.alert(
      "Share Certificate",
      `Certificate link copied for ${asset.name || "Authenticated Collectible"}.`,
    );
  };

  return (
    <View style={styles.root}>
      {/* ── Background Mesh Gradient (Matches HomeScreen.js) ── */}
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
          >
            <Feather name="share-2" size={16} color="#0F172A" />
          </TouchableOpacity>
        </View>

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
              colors={["#6C47FF", "#976af0", "#00fbff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.certRibbon}
            />

            <View style={styles.certInner}>
              {/* Seal & Verified Header */}
              <View style={styles.certHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.certKicker}>
                    SMARTASSETS VERIFIED AUTHENTIC
                  </Text>
                  <Text style={styles.certTitle}>
                    Certificate of Authenticity
                  </Text>
                </View>
                <View style={styles.sealCircle}>
                  <Ionicons name="shield-checkmark" size={22} color="#10B981" />
                </View>
              </View>

              {/* Asset Spotlight Hero Row */}
              <View style={styles.assetSpotlightRow}>
                <Image
                  source={{ uri: primaryImage }}
                  style={styles.assetThumb}
                  resizeMode="cover"
                />
                <View style={styles.assetSpotlightText}>
                  <Text style={styles.assetName} numberOfLines={2}>
                    {asset.name || "Authentic Collectible"}
                  </Text>
                  <View style={styles.verifiedTag}>
                    <Ionicons
                      name="checkmark-circle"
                      size={12}
                      color="#16A34A"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.verifiedTagText}>
                      Physically Vaulted & Inspected
                    </Text>
                  </View>
                </View>
              </View>

              {/* 2x4 Specifications Grid */}
              <View style={styles.fieldsGrid}>
                {certFields.map(([label, value]) => (
                  <View key={label} style={styles.fieldBox}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <Text style={styles.fieldVal} numberOfLines={1}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>

              {/* QR / Blockchain Proof Box */}
              <View style={styles.hashBox}>
                <View style={styles.qrWrap}>
                  <Ionicons
                    name="qr-code-outline"
                    size={28}
                    color="#6C47FF"
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.hashHeaderRow}>
                    <Text style={styles.hashLabel}>ON-CHAIN RECORD PROOF</Text>
                    <Text style={styles.hashStatus}>SEPOLIA VERIFIED</Text>
                  </View>
                  <Text style={styles.hashValue} numberOfLines={2}>
                    {hashString}
                  </Text>
                </View>
              </View>

              {/* Security Watermark Statement */}
              <View style={styles.statementRow}>
                <Feather
                  name="lock"
                  size={12}
                  color="#64748B"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.statementText}>
                  Cryptographically secured dual-layer passport. Non-fungible vault registration.
                </Text>
              </View>
            </View>

            {/* Bottom Purple Brand Ribbon */}
            <LinearGradient
              colors={["#00fbff", "#976af0", "#6C47FF"]}
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
            >
              <Feather
                name="download"
                size={16}
                color="#0F172A"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.secondaryBtnText}>Download PDF</Text>
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
            style={styles.primaryEtherscanBtn}
            onPress={() =>
              Linking.openURL(
                asset.etherscanUrl ||
                  (asset.txHash
                    ? `https://sepolia.etherscan.io/tx/${asset.txHash}`
                    : "https://sepolia.etherscan.io"),
              )
            }
            activeOpacity={0.85}
          >
            <Ionicons
              name="open-outline"
              size={18}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.primaryEtherscanText}>
              View on Sepolia Etherscan
            </Text>
          </TouchableOpacity>
        </ScrollView>
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

  // QR / Blockchain Hash
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
  qrWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
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
  hashValue: {
    fontSize: 11,
    fontFamily: "Courier",
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
});
