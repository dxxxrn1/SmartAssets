// ─── HomeScreen ───────────────────────────────────────────────────────────────
// SmartAssets Modern Glassmorphism Theme (Mockup 2025/2026)
// Featuring Luminous Mesh Gradient Canvas, Portfolio Value Card with Wave Curve,
// Smart AI Insight Card, and Curated "Assets worth watching" Marketplace Showcase.

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
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { getUserVault, resolveImageUrl } from "../services/api";
import { SCREENS } from "../constants/navigation";
import storage, { STORAGE_KEYS } from "../utils/storage";

// ── Currency Formatter (South African Rand R as in design mockups) ────────────────
const formatZAR = (val, fallback = "R1,296,700") => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "string" && val.startsWith("R")) return val;
  if (typeof val === "string" && val.startsWith("£")) {
    return "R" + val.replace(/^£\s?/, "");
  }
  const num =
    typeof val === "number"
      ? val
      : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return String(val);
  return "R" + num.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
};
const formatGBP = formatZAR;

// ── Browse Categories Data ───────────────────────────────────────────────────
const CATEGORY_CARDS = [
  {
    id: "watches",
    name: "Watches",
    categoryKey: "Watches",
    dotColor: "#38BDF8", // Cyan dot
    image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&fit=crop&q=80",
  },
  {
    id: "art",
    name: "Fine Art",
    categoryKey: "Art",
    dotColor: "#A855F7", // Purple dot
    image: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&fit=crop&q=80",
  },
  {
    id: "cars",
    name: "Classic Cars",
    categoryKey: "Cars",
    dotColor: "#FB923C", // Orange dot
    image: "https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=600&fit=crop&q=80",
  },
  {
    id: "wine",
    name: "Fine Wine",
    categoryKey: "Wine",
    dotColor: "#F472B6", // Pink dot
    image: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&fit=crop&q=80",
  },
];

// ── Curated "Assets worth watching" Mockup Data ──────────────────────────────
const CURATED_ASSETS = [
  {
    id: "curated-1",
    category: "WATCHES",
    filterId: "watches",
    name: "Rolex Daytona 116500LN",
    price: "R34,500",
    gain: "+12.4%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&q=80",
    confidence: "96% confidence",
  },
  {
    id: "curated-2",
    category: "ART",
    filterId: "art",
    name: "Untitled, 1984",
    price: "R124,000",
    gain: "+6.8%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&q=80",
    confidence: "91% confidence",
  },
  {
    id: "curated-3",
    category: "CARS",
    filterId: "cars",
    name: "1967 Ferrari 330 GTC",
    price: "R890,000",
    gain: "+9.1%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&q=80",
    confidence: "94% confidence",
  },
  {
    id: "curated-4",
    category: "WINE",
    filterId: "wine",
    name: "Romanée-Conti Grand Cru 1990",
    price: "R28,900",
    gain: "+14.2%",
    isVerified: true,
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&q=80",
    confidence: "95% confidence",
  },
];

// ── Smooth Sine-Wave Line Component (Web SVG or Native line segments) ────────
const PortfolioWaveGraph = () => {
  if (Platform.OS === "web") {
    return (
      <View style={styles.waveContainer}>
        <svg
          viewBox="0 0 420 64"
          preserveAspectRatio="none"
          style={{ width: "100%", height: 52, overflow: "visible" }}
        >
          <path
            d="M 0,38 C 50,14 85,54 140,42 C 190,28 230,50 285,24 C 335,8 370,26 420,18"
            fill="none"
            stroke="rgba(255, 255, 255, 0.95)"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>
      </View>
    );
  }

  // Cross-platform native fallback using connected smooth curve segments
  return (
    <View style={styles.waveContainerNative}>
      <View style={styles.waveTrackNative}>
        <View style={[styles.waveDot, { left: "0%", top: 28 }]} />
        <View style={[styles.waveDot, { left: "15%", top: 12 }]} />
        <View style={[styles.waveDot, { left: "30%", top: 38 }]} />
        <View style={[styles.waveDot, { left: "50%", top: 24 }]} />
        <View style={[styles.waveDot, { left: "70%", top: 34 }]} />
        <View style={[styles.waveDot, { left: "85%", top: 10 }]} />
        <View style={[styles.waveDot, { left: "100%", top: 16 }]} />
        <View style={styles.waveLineNative} />
      </View>
    </View>
  );
};

