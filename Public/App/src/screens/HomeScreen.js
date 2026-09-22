// ─── HomeScreen ───────────────────────────────────────────────────────────────
// Home tab — portfolio card, quick actions, Your Assets list, Browse Categories grid

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
  PanResponder,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { getUserVault } from "../services/api";
import { LinearGradient } from "expo-linear-gradient";

// TILE_WIDTH is now computed inside the component via useWindowDimensions
// to avoid stale values that cause layout jumps and hidden icons on load

// ── Category tiles with real Unsplash product images ──────────────────────────
const CATEGORIES = [
  {
    id: "Luxury Watch",
    label: "Watches",
    color: "#0C2340",
    accent: "#38BDF8",
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=400&q=80",
  },
  {
    id: "Fine Art",
    label: "Fine Art",
    color: "#1E0B3B",
    accent: "#A78BFA",
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&q=80",
  },
  {
    id: "Classic Car",
    label: "Classic Cars",
    color: "#2A0E00",
    accent: "#FB923C",
    image:
      "https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=400&q=80",
  },
  {
    id: "Fine Wine",
    label: "Fine Wine",
    color: "#280614",
    accent: "#F472B6",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80",
  },
  {
    id: "Real Estate",
    label: "Real Estate",
    color: "#071C14",
    accent: "#34D399",
    image:
      "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=400&q=80",
  },
  {
    id: "Collectibles",
    label: "Collectibles",
    color: "#0A1A28",
    accent: "#FBBF24",
    image:
      "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400&q=80",
  },
];

// ── Helper to resolve color tier based on % shares bought / funded ──
// Over 75% -> Neon Green, 40% - 60% -> Neon Orange, 30% - 50% (lower) -> Neon Rose/Red
const getFundingTier = (pct) => {
  const p = Number(pct) || 0;
  if (p >= 75) {
    return {
      type: "green",
      accent: "#10B981",
      lightAccent: "#34D399",
      chipBg: "rgba(16, 185, 129, 0.16)",
    };
  }
  if (p >= 40) {
    return {
      type: "orange",
      accent: "#FB923C",
      lightAccent: "#FBBF24",
      chipBg: "rgba(251, 146, 60, 0.16)",
    };
  }
  return {
    type: "red",
    accent: "#F43F5E",
    lightAccent: "#FB7185",
    chipBg: "rgba(244, 63, 94, 0.16)",
  };
};

