// ─── HomeScreen ───────────────────────────────────────────────────────────────
// Home tab — portfolio card, quick actions, Your Assets list, Browse Categories grid

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { getUserVault } from "../services/api";
import { LinearGradient } from "expo-linear-gradient";

// TILE_WIDTH is now computed inside the component via useWindowDimensions
// to avoid stale values that cause layout jumps and hidden icons on load

// ── Category tiles with real Unsplash product images ──────────────────────────
const CATEGORIES = [
  {
    id: "Luxury Watch",
    label: "Watches",
    color: "#0C2340",
    accent: "#38BDF8",
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=400&q=80",
  },
  {
    id: "Fine Art",
    label: "Fine Art",
    color: "#1E0B3B",
    accent: "#A78BFA",
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&q=80",
  },
  {
    id: "Classic Car",
    label: "Classic Cars",
    color: "#2A0E00",
    accent: "#FB923C",
    image:
      "https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=400&q=80",
  },
  {
    id: "Fine Wine",
    label: "Fine Wine",
    color: "#280614",
    accent: "#F472B6",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80",
  },
  {
    id: "Real Estate",
    label: "Real Estate",
    color: "#071C14",
    accent: "#34D399",
    image:
      "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=400&q=80",
  },
  {
    id: "Collectibles",
    label: "Collectibles",
    color: "#0A1A28",
    accent: "#FBBF24",
    image:
      "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400&q=80",
  },
];

