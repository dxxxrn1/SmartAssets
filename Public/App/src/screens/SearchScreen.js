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
import { getMarketAssets, resolveImageUrl } from "../services/api";
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

// ── Format Currency in South African Rands R ─────────────────────────────────
const formatZAR = (val, fallback = "R0") => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "string" && val.startsWith("R")) return val;
  if (typeof val === "string" && val.startsWith("£")) {
    return "R" + val.replace(/^£\s?/, "");
  }
  const num =
    typeof val === "number"
      ? val
      : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return String(val);
  return "R" + num.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
};
const formatGBP = formatZAR;

// ── Format Share Price Badge ────────────────────────────────────────────────
const formatSharePrice = (asset) => {
  if (asset.sharePrice) {
    const sp = typeof asset.sharePrice === "number"
      ? `R${asset.sharePrice}/sh`
      : String(asset.sharePrice).replace(/^£\s?/, "R");
    return sp.includes("/sh") ? sp : `${sp}/sh`;
  }
  if (asset.share_price) {
    const sp = String(asset.share_price).replace(/^£\s?/, "R");
    return sp.includes("/sh") ? sp : `${sp}/sh`;
  }
  const num =
    asset.price_num ||
    parseFloat(String(asset.price || "").replace(/[^0-9.-]+/g, "")) ||
    0;
  if (num > 0) {
    const sp = Math.max(10, Math.round(num / 100));
    return `R${sp.toLocaleString("en-ZA")}/sh`;
  }
  return "R100/sh";
};

// Real verified market opportunities loaded strictly from Supabase
const DEFAULT_OPPORTUNITIES = [];

// ── Market Category Cards for Horizontal Carousel ────────────────────────────
const MARKET_CATEGORY_CARDS = [
  {
    id: "all",
    name: "All Assets",
    categoryKey: "All",
    dotColor: "#6C47FF",
    defaultCount: "2,840 assets",
    image:
      "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "watches",
    name: "Watches",
    categoryKey: "Watches",
    dotColor: "#38BDF8",
    defaultCount: "428 assets",
    image:
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "art",
    name: "Fine Art",
    categoryKey: "Art",
    dotColor: "#A855F7",
    defaultCount: "1,204 assets",
    image:
      "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "cars",
    name: "Classic Cars",
    categoryKey: "Cars",
    dotColor: "#FB923C",
    defaultCount: "316 assets",
    image:
      "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "sneakers",
    name: "Sneakers",
    categoryKey: "Sneakers",
    dotColor: "#10B981",
    defaultCount: "542 assets",
    image:
      "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "wine",
    name: "Fine Wine",
    categoryKey: "Wine",
    dotColor: "#F472B6",
    defaultCount: "892 assets",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "electronics",
    name: "Electronics",
    categoryKey: "Electronics",
    dotColor: "#6366F1",
    defaultCount: "215 assets",
    image:
      "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80",
  },
];

