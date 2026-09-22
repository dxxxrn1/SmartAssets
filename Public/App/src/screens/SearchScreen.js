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
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      // Sync initial category from route params (e.g. tapped from Home)
      if (route?.params?.initialCategory) {
        setActiveCategory(route.params.initialCategory);
      }
      let cancelled = false;
      const fetchAssets = async () => {
        try {
          setLoading(true);
          const res = await getMarketAssets();
          if (!cancelled) {
            setAssets(Array.isArray(res?.assets) ? res.assets : []);
          }
        } catch (err) {
          console.error("Failed to fetch market assets:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      fetchAssets();
      return () => {
        cancelled = true;
      };
    }, [route?.params?.initialCategory]),
  );

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
      style={[styles.safe, { backgroundColor: "#0F1A2E" }]}
    >
      <View style={{ flex: 1, backgroundColor: "#F4F6FA" }}>
        {/* ══ FIXED DARK HEADER (never scrolls) ══ */}
        <LinearGradient
          colors={["#0F1A2E", "#1A1248", "#2D0A6B", "#3B0E87"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.3, y: 1 }}
          style={styles.heroCard}
        >
          {/* Hero tagline — compact & sleek */}
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroCaption}>
              Verified luxury assets • Curated for bold investors
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
                color="#94A3B8"
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
                  <Feather name="x" size={13} color="#94A3B8" />
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
                        : "rgba(255,255,255,0.1)",
                      borderColor: isActive
                        ? tab.color
                        : "rgba(255,255,255,0.2)",
                    },
                  ]}
                >
                  <Ionicons
                    name={tab.icon}
                    size={13}
                    color={isActive ? "#FFFFFF" : "rgba(255,255,255,0.7)"}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.filterPillText,
                      { color: isActive ? "#FFFFFF" : "rgba(255,255,255,0.7)" },
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

        {/* ── SCROLLABLE CONTENT (light background) ── */}
        <ScrollView
          style={{ flex: 1, backgroundColor: "#F4F6FA" }}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
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
              <Feather name="inbox" size={36} color="#1A3055" />
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
                          <LinearGradient
                            colors={[
                              "transparent",
                              "rgba(255,255,255,0.8)",
                              "#FFFFFF",
                            ]}
                            locations={[0, 0.7, 1]}
                            style={{
                              position: "absolute",
                              bottom: 0,
                              left: 0,
                              right: 0,
                              height: 40,
                            }}
                          />
                        </View>
                      ) : (
                        <View style={styles.cardImgPlaceholder}>
                          <Feather name="box" size={28} color="#1A3055" />
                        </View>
                      )}
                      {/* Verified badge — top right overlay */}
                      {isVerified && (
                        <View style={styles.verifiedBadge}>
                          <Ionicons
                            name="checkmark-sharp"
                            size={9}
                            color="#10B981"
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
                            { backgroundColor: accentColor },
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // ══ Dark Hero Card ══
  heroCard: {
    paddingTop: 12,
    paddingBottom: 22,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
    zIndex: 10,
  },

  heroTextWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  heroCaption: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.8,
    lineHeight: 26,
  },
  heroTitleAccent: { color: "#A78BFA" },
  heroToday: {
    fontSize: 22,
    fontWeight: "900",
    color: "#3c78faff",
    letterSpacing: -0.8,
    lineHeight: 26,
  },

  searchBarWrap: { paddingHorizontal: 20, paddingBottom: 20 },
  searchBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 0,
  },
  searchInput: { flex: 1, fontSize: 12.5, color: "#1A202C" },
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
    paddingTop: 10,
    paddingBottom: 8,
  },
  resultLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#64748B",
  },
  resultCount: { fontSize: 11, fontWeight: "500", color: "#0F172A" },

  // ── Grid ──
  grid: {
    paddingBottom: 28,
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
  loadingText: { color: "#2E4A6B", fontSize: 13 },
  emptyWrap: {
    paddingTop: 60,
    alignItems: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2E4A6B",
    marginTop: 12,
  },
  emptySubtext: { fontSize: 13, color: "#1A3055" },

  // ── Product card (light mode) ──
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  cardImgWrap: {
    width: "100%",
    backgroundColor: "#F1F5F9",
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
    backgroundColor: "#F1F5F9",
  },
  verifiedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  verifiedText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#10B981",
    letterSpacing: 0.5,
  },
  cardBody: {
    padding: 11,
  },
  cardCat: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 3,
  },
  cardName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 17,
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
    color: "#64748B",
    marginBottom: 1,
  },
  cardPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  investBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
