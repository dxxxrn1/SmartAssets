// ─── SearchScreen (Marketplace) ───────────────────────────────────────────────
// SmartAssets Modern Glassmorphism Theme (Mockup 2025/2026)
// Featuring AI-Powered Discovery Hero with Embedded Search, 4-Category Grid Overview,
// and Verified Opportunities Marketplace Cards with AI Confidence & Current Valuations.

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
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
import { getMarketAssets } from "../services/api";
import storage, { STORAGE_KEYS } from "../utils/storage";
import { useAuth } from "../context/AuthContext";

// ── Cache Configuration ───────────────────────────────────────────────────────
let cachedScreenAssets = [];
let lastScreenFetchTime = 0;
const SCREEN_CACHE_TTL = 3 * 60 * 1000; // 3 minutes fresh cache

export function clearSearchScreenCache() {
  cachedScreenAssets = [];
  lastScreenFetchTime = 0;
}

// ── Format Currency in British Pounds £ ───────────────────────────────────────
const formatGBP = (val, fallback = "£34,500") => {
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

// ── Category Overview Data (from Mockup 3) ────────────────────────────────────
const CATEGORY_OVERVIEW = [
  {
    id: "Watches",
    matchKey: "watch",
    title: "Watches",
    count: "428 assets",
    icon: "diamond-outline",
    iconBg: "#EFF6FF",
    iconColor: "#3B82F6",
  },
  {
    id: "Art",
    matchKey: "art",
    title: "Art",
    count: "1,204 assets",
    icon: "color-palette-outline",
    iconBg: "#FFF1F2",
    iconColor: "#F43F5E",
  },
  {
    id: "Cars",
    matchKey: "car",
    title: "Cars",
    count: "316 assets",
    icon: "car-sport-outline",
    iconBg: "#F0FDF4",
    iconColor: "#10B981",
  },
  {
    id: "Wine",
    matchKey: "wine",
    title: "Wine",
    count: "892 assets",
    icon: "wine-outline",
    iconBg: "#FEFCE8",
    iconColor: "#F59E0B",
  },
];

const FILTER_TABS = [
  { id: "All", label: "All" },
  { id: "Watches", label: "Watches" },
  { id: "Art", label: "Art" },
  { id: "Cars", label: "Cars" },
  { id: "Wine", label: "Wine" },
];

// Fallback verified opportunities matching Mockup 3 exactly
const DEFAULT_OPPORTUNITIES = [
  {
    id: "opp-1",
    name: "Rolex Daytona 116500LN",
    category: "WATCHES",
    price: "£34,500",
    confidence: "96% confidence",
    gain: "+12.4%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&q=80",
  },
  {
    id: "opp-2",
    name: "Untitled, 1984",
    category: "ART",
    price: "£124,000",
    confidence: "91% confidence",
    gain: "+6.8%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&q=80",
  },
  {
    id: "opp-3",
    name: "1967 Ferrari 330 GTC",
    category: "CARS",
    price: "£890,000",
    confidence: "94% confidence",
    gain: "+9.1%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&q=80",
  },
  {
    id: "opp-4",
    name: "Patek Philippe Nautilus 5711",
    category: "WATCHES",
    price: "£98,000",
    confidence: "98% confidence",
    gain: "+15.2%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&q=80",
  },
  {
    id: "opp-5",
    name: "Domaine de la Romanée-Conti 1990",
    category: "WINE",
    price: "£28,500",
    confidence: "95% confidence",
    gain: "+11.8%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&q=80",
  },
  {
    id: "opp-6",
    name: "1973 Porsche 911 Carrera RS",
    category: "CARS",
    price: "£450,000",
    confidence: "93% confidence",
    gain: "+8.4%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&q=80",
  },
];

export default function SearchScreen({ navigation, route }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 860;
  const cardWidth = isDesktop ? (screenWidth - 36 - 32) / 3 : (screenWidth - 36 - 16) / 2;

  const { user } = useAuth();
  const initialCat = route?.params?.initialCategory ?? "All";

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(initialCat);
  const [assets, setAssets] = useState(
    cachedScreenAssets.length > 0 ? cachedScreenAssets : DEFAULT_OPPORTUNITIES,
  );
  const [loading, setLoading] = useState(cachedScreenAssets.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch Assets from API
  const fetchAssetsFromNetwork = useCallback(async (isPullToRefresh = false) => {
    try {
      if (isPullToRefresh) {
        setRefreshing(true);
      } else if (cachedScreenAssets.length === 0) {
        setLoading(true);
      }
      const res = await getMarketAssets("All", "", isPullToRefresh);
      if (res?.assets && Array.isArray(res.assets) && res.assets.length > 0) {
        cachedScreenAssets = res.assets;
        lastScreenFetchTime = Date.now();
        setAssets(res.assets);
        await storage.setJSON(STORAGE_KEYS.MARKET_ASSETS, res.assets);
      } else if (cachedScreenAssets.length === 0) {
        setAssets(DEFAULT_OPPORTUNITIES);
      }
    } catch (err) {
      console.warn("[SearchScreen] Using cached / mockup assets:", err.message);
      const cached = await storage.getJSON(STORAGE_KEYS.MARKET_ASSETS, []);
      if (cached && cached.length > 0) {
        cachedScreenAssets = cached;
        setAssets(cached);
      } else {
        setAssets(DEFAULT_OPPORTUNITIES);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (route?.params?.initialCategory) {
        setActiveCategory(route.params.initialCategory);
      }

      const now = Date.now();
      const isFresh =
        cachedScreenAssets.length > 0 &&
        now - lastScreenFetchTime < SCREEN_CACHE_TTL;

      if (isFresh) {
        setAssets(cachedScreenAssets);
        setLoading(false);
        return;
      }

      fetchAssetsFromNetwork(false);
    }, [route?.params?.initialCategory, fetchAssetsFromNetwork]),
  );

  const onRefresh = useCallback(() => {
    fetchAssetsFromNetwork(true);
  }, [fetchAssetsFromNetwork]);

  // Category matching helper
  const matchesCategory = (catStr, targetTab) => {
    if (targetTab === "All") return true;
    const a = String(catStr || "").toLowerCase();
    const t = String(targetTab || "").toLowerCase();
    if (t === "watches") return a.includes("watch");
    if (t === "art") return a.includes("art");
    if (t === "cars") return a.includes("car") || a.includes("vehicle");
    if (t === "wine") return a.includes("wine");
    return a.includes(t);
  };

  // Filtered assets list
  const filteredAssets = useMemo(() => {
    const source = assets.length > 0 ? assets : DEFAULT_OPPORTUNITIES;
    return source.filter((item) => {
      const matchCat = matchesCategory(item.category, activeCategory);
      if (!matchCat) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        item.name?.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q)
      );
    });
  }, [assets, activeCategory, query]);

  // User display name & initials
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
        {/* ── TOP APP BAR / BRAND HEADER ───────────────────────────────────────── */}
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
              <Ionicons name="add" size={16} color="#FFFFFF" style={{ marginRight: 2 }} />
              <Text style={styles.addAssetBtnText}>Add asset</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            HERO CARD: AI-POWERED DISCOVERY (Classic Purple-to-Cyan Gradient)
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.heroCardContainer}>
          <LinearGradient
            colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.85 }}
            style={styles.heroGradient}
          >
            {/* Tag Badge */}
            <View style={styles.heroTagBadge}>
              <Ionicons
                name="sparkles"
                size={12}
                color="#FFFFFF"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.heroTagText}>AI-POWERED DISCOVERY</Text>
            </View>

            {/* Headline */}
            <Text style={styles.heroTitle}>Find your next iconic asset.</Text>

            {/* Subtitle */}
            <Text style={styles.heroSubtitle}>
              Explore verified collectibles with intelligent valuations and market
              signals.
            </Text>

            {/* Embedded Search Bar */}
            <View style={styles.searchBarBox}>
              <Feather name="search" size={18} color="#94A3B8" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search watches, artists, models or vintages…"
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery("")}
                  style={{ marginRight: 8 }}
                >
                  <Feather name="x" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.searchSubmitBtn}
                activeOpacity={0.85}
                onPress={() => {}}
              >
                <Text style={styles.searchSubmitBtnText}>Search</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            CATEGORY OVERVIEW CARDS (4 Cards Grid)
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.categoryOverviewGrid}>
          {CATEGORY_OVERVIEW.map((cat) => {
            const isSelected = activeCategory === cat.title;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.catCard,
                  isSelected && styles.catCardSelected,
                ]}
                onPress={() => {
                  setActiveCategory(isSelected ? "All" : cat.title);
                }}
                activeOpacity={0.85}
              >
                <View>
                  <Text style={styles.catCardTitle}>{cat.title}</Text>
                  <Text style={styles.catCardCount}>{cat.count}</Text>
                </View>

                <View
                  style={[
                    styles.catIconBox,
                    { backgroundColor: cat.iconBg },
                  ]}
                >
                  <Ionicons name={cat.icon} size={18} color={cat.iconColor} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            MARKETPLACE OPPORTUNITIES SECTION
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.marketSection}>
          <View style={styles.marketHeaderRow}>
            <View>
              <Text style={styles.marketTag}>MARKETPLACE</Text>
              <Text style={styles.marketTitle}>
                {loading
                  ? "Loading opportunities…"
                  : `${filteredAssets.length} verified opportunities`}
              </Text>
            </View>

            {/* Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterPillsScroll}
            >
              {FILTER_TABS.map((tab) => {
                const isActive = activeCategory === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    style={[
                      styles.filterPill,
                      isActive ? styles.filterPillActive : styles.filterPillInactive,
                    ]}
                    onPress={() => setActiveCategory(tab.id)}
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
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#6D28D9" />
              <Text style={styles.loadingText}>Loading marketplace…</Text>
            </View>
          ) : filteredAssets.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Feather name="inbox" size={36} color="#94A3B8" />
              <Text style={styles.emptyTitle}>No opportunities found</Text>
              <Text style={styles.emptySubtitle}>
                Try adjusting your search query or category filter.
              </Text>
            </View>
          ) : (
            <View style={styles.gridWrap}>
              {filteredAssets.map((asset) => {
                const formattedPrice = formatGBP(asset.price);
                const confidence =
                  asset.confidence ||
                  (asset.aiScore ? `${asset.aiScore}% confidence` : "96% confidence");
                const gain = asset.gain || "+12.4%";

                return (
                  <TouchableOpacity
                    key={asset.id}
                    style={[styles.marketCard, { width: cardWidth }]}
                    onPress={() =>
                      navigation.navigate(SCREENS.ASSET_DETAIL, { asset })
                    }
                    activeOpacity={0.88}
                  >
                    {/* Card Image with Frosted Badges */}
                    <View style={styles.cardImgWrap}>
                      <Image
                        source={{ uri: asset.image }}
                        style={styles.cardImg}
                        resizeMode="cover"
                      />
                      {/* Verified Badge */}
                      <View style={styles.verifiedBadge}>
                        <Ionicons
                          name="checkmark-sharp"
                          size={11}
                          color="#FFFFFF"
                          style={{ marginRight: 3 }}
                        />
                        <Text style={styles.verifiedText}>Verified</Text>
                      </View>

                      {/* Gain Badge */}
                      <View style={styles.gainBadge}>
                        <Text style={styles.gainText}>{gain}</Text>
                      </View>
                    </View>

                    {/* Card Body */}
                    <View style={styles.cardBody}>
                      {/* Category & Confidence */}
                      <View style={styles.cardTopRow}>
                        <Text style={styles.cardCategory}>
                          {String(asset.category || "ASSET").toUpperCase()}
                        </Text>
                        <Text style={styles.cardConfidence}>{confidence}</Text>
                      </View>

                      {/* Asset Title */}
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {asset.name}
                      </Text>

                      {/* Current Valuation Row */}
                      <View style={styles.cardValuationRow}>
                        <Text style={styles.valuationLabel}>
                          Current valuation
                        </Text>
                        <Text style={styles.valuationValue}>
                          {formattedPrice}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Safe bottom spacer for floating navigation bar */}
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

  // ── Hero Card ───────────────────────────────────────────────────────────────
  heroCardContainer: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
    marginBottom: 20,
  },
  heroGradient: {
    paddingVertical: 26,
    paddingHorizontal: 20,
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
  searchBarBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    width: "100%",
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    marginTop: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#0F172A",
    marginHorizontal: 8,
    paddingVertical: Platform.OS === "ios" ? 4 : 0,
  },
  searchSubmitBtn: {
    backgroundColor: "#5835F5",
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  searchSubmitBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // ── Category Overview Grid ──────────────────────────────────────────────────
  categoryOverviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 26,
  },
  catCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  catCardSelected: {
    borderColor: "#5835F5",
    borderWidth: 1.5,
  },
  catCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  catCardCount: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  catIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Marketplace Section ─────────────────────────────────────────────────────
  marketSection: {
    marginTop: 4,
  },
  marketHeaderRow: {
    marginBottom: 16,
  },
  marketTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 1,
    marginBottom: 2,
  },
  marketTitle: {
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

  // Cards Grid
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  marketCard: {
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
  gainBadge: {
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
  gainText: {
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
    marginBottom: 6,
  },
  cardCategory: {
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
    marginBottom: 10,
    minHeight: 40,
  },
  cardValuationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(241, 245, 249, 0.9)",
  },
  valuationLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  valuationValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },

  // State wrappers
  loadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: "#64748B",
  },
  emptyWrap: {
    paddingVertical: 48,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 4,
  },
});