export default function SearchScreen({ navigation, route }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 860;
  const cardWidth = isDesktop
    ? (screenWidth - 36 - 32) / 3
    : (screenWidth - 36 - 16) / 2;

  const { user } = useAuth();

  const normalizeCategory = (cat) => {
    if (!cat) return "All";
    const low = String(cat).toLowerCase().trim();
    if (low.includes("watch")) return "Watches";
    if (low.includes("art")) return "Art";
    if (low.includes("car") || low.includes("vehicle")) return "Cars";
    if (low.includes("wine")) return "Wine";
    if (low.includes("sneaker") || low.includes("shoe")) return "Sneakers";
    if (
      low.includes("electronic") ||
      low.includes("apple") ||
      low.includes("tech")
    )
      return "Electronics";
    if (low.includes("all")) return "All";
    return cat;
  };

  const initialCat = normalizeCategory(
    route?.params?.category || route?.params?.initialCategory || "All",
  );

  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(initialCat);
  const [assets, setAssets] = useState(
    cachedScreenAssets.length > 0 ? cachedScreenAssets : DEFAULT_OPPORTUNITIES,
  );
  const [loading, setLoading] = useState(cachedScreenAssets.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch Assets from API
  const fetchAssetsFromNetwork = useCallback(
    async (isPullToRefresh = false) => {
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
        console.warn(
          "[SearchScreen] Using cached / mockup assets:",
          err.message,
        );
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
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const incomingCat =
        route?.params?.category || route?.params?.initialCategory;
      if (incomingCat) {
        setActiveCategory(normalizeCategory(incomingCat));
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
    }, [
      route?.params?.category,
      route?.params?.initialCategory,
      fetchAssetsFromNetwork,
    ]),
  );

  const onRefresh = useCallback(() => {
    fetchAssetsFromNetwork(true);
  }, [fetchAssetsFromNetwork]);

  // Compute live item count for category card
  const getCategoryAssetCount = (categoryKey, defaultCount) => {
    const source = assets.length > 0 ? assets : DEFAULT_OPPORTUNITIES;
    if (categoryKey === "All") {
      return `${source.length} assets`;
    }
    const count = source.filter((item) =>
      matchesCategory(item.category, categoryKey),
    ).length;
    if (count > 0) {
      return count === 1 ? "1 asset" : `${count} assets`;
    }
    return defaultCount;
  };

  // Category matching helper
  const matchesCategory = (catStr, targetTab) => {
    if (!targetTab || targetTab === "All") return true;
    const a = String(catStr || "")
      .toLowerCase()
      .trim();
    const t = String(targetTab || "")
      .toLowerCase()
      .trim();
    if (t === "watches") return a.includes("watch");
    if (t === "art" || t === "fine art") return a.includes("art");
    if (t === "cars" || t === "classic cars")
      return a.includes("car") || a.includes("vehicle");
    if (t === "wine" || t === "fine wine") return a.includes("wine");
    if (t === "sneakers") return a.includes("sneaker") || a.includes("shoe");
    if (t === "electronics")
      return (
        a.includes("electronic") ||
        a.includes("tech") ||
        a.includes("apple") ||
        a.includes("gadget")
      );
    return a === t || a.includes(t) || t.includes(a);
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

  const userPhoto =
    user?.avatarUrl ||
    user?.avatar_url ||
    user?.avatar ||
    user?.photoURL ||
    user?.profileImage;

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
    <View style={styles.rootContainer}>
      {/* ── Background Mesh Gradient (Full Screen Edge-to-Edge) ──────────────── */}
      <LinearGradient
        colors={[
          "#e4e0ffff", // Soft luminous lavender
          "#e0daffff", // Soft purple aura
          "#f5dfefff", // Soft lilac-pink
          "#fff5efff", // Soft peach aura
          "#ffffffff", // Ambient cream
        ]}
        locations={[0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
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
          {/* ── TOP APP BAR / BRAND HEADER (Matches Home) ─────────────────────────── */}
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

            {/* Right: Profile Avatar Icon (Matches Home) */}
            <View style={styles.appBarRight}>
              <TouchableOpacity
                style={styles.profileAvatarBtn}
                onPress={() => navigation.navigate(SCREENS.PROFILE)}
                activeOpacity={0.8}
              >
                {userPhoto ? (
                  <Image
                    source={{ uri: resolveImageUrl(userPhoto) }}
                    style={styles.profileAvatarImg}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.profileAvatarFallback}>
                    <Text style={styles.profileInitialsText}>
                      {userInitials}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* ── EXPLORE / BROWSE CATEGORIES SECTION HEADER ─────────────────────── */}
          <View style={styles.topHeaderRow}>
            <View style={styles.headerLeftGroup}>
              {navigation.canGoBack() && (
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => navigation.goBack()}
                  activeOpacity={0.8}
                >
                  <Feather name="chevron-left" size={22} color="#0F172A" />
                </TouchableOpacity>
              )}
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTag}>EXPLORE</Text>
                <Text style={styles.headerTitle}>Browse Categories</Text>
              </View>
            </View>
          </View>

          {/* ── PERMANENTLY VISIBLE SLIM SEARCH INPUT BAR ────────────────────────── */}
          <View style={styles.slimSearchBar}>
            <Feather
              name="search"
              size={16}
              color="#6C47FF"
              style={{ marginRight: 8 }}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search watches, art, cars, models…"
              placeholderTextColor="#94A3B8"
              style={styles.slimSearchInput}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery("")}
                style={{ padding: 4 }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x-circle" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.SCAN_AND_KNOW)}
              style={styles.scanKnowSearchBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.8}
            >
              <Feather name="camera" size={15} color="#6C47FF" />
            </TouchableOpacity>
          </View>

          {/* ── HORIZONTALLY SCROLLABLE CATEGORY CAROUSEL (LIVE FILTERS) ───────── */}
          <View style={styles.categoriesCarouselWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoriesCarouselScroll}
            >
              {MARKET_CATEGORY_CARDS.map((cat) => {
                const isActive =
                  activeCategory.toLowerCase() ===
                    cat.categoryKey.toLowerCase() ||
                  (cat.categoryKey === "All" && activeCategory === "All");

                const countText = getCategoryAssetCount(
                  cat.categoryKey,
                  cat.defaultCount,
                );

                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryCard,
                      isActive
                        ? [
                            styles.categoryCardActive,
                            {
                              borderColor: cat.dotColor || "#6C47FF",
                              shadowColor: cat.dotColor || "#6C47FF",
                            },
                          ]
                        : styles.categoryCardInactive,
                    ]}
                    onPress={() => setActiveCategory(cat.categoryKey)}
                    activeOpacity={0.88}
                  >
                    <Image
                      source={{ uri: cat.image }}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="cover"
                    />

                    {/* Active highlight badge matching dot color */}
                    {isActive && (
                      <View
                        style={[
                          styles.activeCategoryBadge,
                          { backgroundColor: cat.dotColor || "#6C47FF" },
                        ]}
                      >
                        <Ionicons
                          name="checkmark-sharp"
                          size={10}
                          color="#FFFFFF"
                        />
                      </View>
                    )}

                    {/* Dark frosted glass bottom overlay */}
                    <View style={styles.categoryFrostedBar}>
                      <View style={styles.categoryNameRow}>
                        <Text style={styles.categoryNameText} numberOfLines={1}>
                          {cat.name}
                        </Text>
                        <View
                          style={[
                            styles.categoryDot,
                            { backgroundColor: cat.dotColor },
                          ]}
                        />
                      </View>
                      <Text style={styles.categoryCountText} numberOfLines={1}>
                        {countText}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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
                          source={{ uri: resolveImageUrl(asset.image) }}
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

                        {/* Gain Badge: remove +0.0% so the top of image isn't cluttered */}
                        {gain &&
                          !gain.includes("0.0%") &&
                          !gain.includes("+0%") &&
                          gain !== "0%" && (
                            <View style={styles.gainBadge}>
                              <Text style={styles.gainText}>{gain}</Text>
                            </View>
                          )}
                      </View>

                      {/* Card Body: vertical stack, padding 12, overflow hidden */}
                      <View style={styles.cardBody}>
                        {/* Line 1: Category label only (small uppercase, no confidence text) */}
                        <Text style={styles.cardCategory} numberOfLines={1}>
                          {String(
                            asset.category || "COLLECTIBLE",
                          ).toUpperCase()}
                        </Text>

                        {/* Line 2: Item Title (1 line max with numberOfLines={1} and ellipsis) */}
                        <Text
                          style={styles.cardTitle}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {asset.name}
                        </Text>

                        {/* Line 3: Full-width Price on left + Muted share price badge on right */}
                        <View style={styles.cardPriceRow}>
                          <Text style={styles.cardPriceValue} numberOfLines={1}>
                            {formattedPrice}
                          </Text>
                          <View style={styles.sharePriceBadge}>
                            <Text
                              style={styles.sharePriceText}
                              numberOfLines={1}
                            >
                              {formatSharePrice(asset)}
                            </Text>
                          </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: "#F3EEFF",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "transparent",
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
  profileAvatarBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#7C3AED",
    backgroundColor: "#EDE9FE",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  profileAvatarImg: {
    width: "100%",
    height: "100%",
  },
  profileAvatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EDE9FE",
  },
  profileInitialsText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#6D28D9",
  },

  // ── Explore / Categories Section Header (Moved down below AppBar) ───────────
  topHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    marginTop: 2,
  },
  headerLeftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.85)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitleWrap: {
    justifyContent: "center",
  },
  headerTag: {
    fontSize: 10,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.85)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  searchToggleBtnActive: {
    backgroundColor: "#F5F3FF",
    borderColor: "#6C47FF",
  },
  addAssetBtnCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#6D28D9",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },

  // ── Slim Search Input Bar ───────────────────────────────────────────────────
  slimSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 16,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: "#6C47FF",
    shadowColor: "#6C47FF",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  scanKnowSearchBtn: {
    marginLeft: 6,
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  slimSearchInput: {
    flex: 1,
    fontSize: 13,
    color: "#0F172A",
    fontWeight: "600",
    paddingVertical: 0,
  },

  // ── Horizontal Categories Carousel ──────────────────────────────────────────
  categoriesCarouselWrap: {
    marginBottom: 20,
    marginHorizontal: -18,
  },
  categoriesCarouselScroll: {
    paddingHorizontal: 18,
    paddingBottom: 4,
    paddingTop: 20,
  },
  categoryCard: {
    width: 145,
    height: 95,
    borderRadius: 16,
    marginRight: 12,
    overflow: "hidden",
    backgroundColor: "#1E293B",
    position: "relative",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  categoryCardActive: {
    borderWidth: 2.5,
    borderColor: "#6C47FF",
    shadowColor: "#6C47FF",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  categoryCardInactive: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.65)",
  },
  activeCategoryBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#6C47FF",
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 2,
  },
  categoryFrostedBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    ...(Platform.OS === "web"
      ? {
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }
      : {}),
  },
  categoryNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  categoryNameText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: -0.2,
    flex: 1,
    marginRight: 4,
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  categoryCountText: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },

  // ── Marketplace Section ─────────────────────────────────────────────────────
  marketSection: {
    marginTop: 2,
  },
  marketHeaderRow: {
    marginBottom: 14,
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
    padding: 12,
    overflow: "hidden",
  },
  cardCategory: {
    fontSize: 10,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 8,
    lineHeight: 18,
  },
  cardPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(241, 245, 249, 0.9)",
  },
  cardPriceValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    flexShrink: 1,
  },
  sharePriceBadge: {
    backgroundColor: "#F1F5F9",
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 6,
    marginLeft: 6,
  },
  sharePriceText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#64748B",
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
