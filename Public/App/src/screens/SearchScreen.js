// ─── SearchScreen ─────────────────────────────────────────────────────────────
// Marketplace / Discover Assets — 2-column product grid with search & category filters

import React, { useState, useCallback } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { getMarketAssets } from "../services/api";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

// CARD_WIDTH computed inside component via useWindowDimensions
// to prevent stale layout values on first render
const CARD_GAP = 12;
const CARD_H_PAD = 20;

// Module-level cache to persist across re-mounts and tab switching (0 network egress on return)
let cachedScreenAssets = [];
let lastScreenFetchTime = 0;
const SCREEN_CACHE_TTL = 3 * 60 * 1000; // 3 minutes fresh cache

export function clearSearchScreenCache() {
  cachedScreenAssets = [];
  lastScreenFetchTime = 0;
}

const FILTER_TABS = [
  { id: "All", label: "All", icon: "grid-outline", color: "#38BDF8" },
  {
    id: "Luxury Watch",
    label: "Watches",
    icon: "watch-outline",
    color: "#38BDF8",
  },
  {
    id: "Fine Art",
    label: "Art",
    icon: "color-palette-outline",
    color: "#A78BFA",
  },
  {
    id: "Classic Car",
    label: "Cars",
    icon: "car-sport-outline",
    color: "#FB923C",
  },
  { id: "Fine Wine", label: "Wine", icon: "wine-outline", color: "#F472B6" },
];

// Accent colour per category for card label
const CAT_ACCENT = {
  "Luxury Watch": "#38BDF8",
  "Fine Art": "#A78BFA",
  "Classic Car": "#FB923C",
  "Fine Wine": "#F472B6",
};

