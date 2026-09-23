// ─── InvestScreen (Fractional) ────────────────────────────────────────────────
// Fractional ownership — invest tab with asset share listings

import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  ImageBackground,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { getMarketAssets } from "../services/api";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";

const FILTER_CATEGORIES = [
  "All",
  "Watches",
  "Classic Cars",
  "Fine Art",
  "Wine",
  "Real Estate",
];

export default function InvestScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { user } = useAuth();

  const [offerings, setOfferings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getMarketAssets()
        .then((res) => {
          if (!cancelled) {
            setOfferings(Array.isArray(res?.assets) ? res.assets : []);
          }
        })
        .catch((err) => console.warn("InvestScreen fetch error:", err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const filteredOfferings = useMemo(() => {
    if (activeFilter === "All") return offerings;
    return offerings.filter(
      (o) =>
        o.category?.toLowerCase().includes(activeFilter.toLowerCase()) ||
        (activeFilter === "Watches" &&
          o.category?.toLowerCase().includes("watch")) ||
        (activeFilter === "Classic Cars" &&
          (o.category?.toLowerCase().includes("car") ||
            o.category?.toLowerCase().includes("vehicle"))),
    );
  }, [offerings, activeFilter]);

  const totalPoolValue = useMemo(() => {
    return offerings.reduce((sum, o) => sum + (Number(o.price_num) || 0), 0);
  }, [offerings]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>Fractional Invest</Text>
          <Text style={styles.sub}>
            Co-own verified luxury assets from R100/share
          </Text>
        </View>

        {/* ── Investment Pool Header (Top Metrics) ── */}
        <View style={styles.poolHeader}>
          <Text style={styles.poolLabel}>Total Assets Funded</Text>
          <View style={styles.poolValueRow}>
            <Text style={styles.poolValue}>
              R {totalPoolValue.toLocaleString("en-ZA")}
            </Text>
            <View style={styles.growthChip}>
              <Feather name="trending-up" size={12} color="#10B981" />
              <Text style={styles.growthText}>+2.4%</Text>
            </View>
          </View>

          <View style={styles.secondaryStatsRow}>
            <View style={styles.secondaryStat}>
              <Text style={styles.secondaryStatValue}>{offerings.length}</Text>
              <Text style={styles.secondaryStatLabel}>Offerings Open</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.secondaryStat}>
              <Feather name="shield" size={14} color="#94A3B8" />
              <Text style={styles.secondaryStatLabel}>
                100% Escrow Protected
              </Text>
            </View>
          </View>
        </View>

        {/* ── Category Filter Chips ── */}
        <View style={styles.filterContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {FILTER_CATEGORIES.map((cat) => {
              const isActive = activeFilter === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  activeOpacity={0.8}
                  onPress={() => setActiveFilter(cat)}
                  style={isActive ? undefined : styles.filterPillInactive}
                >
                  {isActive ? (
                    <LinearGradient
                      colors={["#00C2FF", "#0077FE"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.filterPillActive}
                    >
                      <Text style={styles.filterTextActive}>{cat}</Text>
                    </LinearGradient>
                  ) : (
                    <Text style={styles.filterTextInactive}>{cat}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Available Offerings ── */}
        <View style={styles.offeringsContainer}>
          {loading ? (
            <ActivityIndicator
              size="large"
              color="#00C2FF"
              style={{ marginTop: 32 }}
            />
          ) : filteredOfferings.length === 0 ? (
            <Text style={styles.emptyText}>
              No offerings available in this category right now.
            </Text>
          ) : (
            filteredOfferings.map((asset) => {
              const totalShares = asset.shares || 100;
              const sharePrice =
                asset.sharePrice ||
                asset.share_price ||
                Math.round((asset.price_num || 1000) / totalShares);
              const sharesSold = asset.sharesSold || asset.shares_sold || 0;
              const pct = Math.min(
                100,
                Math.round((sharesSold / totalShares) * 100),
              );
              const sharesLeft = totalShares - sharesSold;
              const isOwner = Boolean(
                user?.id &&
                (user.id === asset.userId || user.id === asset.user_id),
              );
              const isFunded = sharesSold >= totalShares;
              const valuation = asset.price_num
                ? `R ${asset.price_num.toLocaleString("en-ZA")}`
                : asset.price;

              return (
                <View key={asset.id} style={styles.card}>
                  {/* Hero Image Banner */}
                  <ImageBackground
                    source={{ uri: asset.image }}
                    style={styles.heroImage}
                    imageStyle={styles.heroImageRadius}
                  >
                    <View style={styles.heroTopRow}>
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryBadgeText}>
                          {asset.category}
                        </Text>
                      </View>
                      <View style={styles.authBadge}>
                        <Feather name="shield" size={12} color="#00C2FF" />
                        <Text style={styles.authBadgeText}>SA-CERT</Text>
                      </View>
                    </View>
                    <LinearGradient
                      colors={["transparent", "rgba(18,27,43,0.95)", "#121B2B"]}
                      locations={[0, 0.7, 1]}
                      style={styles.heroVignette}
                    />
                  </ImageBackground>

                  <View style={styles.cardBody}>
                    {/* Two-Column Financial Hierarchy */}
                    <View style={styles.financialRow}>
                      <View style={styles.finLeft}>
                        <Text style={styles.assetName} numberOfLines={1}>
                          {asset.name}
                        </Text>
                        <Text style={styles.assetValuation}>
                          Valuation: {valuation}
                        </Text>
                      </View>
                      <View style={styles.finRight}>
                        <Text style={styles.sharePrice}>
                          R {sharePrice.toLocaleString()}{" "}
                          <Text style={styles.sharePriceUnit}>/ share</Text>
                        </Text>
                        <View style={styles.irrTag}>
                          <Text style={styles.irrText}>+11.8% Est. IRR</Text>
                        </View>
                      </View>
                    </View>

                    {/* Visual Funding Bar */}
                    <View style={styles.fundingSection}>
                      <View style={styles.fundingHeader}>
                        <Text style={styles.fundingStatusText}>
                          <Text style={styles.fundingPctText}>
                            {pct}% Funded
                          </Text>{" "}
                          • {sharesLeft} shares left
                        </Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <LinearGradient
                          colors={["#00C2FF", "#0077FE"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[styles.progressFill, { width: `${pct}%` }]}
                        />
                      </View>
                    </View>

                    {/* CTA Button */}
                    <TouchableOpacity
                      activeOpacity={isOwner || isFunded ? 0.9 : 0.8}
                      onPress={() => {
                        if (isOwner) {
                          Alert.alert(
                            "Self-Investment Restricted",
                            "You listed this collectible. Platform rules prohibit investing in your own listings.",
                          );
                        } else if (isFunded) {
                          Alert.alert(
                            "Offering Closed",
                            "This collectible is 100% funded and closed to new investors.",
                          );
                        } else {
                          navigation.navigate(SCREENS.CHECKOUT, {
                            asset,
                            isFractional: true,
                          });
                        }
                      }}
                      style={{ marginTop: 16 }}
                    >
                      {isOwner || isFunded ? (
                        <View style={styles.investBtnDisabled}>
                          <Text style={styles.investBtnLabelDisabled}>
                            {isOwner
                              ? "Your Listing (Cannot Invest)"
                              : "100% Funded (Closed)"}
                          </Text>
                        </View>
                      ) : (
                        <LinearGradient
                          colors={["#00C2FF", "#0077FE"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.investBtn}
                        >
                          <Text style={styles.investBtnLabel}>Invest Now</Text>
                        </LinearGradient>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#090E17",
  },
  scroll: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: "#FFFFFF",
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: "#94A3B8",
  },

  // -- Top Metrics Header --
  poolHeader: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  poolLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  poolValueRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  poolValue: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -1,
    marginRight: 12,
  },
  growthChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  growthText: {
    color: "#10B981",
    fontSize: 12,
    fontWeight: "700",
  },
  secondaryStatsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  secondaryStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secondaryStatValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  secondaryStatLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94A3B8",
  },
  statDivider: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginHorizontal: 12,
  },

  // -- Category Filter Chips --
  filterContainer: {
    marginBottom: 24,
  },
  filterScroll: {
    paddingHorizontal: 20,
    gap: 12,
  },
  filterPillInactive: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#121B2B",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
  },
  filterPillActive: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  filterTextInactive: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
  },
  filterTextActive: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  // -- Offerings --
  offeringsContainer: {
    paddingHorizontal: 20,
    gap: 20,
  },
  emptyText: {
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 32,
    fontSize: 14,
  },

  card: {
    backgroundColor: "#121B2B",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    overflow: "hidden",
  },
  heroImage: {
    width: "100%",
    aspectRatio: 16 / 9,
    justifyContent: "space-between",
  },
  heroImageRadius: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    zIndex: 10,
  },
  categoryBadge: {
    backgroundColor: "rgba(9, 14, 23, 0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  categoryBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  authBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(9, 14, 23, 0.8)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 194, 255, 0.3)",
    gap: 4,
  },
  authBadgeText: {
    color: "#00C2FF",
    fontSize: 10,
    fontWeight: "800",
  },
  heroVignette: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
  },

  cardBody: {
    padding: 20,
    paddingTop: 16,
  },
  financialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  finLeft: {
    flex: 1,
    paddingRight: 16,
  },
  assetName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  assetValuation: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: "500",
  },
  finRight: {
    alignItems: "flex-end",
  },
  sharePrice: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  sharePriceUnit: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: "500",
  },
  irrTag: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  irrText: {
    color: "#10B981",
    fontSize: 11,
    fontWeight: "700",
  },

  fundingSection: {
    gap: 8,
  },
  fundingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fundingStatusText: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: "500",
  },
  fundingPctText: {
    color: "#00C2FF",
    fontWeight: "700",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },

  investBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  investBtnLabel: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  investBtnDisabled: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  investBtnLabelDisabled: {
    color: "#64748B",
    fontWeight: "700",
    fontSize: 15,
  },
});
