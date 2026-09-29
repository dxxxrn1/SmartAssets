// ─── HomeScreen ───────────────────────────────────────────────────────────────
// Home tab — net worth hero, quick actions, Your Assets, vault teaser, investment opps, recent activity
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
// Gradients flow from pure White (#FFFFFF) to the darkest color of each % tier
const getFundingTier = (pct) => {
  const p = Number(pct) || 0;
  if (p >= 75) {
    return {
      type: "green",
      gradient: ["#FFFFFF", "rgba(174, 0, 255, 1)ff", "#059669", "#064E3B"],
      accent: "#10B981",
      pillBg: "#065F46",
      pillText: "#FFFFFF",
      lightAccent: "#34D399",
      text: "#0F172A",
      isDark: false,
      statusBarFill: "#059669",
    };
  }
  if (p >= 40) {
    return {
      type: "orange",
      gradient: ["#FFFFFF", "rgba(174, 0, 255, 1)ff", "#EA580C", "#7C2D12"],
      accent: "#F97316",
      pillBg: "#9A3412",
      pillText: "#FFFFFF",
      lightAccent: "#FB923C",
      text: "#0F172A",
      isDark: false,
      statusBarFill: "#EA580C",
    };
  }
  return {
    type: "dark",
    gradient: ["#FFFFFF", "rgba(174, 0, 255, 1)ff", "#0284C7", "#082F49"],
    accent: "#0EA5E9",
    pillBg: "#075985",
    pillText: "#FFFFFF",
    lightAccent: "#38BDF8",
    text: "#0F172A",
    isDark: false,
    statusBarFill: "#0284C7",
  };
};