export default function SearchScreen({ navigation, isDark, route }) {
  const { width: screenWidth } = useWindowDimensions();
  const CARD_WIDTH = (screenWidth - CARD_H_PAD * 2 - CARD_GAP) / 2;
  const c = useColors(isDark);
  const initialCat = route?.params?.initialCategory ?? "All";
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(initialCat);
  const [assets, setAssets] = useState(cachedScreenAssets);
  const [loading, setLoading] = useState(cachedScreenAssets.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAssetsFromNetwork = useCallback(async (isPullToRefresh = false) => {
    try {
      if (isPullToRefresh) {
        setRefreshing(true);
      } else if (cachedScreenAssets.length === 0) {
        setLoading(true);
      }
      const res = await getMarketAssets("All", "", isPullToRefresh);
      if (res?.assets) {
        const list = Array.isArray(res.assets) ? res.assets : [];
        cachedScreenAssets = list;
        lastScreenFetchTime = Date.now();
        setAssets(list);
      }
    } catch (err) {
      console.error("Failed to fetch market assets:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Sync initial category from route params (e.g. tapped from Home)
      if (route?.params?.initialCategory) {
        setActiveCategory(route.params.initialCategory);
      }

      const now = Date.now();
      const isFresh =
        cachedScreenAssets.length > 0 &&
        now - lastScreenFetchTime < SCREEN_CACHE_TTL;

      // If fresh cached data exists, avoid redundant network downloads
      if (isFresh) {
        if (assets.length === 0) {
          setAssets(cachedScreenAssets);
        }
        setLoading(false);
        return;
      }

      fetchAssetsFromNetwork(false);
    }, [route?.params?.initialCategory, fetchAssetsFromNetwork, assets.length]),
  );

  const onRefresh = useCallback(() => {
    fetchAssetsFromNetwork(true);
  }, [fetchAssetsFromNetwork]);

  const assetList = Array.isArray(assets) ? assets : [];
  let filtered = assetList;

  if (activeCategory !== "All") {
    filtered = filtered.filter((a) => a.category === activeCategory);
  }
  if (query) {
    filtered = filtered.filter(
      (a) =>
        a.name?.toLowerCase().includes(query.toLowerCase()) ||
        a.category?.toLowerCase().includes(query.toLowerCase()),
    );
  }

  const accent = (asset) => CAT_ACCENT[asset.category] ?? "#38BDF8";

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#F1EFFB" }]}
    >
      <LinearGradient
        colors={["#F1EFFB", "#F8F6FE", "#FCF8F9", "#FEF5F2"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* ══ FIXED PURPLE/VIOLET HERO HEADER (Matching Reference Card) ══ */}
        <LinearGradient
          colors={[
            "#30126B",
            "#4F1E9E",
            "#7C3AED",
            "#9333EA",
            "#C084FC",
            "#E879F9",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          {/* Hero tagline — compact & sleek */}
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroCaption}>
              VERIFIED LUXURY ASSETS · CURATED COLLECTION
            </Text>
            <Text style={styles.heroTitle}>
              {"Discover your next asset "}
              <Text style={styles.heroToday}>TODAY!</Text>
            </Text>
          </View>

          {/* Search bar — always visible */}
          <View style={styles.searchBarWrap}>
            <View style={styles.searchBarInner}>
              <Feather
                name="search"
                size={14}
                color="#64748B"
                style={{ marginRight: 8 }}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search here…"
                placeholderTextColor="#64748B"
                style={styles.searchInput}
              />
              {query.length > 0 ? (
                <TouchableOpacity onPress={() => setQuery("")}>
                  <Feather name="x" size={13} color="#64748B" />
                </TouchableOpacity>
              ) : (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>Filter</Text>
                  <Feather name="sliders" size={10} color="#FFFFFF" />
                </View>
              )}
            </View>
          </View>

          {/* Category filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTER_TABS.map((tab) => {
              const isActive = activeCategory === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setActiveCategory(tab.id)}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: isActive
                        ? tab.color
                        : "rgba(255,255,255,0.12)",
                      borderColor: isActive
                        ? tab.color
                        : "rgba(255,255,255,0.2)",
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={tab.icon}
                    size={13}
                    color={isActive ? "#FFFFFF" : "rgba(255,255,255,0.85)"}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.filterPillText,
                      { color: isActive ? "#FFFFFF" : "rgba(255,255,255,0.85)" },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </LinearGradient>
        {/* ══ END FIXED HEADER ══ */}

        {/* ── SCROLLABLE CONTENT (White Mode) ── */}
        <ScrollView
          style={{ flex: 1, backgroundColor: "transparent" }}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#38BDF8"
              colors={["#38BDF8", "#7C3AED"]}
            />
          }
        >
          {/* Result count */}
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>
              {loading
                ? "LOADING…"
                : query
                  ? `${filtered.length} RESULT${filtered.length !== 1 ? "S" : ""}`
                  : "CURATED COLLECTION"}
            </Text>
            <Text style={styles.resultCount}>
              {!loading &&
                `${filtered.length} asset${filtered.length !== 1 ? "s" : ""}`}
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#38BDF8" />
              <Text style={styles.loadingText}>Loading verified listings…</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Feather name="inbox" size={36} color="#94A3B8" />
              <Text style={styles.emptyText}>No assets found</Text>
              <Text style={styles.emptySubtext}>
                Try a different search or category
              </Text>
            </View>
          ) : (
            <View style={styles.gridInner}>
              {filtered.map((asset, idx) => {
                const accentColor = accent(asset);
                const isVerified = asset.badge === "Verified";
                const isLeftCol = idx % 2 === 0;
                return (
                  <TouchableOpacity
                    key={asset.id}
                    style={[
                      styles.card,
                      {
                        width: CARD_WIDTH,
                        marginRight: isLeftCol ? CARD_GAP : 0,
                        marginBottom: CARD_GAP,
                      },
                    ]}
                    onPress={() =>
                      navigation.navigate(SCREENS.ASSET_DETAIL, { asset })
                    }
                    activeOpacity={0.88}
                  >
                    {/* ── Image ── */}
                    <View
                      style={[
                        styles.cardImgWrap,
                        { height: CARD_WIDTH * 0.85 },
                      ]}
                    >
                      {asset.image ? (
                        <View style={{ flex: 1, position: "relative" }}>
                          <Image
                            source={{ uri: asset.image }}
                            style={styles.cardImg}
                            resizeMode="cover"
                          />
                        </View>
                      ) : (
                        <View style={styles.cardImgPlaceholder}>
                          <Feather name="box" size={28} color="#94A3B8" />
                        </View>
                      )}
                      {/* Verified badge — top right overlay */}
                      {isVerified && (
                        <View style={styles.verifiedBadge}>
                          <Ionicons
                            name="checkmark-sharp"
                            size={9}
                            color="#059669"
                          />
                          <Text style={styles.verifiedText}>VERIFIED</Text>
                        </View>
                      )}
                    </View>

                    {/* ── Card body ── */}
                    <View style={styles.cardBody}>
                      {/* Category label */}
                      <Text
                        style={[styles.cardCat, { color: accentColor }]}
                        numberOfLines={1}
                      >
                        {asset.category?.toUpperCase()}
                      </Text>

                      {/* Asset name */}
                      <Text style={styles.cardName} numberOfLines={2}>
                        {asset.name}
                      </Text>

                      {/* Price + invest button row */}
                      <View style={styles.cardFooter}>
                        <View>
                          <Text style={styles.cardPriceLabel}>VALUE</Text>
                          <Text style={styles.cardPrice}>{asset.price}</Text>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.investBtn,
                            { backgroundColor: "#02ff39ff" },
                          ]}
                          onPress={() =>
                            navigation.navigate(SCREENS.ASSET_DETAIL, { asset })
                          }
                          activeOpacity={0.85}
                        >
                          <Feather name="plus" size={16} color="#000000" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F1EFFB" },

  // ══ Hero Card (Purple/Violet Theme) ══
  heroCard: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 24,
    paddingTop: 16,
    paddingBottom: 20,
    shadowColor: "#6B21A8",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 10,
  },

  heroTextWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  heroCaption: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.8,
    lineHeight: 26,
  },
  heroTitleAccent: { color: "#FDE047" },
  heroToday: {
    fontSize: 22,
    fontWeight: "900",
    color: "#FDE047",
    letterSpacing: -0.8,
    lineHeight: 26,
  },

  searchBarWrap: { paddingHorizontal: 20, paddingBottom: 20 },
  searchBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  searchInput: { flex: 1, fontSize: 13, color: "#0F172A", fontWeight: "500" },
  filterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  filterBadgeText: { fontSize: 10, fontWeight: "700", color: "#FFFFFF" },

  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 2,
    gap: 8,
    flexDirection: "row",
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterPillText: { fontSize: 11, fontWeight: "600" },

  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  resultLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#64748B",
    textTransform: "uppercase",
  },
  resultCount: { fontSize: 11, fontWeight: "700", color: "#0F172A" },

  // ── Grid ──
  grid: {
    paddingBottom: 28,
    backgroundColor: "transparent",
  },
  gridInner: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: CARD_H_PAD,
  },
  loadingWrap: {
    paddingTop: 60,
    alignItems: "center",
    gap: 12,
  },
  loadingText: { color: "#64748B", fontSize: 13, fontWeight: "500" },
  emptyWrap: {
    paddingTop: 60,
    alignItems: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 12,
  },
  emptySubtext: { fontSize: 13, color: "#64748B" },

  // ── Product card (Light luxury mode) ──
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cardImgWrap: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    position: "relative",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  cardImgPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  verifiedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  verifiedText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#059669",
    letterSpacing: 0.5,
  },
  cardBody: {
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  cardCat: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 18,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  cardPriceLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#94A3B8",
    marginBottom: 2,
  },
  cardPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  investBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
});
