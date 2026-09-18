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

// CARD_WIDTH computed inside component via useWindowDimensions
// to prevent stale layout values on first render
const CARD_GAP = 12;
const CARD_H_PAD = 20;

const FILTER_TABS = [
  { id: "All",          label: "All",     icon: "grid-outline",          color: "#38BDF8" },
  { id: "Luxury Watch", label: "Watches", icon: "watch-outline",         color: "#38BDF8" },
  { id: "Fine Art",     label: "Art",     icon: "color-palette-outline", color: "#A78BFA" },
  { id: "Classic Car",  label: "Cars",    icon: "car-sport-outline",     color: "#FB923C" },
  { id: "Fine Wine",    label: "Wine",    icon: "wine-outline",          color: "#F472B6" },
];

// Accent colour per category for card label
const CAT_ACCENT = {
  "Luxury Watch": "#38BDF8",
  "Fine Art":     "#A78BFA",
  "Classic Car":  "#FB923C",
  "Fine Wine":    "#F472B6",
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
      return () => { cancelled = true; };
    }, [route?.params?.initialCategory])
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
        a.category?.toLowerCase().includes(query.toLowerCase())
    );
  }

  const accent = (asset) =>
    CAT_ACCENT[asset.category] ?? "#38BDF8";

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#0A1120" }]}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Marketplace</Text>
          <Text style={styles.subtitle}>Discover verified luxury assets</Text>
        </View>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchBarWrap}>
        <View style={[styles.searchBar, { backgroundColor: "#13223A", borderColor: "#223759" }]}>
          <Feather name="search" size={17} color="#64748B" style={{ marginRight: 8 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search watches, art, cars, wine…"
            placeholderTextColor="#4A6080"
            style={styles.searchInput}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Feather name="x" size={16} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Category filter pills ── */}
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
                  backgroundColor: isActive ? tab.color : "#0F1A2E",
                  borderColor: isActive ? tab.color : "#1A3055",
                },
              ]}
            >
              <Ionicons
                name={tab.icon}
                size={14}
                color={isActive ? "#FFFFFF" : tab.color}
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.filterPillText,
                  { color: isActive ? "#FFFFFF" : "#94A3B8" },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Result count label ── */}
      <View style={styles.resultRow}>
        <Text style={styles.resultLabel}>
          {loading
            ? "LOADING…"
            : query
            ? `${filtered.length} RESULT${filtered.length !== 1 ? "S" : ""}`
            : "CURATED COLLECTION"}
        </Text>
        <Text style={styles.resultCount}>
          {!loading && `${filtered.length} asset${filtered.length !== 1 ? "s" : ""}`}
        </Text>
      </View>

      {/* ── 2-Column Grid ── */}
      <ScrollView
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#38BDF8" />
            <Text style={styles.loadingText}>Loading verified listings…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="inbox" size={36} color="#1A3055" />
            <Text style={styles.emptyText}>No assets found</Text>
            <Text style={styles.emptySubtext}>Try a different search or category</Text>
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
                  onPress={() => navigation.navigate(SCREENS.ASSET_DETAIL, { asset })}
                  activeOpacity={0.88}
                >
                  {/* ── Image ── */}
                  <View style={[styles.cardImgWrap, { height: CARD_WIDTH * 0.85 }]}>
                    {asset.image ? (
                      <Image
                        source={{ uri: asset.image }}
                        style={styles.cardImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.cardImgPlaceholder}>
                        <Feather name="box" size={28} color="#1A3055" />
                      </View>
                    )}
                    {/* Verified badge — top right overlay */}
                    {isVerified && (
                      <View style={styles.verifiedBadge}>
                        <Ionicons name="checkmark-sharp" size={9} color="#10B981" />
                        <Text style={styles.verifiedText}>VERIFIED</Text>
                      </View>
                    )}
                  </View>

                  {/* ── Card body ── */}
                  <View style={styles.cardBody}>
                    {/* Category label */}
                    <Text style={[styles.cardCat, { color: accentColor }]} numberOfLines={1}>
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
                        style={[styles.investBtn, { backgroundColor: accentColor }]}
                        onPress={() => navigation.navigate(SCREENS.ASSET_DETAIL, { asset })}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // ── Header ──
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: "#F1F5F9",
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "500",
    color: "#4A6080",
    marginTop: 2,
  },

  // ── Search bar ──
  searchBarWrap: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#F1F5F9",
  },

  // ── Filter pills ──
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
    flexDirection: "row",
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "600",
  },

  // ── Result label ──
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  resultLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#2E4A6B",
  },
  resultCount: {
    fontSize: 11,
    fontWeight: "500",
    color: "#2E4A6B",
  },

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
  emptyText: { fontSize: 16, fontWeight: "600", color: "#2E4A6B", marginTop: 12 },
  emptySubtext: { fontSize: 13, color: "#1A3055" },

  // ── Product card ──
  card: {
    // width applied inline from CARD_WIDTH (computed in component)
    backgroundColor: "#0F1A2E",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#192A45",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  cardImgWrap: {
    // height applied inline from CARD_WIDTH * 0.85
    width: "100%",
    backgroundColor: "#0A1528",
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
    backgroundColor: "#0A1528",
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
    color: "#E2E8F0",
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
    color: "#2E4A6B",
    marginBottom: 1,
  },
  cardPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#F1F5F9",
    letterSpacing: -0.3,
  },
  investBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