export default function HomeScreen({ navigation, isDark }) {
  const { width: screenWidth } = useWindowDimensions();
  const TILE_WIDTH = (screenWidth - 20 * 2 - 12) / 2;
  const c = useColors(isDark);
  const { user, token, logout } = useAuth();
  const [activeHomeTab, setActiveHomeTab] = useState("Portfolio");
  // ── vault data: holdings from res.holdings, summary from res.summary ──
  const [vaultHoldings, setVaultHoldings] = useState([]);
  const [loadingVault, setLoadingVault] = useState(true);
  const [vaultSummary, setVaultSummary] = useState({
    totalValueFormatted: "R0",
    totalCount: 0,
    wholeCount: 0,
    fractionalCount: 0,
    gainText: "+0.0% MoM",
  });

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      if (token) {
        setLoadingVault(true);
        getUserVault(token)
          .then((res) => {
            if (isMounted) {
              if (res?.summary) setVaultSummary(res.summary);
              // API returns res.holdings (not res.assets) — see VaultScreen
              if (res?.holdings) setVaultHoldings(res.holdings.slice(0, 5));
            }
          })
          .catch((err) => console.warn("Vault fetch error:", err.message))
          .finally(() => {
            if (isMounted) setLoadingVault(false);
          });
      } else {
        setLoadingVault(false);
      }
      return () => {
        isMounted = false;
      };
    }, [token]),
  );

  const handleLogout = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out of SmartAssets?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign Out", style: "destructive", onPress: logout },
      ],
    );
  };

  const formatCategoryLabel = (cat) => {
    if (!cat) return "ASSET";
    const lower = String(cat).toLowerCase();
    if (lower.includes("watch")) return "WATCHES";
    if (lower.includes("art")) return "FINE ART";
    if (lower.includes("car") || lower.includes("vehicle")) return "CARS";
    if (lower.includes("wine")) return "WINE";
    if (lower.includes("real")) return "REAL ESTATE";
    return String(cat).toUpperCase();
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#111827" }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── TOP WHITE-TO-BLUE ISLAND ── */}
        <LinearGradient
          colors={["#FFFFFF", "#F0F8FF", "#a6c2ffff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topWhiteIsland}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.avatarMini}>
                {user?.avatar_url ? (
                  <Image source={{ uri: user.avatar_url }} style={styles.avatarImg} />
                ) : (
                  <Feather name="user" size={16} color="#0F172A" />
                )}
              </View>
              <View>
                <Text style={styles.greeting}>Welcome back,</Text>
                <Text style={styles.username}>
                  {user?.fullName || user?.email?.split("@")[0] || "Member"}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => navigation.navigate(SCREENS.SEARCH)}
              >
                <Feather name="search" size={14} color="#0F172A" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={handleLogout}>
                <Feather name="log-out" size={14} color="#0F172A" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Portfolio Balance Card (gradient stays inside white island) */}
          <View style={styles.portfolioCardContainer}>
            <LinearGradient
              colors={["#60A5FA", "#3B82F6", "#60fa8eff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.portfolioCard}
            >
              <View style={styles.portfolioHeader}>
                <View style={styles.gainBadge}>
                  <Feather name="trending-up" size={11} color="#A7F3D0" />
                  <Text style={styles.gainText}>{vaultSummary.gainText}</Text>
                </View>
                <Text style={styles.cardBrandLabel}>SmartAssets</Text>
              </View>
              <Text style={styles.portfolioLabel}>Portfolio Balance</Text>
              <Text style={styles.portfolioValue}>
                {vaultSummary.totalValueFormatted}
              </Text>
              <View style={styles.cardBottomRow}>
                <View>
                  <Text style={styles.cardChangeLabel}>24h Change</Text>
                  <Text style={styles.cardChangeValue}>
                    +R 68.00 <Text style={styles.cardChangePct}>+4.2%</Text>
                  </Text>
                </View>
                <Ionicons name="shield-checkmark" size={30} color="#F59E0B" />
              </View>
            </LinearGradient>
          </View>

          {/* Quick Actions inside white island */}
          <View style={styles.quickActionsContainer}>
            <View style={styles.quickActionsHeader}>
              <Text style={styles.quickActionsTitle}>Quick Actions</Text>
            </View>
            <View style={styles.quickActionsRow}>
              <LinearGradient colors={["#F3E8FF", "#FCE7F3"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quickActionBox}>
                <TouchableOpacity style={styles.quickActionBtn} activeOpacity={0.8} onPress={() => navigation.navigate(SCREENS.VAULT)}>
                  <View style={styles.quickActionIconCircle}>
                    <Feather name="repeat" size={16} color="#4C1D95" />
                  </View>
                  <Text style={styles.quickActionLabel}>Transfer</Text>
                </TouchableOpacity>
              </LinearGradient>
              
              <LinearGradient colors={["#FFE4E6", "#FFEDD5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quickActionBox}>
                <TouchableOpacity style={styles.quickActionBtn} activeOpacity={0.8} onPress={() => navigation.navigate(SCREENS.VAULT)}>
                  <View style={styles.quickActionIconCircle}>
                    <Ionicons name="card-outline" size={16} color="#B45309" />
                  </View>
                  <Text style={styles.quickActionLabel}>Top Up</Text>
                </TouchableOpacity>
              </LinearGradient>
              
              <LinearGradient colors={["#ECFCCB", "#D1FAE5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quickActionBox}>
                <TouchableOpacity style={styles.quickActionBtn} activeOpacity={0.8} onPress={() => navigation.navigate(SCREENS.VAULT)}>
                  <View style={styles.quickActionIconCircle}>
                    <Feather name="arrow-up-circle" size={16} color="#047857" />
                  </View>
                  <Text style={styles.quickActionLabel}>Payment</Text>
                </TouchableOpacity>
              </LinearGradient>
              
              <LinearGradient colors={["#E0F2FE", "#BAE6FD"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quickActionBox}>
                <TouchableOpacity style={styles.quickActionBtn} activeOpacity={0.8} onPress={() => navigation.navigate(SCREENS.PROFILE)}>
                  <View style={styles.quickActionIconCircle}>
                    <Feather name="user" size={16} color="#0369A1" />
                  </View>
                  <Text style={styles.quickActionLabel}>Profile</Text>
                </TouchableOpacity>
              </LinearGradient>
            </View>
          </View>
        </LinearGradient>
        {/* ── END TOP WHITE-TO-BLUE ISLAND ── */}

        {/* ── DARK BLUE GRADIENT BOTTOM HALF ── */}
        <LinearGradient
          colors={["#a6c2ffff", "#4d73d2ff", "#0F1A2E", "#111827"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.darkBottomHalf}
        >
          {/* ════════════════════════════════════════════
              BROWSE CATEGORIES
          ════════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.sectionTitleDark}>Browse Categories</Text>
              <Text style={styles.sectionSubtitle}>
                Explore what SmartAssets offers
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Feather name="chevron-right" size={13} color="#38BDF8" />
            </TouchableOpacity>
          </View>

          {/* Grid rows — 2 columns */}
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryTile,
                  { backgroundColor: cat.color, width: TILE_WIDTH },
                ]}
                onPress={() =>
                  navigation.navigate(SCREENS.SEARCH, {
                    initialCategory: cat.id,
                  })
                }
                activeOpacity={0.88}
              >
                <Image
                  source={{ uri: cat.image }}
                  style={styles.categoryTileImage}
                  resizeMode="cover"
                />
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.75)"]}
                  start={{ x: 0, y: 0.25 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.categoryTileOverlay}
                >
                  <Text style={styles.categoryTileLabel}>{cat.label}</Text>
                  <View
                    style={[
                      styles.categoryAccentDot,
                      { backgroundColor: cat.accent },
                    ]}
                  />
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>

          {/* ════════════════════════════════════════════
              YOUR ASSETS
          ════════════════════════════════════════════ */}
          <View style={[styles.sectionRow, { marginTop: 28 }]}>
            <View>
              <Text style={styles.sectionTitleDark}>Your Assets</Text>
              <Text style={styles.sectionSubtitle}>
                {vaultSummary.totalCount > 0
                  ? `${vaultSummary.totalCount} holding${vaultSummary.totalCount !== 1 ? "s" : ""} across your portfolio`
                  : "Start building your portfolio"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.VAULT)}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Feather name="chevron-right" size={13} color="#38BDF8" />
            </TouchableOpacity>
          </View>

          {/* Asset list rows */}
          {loadingVault ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color="#38BDF8" />
              <Text style={styles.loadingText}>Loading your holdings…</Text>
            </View>
          ) : vaultHoldings.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyAssetsCard}
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
              activeOpacity={0.85}
            >
              <View style={styles.emptyIconWrap}>
                <Feather name="briefcase" size={20} color="#38BDF8" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyAssetsTitle}>No holdings yet</Text>
                <Text style={styles.emptyAssetsSubtitle}>
                  Browse the marketplace to start investing
                </Text>
              </View>
              <Feather name="chevron-right" size={15} color="#38BDF8" />
            </TouchableOpacity>
          ) : (
            vaultHoldings.map((holding, idx) => (
              <TouchableOpacity
                key={holding.id || idx}
                style={[
                  styles.assetRow,
                  idx === vaultHoldings.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() =>
                  navigation.navigate(SCREENS.ASSET_DETAIL, {
                    asset: {
                      ...holding,
                      priceNum: holding.price_num || 0,
                      owner: user?.fullName || "You",
                      condition: "Mint",
                    },
                  })
                }
                activeOpacity={0.85}
              >
                <View style={styles.assetThumb}>
                  {holding.image ? (
                    <Image
                      source={{ uri: holding.image }}
                      style={styles.assetThumbImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.assetThumbPlaceholder}>
                      <Feather name="box" size={16} color="#38BDF8" />
                    </View>
                  )}
                </View>
                <View style={styles.assetRowMid}>
                  <Text style={styles.assetRowName} numberOfLines={1}>
                    {holding.name}
                  </Text>
                  <Text style={styles.assetRowCat}>
                    {formatCategoryLabel(holding.category)}
                  </Text>
                </View>
                <View style={styles.assetRowRight}>
                  <Text style={styles.assetRowPrice}>
                    {holding.price || "—"}
                  </Text>
                  <View style={styles.gainPill}>
                    <Feather name="trending-up" size={9} color="#34D399" />
                    <Text style={styles.gainPillText}>
                      {holding.gain_pct || "+0%"}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}

          {/* Mid tabs moved to bottom */}
          <View style={[styles.midTabContainer, { marginTop: 24 }]}>
            {["Portfolio", "Watchlist", "Categories"].map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.midTabBtn, activeHomeTab === tab && styles.midTabBtnActive]}
                onPress={() => setActiveHomeTab(tab)}
              >
                <Text style={[styles.midTabText, activeHomeTab === tab && styles.midTabTextActive]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </LinearGradient>
        {/* ── END DARK BLUE GRADIENT BOTTOM HALF ── */}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 32 },

  // ── Top White Island ──
  topWhiteIsland: {
    backgroundColor: "#FFFFFF",
    paddingBottom: 16,
    zIndex: 10,
  },

  topSection: { paddingBottom: 24 }, // kept for compat, unused

  // ── Header — tighter, utility weight ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarMini: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  avatarImg: { width: "100%", height: "100%" },
  greeting: {
    fontSize: 11,
    fontWeight: "500",
    color: "#64748B",
  },
  username: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: "#0F172A",
  },
  // ── Profile avatar circle ──
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },

  // ── Smaller icon buttons ──
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Portfolio Card — Light Blue Gradient container ──
  portfolioCardContainer: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 22,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  portfolioCard: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 22,
    overflow: "hidden",
  },
  portfolioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardBrandLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  gainBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  gainText: { fontSize: 11, fontWeight: "700", color: "#A7F3D0" },
  portfolioLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  portfolioValue: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  // ── Card bottom: 24h change + gold shield ──
  cardBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  cardChangeLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  cardChangeValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardChangePct: {
    fontSize: 12,
    fontWeight: "600",
    color: "#A7F3D0",
  },

  // ── Quick Actions ──
  quickActionsContainer: {
    paddingHorizontal: 8,
    paddingTop: 28,
    paddingBottom: 10,
  },
  quickActionsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  // ── Quick Actions title on white bg ──
  quickActionsTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
  },
  quickActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 0,
  },
  quickActionBox: {
    width: "24%",
    aspectRatio: 1,
    borderRadius: 22,
  },
  quickActionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  quickActionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F172A",
  },

  // ── Dark middle canvas ──
  darkMiddleCanvas: {
    backgroundColor: "#0F1A2E",
    paddingTop: 20,
    paddingBottom: 12,
  },
  midTabContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  midTabBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 999,
  },
  midTabBtnActive: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  midTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  midTabTextActive: {
    color: "#FFFFFF",
  },

  // ── Bottom white sheet ──
  bottomWhiteSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 28,
    paddingBottom: 40,
    minHeight: 400,
  },

  // ── Dark blue gradient bottom half ──
  darkBottomHalf: {
    paddingTop: 20,
    paddingBottom: 40,
    minHeight: 400,
  },

  // ── Profile card (light blue gradient) ──
  profileCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  profileCardAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(56,189,248,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  profileCardName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 3,
  },
  profileCardSub: {
    fontSize: 12,
    color: "rgba(148,163,184,0.9)",
    fontWeight: "400",
  },
  profileCardRight: {
    paddingLeft: 8,
  },

  // ── Section header row ──
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitleDark: {
    fontSize: 15,
    fontWeight: "700",
    color: "#F1F5F9",
    marginBottom: 2,
  },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", color: "#3A5070" },
  viewAllBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  viewAllText: { fontSize: 12, fontWeight: "600", color: "#38BDF8" },

  // ── Your Assets list rows ──
  loadingWrap: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 8,
  },
  loadingText: { color: "#3A5070", fontSize: 12 },

  emptyAssetsCard: {
    marginHorizontal: 20,
    backgroundColor: "#0F1A2E",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1A3055",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#0D2240",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1B4070",
  },
  emptyAssetsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#CBD5E1",
    marginBottom: 2,
  },
  emptyAssetsSubtitle: { fontSize: 11, fontWeight: "400", color: "#3A5070" },

  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  assetThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#0F1A2E",
    borderWidth: 1,
    borderColor: "#1A3055",
  },
  assetThumbImg: { width: "100%", height: "100%" },
  assetThumbPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D2240",
  },
  assetRowMid: { flex: 1 },
  assetRowName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#E2E8F0",
    marginBottom: 3,
  },
  assetRowCat: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#38BDF8",
  },
  assetRowRight: { alignItems: "flex-end", gap: 4 },
  assetRowPrice: { fontSize: 13, fontWeight: "700", color: "#F1F5F9" },
  gainPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(52, 211, 153, 0.1)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  gainPillText: { fontSize: 9.5, fontWeight: "700", color: "#34D399" },

  // ── Browse Categories grid ──
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 8,
  },
  categoryTile: {
    // width is set inline from the TILE_WIDTH computed via useWindowDimensions
    height: 120,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
  },
  categoryTileImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
  },
  categoryTileOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 11,
    paddingBottom: 10,
    paddingTop: 28,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  categoryTileLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  categoryAccentDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginBottom: 2,
  },
});
