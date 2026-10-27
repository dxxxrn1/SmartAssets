// ─── HomeScreen ───────────────────────────────────────────────────────────────
// SmartAssets Modern Glassmorphism Theme (Mockup 2025/2026)
// Featuring Luminous Mesh Gradient Canvas, Portfolio Value Card with Wave Curve,
// Smart AI Insight Card, and Curated "Assets worth watching" Marketplace Showcase.

import React, { useState, useCallback, useRef, useEffect } from "react";
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
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { getUserVault } from "../services/api";
import { SCREENS } from "../constants/navigation";
import storage, { STORAGE_KEYS } from "../utils/storage";

// ── Currency Formatter (British Pounds £ as in design mockups) ────────────────
const formatGBP = (val, fallback = "£1,296,700") => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "string" && val.startsWith("£")) return val;
  if (typeof val === "string" && val.startsWith("R")) {
    return "£" + val.replace(/^R\s?/, "");
  }
  const num =
    typeof val === "number"
      ? val
      : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return String(val);
  return "£" + num.toLocaleString("en-GB", { maximumFractionDigits: 0 });
};

// ── Curated "Assets worth watching" Mockup Data ──────────────────────────────
const CURATED_ASSETS = [
  {
    id: "curated-1",
    category: "WATCHES",
    filterId: "watches",
    name: "Rolex Daytona 116500LN",
    price: "£34,500",
    gain: "+12.4%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&q=80",
    confidence: "96% confidence",
  },
  {
    id: "curated-2",
    category: "ART",
    filterId: "art",
    name: "Untitled, 1984",
    price: "£124,000",
    gain: "+6.8%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&q=80",
    confidence: "91% confidence",
  },
  {
    id: "curated-3",
    category: "CARS",
    filterId: "cars",
    name: "1967 Ferrari 330 GTC",
    price: "£890,000",
    gain: "+9.1%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&q=80",
    confidence: "94% confidence",
  },
  {
    id: "curated-4",
    category: "WINE",
    filterId: "wine",
    name: "Romanée-Conti Grand Cru 1990",
    price: "£28,900",
    gain: "+14.2%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&q=80",
    confidence: "95% confidence",
  },
];

const FILTER_PILLS = [
  { id: "all", label: "All assets" },
  { id: "watches", label: "Watches" },
  { id: "art", label: "Art" },
  { id: "cars", label: "Cars" },
  { id: "wine", label: "Wine" },
];

// ── Smooth Sine-Wave Line Component (Web SVG or Native line segments) ────────
const PortfolioWaveGraph = () => {
  if (Platform.OS === "web") {
    return (
      <View style={styles.waveContainer}>
        <svg
          viewBox="0 0 420 64"
          preserveAspectRatio="none"
          style={{ width: "100%", height: 52, overflow: "visible" }}
        >
          <path
            d="M 0,38 C 50,14 85,54 140,42 C 190,28 230,50 285,24 C 335,8 370,26 420,18"
            fill="none"
            stroke="rgba(255, 255, 255, 0.95)"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>
      </View>
    );
  }

  // Cross-platform native fallback using connected smooth curve segments
  return (
    <View style={styles.waveContainerNative}>
      <View style={styles.waveTrackNative}>
        <View style={[styles.waveDot, { left: "0%", top: 28 }]} />
        <View style={[styles.waveDot, { left: "15%", top: 12 }]} />
        <View style={[styles.waveDot, { left: "30%", top: 38 }]} />
        <View style={[styles.waveDot, { left: "50%", top: 24 }]} />
        <View style={[styles.waveDot, { left: "70%", top: 34 }]} />
        <View style={[styles.waveDot, { left: "85%", top: 10 }]} />
        <View style={[styles.waveDot, { left: "100%", top: 16 }]} />
        <View style={styles.waveLineNative} />
      </View>
    </View>
  );
};

