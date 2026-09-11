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
      style={[styles.safe, { backgroundColor: c.obsidian }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header with User Identity & Logout ── */}
        <View style={[styles.header, { backgroundColor: '#E6FFFD', borderBottomWidth: 0 }]}>
          <View>
            <Text style={[styles.title, { color: '#0F172A' }]}>
              My Personal Vault
            </Text>
            <Text style={[styles.sub, { color: '#334155' }]}>
              {user?.walletAddress
                ? `🦊 ${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
                : user?.fullName
                  ? `${user.fullName} (${user.email})`
                  : user?.email}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.logoutBtn,
              { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)' },
            ]}
            onPress={handleLogout}
          >
            <Feather name="log-out" size={16} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* ── Portfolio Stats Card ── */}
        <View style={[styles.portfolioCard, { backgroundColor: isDark ? '#051121' : '#E0F2FE', borderColor: isDark ? '#162C4E' : c.border }]}>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.portfolioLabel, { color: isDark ? '#7DD3FC' : c.primaryDim }]}>YOUR PORTFOLIO VALUE</Text>
            <Text style={[styles.portfolioValue, { color: isDark ? '#FFFFFF' : c.primaryDim }]}>
              {summary.totalValueFormatted}
            </Text>
          </View>
          
          <View style={styles.statsRow}>
            <View style={[styles.statCircle, { backgroundColor: c.blueBg, borderColor: c.primary, borderWidth: 1 }]}>
               <Text style={[styles.statVal, { color: c.primary }]}>{summary.totalCount}</Text>
               <Text style={[styles.statLbl, { color: c.primary }]}>Holdings</Text>
            </View>
            <View style={[styles.statCircle, { backgroundColor: c.amberBg, borderColor: c.amber, borderWidth: 1 }]}>
               <Text style={[styles.statVal, { color: c.amber }]}>{summary.wholeCount}</Text>
               <Text style={[styles.statLbl, { color: c.amber }]}>Whole</Text>
            </View>
            <View style={[styles.statCircle, { backgroundColor: c.greenBg, borderColor: c.green, borderWidth: 1 }]}>
               <Text style={[styles.statVal, { color: c.green }]}>{summary.fractionalCount}</Text>
               <Text style={[styles.statLbl, { color: c.green }]}>Fraction</Text>
            </View>
          </View>
        </View>

        <View>
            {/* ── Holdings Section ── */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: c.warm }]}>
                Your Verified Holdings
              </Text>
              <Text
                style={[
                  styles.privateBadge,
                  { color: c.primary, backgroundColor: c.primaryBg },
                ]}
              >
                🔒 Private to you
              </Text>
            </View>

            {loading ? (
              <View style={styles.loaderWrap}>
                <ActivityIndicator size="large" color={c.primary} />
                <Text style={[styles.loaderText, { color: c.muted }]}>
                  Loading your vault…
                </Text>
              </View>
            ) : holdings.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <View
                  style={[
                    styles.emptyIconCircle,
                    { backgroundColor: c.primaryBg },
                  ]}
                >
                  <Ionicons name="shield-outline" size={32} color={c.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: c.warm }]}>
                  Your Vault is Empty
                </Text>
                <Text style={[styles.emptySub, { color: c.muted }]}>
                  No assets in your account yet. Assets you purchase or list
                  will be securely stored here.
                </Text>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: c.primary }]}
                  onPress={() => navigation.navigate(SCREENS.LIST_ASSET)}
                >
                  <Text style={styles.actionBtnText}>+ List a New Asset</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.ghostActionBtn, { borderColor: c.border }]}
                  onPress={() => navigation.navigate(SCREENS.HOME)}
                >
                  <Text style={[styles.ghostActionBtnText, { color: c.warm }]}>
                    Explore Marketplace
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              holdings.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.holdingCard,
                    { 
                      backgroundColor: isDark ? '#17365D' : c.card, 
                      borderColor: isDark ? '#3B82F6' : c.border,
                      shadowColor: isDark ? '#60A5FA' : '#000000',
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: isDark ? 0.5 : 0.05,
                      shadowRadius: isDark ? 16 : 8,
                      elevation: isDark ? 12 : 2,
                    },
                  ]}
                  onPress={() =>
                    navigation.navigate(SCREENS.ASSET_DETAIL, {
                      asset: {
                        ...item,
                        priceNum: item.price_num || 0,
                        owner: user?.fullName || "You",
                        year: 2024,
                        condition: "Mint",
                        cert: "SA-" + item.id.substring(0, 8).toUpperCase(),
                        trending: false,
                        shares: item.asset_type === "fractional" ? 100 : 1,
                        sharePrice: item.price_num,
                        sharesSold: item.asset_type === "fractional" ? 45 : 1,
                      },
                    })
                  }
                  activeOpacity={0.9}
                >
                  <Image
                    source={{ uri: item.image }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                  <View style={styles.holdingMeta}>
                    <Text
                      style={[styles.holdingCategory, { color: c.primary }]}
                    >
                      {item.category?.toUpperCase()}
                    </Text>
                    <Text
                      style={[styles.holdingName, { color: c.warm }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.holdingType, { color: c.muted }]}>
                      {item.asset_type === "fractional"
                        ? "Fractional Share"
                        : "Whole Asset"}
                    </Text>
                  </View>
                  <View style={styles.holdingRight}>
                    <Text style={[styles.holdingValue, { color: c.warm }]}>
                      {item.price}
                    </Text>
                    <Text
                      style={[
                        styles.holdingGain,
                        { color: item.positive ? c.green : c.red },
                      ]}
                    >
                      {item.gain || "+0%"} ({item.gain_pct || "0%"})
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    marginBottom: 16,
  },
  portfolioCard: {
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 20,
  },
  portfolioLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  portfolioValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  statCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statVal: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  statLbl: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  sub: { fontSize: 12, marginTop: 2 },
  logoutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  privateBadge: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },

  loaderWrap: { padding: 40, alignItems: "center", gap: 12 },
  loaderText: { fontSize: 13, fontWeight: "500" },
  emptyCard: {
    marginHorizontal: 20,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    gap: 12,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 12,
  },
  actionBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
  },
  actionBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  ghostActionBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    width: "100%",
    alignItems: "center",
  },
  ghostActionBtnText: { fontSize: 13, fontWeight: "600" },
  holdingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  holdingMeta: { flex: 1, gap: 2 },
  holdingCategory: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  holdingName: { fontSize: 13, fontWeight: "700" },
  holdingType: { fontSize: 11 },
  holdingRight: { alignItems: "flex-end", gap: 3 },
  holdingValue: { fontSize: 13, fontWeight: "700" },
  holdingGain: { fontSize: 11, fontWeight: "600" },
});
