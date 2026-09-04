// ─── SearchScreen ─────────────────────────────────────────────────────────────
// Discover Assets — luxury cards with rich category palettes and image on the right

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { getMarketAssets } from "../services/api";
import { Feather } from "@expo/vector-icons";

// ── Category Palettes matching the luxury reference ───────────────────────────
const CATEGORY_THEMES = {
  "Luxury Watch": {
    color: "#1D4ED8", // Sapphire Blue
    btnBg: "#0F172A",
  },
  "Fine Art": {
    color: "#6D28D9", // Royal Violet / Plum
    btnBg: "#3B0764",
  },
  "Classic Car": {
    color: "#C2410C", // Burnt Copper / Amber
    btnBg: "#431407",
  },
  "Fine Wine": {
    color: "#881337", // Deep Bordeaux / Maroon
    btnBg: "#4C0519",
  },
};

export default function SearchScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
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
    }, [])
  );

  const assetList = Array.isArray(assets) ? assets : [];
  const filtered = query
    ? assetList.filter(
        (a) =>
          a.name?.toLowerCase().includes(query.toLowerCase()) ||
          a.category?.toLowerCase().includes(query.toLowerCase()),
      )
    : assetList;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: c.obsidian }]}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.warm }]}>Discover Assets</Text>

        {/* Search bar */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Feather
            name="search"
            size={17}
            color={c.muted}
            style={{ marginLeft: 2, marginRight: 6 }}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search watches, fine art, cars, wine…"
            placeholderTextColor={c.muted}
            style={[styles.searchInput, { color: c.warm }]}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Feather name="x" size={16} color={c.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Section Title ── */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: c.muted }]}>
          {query
            ? `${filtered.length} RESULT${filtered.length !== 1 ? "S" : ""} FOUND`
            : "CURATED COLLECTION"}
        </Text>
      </View>

      {/* ── Item List (Image on the Right) ── */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="large" color={c.warm} style={{ marginTop: 40 }} />
        ) : (
        filtered.map((asset) => {
          const isVerified = asset.badge === "Verified";

          // Green theme for Verified cards, Yellow/Amber theme for Pending cards
          const accentColor = isVerified
            ? isDark
              ? "#10B981"
              : "#059669"
            : isDark
            ? "#F59E0B"
            : "#D97706";

          const nameColor = isVerified
            ? isDark
              ? "#A7F3D0"
              : "#064E3B"
            : isDark
            ? "#FEF3C7"
            : "#78350F";

          const priceColor = isVerified
            ? isDark
              ? "#34D399"
              : "#059669"
            : isDark
            ? "#FBBF24"
            : "#D97706";

          const marketValueColor = isVerified
            ? isDark
              ? "#6EE7B7"
              : "#047857"
            : isDark
            ? "#FCD34D"
            : "#B45309";

          const circleBtnBg = isVerified
            ? isDark
              ? "#064E3B"
              : "#0F172A"
            : isDark
            ? "#78350F"
            : "#B45309";

          return (
            <TouchableOpacity
              key={asset.id}
              style={[
                styles.card,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
              ]}
              onPress={() =>
                navigation.navigate(SCREENS.ASSET_DETAIL, { asset })
              }
              activeOpacity={0.88}
            >
              {/* ── Left Column: All Details & Information ── */}
              <View style={styles.cardBody}>
                {/* Top: Category on left, Market Value & Price on right */}
                <View style={styles.topRow}>
                  <Text style={[styles.categoryLabel, { color: accentColor }]}>
                    {asset.category.toUpperCase()}
                  </Text>
                  <View style={styles.priceCol}>
                    <Text style={[styles.marketValueLabel, { color: marketValueColor }]}>
                      MARKET VALUE
                    </Text>
                    <Text style={[styles.priceText, { color: priceColor }]}>
                      {asset.price}
                    </Text>
                  </View>
                </View>

                {/* Title */}
                <Text
                  style={[styles.assetName, { color: nameColor }]}
                  numberOfLines={2}
                >
                  {asset.name}
                </Text>

                {/* Bottom: Verification status & circle action button */}
                <View style={styles.bottomRow}>
                  <View style={styles.statusRow}>
                    <Feather
                      name={isVerified ? "check-circle" : "clock"}
                      size={13}
                      color={accentColor}
                    />
                    <Text style={[styles.statusText, { color: accentColor }]}>
                      {asset.badge}
                    </Text>
                    <Text style={[styles.dotSep, { color: c.muted }]}>·</Text>
                    <Text style={[styles.metaText, { color: c.muted }]}>
                      {asset.year}
                    </Text>
                    <Text style={[styles.dotSep, { color: c.muted }]}>·</Text>
                    <Text
                      style={[styles.metaText, { color: c.muted }]}
                      numberOfLines={1}
                    >
                      {asset.condition}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.circleBtn,
                      { backgroundColor: circleBtnBg },
                    ]}
                  >
                    <Feather name="chevron-right" size={14} color="#FFFFFF" />
                  </View>
                </View>
              </View>

              {/* ── Right Column: Hero Image ── */}
              <Image
                source={{ uri: asset.image }}
                style={styles.cardImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          );
        })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  card: {
    flexDirection: "row",
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 14,
    minHeight: 146,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 10,
    justifyContent: "space-between",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  categoryLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1,
  },
  priceCol: {
    alignItems: "flex-end",
  },
  marketValueLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 0.9,
    marginBottom: 1,
  },
  priceText: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  assetName: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 22,
    letterSpacing: -0.2,
    marginVertical: 4,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    paddingRight: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  dotSep: {
    fontSize: 10,
    marginHorizontal: 1,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "500",
  },
  circleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardImage: {
    width: 115,
    height: "100%",
  },
});