// ── Helper to render text with a left-to-right color gradient across each letter ──
// Wallet gradient default: #976af0 (Purple) to #00fbff (Cyan)
const GradientText = ({
  text,
  style,
  startColor = { r: 151, g: 106, b: 240 }, // #976af0 (Purple)
  endColor = { r: 0, g: 251, b: 255 }, // #00fbff (Cyan)
}) => {
  const str = String(text || "");
  const chars = Array.from(str);
  const total = chars.length;

  return (
    <Text style={style}>
      {chars.map((char, i) => {
        const t = total > 1 ? i / (total - 1) : 0;
        const r = Math.round(startColor.r + (endColor.r - startColor.r) * t);
        const g = Math.round(startColor.g + (endColor.g - startColor.g) * t);
        const b = Math.round(startColor.b + (endColor.b - startColor.b) * t);
        return (
          <Text key={`${char}-${i}`} style={{ color: `rgb(${r}, ${g}, ${b})` }}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
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
    totalValueNum: 0,
    availableBalanceFormatted: "R0",
    availableBalanceNum: 0,
    portfolioValueFormatted: "R0",
    portfolioValueNum: 0,
    totalCount: 0,
    wholeCount: 0,
    fractionalCount: 0,
    gainText: "+0.0% MoM",
  });
  const [showBalance, setShowBalance] = useState(true);

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
      style={styles.safe}
    >
      <LinearGradient
        colors={["#ECEBFA", "#F0EEFB", "#F7F5FE", "#FBF7FA", "#FFF8F2", "#FFF7EF"]}
        locations={[0, 0.15, 0.5, 0.7, 0.9, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.scroll, { backgroundColor: "transparent" }]}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleMainScroll}
          onScrollEndDrag={handleMainScrollEndDrag}
        >
          {/* ── TOP ISLAND ── */}
          <View style={[styles.topWhiteIsland, { backgroundColor: "transparent" }]}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerWelcomeText}>Welcome Back</Text>
              <GradientText
                text={
                  user?.fullName ||
                  user?.email?.split("@")[0] ||
                  "Robin Mathuis"
                }
                style={styles.headerUsername}
              />
            </View>

            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => navigation.navigate(SCREENS.SEARCH)}
              >
                <Feather name="search" size={17} color="#0F172A" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="bell" size={17} color="#0F172A" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.avatarMini}
                onPress={() => navigation.navigate(SCREENS.PROFILE)}
                activeOpacity={0.8}
              >
                {user?.avatar_url || user?.avatarUrl ? (
                  <Image
                    source={{ uri: user.avatar_url || user.avatarUrl }}
                    style={styles.avatarImg}
                  />
                ) : (
                  <Feather name="user" size={18} color="#0F172A" />
                )}
              </TouchableOpacity>
            </View>
          </View>
          {/* ════════════════════════════════════════════
              THE WALLET CARD (Dual-Tone Purple & Lavender Stack)
          ════════════════════════════════════════════ */}
          <View style={styles.walletCardOuterContainer}>
            <View style={styles.walletStackRow}>
              {/* Main Dual-Tone Card */}
              <View style={styles.walletDualCard}>
                {/* Purple Top Section */}
                <LinearGradient
                  colors={["#976af0ff", "#00fbffff"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.walletPurpleTop}
                >
                  {/* Two-column layout: left (label+balance+pill) | right (shield+lock) */}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    {/* Left column */}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.walletPurpleLabel}>
                        Personal Assets
                      </Text>
                      <Text
                        style={[styles.walletPurpleBalance, { marginTop: 4 }]}
                      >
                        {showBalance
                          ? (() => {
                              const liq = vaultSummary.availableBalanceNum || 0;
                              const port = vaultSummary.portfolioValueNum || 0;
                              const netWorth = liq + port;
                              if (netWorth === 0)
                                return (
                                  vaultSummary.totalValueFormatted ||
                                  "R 1,299.00"
                                );
                              return (
                                "R " +
                                netWorth.toLocaleString("en-ZA", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })
                              );
                            })()
                          : "R • • • • • •"}
                      </Text>
                      {/* Growth pill under balance */}
                      <View
                        style={[
                          styles.walletGrowthPill,
                          { marginTop: 8, alignSelf: "flex-start" },
                        ]}
                      >
                        <Ionicons
                          name="trending-up"
                          size={13}
                          color="#2563EB"
                        />
                        <Text style={styles.walletGrowthPillText}>+4.2%</Text>
                      </View>
                    </View>

                    {/* Right: lock on the bottom right */}
                    <View
                      style={{
                        alignItems: "center",
                        alignSelf: "flex-end",
                      }}
                    >
                      <Ionicons name="lock-closed" size={26} color="#F59E0B" />
                    </View>
                  </View>
                </LinearGradient>

                {/* Yellow Bottom Section Matching Side Peek */}
                <LinearGradient
                  colors={["#E5FF00", "#31322c"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.walletLavenderBottom}
                >
                  {/* Left: Account Balance */}
                  <View style={styles.walletBottomCol}>
                    <Text style={styles.walletBottomLabel}>
                      Account Balance
                    </Text>
                    <TouchableOpacity
                      style={styles.walletBalanceToggleRow}
                      onPress={() => setShowBalance(!showBalance)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.walletBottomValue}>
                        {showBalance
                          ? vaultSummary.availableBalanceFormatted || "R 0.00"
                          : "••••••••"}
                      </Text>
                      <Ionicons
                        name={showBalance ? "eye-outline" : "eye-off-outline"}
                        size={15}
                        color="#FFFFFF"
                        style={{ marginLeft: 6 }}
                      />
                    </TouchableOpacity>
                  </View>
                  {/* Right: Vault ID */}
                  <View
                    style={[styles.walletBottomCol, { alignItems: "flex-end" }]}
                  >
                    <Text style={styles.walletBottomLabel}>Vault ID</Text>
                    <Text style={styles.walletBottomCode}>
                      {vaultSummary.accountNumber || "SA-8525-9632"}
                    </Text>
                  </View>
                </LinearGradient>
              </View>
              {/* Right Green Card Peek (Matching reference screenshot) */}
              {/* <View style={styles.walletGreenPeek} /> */}
            </View>
          </View>
          {/* ════════════════════════════════════════════
              QUICK ACTIONS
          ════════════════════════════════════════════ */}
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
              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate(SCREENS.VAULT)}
              >
                <View style={styles.quickActionIconCircle}>
                  <Ionicons name="swap-vertical" size={20} color="#0F172A" />
                </View>
                <Text style={styles.quickActionLabel}>Transfer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate(SCREENS.VAULT)}
              >
                <View style={styles.quickActionIconCircle}>
                  <Ionicons name="add-circle" size={20} color="#0F172A" />
                </View>
                <Text style={styles.quickActionLabel}>Top Up</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate(SCREENS.VAULT)}
              >
                <View style={styles.quickActionIconCircle}>
                  <Ionicons name="card" size={20} color="#0F172A" />
                </View>
                <Text style={styles.quickActionLabel}>Payment</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate(SCREENS.PROFILE)}
              >
                <View style={styles.quickActionIconCircle}>
                  <Ionicons name="person" size={20} color="#0F172A" />
                </View>
                <Text style={styles.quickActionLabel}>Profile</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {/* ── END TOP ISLAND ── */}

        {/* ── BOTTOM HALF ── */}
        <View style={styles.darkBottomHalf}>
          {/* ════════════════════════════════════════════
              YOUR ASSETS (Horizontal)
          ════════════════════════════════════════════ */}
          <View style={[styles.sectionRow, { marginTop: 16 }]}>
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
                    colors={["rgba(99,160,255,0.05)", "rgba(148,196,255,0.08)"]}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={{ position: "relative" }}>
                    <Image
                      source={{ uri: holding.image }}
                      style={styles.graphiteCardImg}
                    />
                    <LinearGradient
                      colors={["transparent", "rgba(76,134,255,0.12)", "rgba(99,160,255,0.22)"]}
                      locations={[0, 0.6, 1]}
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 48,
                      }}
                    />
                  </View>
                  <View style={styles.graphiteCardContent}>
                    <Text style={styles.graphiteCardCat} numberOfLines={1}>
                      {holding.category || "ASSET"}
                    </Text>
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
                    {/* Image */}
                    <Image
                      source={{ uri: asset.image }}
                      style={styles.investmentCardImg}
                    />

                    {/* Slick Status Bar on the edge of the box itself */}
                    <View style={styles.edgeStatusBarTrack}>
                      <View
                        style={[
                          styles.edgeStatusBarFill,
                          {
                            width: `${asset.fundedPct}%`,
                            backgroundColor: tier.statusBarFill || "#000000",
                          },
                        ]}
                      />
                    </View>

                    {/* Content Box with corresponding tier gradient */}
                    <LinearGradient
                      colors={tier.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.investmentCardContent,
                        tier.isDark && styles.investmentCardContentDark,
                      ]}
                    >
                      <Text
                        style={[
                          styles.investmentCardTitle,
                          tier.isDark && styles.investmentCardTitleDark,
                        ]}
                        numberOfLines={1}
                      >
                        {asset.name}
                      </Text>

                      <View style={styles.investmentStatsRow}>
                        <View
                          style={[
                            styles.investmentPctPill,
                            { backgroundColor: tier.pillBg },
                          ]}
                        >
                          <Text
                            style={[
                              styles.investmentFundedPct,
                              { color: tier.pillText },
                            ]}
                          >
                            {asset.fundedPct}% funded
                          </Text>
                        </View>
                        <Text style={styles.investmentSharesLeft}>
                          {asset.sharesRemaining} left
                        </Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>

          {/* ════════════════════════════════════════════
              PORTFOLIO SNAPSHOT (Takes space of My Vault)
          ════════════════════════════════════════════ */}
          <View style={[styles.sectionRow, { marginTop: 32 }]}>
            <View>
              <Text style={styles.sectionTitleDark}>Portfolio</Text>
              <Text style={styles.sectionSubtitle}>
                Performance & asset summary
              </Text>
            </View>
          </View>

          <View style={styles.portfolioSnapshotGrid}>
            {/* Left Card: Our Assets (Left blue-purple half of reference gradient) */}
            <TouchableOpacity
              style={styles.snapshotCardDarkWrap}
              activeOpacity={0.85}
              onPress={() => navigation.navigate(SCREENS.VAULT)}
            >
              <LinearGradient
                colors={["#d7d1f3ff", "#7B4CF0"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.snapshotCardDark}
              >
                <View style={styles.snapshotIconCircleDark}>
                  <Feather name="arrow-down" size={18} color="#2563EB" />
                </View>

                <Text style={styles.snapshotCardLabelDark}>Assets</Text>
                <Text style={styles.snapshotCardValueDark}>
                  {vaultSummary.portfolioValueNum > 0
                    ? vaultSummary.portfolioValueFormatted
                    : "R 1,299"}
                </Text>
                <Text style={styles.snapshotCardSubDark}>
                  <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>
                    +R 243
                  </Text>{" "}
                  this month
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Right Card: Investment Perf (Right lighter orchid-coral half of reference gradient) */}
            <TouchableOpacity
              style={styles.snapshotCardLightBlueWrap}
              activeOpacity={0.85}
              onPress={() => navigation.navigate(SCREENS.VAULT)}
            >
              <LinearGradient
                colors={["#A852D4", "#EE6F82"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.snapshotCardLightBlue}
              >
                <View style={styles.snapshotIconCircleLightBlue}>
                  <Feather name="arrow-up" size={18} color="#2563EB" />
                </View>

                <Text style={styles.snapshotCardLabelLightBlue}>
                  Investment Perf
                </Text>
                <Text style={styles.snapshotCardValueLightBlue}>
                  {vaultSummary.gainText &&
                  vaultSummary.gainText !== "+0.0% MoM"
                    ? vaultSummary.gainText
                    : "+18.7%"}
                </Text>
                <Text style={styles.snapshotCardSubLightBlue}>
                  <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>
                    +R 243
                  </Text>{" "}
                  net return
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
        {/* ── END DARK BLUE GRADIENT BOTTOM HALF ── */}

        {/* ════════════════════════════════════════════
            RECENT ACTIVITY (Bottom Sheet at End of Screen)
        ════════════════════════════════════════════ */}
        <Animated.View
          style={[styles.bottomSheetContainer, { height: animatedHeight }]}
        >
          <LinearGradient
            colors={["#FAF5FF", "#F6F0FE", "#FBF7FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
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
    </LinearGradient>
  </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ECEBFA" },
  scroll: { flexGrow: 1, backgroundColor: "transparent" },

  // ── Top White Island ──
  topWhiteIsland: {
    backgroundColor: "transparent",
    paddingBottom: 20,
    zIndex: 10,
  },

  topSection: { paddingBottom: 24 }, // kept for compat, unused

  // ── Header — inspired by modern reference ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerWelcomeText: {
    fontSize: 12.5,
    fontWeight: "500",
    color: "#94A3B8",
    marginBottom: 2,
  },
  headerUsername: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "#171B26",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarMini: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#171B26",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarImg: { width: "100%", height: "100%" },

  // ── Dual-Tone Wallet Card (Reference Design) ──
  walletCardOuterContainer: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 16,
  },
  walletStackRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  walletDualCard: {
    flex: 1,
    borderRadius: 22,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  walletPurpleTop: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  walletPurpleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  walletPurpleLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.85)",
  },
  walletBrandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  walletBrandText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  walletPurpleBalance: {
    fontSize: 27,
    fontWeight: "800",
    color: "#ffffffff",
    letterSpacing: -0.5,
  },
  walletLavenderBottom: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  walletGrowthPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  walletGrowthPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563EB",
    letterSpacing: 0.2,
  },
  walletBottomCol: {
    justifyContent: "center",
  },
  walletBottomLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 3,
  },
  walletBalanceToggleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  walletBottomValue: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  walletBottomCode: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  walletGreenPeek: {
    width: 14,
    backgroundColor: "#e5ff00c0",
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    marginLeft: 7,
    height: "76%",
    alignSelf: "center",
  },
  cardChangePct: {
    fontSize: 12,
    fontWeight: "700",
    color: "#34D399",
  },

  // ── Portfolio Snapshot Grid (Design inspired by reference image) ──
  portfolioSnapshotGrid: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  snapshotCardDarkWrap: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
  },
  snapshotCardDark: {
    flex: 1,
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  snapshotIconCircleDark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  snapshotCardLabelDark: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.85)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  snapshotCardValueDark: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  snapshotCardSubDark: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.85)",
  },

  snapshotCardLightBlueWrap: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
  },
  snapshotCardLightBlue: {
    flex: 1,
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  snapshotIconCircleLightBlue: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  snapshotCardLabelLightBlue: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.85)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  snapshotCardValueLightBlue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  snapshotCardSubLightBlue: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.85)",
  },

  // ── Quick Actions ──
  quickActionsContainer: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  quickActionsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  quickActionsTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  seeMoreText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563EB",
  },
  quickActionsGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  quickActionCard: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  quickActionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
    letterSpacing: -0.2,
    textAlign: "center",
  },

  // ── Vault Teaser Card — pure black, matching VaultScreen portfolioSection ──
  vaultTeaserCard: {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: "#000000",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  vaultTeaserRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  vaultTeaserLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38BDF8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  vaultTeaserValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  vaultTeaserActions: {
    flexDirection: "row",
    gap: 12,
  },
  vaultTeaserBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#4C86FF",
    paddingVertical: 12,
    borderRadius: 12,
  },
  vaultTeaserBtnOutline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#4C86FF",
  },
  vaultTeaserBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // ── Main container for sheet overlay ──
  mainContainer: {
    flex: 1,
    position: "relative",
  },

  // ── Dark blue gradient bottom half ──
  darkBottomHalf: {
    paddingTop: 16,
    paddingBottom: 40,
    minHeight: 400,
    backgroundColor: "transparent",
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
    color: "#0F172A",
    marginBottom: 2,
  },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", color: "#64748B" },
  viewAllBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  viewAllText: { fontSize: 12, fontWeight: "600", color: "#2563EB" },

  // ── Graphite Card System (Horizontal Lists) ──
  loadingWrap: { paddingVertical: 20, alignItems: "center" },
  emptyAssetsCard: {
    marginHorizontal: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
  },
  emptyAssetsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  listingCardHorizontal: {
    width: 220,
    backgroundColor: "#EEF4FF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(76,134,255,0.15)",
  },
  graphiteCardHorizontal: {
    width: 220,
    backgroundColor: "#EEF4FF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(76,134,255,0.15)",
  },
  graphiteCardImg: {
    width: "100%",
    height: 120,
  },
  graphiteCardContent: {
    padding: 14,
    backgroundColor: "rgba(238,244,255,0.97)",
    borderTopWidth: 1,
    borderTopColor: "rgba(76,134,255,0.12)",
  },
  graphiteCardCat: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6BA3FF",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  graphiteCardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1A2744",
    marginBottom: 6,
  },
  graphiteCardPrice: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4C86FF",
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
    height: 3.5,
    width: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  edgeStatusBarFill: {
    height: "100%",
    backgroundColor: "#16A34A",
  },
  investmentCardContent: {
    padding: 14,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: "rgba(255, 255, 255, 0.15)",
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
    fontSize: 14.5,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  investmentStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  investmentPctPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  investmentFundedPct: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.1,
  },
  investmentSharesLeft: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  investmentCardContentDark: {
    borderWidth: 1.2,
    borderTopWidth: 0,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  investmentCardTitleDark: {
    color: "#0F172A",
  },

  // ── Expandable Bottom Section Styles (Light Mode) ──
  bottomSheetContainer: {
    backgroundColor: "#FAF5FF",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: "#EDE9FE",
    borderBottomWidth: 0,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 6,
    overflow: "hidden",
    marginTop: "auto",
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
    backgroundColor: "#DDD6FE",
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
    backgroundColor: "#F3E8FF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E9D5FF",
  },
  sheetBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
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