export default function HomeScreen({ navigation, isDark }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const TILE_WIDTH = (screenWidth - 20 * 2 - 12) / 2;
  const c = useColors(isDark);
  const { user, token, logout } = useAuth();
  const [activeHomeTab, setActiveHomeTab] = useState("Portfolio");
  // ── vault data: holdings from res.holdings, summary from res.summary ──
  const [vaultHoldings, setVaultHoldings] = useState([]);
  const [loadingVault, setLoadingVault] = useState(true);
  const [vaultSummary, setVaultSummary] = useState({
    totalValueFormatted: "R0",
    totalCount: 0,
    wholeCount: 0,
    fractionalCount: 0,
    gainText: "+0.0% MoM",
  });

  // ── MOCK DATA FOR INVESTMENT OPPORTUNITIES ──
  const [fundingAssets, setFundingAssets] = useState([
    {
      id: "mock-fund-1",
      name: "Rolex Daytona 'Paul Newman'",
      category: "Luxury Watch",
      image:
        "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=500&q=80",
      fundedPct: 88,
      sharesRemaining: 15,
    },
    {
      id: "mock-fund-2",
      name: "1962 Ferrari 250 GTO",
      category: "Classic Car",
      image:
        "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=500&q=80",
      fundedPct: 54,
      sharesRemaining: 320,
    },
    {
      id: "mock-fund-3",
      name: "Domaine de la Romanée-Conti 1990",
      category: "Fine Wine",
      image:
        "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500&q=80",
      fundedPct: 36,
      sharesRemaining: 180,
    },
    {
      id: "mock-fund-4",
      name: "Banksy 'Love is in the Air'",
      category: "Fine Art",
      image:
        "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=500&q=80",
      fundedPct: 22,
      sharesRemaining: 420,
    },
  ]);

  // ── Expandable Bottom Section Configuration ──
  const COLLAPSED_HEIGHT = 295;
  const EXPANDED_HEIGHT = Math.min(Math.round(screenHeight * 0.72), 620);

  const scrollViewRef = useRef(null);
  const animatedHeight = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const currentHeightRef = useRef(COLLAPSED_HEIGHT);
  const isExpandedRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    const listener = animatedHeight.addListener(({ value }) => {
      currentHeightRef.current = value;
    });
    return () => {
      animatedHeight.removeListener(listener);
    };
  }, [animatedHeight]);

  const expandSheet = () => {
    setIsExpanded(true);
    isExpandedRef.current = true;
    Animated.spring(animatedHeight, {
      toValue: EXPANDED_HEIGHT,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start(() => {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 50);
    });
  };

  const collapseSheet = () => {
    setIsExpanded(false);
    isExpandedRef.current = false;
    Animated.spring(animatedHeight, {
      toValue: COLLAPSED_HEIGHT,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start();
  };

  const toggleSheet = () => {
    if (isExpandedRef.current) {
      collapseSheet();
    } else {
      expandSheet();
    }
  };

  const handleMainScroll = (event) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const maxScrollY = contentSize.height - layoutMeasurement.height;
    if (
      maxScrollY > 0 &&
      contentOffset.y > maxScrollY + 15 &&
      !isExpandedRef.current
    ) {
      expandSheet();
    }
  };

  const handleMainScrollEndDrag = (event) => {
    const { layoutMeasurement, contentOffset, contentSize, velocity } =
      event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (layoutMeasurement.height + contentOffset.y);
    if (distanceFromBottom <= 40 && !isExpandedRef.current) {
      if (velocity?.y > 0.1 || distanceFromBottom <= 8) {
        expandSheet();
      }
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 6;
      },
      onPanResponderGrant: () => {
        animatedHeight.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        let newH = currentHeightRef.current - gestureState.dy;
        if (newH < COLLAPSED_HEIGHT - 20) newH = COLLAPSED_HEIGHT - 20;
        if (newH > EXPANDED_HEIGHT + 20) newH = EXPANDED_HEIGHT + 20;
        animatedHeight.setValue(newH);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -25 || gestureState.vy < -0.3) {
          expandSheet();
        } else if (gestureState.dy > 25 || gestureState.vy > 0.3) {
          collapseSheet();
        } else {
          if (
            currentHeightRef.current >
            (COLLAPSED_HEIGHT + EXPANDED_HEIGHT) / 2
          ) {
            expandSheet();
          } else {
            collapseSheet();
          }
        }
      },
    }),
  ).current;

  const ACTIVITY_FILTERS = [
    { id: "all", label: "All" },
    { id: "transfers", label: "Transfers", icon: "swap-horizontal" },
    { id: "valuations", label: "Valuations", icon: "trending-up" },
    { id: "certificates", label: "Certificates", icon: "shield-checkmark" },
    { id: "ai", label: "AI Insights", icon: "sparkles" },
  ];

  const recentActivity = [
    {
      id: "act-1",
      category: "transfers",
      title: "Share Purchase Confirmed",
      desc: "5 shares of 1962 Ferrari 250 GTO",
      time: "2h ago",
      icon: "checkmark-circle",
      color: "#10B981",
      iconBg: "rgba(16, 185, 129, 0.18)",
      rightIcon: "chevron-forward",
      targetScreen: SCREENS.VAULT,
    },
    {
      id: "act-2",
      category: "valuations",
      title: "Valuation Updated",
      desc: "Patek Philippe Nautilus up +4.2% MoM",
      time: "5h ago",
      icon: "trending-up",
      color: "#38BDF8",
      iconBg: "rgba(56, 189, 248, 0.18)",
      rightIcon: "chevron-forward",
      targetScreen: SCREENS.SEARCH,
    },
    {
      id: "act-3",
      category: "ai",
      title: "Smart Valuation Alert",
      desc: "Classic car category index shifted +1.8%",
      time: "1d ago",
      icon: "sparkles",
      color: "#A855F7",
      iconBg: "rgba(168, 85, 247, 0.18)",
      rightIcon: "chatbubble-ellipses-outline",
      targetScreen: SCREENS.HEALTH_REPORT,
    },
    {
      id: "act-4",
      category: "certificates",
      title: "Certificate of Authenticity",
      desc: "Digital ownership token verified on-chain",
      time: "2d ago",
      icon: "shield-checkmark",
      color: "#F59E0B",
      iconBg: "rgba(245, 158, 11, 0.18)",
      rightIcon: "document-text-outline",
      targetScreen: SCREENS.CERTIFICATE,
    },
    {
      id: "act-5",
      category: "transfers",
      title: "Dividend Payout Received",
      desc: "+R 245.00 credited from Rare Whisky Fund",
      time: "3d ago",
      icon: "wallet",
      color: "#34D399",
      iconBg: "rgba(52, 211, 153, 0.18)",
      rightIcon: "checkmark-done-outline",
      targetScreen: SCREENS.VAULT,
    },
    {
      id: "act-6",
      category: "ai",
      title: "Portfolio Health Report",
      desc: "Asset diversification score 94/100 (Optimal)",
      time: "4d ago",
      icon: "pulse",
      color: "#6366F1",
      iconBg: "rgba(99, 102, 241, 0.18)",
      rightIcon: "chevron-forward",
      targetScreen: SCREENS.HEALTH_REPORT,
    },
  ];

  const filteredActivities = recentActivity.filter((act) => {
    if (activeFilter === "all") return true;
    return act.category === activeFilter;
  });

  const handleActivityPress = (act) => {
    if (act.targetScreen) {
      navigation.navigate(act.targetScreen);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      if (token) {
        setLoadingVault(true);
        getUserVault(token)
          .then((res) => {
            if (isMounted) {
              if (res?.summary) setVaultSummary(res.summary);
              // API returns res.holdings (not res.assets) — see VaultScreen
              if (res?.holdings) setVaultHoldings(res.holdings.slice(0, 5));
            }
          })
          .catch((err) => console.warn("Vault fetch error:", err.message))
          .finally(() => {
            if (isMounted) setLoadingVault(false);
          });
      } else {
        setLoadingVault(false);
      }
      return () => {
        isMounted = false;
      };
    }, [token]),
  );

  const handleLogout = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out of SmartAssets?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign Out", style: "destructive", onPress: logout },
      ],
    );
  };

  const formatCategoryLabel = (cat) => {
    if (!cat) return "ASSET";
    const lower = String(cat).toLowerCase();
    if (lower.includes("watch")) return "WATCHES";
    if (lower.includes("art")) return "FINE ART";
    if (lower.includes("car") || lower.includes("vehicle")) return "CARS";
    if (lower.includes("wine")) return "WINE";
    if (lower.includes("real")) return "REAL ESTATE";
    return String(cat).toUpperCase();
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#111827" }]}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleMainScroll}
        onScrollEndDrag={handleMainScrollEndDrag}
      >
        {/* ── TOP WHITE-TO-BLUE ISLAND ── */}
        <LinearGradient
          colors={["#FFFFFF", "#F0F8FF", "#a6c2ffff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topWhiteIsland}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.avatarMini}>
                {user?.avatar_url ? (
                  <Image
                    source={{ uri: user.avatar_url }}
                    style={styles.avatarImg}
                  />
                ) : (
                  <Feather name="user" size={18} color="#38BDF8" />
                )}
              </View>
              <View>
                <Text style={styles.greeting}>Welcome back,</Text>
                <Text style={styles.username}>
                  {user?.fullName || user?.email?.split("@")[0] || "Member"}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 7 }}>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="settings" size={18} color="#38BDF8" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="bell" size={18} color="#38BDF8" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => navigation.navigate(SCREENS.SEARCH)}
              >
                <Feather name="search" size={18} color="#38BDF8" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={handleLogout}>
                <Feather name="log-out" size={18} color="#38BDF8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Portfolio Balance Card (The Wallet — Dark Mode with Slight Silver Bottom Gradient) */}
          <View style={styles.portfolioCardContainer}>
            <LinearGradient
              colors={[
                "#000000",
                "#080F1E",
                "#111C30",
                "#1E2A3E",
                "#475569",
                "#94A3B8",
              ]}
              locations={[0, 0.35, 0.6, 0.8, 0.93, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.portfolioCard}
            >
              <View style={styles.portfolioHeader}>
                <View style={styles.gainBadge}>
                  <Feather name="trending-up" size={11} color="#00ff4c62" />
                  {(() => {
                    const text = vaultSummary.gainText || "+4.2% MoM";
                    if (text.toLowerCase().includes("mom")) {
                      const parts = text.split(/mom/i);
                      return (
                        <Text style={styles.gainText}>
                          {parts[0]}
                          <Text style={styles.momText}>MoM</Text>
                          {parts[1] || ""}
                        </Text>
                      );
                    }
                    return <Text style={styles.gainText}>{text}</Text>;
                  })()}
                </View>
                <Text style={styles.cardBrandLabel}>SmartAssets</Text>
              </View>
              <Text style={styles.portfolioLabel}>Portfolio Balance</Text>
              <Text style={styles.portfolioValue}>
                {vaultSummary.totalValueFormatted}
              </Text>
              <View style={styles.cardBottomRow}>
                <View>
                  <Text style={styles.cardChangeLabel}>24h Change</Text>
                  <Text style={styles.cardChangeValue}>
                    +R 68.00 <Text style={styles.cardChangePct}>+4.2%</Text>
                  </Text>
                </View>
                <Ionicons name="shield-checkmark" size={30} color="#F59E0B" />
              </View>
            </LinearGradient>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActionsContainer}>
            <View style={styles.quickActionsHeader}>
              <Text style={styles.quickActionsTitle}>Quick Actions</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate(SCREENS.VAULT)}
              >
                <Text style={styles.seeMoreText}>See More</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.quickActionsGrid}>
              {/* Row 1: Left (Transfer) & Right (Top Up) */}
              <View style={styles.quickActionsRow}>
                <TouchableOpacity
                  style={styles.quickActionCard}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate(SCREENS.VAULT)}
                >
                  <Ionicons name="swap-vertical" size={21} color="#7700ffb6" />
                  <Text style={styles.quickActionLabel}>Transfer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickActionCard}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate(SCREENS.VAULT)}
                >
                  <Ionicons name="add-circle" size={21} color="#7700ffb6" />
                  <Text style={styles.quickActionLabel}>Top Up</Text>
                </TouchableOpacity>
              </View>

              {/* Row 2: Left (Payment) & Right (Profile) */}
              <View style={styles.quickActionsRow}>
                <TouchableOpacity
                  style={styles.quickActionCard}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate(SCREENS.VAULT)}
                >
                  <Ionicons name="card" size={21} color="#7700ffb6" />
                  <Text style={styles.quickActionLabel}>Payment</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickActionCard}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate(SCREENS.PROFILE)}
                >
                  <Ionicons name="person" size={21} color="#7700ffb6" />
                  <Text style={styles.quickActionLabel}>Profile</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </LinearGradient>
        {/* ── END TOP WHITE-TO-BLUE ISLAND ── */}

        {/* ── DARK BLUE GRADIENT BOTTOM HALF ── */}
        <LinearGradient
          colors={["#a6c2ffff", "#4d73d2ff", "#0F1A2E", "#111827"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.darkBottomHalf}
        >
          {/* ════════════════════════════════════════════
              BROWSE CATEGORIES
          ════════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.sectionTitleDark}>Browse Categories</Text>
              <Text style={styles.sectionSubtitle}>
                Explore what SmartAssets offers
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Feather name="chevron-right" size={13} color="#38BDF8" />
            </TouchableOpacity>
          </View>

          {/* Grid rows — 2 columns */}
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryTile,
                  { backgroundColor: cat.color, width: TILE_WIDTH },
                ]}
                onPress={() =>
                  navigation.navigate(SCREENS.SEARCH, {
                    initialCategory: cat.id,
                  })
                }
                activeOpacity={0.88}
              >
                <Image
                  source={{ uri: cat.image }}
                  style={styles.categoryTileImage}
                  resizeMode="cover"
                />
                <LinearGradient
                  colors={["transparent", "rgba(20, 21, 24, 0.9)"]}
                  start={{ x: 0, y: 0.25 }}
                  end={{ x: 0, y: 1 }}
                  style={[
                    styles.categoryTileOverlay,
                    {
                      borderWidth: 1,
                      borderColor: "rgba(184, 190, 200, 0.3)",
                      borderRadius: 16,
                    },
                  ]}
                >
                  <Text style={styles.categoryTileLabel}>{cat.label}</Text>
                  <View
                    style={[
                      styles.categoryAccentDot,
                      { backgroundColor: cat.accent },
                    ]}
                  />
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>

          {/* ════════════════════════════════════════════
              YOUR ASSETS (Horizontal)
          ════════════════════════════════════════════ */}
          <View style={[styles.sectionRow, { marginTop: 28 }]}>
            <View>
              <Text style={styles.sectionTitleDark}>Your Assets</Text>
              <Text style={styles.sectionSubtitle}>
                {vaultSummary.totalCount > 0
                  ? `${vaultSummary.totalCount} holding${vaultSummary.totalCount !== 1 ? "s" : ""} in your portfolio`
                  : "Start building your portfolio"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.VAULT)}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Feather name="chevron-right" size={13} color="#4C86FF" />
            </TouchableOpacity>
          </View>

          {loadingVault ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color="#4C86FF" />
            </View>
          ) : vaultHoldings.length === 0 ? (
            <View style={styles.emptyAssetsCard}>
              <Feather name="briefcase" size={20} color="#4C86FF" />
              <Text style={styles.emptyAssetsTitle}>No holdings yet</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {vaultHoldings.slice(0, 3).map((holding, idx) => (
                <TouchableOpacity
                  key={holding.id || idx}
                  style={styles.listingCardHorizontal}
                  onPress={() =>
                    navigation.navigate(SCREENS.ASSET_DETAIL, {
                      asset: holding,
                    })
                  }
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={["rgba(76,134,255,0.15)", "rgba(15,26,46,0.9)"]}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={{ position: "relative" }}>
                    <Image
                      source={{ uri: holding.image }}
                      style={styles.graphiteCardImg}
                    />
                    <LinearGradient
                      colors={["transparent", "rgba(15,26,46,0.8)", "#0F1A2E"]}
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
                  <View style={styles.graphiteCardContent}>
                    <Text style={styles.graphiteCardTitle} numberOfLines={1}>
                      {holding.name}
                    </Text>
                    <Text style={styles.graphiteCardPrice}>
                      {holding.price || "—"}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ════════════════════════════════════════════
              INVESTMENT OPPORTUNITIES
          ════════════════════════════════════════════ */}
          <View style={[styles.sectionRow, { marginTop: 32 }]}>
            <View>
              <Text style={styles.sectionTitleDark}>
                Investment Opportunities
              </Text>
              <Text style={styles.sectionSubtitle}>
                Active fractional funding rounds
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Feather name="chevron-right" size={13} color="#4C86FF" />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          >
            {[...fundingAssets]
              .sort((a, b) => (b.fundedPct || 0) - (a.fundedPct || 0))
              .map((asset, idx) => {
                const tier = getFundingTier(asset.fundedPct);
                return (
                  <TouchableOpacity
                    key={asset.id || idx}
                    style={styles.investmentOpportunityCard}
                    onPress={() => navigation.navigate(SCREENS.SEARCH)}
                    activeOpacity={0.88}
                  >
                    {/* Image with top % funded badge */}
                    <View style={{ position: "relative" }}>
                      <Image
                        source={{ uri: asset.image }}
                        style={styles.investmentCardImg}
                      />

                      {/* Top Badge with % funded */}
                      <View style={styles.topFundedBadge}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: tier.accent },
                          ]}
                        />
                        <Text
                          style={[styles.topFundedText, { color: tier.accent }]}
                        >
                          {asset.fundedPct}% Funded
                        </Text>
                      </View>
                    </View>

                    {/* Slick Status Bar on the edge of the box itself */}
                    <View style={styles.edgeStatusBarTrack}>
                      <View
                        style={[
                          styles.edgeStatusBarFill,
                          {
                            width: `${asset.fundedPct}%`,
                            backgroundColor: tier.accent,
                          },
                        ]}
                      />
                    </View>

                    {/* Black & Neon Content Box (Vault Portfolio Container style) */}
                    <View style={styles.investmentCardContent}>
                      <Text
                        style={styles.investmentCardTitle}
                        numberOfLines={1}
                      >
                        {asset.name}
                      </Text>

                      <View style={styles.investmentStatsRow}>
                        <Text
                          style={[
                            styles.investmentFundedPct,
                            { color: tier.accent },
                          ]}
                        >
                          {asset.fundedPct}% funded
                        </Text>
                        <Text style={styles.investmentSharesLeft}>
                          {asset.sharesRemaining} left
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>
        </LinearGradient>
        {/* ── END DARK BLUE GRADIENT BOTTOM HALF ── */}

        {/* ════════════════════════════════════════════
            RECENT ACTIVITY (Bottom Sheet at End of Screen)
        ════════════════════════════════════════════ */}
        <Animated.View
          style={[styles.bottomSheetContainer, { height: animatedHeight }]}
        >
          {/* Drag Handle & Header (Receives PanResponder) */}
          <View
            {...panResponder.panHandlers}
            style={styles.sheetHandleTouchArea}
          >
            <View style={styles.dragPill} />
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={toggleSheet}
              style={styles.sheetHeaderRow}
            >
              <View style={styles.sheetTitleGroup}>
                <Text style={styles.sheetTitle}>Recent Activity</Text>
                <View style={styles.sheetBadge}>
                  <Text style={styles.sheetBadgeText}>
                    {filteredActivities.length}
                  </Text>
                </View>
              </View>

              <View style={styles.pullIconBtn}>
                <Text style={styles.pullIconText}>
                  {isExpanded ? "Pull down" : "Pull up"}
                </Text>
                <View style={styles.pullIconCircle}>
                  <Ionicons
                    name={isExpanded ? "chevron-down" : "chevron-up"}
                    size={16}
                    color="#FFFFFF"
                  />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* Horizontal Filter Chips */}
          <View style={styles.sheetFilterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sheetFilterScroll}
            >
              {ACTIVITY_FILTERS.map((tab) => {
                const active = activeFilter === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => setActiveFilter(tab.id)}
                    style={[
                      styles.filterChip,
                      active && styles.filterChipActive,
                    ]}
                    activeOpacity={0.8}
                  >
                    {tab.icon && (
                      <Ionicons
                        name={tab.icon}
                        size={13}
                        color={active ? "#FFFFFF" : "#64748B"}
                        style={{ marginRight: 5 }}
                      />
                    )}
                    <Text
                      style={[
                        styles.filterChipText,
                        active && styles.filterChipTextActive,
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Scrollable List of Activity Cards */}
          <ScrollView
            style={styles.sheetActivityScroll}
            contentContainerStyle={styles.sheetActivityContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            scrollEnabled={isExpanded}
          >
            {filteredActivities.map((act) => (
              <TouchableOpacity
                key={act.id}
                style={styles.activityCard}
                activeOpacity={0.75}
                onPress={() => handleActivityPress(act)}
              >
                <View
                  style={[
                    styles.activityIconCircle,
                    { backgroundColor: act.iconBg || `${act.color}20` },
                  ]}
                >
                  <Ionicons name={act.icon} size={18} color={act.color} />
                </View>
                <View style={styles.activityInfo}>
                  <View style={styles.activityHeader}>
                    <Text style={styles.activityCardTitle} numberOfLines={1}>
                      {act.title}
                    </Text>
                    <Text style={styles.activityCardTime}>{act.time}</Text>
                  </View>
                  <Text style={styles.activityCardDesc} numberOfLines={1}>
                    {act.desc}
                  </Text>
                </View>
                {act.rightIcon && (
                  <Ionicons
                    name={act.rightIcon}
                    size={16}
                    color="#94A3B8"
                    style={styles.activityCardChevron}
                  />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 24 },

  // ── Top White Island ──
  topWhiteIsland: {
    backgroundColor: "#FFFFFF",
    paddingBottom: 0,
    zIndex: 10,
  },

  topSection: { paddingBottom: 24 }, // kept for compat, unused

  // ── Header — balanced, matching Vault styling ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 18,
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
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(56, 189, 248, 0.35)",
  },
  avatarImg: { width: "100%", height: "100%" },
  greeting: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  username: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: "#38BDF8",
  },
  // ── Profile avatar circle ──
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#000000",
    borderWidth: 1.5,
    borderColor: "rgba(56, 189, 248, 0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 17,
    fontWeight: "700",
    color: "#38BDF8",
    letterSpacing: -0.3,
  },

  // ── Icon buttons — matching VaultScreen (40x40) ──
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },

  // ── Portfolio Card / The Wallet ──
  portfolioCardContainer: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 12,
    borderRadius: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  portfolioCard: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "rgba(148, 163, 184, 0.25)",
    overflow: "hidden",
  },
  portfolioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardBrandLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.65)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  gainBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#064E3B",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#059669",
  },
  gainText: { fontSize: 11, fontWeight: "700", color: "#34D399" },
  momText: { fontSize: 11, fontWeight: "700", color: "#FFFFFF" },
  portfolioLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.75)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  portfolioValue: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 18,
    textShadowColor: "rgba(0, 0, 0, 0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  // ── Card bottom: 24h change + gold shield ──
  cardBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  cardChangeLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.65)",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  cardChangeValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardChangePct: {
    fontSize: 12,
    fontWeight: "700",
    color: "#34D399",
  },

  // ── Quick Actions ──
  quickActionsContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
  },
  quickActionsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  // ── Quick Actions title on white bg ──
  quickActionsTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
  },
  seeMoreText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  quickActionsGrid: {
    gap: 10,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  quickActionCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#000000",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
    gap: 12,
  },
  quickActionLabel: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#2f00ff8a",
    letterSpacing: -0.2,
  },

  // ── Main container for sheet overlay ──
  mainContainer: {
    flex: 1,
    position: "relative",
  },

  // ── Dark blue gradient bottom half ──
  darkBottomHalf: {
    paddingTop: 10,
    paddingBottom: 40,
    minHeight: 400,
  },

  // ── Profile card (light blue gradient) ──
  profileCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  profileCardAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(56,189,248,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.3)",
  },
  profileCardName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 3,
  },
  profileCardSub: {
    fontSize: 12,
    color: "rgba(148,163,184,0.9)",
    fontWeight: "400",
  },
  profileCardRight: {
    paddingLeft: 8,
  },

  // ── Section header row ──
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitleDark: {
    fontSize: 15,
    fontWeight: "700",
    color: "#F1F5F9",
    marginBottom: 2,
  },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", color: "#3A5070" },
  viewAllBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  viewAllText: { fontSize: 12, fontWeight: "600", color: "#4C86FF" },

  // ── Graphite Card System (Horizontal Lists) ──
  loadingWrap: { paddingVertical: 20, alignItems: "center" },
  emptyAssetsCard: {
    marginHorizontal: 20,
    backgroundColor: "#1F2126",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    gap: 8,
  },
  emptyAssetsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#CBD5E1",
  },
  listingCardHorizontal: {
    width: 220,
    backgroundColor: "#0F1A2E",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(76, 134, 255, 0.2)",
  },
  graphiteCardHorizontal: {
    width: 220,
    backgroundColor: "#1F2126",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  graphiteCardImg: {
    width: "100%",
    height: 120,
  },
  graphiteCardContent: {
    padding: 14,
  },
  graphiteCardCat: {
    fontSize: 10,
    fontWeight: "700",
    color: "#4C86FF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  graphiteCardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  graphiteCardPrice: {
    fontSize: 13,
    fontWeight: "700",
    color: "#CBD5E1",
  },

  // ── Funding Specific Styles ──
  fundingBarBg: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginBottom: 6,
    overflow: "hidden",
  },
  fundingBarFill: {
    height: "100%",
    backgroundColor: "#34D399",
    borderRadius: 2,
  },
  fundingStats: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  fundingStatText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#94A3B8",
  },

  // ── Investment Opportunities (Black & Blue Neon Vault Container Style) ──
  investmentOpportunityCard: {
    width: 220,
    backgroundColor: "#000000",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  cardTopAccentBorder: {
    height: 3.5,
    width: "100%",
  },
  investmentCardImg: {
    width: "100%",
    height: 120,
  },
  topFundedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(10, 15, 29, 0.88)",
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4.5,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  topFundedText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  edgeStatusBarTrack: {
    height: 4,
    width: "100%",
    backgroundColor: "#0F172A",
  },
  edgeStatusBarFill: {
    height: "100%",
  },
  investmentCardContent: {
    padding: 14,
    backgroundColor: "#000000",
  },
  cardCategoryChip: {
    flexDirection: "row",
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    marginBottom: 6,
  },
  cardCategoryText: {
    fontSize: 9.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  investmentCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F1F5F9",
    marginBottom: 10,
  },
  investmentStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  investmentFundedPct: {
    fontSize: 12,
    fontWeight: "700",
  },
  investmentSharesLeft: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#94A3B8",
  },

  // ── Expandable Bottom Section Styles (Light Mode) ──
  bottomSheetContainer: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderBottomWidth: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
    overflow: "hidden",
    marginTop: 24,
  },
  sheetHandleTouchArea: {
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  dragPill: {
    width: 44,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 4,
  },
  sheetTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  sheetBadge: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  sheetBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2563EB",
  },
  pullIconBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F1F5F9",
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  pullIconText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#334155",
  },
  pullIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sheetFilterRow: {
    marginBottom: 10,
  },
  sheetFilterScroll: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  filterChipActive: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },
  filterChipText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#64748B",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  sheetActivityScroll: {
    flex: 1,
  },
  sheetActivityContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 10,
  },
  activityCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 12,
  },
  activityIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  activityInfo: {
    flex: 1,
  },
  activityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  activityCardTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#0F172A",
    flex: 1,
    marginRight: 8,
  },
  activityCardTime: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "500",
  },
  activityCardDesc: {
    fontSize: 12,
    color: "#64748B",
  },
  activityCardChevron: {
    marginLeft: 4,
  },

  // ── Browse Categories grid ──
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 8,
  },
  categoryTile: {
    // width is set inline from the TILE_WIDTH computed via useWindowDimensions
    height: 120,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
  },
  categoryTileImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
  },
  categoryTileOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 11,
    paddingBottom: 10,
    paddingTop: 28,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  categoryTileLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  categoryAccentDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginBottom: 2,
  },
});