export default function HomeScreen({ navigation }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 840;
  const { user, token, logout } = useAuth();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingVault, setLoadingVault] = useState(true);
  const [vaultSummary, setVaultSummary] = useState({
    totalValueFormatted: "R1,077",
    portfolioValueFormatted: "R1,077",
    portfolioValueNum: 1077,
    totalCount: 5,
    categoriesCount: 4,
    verifiedPct: 96,
    annualGainFormatted: "+12.4% overall gain",
    gainPct: "↑ 12.4%",
  });
  const [vaultHoldings, setVaultHoldings] = useState([]);

  // Fetch Vault Data with unified dynamic formula: personalTotal + fractionalTotal + escrowCash
  const loadVaultData = useCallback(async () => {
    // 1. Immediately compute from local storage for instant real-time sync with VaultScreen
    try {
      const [cachedPersonal, cachedFractions, cachedCash, cachedVault] =
        await Promise.all([
          storage.getJSON(STORAGE_KEYS.PERSONAL_COLLECTION),
          storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS),
          storage.getJSON(STORAGE_KEYS.ESCROW_CASH),
          storage.getJSON(STORAGE_KEYS.VAULT),
        ]);

      const personalList =
        Array.isArray(cachedPersonal) && cachedPersonal.length > 0
          ? cachedPersonal
          : [
              { initialValue: 150, liveMarketValue: 132 },
              { initialValue: 120, liveMarketValue: 137 },
              { initialValue: 65, liveMarketValue: 58 },
            ];

      const fractionalList =
        Array.isArray(cachedFractions) && cachedFractions.length > 0
          ? cachedFractions
          : [{ myStake: 200 }, { myStake: 200 }];

      const cashNum = typeof cachedCash === "number" ? cachedCash : 250;

      const pTotal = personalList.reduce(
        (sum, it) =>
          sum + (Number(it.liveMarketValue) || Number(it.initialValue) || 0),
        0
      );
      const fTotal = fractionalList.reduce(
        (sum, it) => sum + (Number(it.myStake) || 0),
        0
      );
      const combinedTotalNum = pTotal + fTotal + cashNum;
      const combinedCount = personalList.length + fractionalList.length;

      setVaultSummary((prev) => ({
        ...prev,
        portfolioValueFormatted: formatGBP(combinedTotalNum),
        portfolioValueNum: combinedTotalNum,
        totalValueFormatted: formatGBP(combinedTotalNum),
        totalCount: combinedCount,
      }));

      if (cachedVault?.holdings && Array.isArray(cachedVault.holdings)) {
        setVaultHoldings(cachedVault.holdings);
      }
    } catch (_) {}

    // 2. Fetch live if token available
    if (!token) {
      setLoadingVault(false);
      return;
    }

    try {
      setLoadingVault(true);
      const res = await getUserVault(token);
      if (res?.holdings && Array.isArray(res.holdings)) {
        setVaultHoldings(res.holdings);
      }
      if (res?.summary) {
        await storage.setJSON(STORAGE_KEYS.VAULT, {
          summary: res.summary,
          holdings: res?.holdings,
        });
      }
    } catch (err) {
      console.warn("[HomeScreen] Vault load fallback:", err.message);
      if (
        err.message?.includes("Unauthorized") ||
        err.message?.includes("Session expired") ||
        err.message?.includes("invalid token")
      ) {
        logout();
      }
    } finally {
      setLoadingVault(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadVaultData();
    }, [loadVaultData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadVaultData();
  };

  // Derive user display name & photo
  const userName =
    user?.firstName ||
    user?.fullName?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "James";

  const userPhoto =
    user?.avatarUrl ||
    user?.avatar_url ||
    user?.avatar ||
    user?.photoURL ||
    user?.profileImage;

  const userInitials = (
    user?.fullName
      ? user.fullName
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
      : "JH"
  ).toUpperCase();

  return (
    <View style={styles.rootContainer}>
      {/* ── Background Mesh Gradient (Full Screen Edge-to-Edge) ──────────────── */}
      <LinearGradient
        colors={[
          "#e4e0ffff", // Soft luminous lavender
          "#e0daffff", // Soft purple aura
          "#f5dfefff", // Soft lilac-pink
          "#fff5efff", // Soft peach aura
          "#ffffffff", // Ambient cream
        ]}
        locations={[0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { pointerEvents: "none" }]}
      />

      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#976af0"
            colors={["#976af0", "#00fbff"]}
          />
        }
      >
        {/* ── TOP APP BAR / BRAND HEADER ───────────────────────────────────────── */}
        <View style={styles.appBar}>
          {/* Logo & Brand Name */}
          <View style={styles.brandGroup}>
            <LinearGradient
              colors={["#976af0", "#00fbff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoBadge}
            >
              <Ionicons name="diamond" size={17} color="#FFFFFF" />
            </LinearGradient>
            <Text style={styles.brandTitle}>SmartAssets</Text>
          </View>

          {/* Right: Profile Avatar Icon (Add asset removed) */}
          <View style={styles.appBarRight}>
            <TouchableOpacity
              style={styles.profileAvatarBtn}
              onPress={() => navigation.navigate(SCREENS.PROFILE)}
              activeOpacity={0.8}
            >
              {userPhoto ? (
                <Image
                  source={{ uri: resolveImageUrl(userPhoto) }}
                  style={styles.profileAvatarImg}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.profileAvatarFallback}>
                  <Text style={styles.profileInitialsText}>{userInitials}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── GREETING & ACTIVITY BAR ─────────────────────────────────────────── */}
        <View style={styles.greetingRow}>
          <View style={styles.greetingTextCol}>
            <Text style={styles.greetingHelloText}>Good morning,</Text>
            <Text style={styles.greetingUserNameText} numberOfLines={1}>
              {userName}
            </Text>
            <Text style={styles.greetingSubtitle} numberOfLines={1}>
              Your collection gained R185 while you were away.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.activityPillBtn}
            onPress={() => navigation.navigate(SCREENS.VAULT)}
            activeOpacity={0.8}
          >
            <Ionicons
              name="notifications-outline"
              size={16}
              color="#0F172A"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.activityPillText}>Activity</Text>
          </TouchableOpacity>
        </View>

        {/* ── PORTFOLIO VALUE CARD ────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.portfolioCard}
          activeOpacity={0.92}
          onPress={() => navigation.navigate(SCREENS.VAULT)}
        >
          <LinearGradient
            colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.85 }}
            style={styles.portfolioCardGradient}
          >
            <View style={styles.portfolioHeader}>
              <Text style={styles.portfolioLabel}>PORTFOLIO VALUE</Text>
              <View style={styles.barChartBadge}>
                <Feather name="bar-chart-2" size={16} color="#FFFFFF" />
              </View>
            </View>

            <Text style={styles.portfolioValueNumber}>
              {vaultSummary.portfolioValueFormatted || "R1,296,700"}
            </Text>

            <View style={styles.gainRow}>
              <View
                style={[
                  styles.growthPill,
                  { flexDirection: "row", alignItems: "center" },
                ]}
              >
                <Feather
                  name="trending-up"
                  size={12}
                  color="#FFFFFF"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.growthPillText}>8.4%</Text>
              </View>
              <Text style={styles.yearlyGainText}>+R185 this month</Text>
            </View>

            <PortfolioWaveGraph />

            <View style={styles.portfolioStatsRow}>
              <View style={styles.portfolioStatCol}>
                <Text style={styles.statNumber}>
                  {vaultSummary.totalCount || 12}
                </Text>
                <Text style={styles.statLabel}>Assets</Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.portfolioStatCol}>
                <Text style={styles.statNumber}>
                  {vaultSummary.categoriesCount || 4}
                </Text>
                <Text style={styles.statLabel}>Categories</Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.portfolioStatCol}>
                <Text style={styles.statNumber}>
                  {vaultSummary.verifiedPct || 96}%
                </Text>
                <Text style={styles.statLabel}>Verified</Text>
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* ── SCAN & KNOW CAMERA CTA ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.scanKnowCard}
          onPress={() => navigation.navigate(SCREENS.SCAN_AND_KNOW)}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={["#0F172A", "#1E1B4B", "#312E81"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.scanKnowGradient}
          >
            <View style={styles.scanKnowIconWrap}>
              <Ionicons name="scan" size={22} color="#00C2FF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanKnowKicker}>GEMINI VISION • ZAR ORACLE</Text>
              <Text style={styles.scanKnowTitle}>Scan & Know</Text>
              <Text style={styles.scanKnowSub} numberOfLines={1}>
                Identify, value in Rands, and match Sepolia certificates
              </Text>
            </View>
            <Feather name="camera" size={18} color="#FFFFFF" />
          </LinearGradient>
        </TouchableOpacity>

        {/* ── SLIM SMART INSIGHT BANNER ───────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.slimInsightBanner}
          onPress={() => navigation.navigate(SCREENS.SEARCH)}
          activeOpacity={0.88}
        >
          <View style={styles.slimInsightLeft}>
            <View style={styles.slimSparkleWrap}>
              <Ionicons name="sparkles" size={14} color="#7C3AED" />
            </View>
            <View style={styles.slimTextCol}>
              <Text style={styles.slimTagText}>SMART INSIGHT</Text>
              <Text style={styles.slimHeadlineText} numberOfLines={1}>
                Watch demand is up 18%
              </Text>
            </View>
          </View>

          <View style={styles.slimExploreLink}>
            <Text style={styles.slimExploreLabel}>Explore</Text>
            <Feather
              name="arrow-right"
              size={13}
              color="#7C3AED"
              style={{ marginLeft: 3 }}
            />
          </View>
        </TouchableOpacity>

        {/* ── 2-COLUMN QUICK FINANCIAL STATUS BUBBLES ─────────────────────────── */}
        <View style={styles.quickStatusRow}>
          {/* Left Bubble: Available Cash (Lilac/Periwinkle Gradient) */}
          <TouchableOpacity
            style={styles.bubbleCardWrapper}
            activeOpacity={0.88}
            onPress={() =>
              Alert.alert(
                "Top Up Cash",
                "Select an amount to deposit into your SmartAssets secure wallet balance.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Add R500",
                    onPress: () =>
                      Alert.alert("Success", "R500 deposited via Apple Pay."),
                  },
                ]
              )
            }
          >
            <LinearGradient
              colors={["#9E7BFA", "#7353EA"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.2, y: 1 }}
              style={styles.bubbleGradient}
            >
              <View style={styles.bubbleIconCircle}>
                <Feather name="chevron-down" size={24} color="#7353EA" />
              </View>
              <Text style={styles.bubbleLabel}>AVAILABLE CASH</Text>
              <Text style={styles.bubbleValue}>R250</Text>
              <View style={styles.bubbleFooterRow}>
                <Feather
                  name="plus-circle"
                  size={12}
                  color="#FFFFFF"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.bubbleSubText}>Top Up funds</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Right Bubble: AI Risk Score (Magenta/Pink Gradient) */}
          <TouchableOpacity
            style={styles.bubbleCardWrapper}
            activeOpacity={0.88}
            onPress={() =>
              Alert.alert(
                "AI Risk Score: Low (96%)",
                "Your portfolio volatility is 96% optimal. Protected by Horological & Fine Art benchmark models."
              )
            }
          >
            <LinearGradient
              colors={["#B83DAE", "#DE4580"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.2, y: 1 }}
              style={styles.bubbleGradient}
            >
              <View style={styles.bubbleIconCircle}>
                <Feather name="chevron-up" size={24} color="#DE4580" />
              </View>
              <Text style={styles.bubbleLabel}>AI RISK SCORE</Text>
              <Text style={styles.bubbleValue}>Low (96%)</Text>
              <View style={styles.bubbleFooterRow}>
                <Ionicons
                  name="shield-checkmark"
                  size={12}
                  color="#FFFFFF"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.bubbleSubText}>Verified • Safe</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ── IN-APP AR SHOWROOM SPOTLIGHT BANNER ──────────────────────────────── */}
        <TouchableOpacity
          style={styles.arShowroomBanner}
          onPress={() =>
            navigation.navigate(SCREENS.LIVE_ROOM_PREVIEW, {
              imageUri: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&q=80',
              title: 'Velvet Lounge Chair',
              listingId: 'showcase-chair-3d',
              glbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/SheenChair/glTF-Binary/SheenChair.glb',
              source: 'ai_generated',
              placement: 'floor',
              widthCm: 75,
              heightCm: 85,
              depthCm: 80,
            })
          }
          activeOpacity={0.92}
        >
          <LinearGradient
            colors={['#0F172A', '#1E1B4B', '#172554']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.arShowroomGradient}
          >
            <View style={styles.arShowroomTopRow}>
              <View style={styles.arShowroomBadge}>
                <Ionicons name="scan" size={13} color="#00C2FF" />
                <Text style={styles.arShowroomBadgeText}>NEW • IN-APP AR EXPERIENCE</Text>
              </View>
              <View style={styles.arTrueScalePill}>
                <Text style={styles.arTrueScaleText}>1:1 SCALE</Text>
              </View>
            </View>

            <Text style={styles.arShowroomTitle}>
              Decorate your room with verified luxury
            </Text>
            <Text style={styles.arShowroomSubtitle}>
              Hang paintings on your walls or place iconic furniture on your floor. Live plane tracking & soft shadows.
            </Text>

            <View style={styles.arShowroomFooter}>
              <View style={styles.arShowroomItemsPill}>
                <Ionicons name="cube-outline" size={13} color="#00C2FF" />
                <Text style={styles.arShowroomItemsText}>5 Showcase Collectibles</Text>
              </View>

              <View style={styles.arShowroomActionBtn}>
                <Text style={styles.arShowroomActionText}>Launch AR</Text>
                <Feather name="arrow-right" size={14} color="#00C2FF" style={{ marginLeft: 4 }} />
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* ── BROWSE CATEGORIES (2x2 VISUAL IMAGE GRID) ───────────────────────── */}
        <View style={styles.dashboardSection}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTag}>MARKETPLACE</Text>
              <Text style={styles.sectionTitle}>Explore Categories</Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.SEARCH, { category: 'All' })}
              activeOpacity={0.7}
              style={styles.seeAllBtn}
            >
              <Text style={styles.seeAllText}>View all</Text>
              <Feather name="chevron-right" size={14} color="#7C3AED" />
            </TouchableOpacity>
          </View>

          <View style={styles.categoriesGrid}>
            {CATEGORY_CARDS.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={styles.categoryCard}
                activeOpacity={0.88}
                onPress={() => navigation.navigate(SCREENS.SEARCH, { category: cat.categoryKey })}
              >
                <Image
                  source={{ uri: cat.image }}
                  style={StyleSheet.absoluteFillObject}
                  resizeMode="cover"
                />
                {/* Subtle dark frosted glass bar over bottom of each category image */}
                <View style={styles.categoryFrostedBar}>
                  <Text style={styles.categoryNameText} numberOfLines={1}>
                    {cat.name}
                  </Text>
                  <View style={[styles.categoryDot, { backgroundColor: cat.dotColor }]} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── TOP MOVERS TODAY (SINGLE HORIZONTAL CAROUSEL) ────────────────────── */}
        <View style={styles.dashboardSection}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTag}>MARKET MOMENTUM</Text>
              <Text style={styles.sectionTitle}>Top Movers Today</Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
              activeOpacity={0.7}
              style={styles.seeAllBtn}
            >
              <Text style={styles.seeAllText}>Explore</Text>
              <Feather name="arrow-right" size={13} color="#7C3AED" />
            </TouchableOpacity>
          </View>

          {/* Curated Asset Cards (Horizontal Scroll) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.curatedCardsScroll}
          >
            {CURATED_ASSETS.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.curatedCard}
                onPress={() =>
                  navigation.navigate(SCREENS.ASSET_DETAIL, { asset: item })
                }
                activeOpacity={0.88}
              >
                {/* Image Wrap with Frosted Badges */}
                <View style={styles.curatedImgWrap}>
                  <Image
                    source={{ uri: resolveImageUrl(item.image) }}
                    style={styles.curatedImg}
                    resizeMode="cover"
                  />
                  {/* Verified Badge */}
                  {item.isVerified && (
                    <View style={styles.cardVerifiedBadge}>
                      <Ionicons
                        name="shield-checkmark"
                        size={12}
                        color="#FFFFFF"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.cardVerifiedText}>Verified</Text>
                    </View>
                  )}

                  {/* Gain Badge */}
                  <View style={styles.cardGainBadge}>
                    <Text style={styles.cardGainText}>{item.gain}</Text>
                  </View>
                </View>

                {/* Card Info Footer */}
                <View style={styles.curatedCardFooter}>
                  <Text style={styles.curatedCardCat}>{item.category}</Text>
                  <View style={styles.curatedCardDetailsRow}>
                    <Text style={styles.curatedCardName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.curatedCardPrice}>{item.price}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Safe bottom spacer for floating navigation bar */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: "#F3EEFF",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "transparent",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },

  // ── Top Brand Header ────────────────────────────────────────────────────────
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    marginTop: 4,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  appBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileAvatarBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#7C3AED",
    backgroundColor: "#EDE9FE",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  profileAvatarImg: {
    width: "100%",
    height: "100%",
  },
  profileAvatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EDE9FE",
  },
  profileInitialsText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#6D28D9",
  },

  // ── Greeting Bar ────────────────────────────────────────────────────────────
  greetingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  greetingTextCol: {
    flex: 1,
    marginRight: 10,
  },
  greetingHelloText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  greetingUserNameText: {
    fontSize: 26,
    fontWeight: "900",
    color: "#F59E0B", // Warm vibrant golden-yellow
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: 3,
  },
  greetingSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 1,
  },
  activityPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    marginTop: 4,
  },
  activityPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },

  // ── Main Cards Row ──────────────────────────────────────────────────────────
  mainCardsRow: {
    flexDirection: "column",
    gap: 16,
    marginBottom: 28,
  },
  mainCardsRowDesktop: {
    flexDirection: "row",
  },

  // ── Portfolio Value Card ────────────────────────────────────────────────────
  portfolioCard: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },
  portfolioCardDesktop: {
    flex: 1.15,
  },
  portfolioCardGradient: {
    padding: 22,
    position: "relative",
  },
  portfolioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  portfolioLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.85)",
    letterSpacing: 1.2,
  },
  barChartBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  portfolioValueNumber: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.8,
  },
  gainRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 14,
  },
  growthPill: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  growthPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  yearlyGainText: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.9)",
    marginLeft: 8,
  },

  // Wave Graph
  waveContainer: {
    height: 52,
    width: "100%",
    justifyContent: "center",
    marginVertical: 4,
  },
  waveContainerNative: {
    height: 48,
    width: "100%",
    justifyContent: "center",
    marginVertical: 4,
  },
  waveTrackNative: {
    height: 40,
    position: "relative",
    justifyContent: "center",
  },
  waveLineNative: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    borderRadius: 1,
  },
  waveDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },

  // 3-Col Stats
  portfolioStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.18)",
  },
  portfolioStatCol: {
    flex: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  statLabel: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.78)",
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    marginHorizontal: 12,
  },

  scanKnowCard: {
    marginTop: 4,
    marginBottom: 12,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#312E81",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
  scanKnowGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  scanKnowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(0,194,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,194,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanKnowKicker: {
    color: "#67E8F9",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  scanKnowTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 1,
  },
  scanKnowSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    marginTop: 2,
  },

  // ── Slim Smart Insight Banner ───────────────────────────────────────────────
  slimInsightBanner: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  slimInsightLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 10 },
  slimSparkleWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.18)",
  },
  slimTextCol: { flex: 1 },
  slimHeaderLine: { flexDirection: "row", alignItems: "center" },
  slimTagText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  slimDotSeparator: { fontSize: 10, color: "#94A3B8", marginHorizontal: 5 },
  slimHeadlineText: { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  slimSubText: { fontSize: 11, color: "#64748B", marginTop: 1 },
  slimExploreLink: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F3FF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.15)",
  },
  slimExploreLabel: { fontSize: 11, fontWeight: "700", color: "#7C3AED" },

  // ── 2-Column Quick Financial Status Bubbles ─────────────────────────────────
  quickStatusRow: {
    flexDirection: "row",
    gap: 14,
    marginTop: 14,
    marginBottom: 24,
  },
  bubbleCardWrapper: {
    flex: 1,
    borderRadius: 26,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  bubbleGradient: {
    borderRadius: 26,
    paddingVertical: 18,
    paddingHorizontal: 16,
    minHeight: 165,
    justifyContent: "space-between",
  },
  bubbleIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  bubbleLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255, 255, 255, 0.88)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  bubbleValue: {
    fontSize: 24,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  bubbleFooterRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  bubbleSubText: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.95)",
  },

  // ── Dashboard Sections & Activity Feed ──────────────────────────────────────
  dashboardSection: {
    marginBottom: 22,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTag: {
    fontSize: 10,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7C3AED",
  },


  // Curated Cards
  curatedCardsScroll: {
    flexDirection: "row",
    gap: 16,
    paddingBottom: 16,
  },
  curatedCard: {
    width: 280,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  curatedImgWrap: {
    height: 180,
    width: "100%",
    position: "relative",
    backgroundColor: "#F1F5F9",
  },
  curatedImg: {
    width: "100%",
    height: "100%",
  },
  cardVerifiedBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  cardVerifiedText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  cardGainBadge: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardGainText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  curatedCardFooter: {
    padding: 16,
  },
  curatedCardCat: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  curatedCardDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  curatedCardName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    flex: 1,
    marginRight: 8,
  },
  curatedCardPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },

  // ── Browse Categories Styles ────────────────────────────────────────────────
  categoriesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  categoryCard: {
    width: "48%",
    height: 145,
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 14,
    backgroundColor: "#1E293B",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    position: "relative",
  },
  categoryFrostedBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    ...(Platform.OS === "web"
      ? {
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }
      : {}),
  },
  categoryNameText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  arShowroomBanner: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#00C2FF",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  arShowroomGradient: {
    padding: 20,
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: "rgba(0, 194, 255, 0.35)",
    gap: 10,
  },
  arShowroomTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  arShowroomBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 194, 255, 0.4)",
  },
  arShowroomBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#00C2FF",
    letterSpacing: 0.8,
  },
  arTrueScalePill: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  arTrueScaleText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#CBD5E1",
    letterSpacing: 0.6,
  },
  arShowroomTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  arShowroomSubtitle: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 18,
  },
  arShowroomFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  arShowroomItemsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  arShowroomItemsText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#CBD5E1",
  },
  arShowroomActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 194, 255, 0.15)",
    borderWidth: 1,
    borderColor: "#00C2FF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  arShowroomActionText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#00C2FF",
  },
});