export default function HomeScreen({ navigation }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 840;
  const { user, token } = useAuth();

  const [activeFilter, setActiveFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingVault, setLoadingVault] = useState(true);
  const [vaultSummary, setVaultSummary] = useState({
    totalValueFormatted: "£1,296,700",
    portfolioValueFormatted: "£1,296,700",
    portfolioValueNum: 1296700,
    totalCount: 12,
    categoriesCount: 4,
    verifiedPct: 96,
    annualGainFormatted: "£100,320 this year",
    gainPct: "↑ 8.4%",
  });
  const [vaultHoldings, setVaultHoldings] = useState([]);

  // Fetch Vault Data
  const loadVaultData = useCallback(async () => {
    // 1. Immediately restore cached data
    try {
      const cached = await storage.getJSON(STORAGE_KEYS.VAULT);
      if (cached?.summary) {
        setVaultSummary((prev) => ({
          ...prev,
          portfolioValueFormatted:
            formatGBP(cached.summary.portfolioValueFormatted) ||
            prev.portfolioValueFormatted,
          totalCount: cached.summary.totalCount || prev.totalCount,
        }));
      }
      if (cached?.holdings && Array.isArray(cached.holdings)) {
        setVaultHoldings(cached.holdings);
      }
    } catch (_) {}

    // 2. Fetch live if token available
    if (!token) {
      setLoadingVault(false);
      return;
    }

    try {
      setLoadingVault(true);
      const res = await getUserVault(token);
      if (res?.summary) {
        setVaultSummary((prev) => ({
          ...prev,
          portfolioValueFormatted:
            formatGBP(res.summary.portfolioValueFormatted) ||
            prev.portfolioValueFormatted,
          totalCount: res.summary.totalCount || prev.totalCount,
        }));
      }
      if (res?.holdings && Array.isArray(res.holdings)) {
        setVaultHoldings(res.holdings);
      }
      await storage.setJSON(STORAGE_KEYS.VAULT, {
        summary: res?.summary,
        holdings: res?.holdings,
      });
    } catch (err) {
      console.warn("[HomeScreen] Vault load fallback:", err.message);
    } finally {
      setLoadingVault(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadVaultData();
    }, [loadVaultData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadVaultData();
  };

  // Derive user display name
  const userName =
    user?.firstName ||
    user?.fullName?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "James";

  const userInitials = (
    user?.fullName
      ? user.fullName
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
      : "JH"
  ).toUpperCase();

  // Combine curated mockup assets with live user assets if filtered
  const filteredCurated = CURATED_ASSETS.filter((item) => {
    if (activeFilter === "all") return true;
    return item.filterId === activeFilter;
  });

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      {/* ── Background Mesh Gradient ─────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient
          colors={[
            "hsla(244, 100%, 94%, 1.00)",
            "#d5cdffff",
            "#fae3f4ff",
            "#fff0e6ff",
            "#FFF7EF",
          ]}
          locations={[0, 0.2, 0.5, 0.8, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#976af0"
            colors={["#976af0", "#00fbff"]}
          />
        }
      >
        {/* ── TOP APP BAR / BRAND HEADER ───────────────────────────────────────── */}
        <View style={styles.appBar}>
          {/* Logo & Brand Name */}
          <View style={styles.brandGroup}>
            <LinearGradient
              colors={["#976af0", "#00fbff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoBadge}
            >
              <Ionicons name="diamond" size={17} color="#FFFFFF" />
            </LinearGradient>
            <Text style={styles.brandTitle}>SmartAssets</Text>
          </View>

          {/* Right: User Pill + Add Asset Button */}
          <View style={styles.appBarRight}>
            <TouchableOpacity
              style={styles.userPill}
              onPress={() => navigation.navigate(SCREENS.PROFILE)}
              activeOpacity={0.8}
            >
              <View style={styles.initialsCircle}>
                <Text style={styles.initialsText}>{userInitials}</Text>
              </View>
              <Text style={styles.userPillName} numberOfLines={1}>
                {userName}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.addAssetBtn}
              onPress={() => navigation.navigate(SCREENS.LIST_ASSET)}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={16} color="#FFFFFF" style={{ marginRight: 2 }} />
              <Text style={styles.addAssetBtnText}>Add asset</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── GREETING & INSIGHTS BAR ─────────────────────────────────────────── */}
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greetingTitle}>Good morning, {userName}.</Text>
            <Text style={styles.greetingSubtitle}>
              Your collection gained £1,240 while you were away.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.insightsPillBtn}
            onPress={() =>
              Alert.alert(
                "Market Insights",
                "• Watch collection is outperforming benchmark by +18%\n• Contemporary Art demand rising in London\n• Vault security verification is 96% optimal",
              )
            }
            activeOpacity={0.8}
          >
            <Ionicons
              name="notifications-outline"
              size={15}
              color="#0F172A"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.insightsPillText}>3 insights</Text>
          </TouchableOpacity>
        </View>

        {/* ── MAIN SHOWCASE ROW (Portfolio Value + Smart Insight) ──────────────── */}
        <View style={[styles.mainCardsRow, isDesktop && styles.mainCardsRowDesktop]}>
          {/* ══════════════════════════════════════════════════════════════════════
              CARD 1: PORTFOLIO VALUE (Signature Purple-to-Cyan Wallet Gradient)
          ══════════════════════════════════════════════════════════════════════ */}
          <TouchableOpacity
            style={[styles.portfolioCard, isDesktop && styles.portfolioCardDesktop]}
            activeOpacity={0.92}
            onPress={() => navigation.navigate(SCREENS.VAULT)}
          >
            <LinearGradient
              colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.85 }}
              style={styles.portfolioCardGradient}
            >
              {/* Header: Label + Bar Chart Icon */}
              <View style={styles.portfolioHeader}>
                <Text style={styles.portfolioLabel}>PORTFOLIO VALUE</Text>
                <View style={styles.barChartBadge}>
                  <Feather name="bar-chart-2" size={16} color="#FFFFFF" />
                </View>
              </View>

              {/* Big Portfolio Value */}
              <Text style={styles.portfolioValueNumber}>
                {vaultSummary.portfolioValueFormatted || "£1,296,700"}
              </Text>

              {/* Growth Pill & Yearly Gain */}
              <View style={styles.gainRow}>
                <View style={styles.growthPill}>
                  <Text style={styles.growthPillText}>↑ 8.4%</Text>
                </View>
                <Text style={styles.yearlyGainText}>£100,320 this year</Text>
              </View>

              {/* Sine Wave Curve */}
              <PortfolioWaveGraph />

              {/* Bottom 3-Col Stats */}
              <View style={styles.portfolioStatsRow}>
                <View style={styles.portfolioStatCol}>
                  <Text style={styles.statNumber}>{vaultSummary.totalCount || 12}</Text>
                  <Text style={styles.statLabel}>Assets</Text>
                </View>

                <View style={styles.statDivider} />

                <View style={styles.portfolioStatCol}>
                  <Text style={styles.statNumber}>
                    {vaultSummary.categoriesCount || 4}
                  </Text>
                  <Text style={styles.statLabel}>Categories</Text>
                </View>

                <View style={styles.statDivider} />

                <View style={styles.portfolioStatCol}>
                  <Text style={styles.statNumber}>
                    {vaultSummary.verifiedPct || 96}%
                  </Text>
                  <Text style={styles.statLabel}>Verified</Text>
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ══════════════════════════════════════════════════════════════════════
              CARD 2: SMART INSIGHT (Pure White Card with Violet Highlights)
          ══════════════════════════════════════════════════════════════════════ */}
          <View style={[styles.smartInsightCard, isDesktop && styles.smartInsightCardDesktop]}>
            {/* Tag + Timestamp */}
            <View style={styles.smartInsightHeader}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="sparkles"
                  size={14}
                  color="#7C3AED"
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.smartInsightTag}>SMART INSIGHT</Text>
              </View>
              <Text style={styles.smartInsightTime}>Today</Text>
            </View>

            {/* Headline */}
            <Text style={styles.smartInsightHeadline}>
              Your watch collection is outperforming the market.
            </Text>

            {/* Body */}
            <Text style={styles.smartInsightBody}>
              Collector demand is up 18% this quarter. It may be a strong moment
              to rebalance into fine art.
            </Text>

            {/* CTA Button */}
            <TouchableOpacity
              style={styles.exploreCtaBtn}
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
              activeOpacity={0.8}
            >
              <Text style={styles.exploreCtaText}>Explore opportunity</Text>
              <Feather
                name="arrow-right"
                size={14}
                color="#FFFFFF"
                style={{ marginLeft: 6 }}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── CURATED FOR YOU / ASSETS WORTH WATCHING ─────────────────────────── */}
        <View style={styles.curatedSection}>
          <View style={styles.curatedHeaderRow}>
            <View>
              <Text style={styles.curatedTag}>CURATED FOR YOU</Text>
              <Text style={styles.curatedTitle}>Assets worth watching</Text>
            </View>

            {/* Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterPillsContainer}
            >
              {FILTER_PILLS.map((pill) => {
                const isActive = activeFilter === pill.id;
                return (
                  <TouchableOpacity
                    key={pill.id}
                    style={[
                      styles.filterPill,
                      isActive ? styles.filterPillActive : styles.filterPillInactive,
                    ]}
                    onPress={() => setActiveFilter(pill.id)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        isActive
                          ? styles.filterPillTextActive
                          : styles.filterPillTextInactive,
                      ]}
                    >
                      {pill.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Curated Asset Cards (Horizontal Scroll or Grid) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.curatedCardsScroll}
          >
            {filteredCurated.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.curatedCard}
                onPress={() =>
                  navigation.navigate(SCREENS.ASSET_DETAIL, { asset: item })
                }
                activeOpacity={0.88}
              >
                {/* Image Wrap with Frosted Badges */}
                <View style={styles.curatedImgWrap}>
                  <Image
                    source={{ uri: item.image }}
                    style={styles.curatedImg}
                    resizeMode="cover"
                  />
                  {/* Verified Badge */}
                  {item.isVerified && (
                    <LinearGradient
                      colors={["#F2DC87", "#C5A059"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.cardVerifiedBadge}
                    >
                      <Ionicons
                        name="shield-checkmark"
                        size={12}
                        color="#FFFFFF"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.cardVerifiedText}>Verified</Text>
                    </LinearGradient>
                  )}

                  {/* Gain Badge */}
                  <View style={styles.cardGainBadge}>
                    <Text style={styles.cardGainText}>{item.gain}</Text>
                  </View>
                </View>

                {/* Card Info Footer */}
                <View style={styles.curatedCardFooter}>
                  <Text style={styles.curatedCardCat}>{item.category}</Text>
                  <View style={styles.curatedCardDetailsRow}>
                    <Text style={styles.curatedCardName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.curatedCardPrice}>{item.price}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Safe bottom spacer for floating navigation bar */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },

  // ── Top Brand Header ────────────────────────────────────────────────────────
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    marginTop: 4,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  appBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  userPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  initialsCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  initialsText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6D28D9",
  },
  userPillName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  addAssetBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6D28D9",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  addAssetBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // ── Greeting & Insights Row ─────────────────────────────────────────────────
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  greetingTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.6,
  },
  greetingSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 3,
  },
  insightsPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  insightsPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F172A",
  },

  // ── Main Cards Row ──────────────────────────────────────────────────────────
  mainCardsRow: {
    flexDirection: "column",
    gap: 16,
    marginBottom: 28,
  },
  mainCardsRowDesktop: {
    flexDirection: "row",
  },

  // ── Portfolio Value Card ────────────────────────────────────────────────────
  portfolioCard: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },
  portfolioCardDesktop: {
    flex: 1.15,
  },
  portfolioCardGradient: {
    padding: 22,
    position: "relative",
  },
  portfolioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  portfolioLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.85)",
    letterSpacing: 1.2,
  },
  barChartBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  portfolioValueNumber: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.8,
  },
  gainRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 14,
  },
  growthPill: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  growthPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  yearlyGainText: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.9)",
    marginLeft: 8,
  },

  // Wave Graph
  waveContainer: {
    height: 52,
    width: "100%",
    justifyContent: "center",
    marginVertical: 4,
  },
  waveContainerNative: {
    height: 48,
    width: "100%",
    justifyContent: "center",
    marginVertical: 4,
  },
  waveTrackNative: {
    height: 40,
    position: "relative",
    justifyContent: "center",
  },
  waveLineNative: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    borderRadius: 1,
  },
  waveDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },

  // 3-Col Stats
  portfolioStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.18)",
  },
  portfolioStatCol: {
    flex: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  statLabel: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.78)",
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    marginHorizontal: 12,
  },

  // ── Smart Insight Card ──────────────────────────────────────────────────────
  smartInsightCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    borderLeftWidth: 6,
    borderLeftColor: "#C5A059",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
    justifyContent: "space-between",
  },
  smartInsightCardDesktop: {
    flex: 0.85,
  },
  smartInsightHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  smartInsightTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.8,
  },
  smartInsightTime: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "500",
  },
  smartInsightHeadline: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    lineHeight: 24,
    marginBottom: 8,
  },
  smartInsightBody: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 20,
  },
  exploreCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#C5A059",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginTop: 18,
    shadowColor: "#C5A059",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  exploreCtaText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // ── Curated Section ─────────────────────────────────────────────────────────
  curatedSection: {
    marginTop: 6,
  },
  curatedHeaderRow: {
    marginBottom: 16,
  },
  curatedTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 1,
    marginBottom: 2,
  },
  curatedTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  filterPillsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingBottom: 4,
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  filterPillActive: {
    backgroundColor: "#5835F5",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  filterPillInactive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: "600",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
  },
  filterPillTextInactive: {
    color: "#64748B",
  },

  // Curated Cards
  curatedCardsScroll: {
    flexDirection: "row",
    gap: 16,
    paddingBottom: 16,
  },
  curatedCard: {
    width: 280,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  curatedImgWrap: {
    height: 180,
    width: "100%",
    position: "relative",
    backgroundColor: "#F1F5F9",
  },
  curatedImg: {
    width: "100%",
    height: "100%",
  },
  cardVerifiedBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    shadowColor: "#C5A059",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  cardVerifiedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardGainBadge: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardGainText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  curatedCardFooter: {
    padding: 16,
  },
  curatedCardCat: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  curatedCardDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  curatedCardName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    flex: 1,
    marginRight: 8,
  },
  curatedCardPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
});
