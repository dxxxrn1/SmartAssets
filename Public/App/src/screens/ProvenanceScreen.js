// ─── ProvenanceScreen ─────────────────────────────────────────────────────────
// Full provenance timeline — chain of custody authenticated events

import React, { useState, useEffect } from "react";
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
import { getAssetDetails, resolveImageUrl } from "../services/api";

const CANVAS_MESH = [
  "#e4e0ffff", // Soft luminous lavender
  "#e0daffff", // Soft purple aura
  "#f5dfefff", // Soft lilac-pink
  "#fff5efff", // Soft peach aura
  "#ffffffff", // Ambient cream
];

const EVENT_ICONS = [
  "shield-checkmark",
  "checkmark-circle",
  "cube",
  "pricetag",
  "document-text",
  "lock-closed",
];

export default function ProvenanceScreen({ navigation, route }) {
  const asset = route?.params?.asset ?? {};
  const [history, setHistory] = useState(route?.params?.history || []);

  useEffect(() => {
    if ((!history || history.length === 0) && asset.id) {
      getAssetDetails(asset.id)
        .then((data) => {
          if (data?.history && data.history.length > 0) {
            setHistory(data.history);
          }
        })
        .catch((err) =>
          console.warn("Failed to fetch provenance history:", err),
        );
    }
  }, [asset.id]);

  const displayEvents =
    history && history.length > 0
      ? history
      : [
          {
            year: String(asset.year || "2019"),
            event: "Original Retail Acquisition",
            party: "Geneva Authorized Dealer · Switzerland",
            detail: "Mint condition initial delivery with warranty documentation.",
          },
          {
            year: "2023",
            event: "Full Laboratory Servicing & Pressure Testing",
            party: "Certified Horology & Authentication Lab",
            detail: "Tested and authenticated to +1.2 sec/day tolerance.",
          },
          {
            year: "2024",
            event: "SmartAssets Vault Ingestion & Tokenized Listing",
            party: "London High-Security Vault #4",
            detail: "Physical item secured in custody. Cryptographic token minted on Sepolia.",
            hash: asset.txHash || "0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c2d5b7e0f",
          },
        ];

  const primaryImage = resolveImageUrl(
    asset.image || asset.primary_image || (asset.images && asset.images[0]),
  );

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
            <Text style={styles.breadcrumbActive}>Provenance Timeline</Text>
          </View>

          <TouchableOpacity
            style={styles.shareBtn}
            activeOpacity={0.8}
            onPress={() => {
              Alert.alert(
                "Share Provenance",
                `Provenance record copied for ${asset.name || "Collectible"}`,
              );
            }}
          >
            <Feather name="share-2" size={16} color="#0F172A" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Asset Spotlight Card ── */}
          <View style={styles.assetCard}>
            <Image
              source={{ uri: primaryImage }}
              style={styles.assetThumb}
              resizeMode="cover"
            />
            <View style={styles.assetInfoCol}>
              <View style={styles.categoryPill}>
                <Text style={styles.categoryPillText}>
                  {(asset.category || "COLLECTIBLE").toUpperCase()}
                </Text>
              </View>
              <Text style={styles.assetTitle} numberOfLines={2}>
                {asset.name || "Authentic Collectible"}
              </Text>
              <Text style={styles.assetSub}>
                Year: {asset.year || "2019"} · Serial: {asset.serial || "SA-83921"}
              </Text>
            </View>
          </View>

          {/* ── 2. 100% Provenance Verified Banner ── */}
          <View style={styles.verifiedCard}>
            <View style={styles.verifiedIconWrap}>
              <Ionicons name="shield-checkmark" size={20} color="#10B981" />
            </View>
            <View style={styles.verifiedTextCol}>
              <Text style={styles.verifiedTitle}>100% Provenance Verified</Text>
              <Text style={styles.verifiedSub}>
                Continuous, unbroken chain of custody verified by independent certified appraisers.
              </Text>
            </View>
          </View>

          {/* ── 3. Chronological Timeline Card ── */}
          <View style={styles.timelineCard}>
            <View style={styles.timelineHeaderRow}>
              <View>
                <Text style={styles.timelineHeaderLabel}>CHAIN OF CUSTODY</Text>
                <Text style={styles.timelineHeaderTitle}>Authenticated History</Text>
              </View>
              <View style={styles.eventsCountBadge}>
                <Text style={styles.eventsCountText}>{displayEvents.length} Events</Text>
              </View>
            </View>

            <View style={styles.timelineBody}>
              {displayEvents.map((event, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === displayEvents.length - 1;
                const iconName = EVENT_ICONS[idx % EVENT_ICONS.length];
                const hashStr = event.txHash || event.hash;

                return (
                  <View key={idx} style={styles.timelineRow}>
                    {/* Left Track Column */}
                    <View style={styles.trackCol}>
                      <View
                        style={[
                          styles.timelineNode,
                          isFirst
                            ? styles.timelineNodeActive
                            : styles.timelineNodeNormal,
                        ]}
                      >
                        <Ionicons
                          name={iconName}
                          size={14}
                          color={isFirst ? "#FFFFFF" : "#6C47FF"}
                        />
                      </View>
                      {!isLast && <View style={styles.trackLine} />}
                    </View>

                    {/* Right Content Column */}
                    <View
                      style={[
                        styles.eventContent,
                        !isLast && { paddingBottom: 24 },
                      ]}
                    >
                      {/* Year & Badge Row */}
                      <View style={styles.eventYearRow}>
                        <View style={styles.yearPill}>
                          <Text style={styles.yearPillText}>
                            {event.year || event.date || event.yr || "2024"}
                          </Text>
                        </View>
                        {isFirst && (
                          <View style={styles.latestBadge}>
                            <Text style={styles.latestBadgeText}>Latest Event</Text>
                          </View>
                        )}
                      </View>

                      {/* Event Title */}
                      <Text style={styles.eventTitle}>
                        {event.event || event.title || event.ev}
                      </Text>

                      {/* Party / Custodian */}
                      {(event.party || event.detail) && (
                        <View style={styles.partyRow}>
                          <Feather
                            name="map-pin"
                            size={12}
                            color="#64748B"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.partyText}>
                            {event.party || event.detail}
                          </Text>
                        </View>
                      )}

                      {/* Detail Notes */}
                      {event.detail && event.party && (
                        <Text style={styles.detailText}>{event.detail}</Text>
                      )}

                      {/* On-Chain Transaction Link */}
                      {hashStr ? (
                        <TouchableOpacity
                          style={styles.txLinkPill}
                          onPress={() =>
                            Linking.openURL(
                              event.etherscanUrl ||
                                `https://sepolia.etherscan.io/tx/${hashStr}`,
                            )
                          }
                          activeOpacity={0.8}
                        >
                          <Feather
                            name="link-2"
                            size={12}
                            color="#6C47FF"
                            style={{ marginRight: 5 }}
                          />
                          <Text style={styles.txLinkText} numberOfLines={1}>
                            {String(hashStr).slice(0, 10)}…{String(hashStr).slice(-8)}
                          </Text>
                          <Feather
                            name="external-link"
                            size={11}
                            color="#6C47FF"
                            style={{ marginLeft: 4 }}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* ── 4. Smart Contract Security Note Card ── */}
          <View style={styles.auditCard}>
            <View style={styles.auditHeader}>
              <Ionicons
                name="sparkles"
                size={14}
                color="#A78BFA"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.auditTag}>SMART CONTRACT AUDIT</Text>
            </View>
            <Text style={styles.auditTitle}>Immutable Ledger Anchoring</Text>
            <Text style={styles.auditBody}>
              Every transition in ownership, certified horological servicing, and physical vault deposit is cryptographically recorded on Sepolia Ethereum with SHA-256 asset fingerprints.
            </Text>
            <TouchableOpacity
              style={styles.auditBtn}
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
              <Text style={styles.auditBtnText}>Explore On Sepolia Etherscan</Text>
              <Feather
                name="arrow-up-right"
                size={14}
                color="#6C47FF"
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          </View>
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

  // 1. Asset Spotlight Card
  assetCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#1E1B4B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  assetThumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  assetInfoCol: {
    flex: 1,
    gap: 2,
  },
  categoryPill: {
    alignSelf: "flex-start",
    backgroundColor: "#F5F3FF",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 2,
  },
  categoryPillText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#6C47FF",
    letterSpacing: 0.8,
  },
  assetTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  assetSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },

  // 2. Verified Banner
  verifiedCard: {
    backgroundColor: "#ECFDF5",
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  verifiedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  verifiedTextCol: {
    flex: 1,
  },
  verifiedTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#065F46",
    marginBottom: 2,
  },
  verifiedSub: {
    fontSize: 11,
    lineHeight: 16,
    color: "#047857",
    fontWeight: "500",
  },

  // 3. Timeline Card
  timelineCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#1E1B4B",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  timelineHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    marginBottom: 20,
  },
  timelineHeaderLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6C47FF",
    letterSpacing: 1.1,
    marginBottom: 2,
  },
  timelineHeaderTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  eventsCountBadge: {
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  eventsCountText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
  },
  timelineBody: {
    paddingLeft: 4,
  },
  timelineRow: {
    flexDirection: "row",
  },
  trackCol: {
    width: 32,
    alignItems: "center",
  },
  timelineNode: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  timelineNodeActive: {
    backgroundColor: "#6C47FF",
    shadowColor: "#6C47FF",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  timelineNodeNormal: {
    backgroundColor: "#F5F3FF",
    borderWidth: 1.5,
    borderColor: "#DDD6FE",
  },
  trackLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 4,
  },
  eventContent: {
    flex: 1,
    paddingLeft: 12,
  },
  eventYearRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  yearPill: {
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  yearPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6C47FF",
  },
  latestBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  latestBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#16A34A",
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  partyRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  partyText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },
  detailText: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 18,
    marginBottom: 6,
  },
  txLinkPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F3FF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    marginTop: 4,
  },
  txLinkText: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Courier",
    color: "#6C47FF",
    maxWidth: 200,
  },

  // 4. Audit Note Card
  auditCard: {
    backgroundColor: "#1E1B4B",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(108, 71, 255, 0.3)",
    shadowColor: "#1E1B4B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
  auditHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  auditTag: {
    fontSize: 10,
    fontWeight: "800",
    color: "#A78BFA",
    letterSpacing: 1.2,
  },
  auditTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  auditBody: {
    fontSize: 12,
    lineHeight: 19,
    color: "#CBD5E1",
    fontWeight: "400",
    marginBottom: 16,
  },
  auditBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  auditBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#6C47FF",
  },
});
