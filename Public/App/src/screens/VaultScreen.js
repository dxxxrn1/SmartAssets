// ─── VaultScreen ──────────────────────────────────────────────────────────────
// User-Isolated Portfolio Vault — displays ONLY assets belonging to the logged-in user.

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { useAuth } from "../context/AuthContext";
import { getUserVault } from "../services/api";
import { Feather, Ionicons } from "@expo/vector-icons";

export default function VaultScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { user, token, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Portfolio");
  const [holdings, setHoldings] = useState([]);
  const [summary, setSummary] = useState({
    totalValueFormatted: "R0",
    totalValueNum: 0,
    totalCount: 0,
    wholeCount: 0,
    fractionalCount: 0,
    gainText: "0.0%",
  });

  const loadVault = useCallback(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getUserVault(token)
      .then((res) => {
        if (res.success) {
          setHoldings(res.holdings || []);
          if (res.summary) setSummary(res.summary);
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch user vault:", err.message);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadVault();
    }, [loadVault]),
  );

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#2D0A4E" }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── UNIFIED GRADIENT (Deep Purple -> White) ── */}
        <LinearGradient
          colors={[
            "#0c074eff",
            "#3c1679ff",
            "#6d35bbff",
            "#753cceb8",
            "#9054e6bf",
            "#82b8ffff",
            "#82aaffff",
            "#9dd3ffff",
            "#b8e9ffff",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.unifiedGradient}
        >
          {/* Header */}
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.greetingName}>My Vault</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="settings" size={18} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="bell" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.balanceContainer}>
            <Text style={styles.balanceLabel}>Available Balance</Text>
            <Text style={styles.balanceValue}>{summary.totalValueFormatted}</Text>
            <Text style={styles.balanceGain}>
              $10,240.00 <Text style={styles.balanceGainPct}>+12%</Text>
            </Text>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.withdrawBtn}>
              <Feather name="arrow-down-left" size={16} color="#FFFFFF" />
              <Text style={styles.withdrawBtnText}>Withdraw</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.depositBtn}>
              <Feather name="arrow-up-right" size={16} color="#0F172A" />
              <Text style={styles.depositBtnText}>Deposit</Text>
            </TouchableOpacity>
          </View>

          {/* ── PORTFOLIO SECTION (White Elevated Card) ── */}
          <View style={styles.portfolioSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleDark}>Portfolio</Text>
              <TouchableOpacity>
                <Text style={styles.viewAllTextDark}>View All</Text>
              </TouchableOpacity>
            </View>

          {/* Custom Pill Tab Navigator */}
          <View style={styles.tabContainer}>
            {["Portfolio", "Shares", "Transactions"].map((tab) => {
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                    {tab}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Cards Grid */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardsScroll}>
            {loading ? (
              <ActivityIndicator size="large" color="#BBF7D0" style={{ margin: 40 }} />
            ) : holdings.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={{ color: "#94A3B8" }}>No assets found.</Text>
              </View>
            ) : (
              holdings.map((item, idx) => {
                const bgColor = "#F8FAFC";
                const textColor = "#0F172A";

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.portfolioAssetCardWhite}
                    activeOpacity={0.9}
                    onPress={() =>
                      navigation.navigate(SCREENS.ASSET_DETAIL, {
                        asset: { ...item, priceNum: item.price_num || 0 },
                      })
                    }
                  >
                    <View style={styles.cardTopRow}>
                      <View style={styles.cardThumbWrapWhite}>
                        <Image source={{ uri: item.image }} style={styles.cardLogo} />
                      </View>
                      <View style={{ justifyContent: "center", flex: 1 }}>
                        <Text style={styles.cardTitleDark} numberOfLines={1}>{item.name}</Text>
                      </View>
                    </View>
                    <View style={styles.cardBottomRow}>
                      <Text style={styles.cardPrice}>{item.price}</Text>
                      <View style={styles.cardGainPill}>
                        <Feather name={item.positive ? "trending-up" : "trending-down"} size={10} color="#059669" />
                        <Text style={styles.cardGainText}>
                          {item.gain_pct || "+0%"}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
          </View>
        </LinearGradient>

        {/* ── BOTTOM DARK SECTION (WATCHLIST) ── */}
        <View style={styles.bottomDarkSectionWrapper}>
          <View style={styles.bottomDarkSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleDark}>My Watchlist</Text>
              <TouchableOpacity>
                <Text style={styles.viewAllTextDark}>View All</Text>
              </TouchableOpacity>
            </View>
          
          <View style={styles.watchlistContainer}>
             {/* Mock Watchlist Item 1 */}
             <View style={styles.watchlistItem}>
                <View style={styles.watchLeft}>
                   <View style={styles.watchIconWrap}>
                      <Image source={{ uri: "https://images.unsplash.com/photo-1548171915-e79a380a2a4b?q=80&w=300&auto=format&fit=crop" }} style={styles.watchLogo} />
                   </View>
                   <View>
                      <Text style={styles.watchTitle}>Rolex Submariner</Text>
                      <Text style={styles.watchSub}>Watches</Text>
                   </View>
                </View>
                <View style={styles.watchRight}>
                   <Text style={styles.watchPrice}>$12,500</Text>
                   <Text style={[styles.watchGain, { color: '#059669' }]}>+2.4%</Text>
                </View>
             </View>
             
             {/* Mock Watchlist Item 2 */}
             <View style={styles.watchlistItem}>
                <View style={styles.watchLeft}>
                   <View style={styles.watchIconWrap}>
                      <Image source={{ uri: "https://images.unsplash.com/photo-1614165936126-2ed18e471b3b?q=80&w=300&auto=format&fit=crop" }} style={styles.watchLogo} />
                   </View>
                   <View>
                      <Text style={styles.watchTitle}>Ferrari Testarossa</Text>
                      <Text style={styles.watchSub}>Classic Cars</Text>
                   </View>
                </View>
                <View style={styles.watchRight}>
                   <Text style={styles.watchPrice}>$185,000</Text>
                   <Text style={[styles.watchGain, { color: '#059669' }]}>+1.1%</Text>
                </View>
             </View>

             {/* Mock Watchlist Item 3 */}
             <View style={styles.watchlistItem}>
                <View style={styles.watchLeft}>
                   <View style={styles.watchIconWrap}>
                      <Image source={{ uri: "https://images.unsplash.com/photo-1577744063259-22a0149bb892?q=80&w=300&auto=format&fit=crop" }} style={styles.watchLogo} />
                   </View>
                   <View>
                      <Text style={styles.watchTitle}>Banksy Original</Text>
                      <Text style={styles.watchSub}>Fine Art</Text>
                   </View>
                </View>
                <View style={styles.watchRight}>
                   <Text style={styles.watchPrice}>$42,000</Text>
                   <Text style={[styles.watchGain, { color: '#059669' }]}>+0.8%</Text>
                </View>
             </View>
          </View>
        </View>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, backgroundColor: "#0F1A2E" }, 
  
  unifiedGradient: {
    paddingTop: 10,
    paddingBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    zIndex: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarMini: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  greetingText: { fontSize: 12, color: "#64748B", marginBottom: 2 },
  greetingName: { fontSize: 24, fontWeight: "700", color: "#FFFFFF", letterSpacing: -0.4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  balanceContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  balanceLabel: { fontSize: 13, color: "#E2E8F0", fontWeight: "500", marginBottom: 8 },
  balanceValue: { fontSize: 40, fontWeight: "800", color: "#FFFFFF", letterSpacing: -1, marginBottom: 8 },
  balanceGain: { fontSize: 11, color: "#E2E8F0", fontWeight: "600" },
  balanceGainPct: { color: "#10B981" },
  
  actionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  withdrawBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 255, 255, 0.45)", // Translucent
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  withdrawBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" }, // White text
  depositBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff93", // Solid white
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  depositBtnText: { fontSize: 15, fontWeight: "700", color: "#0F172A" },

  // -- Portfolio Elevated Card --
  portfolioSection: {
    backgroundColor: "#000000",
    marginTop: 20,
    marginHorizontal: 16,
    paddingVertical: 24,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
    minHeight: 250,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  sectionTitleWhite: { fontSize: 15, fontWeight: "700", color: "#F1F5F9" },
  viewAllText: { fontSize: 12, fontWeight: "600", color: "#38BDF8" },
  
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#0F172A",
    marginHorizontal: 24,
    borderRadius: 999,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 999,
  },
  tabBtnActive: { backgroundColor: "#4C86FF" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#94A3B8" },
  tabTextActive: { color: "#FFFFFF" },

  // -- Horizontal asset cards on dark canvas (dark glass mode) --
  cardsScroll: {
    paddingHorizontal: 24,
    gap: 16,
  },
  portfolioAssetCardWhite: {
    width: 220,
    height: 140,
    borderRadius: 24,
    padding: 16,
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTopRow: { gap: 10 },
  cardThumbWrapWhite: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cardLogo: { width: 36, height: 36, borderRadius: 8 },
  cardTitleDark: { fontSize: 13, fontWeight: "600", marginBottom: 3, color: "#F1F5F9" },
  cardSub: { fontSize: 11, fontWeight: "500", color: "#94A3B8" },
  cardCategoryChip: {
    flexDirection: "row",
    alignSelf: "flex-start",
    backgroundColor: "rgba(56,189,248,0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  cardCategoryText: { fontSize: 9.5, fontWeight: "700", color: "#38BDF8", textTransform: "uppercase", letterSpacing: 0.8 },
  cardBottomRow: { gap: 6 },
  cardPrice: { fontSize: 13, fontWeight: "700", color: "#F1F5F9" },
  cardGainPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(52,211,153,0.12)",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardGainText: { fontSize: 9, fontWeight: "700", color: "#34D399" },
  emptyCard: { width: 300, height: 180, alignItems: "center", justifyContent: "center", backgroundColor: "#1E293B", borderRadius: 24 },

  // -- Bottom Dark Section (Watchlist) --
  bottomDarkSectionWrapper: {
    backgroundColor: "transparent", 
  },
  bottomDarkSection: {
    backgroundColor: "#000000",
    paddingTop: 32,
    paddingBottom: 40,
    minHeight: 300,
  },
  sectionTitleDark: { fontSize: 15, fontWeight: "700", color: "#F1F5F9", marginBottom: 2 },
  viewAllTextDark: { fontSize: 12, fontWeight: "600", color: "#38BDF8" },
  watchlistContainer: {
    paddingHorizontal: 24,
    gap: 20,
  },
  watchlistItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  watchLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  watchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  watchLogo: { width: "100%", height: "100%", borderRadius: 12 },
  watchTitle: { fontSize: 13, fontWeight: "600", color: "#F1F5F9", marginBottom: 2 },
  watchSub: { fontSize: 11, fontWeight: "500", color: "#94A3B8" },
  watchRight: { alignItems: "flex-end", gap: 4 },
  watchPrice: { fontSize: 13, fontWeight: "700", color: "#F1F5F9", marginBottom: 0 },
  watchGain: { fontSize: 9, fontWeight: "700" },
});
