// ─── InvestScreen (Fractional Investment Marketplace) ────────────────────────
// SmartAssets Modern Glassmorphism Theme (Mockup 2025/2026)
// Featuring Luminous Mesh Gradient Canvas, Violet-to-Magenta Investment Hero,
// Category Pills, Funding Progress Bars, and Verified Asset Offering Cards.

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { SCREENS } from "../constants/navigation";
import { getMarketAssets, getUserVault } from "../services/api";
import { useAuth } from "../context/AuthContext";
import storage, { STORAGE_KEYS } from "../utils/storage";

// ── Currency Formatter (British Pounds £) ─────────────────────────────────────
const formatGBP = (val, fallback = "£100") => {
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

const FILTER_CATEGORIES = [
  { id: "All", label: "All" },
  { id: "Watches", label: "Watches" },
  { id: "Cars", label: "Cars" },
  { id: "Art", label: "Art" },
  { id: "Wine", label: "Wine" },
  { id: "Real Estate", label: "Real Estate" },
];

// Fallback verified investment offerings with authentic investment metrics
const DEFAULT_OFFERINGS = [
  {
    id: "offering-1",
    name: "Rolex Daytona 116500LN",
    category: "WATCHES",
    filterCat: "Watches",
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&q=80",
    price: "£34,500",
    share_price: "£100",
    total_shares: 345,
    shares_sold: 282,
    funded_pct: 82,
    est_roi: "+12.4% Est. ROI",
    demand: "+18% Demand",
    liquidity: "24 days",
    confidence: "96% confidence",
  },
  {
    id: "offering-2",
    name: "1967 Ferrari 330 GTC",
    category: "CARS",
    filterCat: "Cars",
    image:
      "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&q=80",
    price: "£890,000",
    share_price: "£250",
    total_shares: 3560,
    shares_sold: 2314,
    funded_pct: 65,
    est_roi: "+14.2% Est. ROI",
    demand: "+22% Demand",
    liquidity: "30 days",
    confidence: "94% confidence",
  },
  {
    id: "offering-3",
    name: "Untitled, 1984 (Basquiat)",
    category: "ART",
    filterCat: "Art",
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&q=80",
    price: "£124,000",
    share_price: "£100",
    total_shares: 1240,
    shares_sold: 1100,
    funded_pct: 89,
    est_roi: "+11.5% Est. ROI",
    demand: "+15% Demand",
    liquidity: "18 days",
    confidence: "91% confidence",
  },
  {
    id: "offering-4",
    name: "Domaine de la Romanée-Conti 1990",
    category: "WINE",
    filterCat: "Wine",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&q=80",
    price: "£28,900",
    share_price: "£50",
    total_shares: 578,
    shares_sold: 260,
    funded_pct: 45,
    est_roi: "+9.8% Est. ROI",
    demand: "+12% Demand",
    liquidity: "40 days",
    confidence: "95% confidence",
  },
  {
    id: "offering-5",
    name: "Patek Philippe Nautilus 5711",
    category: "WATCHES",
    filterCat: "Watches",
    image:
      "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&q=80",
    price: "£98,000",
    share_price: "£200",
    total_shares: 490,
    shares_sold: 460,
    funded_pct: 94,
    est_roi: "+15.2% Est. ROI",
    demand: "+26% Demand",
    liquidity: "14 days",
    confidence: "98% confidence",
  },
  {
    id: "offering-6",
    name: "Mayfair Prime Residence",
    category: "REAL ESTATE",
    filterCat: "Real Estate",
    image:
      "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&q=80",
    price: "£1,450,000",
    share_price: "£500",
    total_shares: 2900,
    shares_sold: 1595,
    funded_pct: 55,
    est_roi: "+8.9% Est. ROI",
    demand: "+9% Demand",
    liquidity: "60 days",
    confidence: "93% confidence",
  },
];

export default function InvestScreen({ navigation }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 860;
  const cardWidth = isDesktop
    ? (screenWidth - 36 - 32) / 3
    : (screenWidth - 36 - 16) / 2;

  const { user, token } = useAuth();
  const [activeFilter, setActiveFilter] = useState("All");
  const [offerings, setOfferings] = useState(DEFAULT_OFFERINGS);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userHoldings, setUserHoldings] = useState([]);

  const loadData = useCallback(async () => {
    try {
      const res = await getMarketAssets("All", "");
      if (res?.assets && Array.isArray(res.assets) && res.assets.length > 0) {
        // Map any assets into fractional offering structure
        const mapped = res.assets.map((a, i) => ({
          ...a,
          share_price: a.share_price ? formatGBP(a.share_price) : "£100",
          total_shares: a.shares || a.total_shares || 500,
          shares_sold: a.shares_sold || a.sharesSold || 350,
          funded_pct:
            a.fundedPct || Math.round(Math.min(95, 40 + ((i * 12) % 55))),
          est_roi: a.est_roi || "+11.8% Est. ROI",
          confidence: a.confidence || "95% confidence",
        }));
        setOfferings(mapped);
      } else {
        setOfferings(DEFAULT_OFFERINGS);
      }
    } catch (_) {
      setOfferings(DEFAULT_OFFERINGS);
    }

    if (token) {
      try {
        const vaultRes = await getUserVault(token);
        if (vaultRes?.holdings && Array.isArray(vaultRes.holdings)) {
          setUserHoldings(vaultRes.holdings);
        }
      } catch (_) {}
    }
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Filter offerings
  const filteredOfferings = useMemo(() => {
    if (activeFilter === "All") return offerings;
    const f = activeFilter.toLowerCase();
    return offerings.filter((o) => {
      const c = String(o.category || o.filterCat || "").toLowerCase();
      if (f === "watches") return c.includes("watch");
      if (f === "cars") return c.includes("car") || c.includes("vehicle");
      if (f === "art") return c.includes("art");
      if (f === "wine") return c.includes("wine");
      if (f === "real estate") return c.includes("real");
      return c.includes(f);
    });
  }, [offerings, activeFilter]);

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

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      {/* ── Background Mesh Gradient ─────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient
          colors={[
            "rgba(216, 214, 253, 1)",
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
        {/* ── TOP APP BAR ──────────────────────────────────────────────────────── */}
        <View style={styles.appBar}>
          <TouchableOpacity
            style={styles.brandGroup}
            onPress={() => navigation.navigate(SCREENS.HOME)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#976af0", "#00fbff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoBadge}
            >
              <Ionicons name="diamond" size={17} color="#FFFFFF" />
            </LinearGradient>
            <Text style={styles.brandTitle}>SmartAssets</Text>
          </TouchableOpacity>

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
              <Ionicons
                name="add"
                size={16}
                color="#FFFFFF"
                style={{ marginRight: 2 }}
              />
              <Text style={styles.addAssetBtnText}>Add asset</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            HERO CARD: FRACTIONAL INVEST (Classic Purple-to-Cyan Gradient)
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.heroContainer}>
          <LinearGradient
            colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.85 }}
            style={styles.heroGradient}
          >
            {/* Tag */}
            <View style={styles.heroTagBadge}>
              <Ionicons
                name="trending-up"
                size={12}
                color="#FFFFFF"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.heroTagText}>FRACTIONAL INVEST</Text>
            </View>

            {/* Title */}
            <Text style={styles.heroTitle}>Own a piece of iconic luxury.</Text>
            <Text style={styles.heroSubtitle}>
              Invest in verified watches, classic cars, and fine art from
              £100/share with automated yield distribution.
            </Text>

            {/* Key Metrics Row inside Hero */}
            <View style={styles.heroMetricsRow}>
              <View style={styles.heroMetricCol}>
                <Text style={styles.heroMetricNum}>6</Text>
                <Text style={styles.heroMetricLabel}>Live Rounds</Text>
              </View>
              <View style={styles.heroMetricDivider} />
              <View style={styles.heroMetricCol}>
                <Text style={styles.heroMetricNum}>+12.4%</Text>
                <Text style={styles.heroMetricLabel}>Avg Return</Text>
              </View>
              <View style={styles.heroMetricDivider} />
              <View style={styles.heroMetricCol}>
                <Text style={styles.heroMetricNum}>£100</Text>
                <Text style={styles.heroMetricLabel}>Min Entry</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            OFFERINGS SECTION
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTag}>ACTIVE ROUNDS</Text>
              <Text style={styles.sectionTitle}>
                {filteredOfferings.length} investment opportunities
              </Text>
            </View>

            {/* Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterPillsScroll}
            >
              {FILTER_CATEGORIES.map((tab) => {
                const isActive = activeFilter === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    style={[
                      styles.filterPill,
                      isActive
                        ? styles.filterPillActive
                        : styles.filterPillInactive,
                    ]}
                    onPress={() => setActiveFilter(tab.id)}
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
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Cards Grid */}
          <View style={styles.gridWrap}>
            {filteredOfferings.map((offering) => {
              const formattedPrice = formatGBP(offering.price);
              const sharePrice = formatGBP(offering.share_price, "£100");
              const pct = offering.funded_pct || 75;
              const roi = offering.est_roi || "+12.4% Est. ROI";

              return (
                <TouchableOpacity
                  key={offering.id}
                  style={[styles.offeringCard, { width: cardWidth }]}
                  onPress={() =>
                    navigation.navigate(SCREENS.ASSET_DETAIL, {
                      asset: offering,
                    })
                  }
                  activeOpacity={0.88}
                >
                  {/* Image with Badges */}
                  <View style={styles.cardImgWrap}>
                    <Image
                      source={{ uri: offering.image }}
                      style={styles.cardImg}
                      resizeMode="cover"
                    />
                    {/* Verified Badge */}
                    <View style={styles.verifiedBadge}>
                      <Ionicons
                        name="shield-checkmark"
                        size={11}
                        color="#FFFFFF"
                        style={{ marginRight: 3 }}
                      />
                      <Text style={styles.verifiedText}>Verified</Text>
                    </View>

                    {/* ROI Badge */}
                    <View style={styles.roiBadge}>
                      <Text style={styles.roiText}>{roi}</Text>
                    </View>
                  </View>

                  {/* Body */}
                  <View style={styles.cardBody}>
                    {/* Category & Confidence */}
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardCat}>
                        {String(offering.category || "ASSET").toUpperCase()}
                      </Text>
                      <Text style={styles.cardConfidence}>
                        {offering.confidence || "96% confidence"}
                      </Text>
                    </View>

                    {/* Title */}
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {offering.name}
                    </Text>

                    {/* Funding Progress Bar */}
                    <View style={styles.progressContainer}>
                      <View style={styles.progressHeaderRow}>
                        <Text style={styles.progressLabel}>
                          Funding Progress
                        </Text>
                        <Text style={styles.progressPct}>{pct}%</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <LinearGradient
                          colors={["#976af0", "#00fbff"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[styles.progressFill, { width: `${pct}%` }]}
                        />
                      </View>
                    </View>

                    {/* Valuation & Share Price Row */}
                    <View style={styles.cardBottomRow}>
                      <View>
                        <Text style={styles.metricLabel}>Share Price</Text>
                        <Text style={styles.sharePriceValue}>{sharePrice}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.metricLabel}>Target Valuation</Text>
                        <Text style={styles.targetValuationValue}>
                          {formattedPrice}
                        </Text>
                      </View>
                    </View>

                    {/* Action Button */}
                    <TouchableOpacity
                      style={styles.investActionBtn}
                      onPress={() =>
                        navigation.navigate(SCREENS.ASSET_DETAIL, {
                          asset: offering,
                        })
                      }
                      activeOpacity={0.85}
                    >
                      <Text style={styles.investActionBtnText}>Invest now</Text>
                      <Feather
                        name="arrow-right"
                        size={13}
                        color="#FFFFFF"
                        style={{ marginLeft: 4 }}
                      />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Bottom space */}
        <View style={{ height: 110 }} />
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

  // ── Brand Header ────────────────────────────────────────────────────────────
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

  // ── Hero ────────────────────────────────────────────────────────────────────
  heroContainer: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
    marginBottom: 24,
  },
  heroGradient: {
    paddingVertical: 26,
    paddingHorizontal: 22,
    alignItems: "center",
  },
  heroTagBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 12,
  },
  heroTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.88)",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
    maxWidth: 480,
  },
  heroMetricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 20,
    width: "100%",
  },
  heroMetricCol: {
    flex: 1,
    alignItems: "center",
  },
  heroMetricNum: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  heroMetricLabel: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 2,
  },
  heroMetricDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },

  // ── Offerings Section ───────────────────────────────────────────────────────
  sectionWrap: {
    marginTop: 4,
  },
  sectionHeaderRow: {
    marginBottom: 16,
  },
  sectionTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 1,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  filterPillsScroll: {
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

  // Grid & Cards
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  offeringCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  cardImgWrap: {
    height: 180,
    width: "100%",
    position: "relative",
    backgroundColor: "#F1F5F9",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  verifiedBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  roiBadge: {
    position: "absolute",
    top: 10,
    right: 10,
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
  roiText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },

  // Card Body
  cardBody: {
    padding: 14,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardCat: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.5,
  },
  cardConfidence: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "500",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
    marginBottom: 12,
    minHeight: 40,
  },

  // Progress Bar
  progressContainer: {
    marginBottom: 12,
  },
  progressHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "500",
  },
  progressPct: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6D28D9",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },

  // Bottom stats
  cardBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(241, 245, 249, 0.9)",
    marginBottom: 12,
  },
  metricLabel: {
    fontSize: 11,
    color: "#64748B",
  },
  sharePriceValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 1,
  },
  targetValuationValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
    marginTop: 1,
  },

  // CTA
  investActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5835F5",
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  investActionBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
