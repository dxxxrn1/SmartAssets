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
    if (!token) return;
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
      style={[styles.safe, { backgroundColor: "#FFFFFF" }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── TOP SECTION (WHITE-TO-BLUE) ── */}
        <LinearGradient
          colors={["#FFFFFF", "#F0F8FF", "#a6c2ffff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topWhiteSection}
        >
          <View style={styles.header}>
            <Text style={styles.greetingName}>My Vault</Text>
            <TouchableOpacity style={styles.bellBtn}>
              <Feather name="bell" size={18} color="#0F172A" />
            </TouchableOpacity>
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
              <Feather name="arrow-down-left" size={16} color="#064E3B" />
              <Text style={styles.withdrawBtnText}>Withdraw</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.depositBtn}>
              <Feather name="arrow-up-right" size={16} color="#0F172A" />
              <Text style={styles.depositBtnText}>Deposit</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* ── MIDDLE SECTION (DARK) ── */}
        <View style={styles.darkSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitleWhite}>Portfolio</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>View All</Text>
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
                const bgColor = "#7B61FF"; // Solid vibrant purple from screenshot
                const textColor = "#FFFFFF";

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.portfolioAssetCard}
                    activeOpacity={0.9}
                    onPress={() =>
                      navigation.navigate(SCREENS.ASSET_DETAIL, {
                        asset: { ...item, priceNum: item.price_num || 0 },
                      })
                    }
                  >
                    <View style={styles.cardTopRow}>
                      <View style={styles.cardThumbWrap}>
                        <Image source={{ uri: item.image }} style={styles.cardLogo} />
                      </View>
                      <View>
                        <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                        <View style={styles.cardCategoryChip}>
                          <Text style={styles.cardCategoryText}>{item.category}</Text>
                        </View>
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

        {/* ── BOTTOM SECTION (WHITE) ── */}
        <View style={styles.bottomWhiteSection}>
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
                      <Feather name="coffee" size={18} color="#059669" />
                   </View>
                   <View>
                      <Text style={styles.watchTitle}>Sbux</Text>
                      <Text style={styles.watchSub}>Starbucks</Text>
                   </View>
                </View>
                <View style={styles.watchRight}>
                   <Text style={styles.watchPrice}>$80.30</Text>
                   <Text style={[styles.watchGain, { color: '#059669' }]}>+1.32%</Text>
                </View>
             </View>
             
             {/* Mock Watchlist Item 2 */}
             <View style={styles.watchlistItem}>
                <View style={styles.watchLeft}>
                   <View style={styles.watchIconWrap}>
                      <Feather name="activity" size={18} color="#4F46E5" />
                   </View>
                   <View>
                      <Text style={styles.watchTitle}>Nike</Text>
                      <Text style={styles.watchSub}>Nike, Inc</Text>
                   </View>
                </View>
                <View style={styles.watchRight}>
                   <Text style={styles.watchPrice}>$111.05</Text>
                   <Text style={[styles.watchGain, { color: '#DC2626' }]}>-0.32%</Text>
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
  
  // -- Top White Island --
  topWhiteSection: {
    backgroundColor: "#FFFFFF",
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
  greetingName: { fontSize: 24, fontWeight: "700", color: "#0F172A", letterSpacing: -0.4 },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  balanceContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  balanceLabel: { fontSize: 13, color: "#64748B", fontWeight: "500", marginBottom: 8 },
  balanceValue: { fontSize: 40, fontWeight: "800", color: "#0F172A", letterSpacing: -1, marginBottom: 8 },
  balanceGain: { fontSize: 11, color: "#64748B", fontWeight: "600" },
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
    backgroundColor: "#10B981",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
  },
  withdrawBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  depositBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  depositBtnText: { fontSize: 15, fontWeight: "700", color: "#0F172A" },

  // -- Middle Dark --
  darkSection: {
    backgroundColor: "#0F1A2E",
    paddingTop: 32,
    paddingBottom: 40,
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
    backgroundColor: "#1E293B",
    marginHorizontal: 24,
    borderRadius: 999,
    padding: 4,
    marginBottom: 24,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 999,
  },
  tabBtnActive: { backgroundColor: "#FFFFFF" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#94A3B8" },
  tabTextActive: { color: "#0F172A" },

  // -- Horizontal asset cards on dark canvas (dark glass mode) --
  cardsScroll: {
    paddingHorizontal: 24,
    gap: 16,
  },
  portfolioAssetCard: {
    width: 160,
    height: 190,
    borderRadius: 24,
    padding: 16,
    justifyContent: "space-between",
    backgroundColor: "#121B2B",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTopRow: { gap: 10 },
  cardThumbWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cardLogo: { width: 36, height: 36, borderRadius: 8 },
  cardTitle: { fontSize: 13, fontWeight: "600", marginBottom: 3, color: "#E2E8F0" },
  cardSub: { fontSize: 11, fontWeight: "500" },
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

  // -- Bottom White Sheet --
  bottomWhiteSection: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 32,
    paddingBottom: 40,
    minHeight: 300,
  },
  sectionTitleDark: { fontSize: 15, fontWeight: "700", color: "#0F172A", marginBottom: 2 },
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
    borderRadius: 22,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  watchTitle: { fontSize: 13, fontWeight: "600", color: "#0F172A", marginBottom: 2 },
  watchSub: { fontSize: 11, fontWeight: "500", color: "#64748B" },
  watchRight: { alignItems: "flex-end", gap: 4 },
  watchPrice: { fontSize: 13, fontWeight: "700", color: "#0F172A", marginBottom: 0 },
  watchGain: { fontSize: 9, fontWeight: "700" },
});
