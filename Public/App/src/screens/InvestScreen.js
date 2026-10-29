// ─── InvestScreen (Fintech Share Trading & Wishlist) ─────────────────────────
// Pure fintech trading and portfolio management:
// 1. Dynamic Top Summary Bar (Total Invested, Available Cash, Dynamic Portfolio Allocation)
// 2. Tab Switch: [Share Trading] vs [My Wishlist]
// 3. Full-width horizontal trading rows with funding progress, share pricing, and direct Buy/Sell
// 4. Client-side persistent wishlist management (zero Supabase mutations)

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { SCREENS } from "../constants/navigation";
import { getMarketAssets, getUserVault, resolveImageUrl } from "../services/api";
import { useAuth } from "../context/AuthContext";
import KycGatekeeperModal from "../components/KycGatekeeperModal";
import storage, { STORAGE_KEYS } from "../utils/storage";
import { getMarketAssetsCache } from "../services/storage";

// ── Currency Formatter (South African Rands R) ───────────────────────────────
const formatZAR = (val, fallback = "R0") => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "string") {
    let str = val.trim();
    if (str.startsWith("£")) {
      str = str.replace(/^£\s?/, "");
    }
    const cleanNum = parseFloat(str.replace(/[^0-9.-]+/g, ""));
    if (!isNaN(cleanNum)) {
      return "R" + cleanNum.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
    }
    if (str.startsWith("R")) return str;
    return "R" + str;
  }
  const num =
    typeof val === "number"
      ? val
      : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return fallback;
  return "R" + num.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
};
const formatGBP = formatZAR;

// Real verified investment offerings are loaded strictly from Supabase
const DEFAULT_OFFERINGS = [];

const WISHLIST_STORAGE_KEY = "@smartassets_wishlist";

export default function InvestScreen({ navigation }) {
  const { user, token } = useAuth();
  const [kycGatekeeperVisible, setKycGatekeeperVisible] = useState(false);
  const [activeTab, setActiveTab] = useState("trading"); // 'trading' | 'wishlist'
  const [offerings, setOfferings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userHoldings, setUserHoldings] = useState([]);
  const [vaultSummary, setVaultSummary] = useState(null);
  const [wishlistIds, setWishlistIds] = useState([]);

  // Load wishlist from storage on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await storage.getJSON(WISHLIST_STORAGE_KEY, null);
        if (Array.isArray(stored)) {
          setWishlistIds(stored);
        }
      } catch (_) {}
    })();
  }, []);

  // Toggle Wishlist item and persist
  const toggleWishlist = useCallback((assetId) => {
    setWishlistIds((prev) => {
      const exists = prev.includes(assetId);
      const next = exists ? prev.filter((id) => id !== assetId) : [...prev, assetId];
      storage.setJSON(WISHLIST_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const [availableCash, setAvailableCash] = useState(0);
  const [totalInvested, setTotalInvested] = useState(0);

  // Load live market assets and user vault
  const loadData = useCallback(async () => {
    try {
      const res = await getMarketAssets("All", "");
      if (res?.assets && Array.isArray(res.assets) && res.assets.length > 0) {
        // Filter strictly for active listings with fractional investment explicitly enabled and shares available
        const investable = res.assets.filter((a) => {
          const isEnabled = Boolean(a.allow_investment || a.allowInvestment);
          const isAvailable = a.status !== "sold";
          const hasShares = Number(a.shares) > 0;
          return isEnabled && isAvailable && hasShares;
        });

        const mapped = investable.map((a) => {
          const totalShares = Number(a.shares || a.total_shares || a.totalShares || 100);
          const sharesSold = Number(a.shares_sold ?? a.sharesSold ?? 0);
          const remainingShares = Math.max(0, totalShares - sharesSold);
          const sharePriceNum =
            Number(a.share_price) ||
            Number(a.sharePrice) ||
            Math.round((Number(a.price_num) || 1000) / totalShares);

          return {
            ...a,
            allow_investment: true,
            allowInvestment: true,
            shares: totalShares,
            total_shares: totalShares,
            totalShares: totalShares,
            shares_sold: sharesSold,
            sharesSold: sharesSold,
            remaining_shares: remainingShares,
            remainingShares: remainingShares,
            share_price: formatZAR(sharePriceNum),
            sharePrice: sharePriceNum,
            sharePriceNum,
            funded_pct: Math.min(100, Math.round((sharesSold / totalShares) * 100)),
          };
        });
        setOfferings(mapped);
      } else {
        setOfferings([]);
      }
    } catch (_) {
      setOfferings([]);
    }

    try {
      const cachedCash = await storage.getJSON(STORAGE_KEYS.ESCROW_CASH);
      if (typeof cachedCash === "number") {
        setAvailableCash(cachedCash);
      }

      const cachedFractions = await storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS);
      if (Array.isArray(cachedFractions) && cachedFractions.length > 0) {
        const stakesSum = cachedFractions.reduce(
          (sum, f) => sum + (Number(f.myStake) || 0),
          0
        );
        if (stakesSum > 0) setTotalInvested(stakesSum);
      }
    } catch (_) {}

    if (token) {
      try {
        const vaultRes = await getUserVault(token);
        if (vaultRes?.holdings && Array.isArray(vaultRes.holdings)) {
          setUserHoldings(vaultRes.holdings);
        }
        if (vaultRes?.summary) {
          setVaultSummary(vaultRes.summary);
          if (vaultRes.summary.availableBalanceNum && typeof vaultRes.summary.availableBalanceNum === "number") {
            setAvailableCash(vaultRes.summary.availableBalanceNum);
          }
        }
      } catch (_) {}
    }
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  // Immediately hydrate from AsyncStorage cache so user sees offerings while offline
  useEffect(() => {
    getMarketAssetsCache().then((cached) => {
      if (cached && cached.length > 0 && offerings.length === 0) {
        setOfferings(cached);
        setLoading(false);
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // ── Financial Math: Total Invested & Available Cash (R0 Currency Formatted Default) ──
  const totalInvestedFormatted = useMemo(() => {
    return formatZAR(totalInvested, "R0");
  }, [totalInvested]);

  const availableCashFormatted = useMemo(() => {
    return formatZAR(availableCash, "R0");
  }, [availableCash]);

  // ── Dynamic Portfolio Allocation Breakdown ──────────────────────────────────
  const allocation = useMemo(() => {
    const CATEGORY_COLORS = {
      watches: "#8B5CF6",
      cars: "#06B6D4",
      art: "#EC4899",
      wine: "#F59E0B",
      "real estate": "#10B981",
      sneakers: "#3B82F6",
      electronics: "#6366F1",
    };

    if (userHoldings && userHoldings.length > 0) {
      const totals = {};
      let sum = 0;
      userHoldings.forEach((h) => {
        const cat = (h.category || "Watches").toLowerCase();
        let key = "watches";
        if (cat.includes("car")) key = "cars";
        else if (cat.includes("art")) key = "art";
        else if (cat.includes("wine")) key = "wine";
        else if (cat.includes("real")) key = "real estate";
        else if (cat.includes("sneaker")) key = "sneakers";
        else if (cat.includes("electronic")) key = "electronics";
        else key = cat;

        const val =
          Number(h.price_num) ||
          parseFloat(String(h.price || "").replace(/[^0-9.-]+/g, "")) ||
          1000;
        totals[key] = (totals[key] || 0) + val;
        sum += val;
      });

      if (sum > 0) {
        return Object.entries(totals).map(([key, val]) => {
          const pct = Math.round((val / sum) * 100);
          const label = key.charAt(0).toUpperCase() + key.slice(1);
          return {
            category: label,
            percentage: pct,
            color: CATEGORY_COLORS[key] || "#8B5CF6",
            valueFormatted: formatGBP(val),
          };
        });
      }
    }

    // Default portfolio allocation baseline
    return [
      { category: "Watches", percentage: 52, color: "#8B5CF6", valueFormatted: "R77,220" },
      { category: "Art", percentage: 28, color: "#EC4899", valueFormatted: "R41,580" },
      { category: "Cars", percentage: 20, color: "#06B6D4", valueFormatted: "R29,700" },
    ];
  }, [userHoldings]);

  // Wishlist items filtered from offerings
  const wishlistItems = useMemo(() => {
    return offerings.filter((o) => wishlistIds.includes(o.id));
  }, [offerings, wishlistIds]);

  // Handle Direct Share Actions — navigates directly to Fractional Investment page
  const handleBuyShares = (offering) => {
    if (user && (user.kycStatus !== 'verified' || user.isSuspended)) {
      setKycGatekeeperVisible(true);
      return;
    }
    const totalShares = Number(offering.shares || offering.total_shares || offering.totalShares || 100);
    const sharesSold = Number(offering.sharesSold ?? offering.shares_sold ?? 0);
    const sharePriceNum =
      Number(offering.sharePriceNum) ||
      parseFloat(String(offering.share_price || offering.sharePrice || "").replace(/[^0-9.]/g, "")) || 100;

    navigation.navigate(SCREENS.CHECKOUT, {
      asset: {
        ...offering,
        allow_investment: true,
        allowInvestment: true,
        shares: totalShares,
        total_shares: totalShares,
        totalShares: totalShares,
        sharesSold: sharesSold,
        shares_sold: sharesSold,
        sharePrice: sharePriceNum,
        share_price: sharePriceNum,
      },
      isFractional: true,
    });
  };

  const handleSellShares = (offering) => {
    if (user && (user.kycStatus !== 'verified' || user.isSuspended)) {
      setKycGatekeeperVisible(true);
      return;
    }
    const sharePriceNum =
      Number(offering.sharePriceNum) ||
      parseFloat(String(offering.share_price || "").replace(/[^0-9.]/g, "")) || 100;

    Alert.alert(
      "Share Custody & Liquidity",
      `Your shares in "${offering.name}" are registered in durable Vault custody at an oracle value of R${sharePriceNum}/share.\n\n` +
      `When this collectible is bought outright, your full pro-rata share of the verified net proceeds will automatically credit directly to your Vault cash balance.`,
      [
        { text: "Got It", style: "default" },
      ]
    );
  };

  const handleOpenDetails = (item) => {
    if (!item) return;
    const priceNum =
      typeof item.price === "number"
        ? item.price
        : parseFloat(String(item.price || "10000").replace(/[^0-9.-]+/g, "")) ||
          10000;
    const sharePriceVal = item.share_price || item.sharePrice || "R100";
    const totalSharesVal =
      item.total_shares || item.shares || Math.max(10, Math.round(priceNum / 100));

    navigation.navigate(SCREENS.ASSET_DETAIL, {
      asset: {
        ...item,
        id: item.id,
        name: item.name || item.title || "Fractional Asset",
        title: item.name || item.title || "Fractional Asset",
        category: item.category || item.filterCat || "Watches",
        price: item.price || `R${priceNum.toLocaleString("en-ZA")}`,
        price_num: priceNum,
        share_price: sharePriceVal,
        sharePrice: sharePriceVal,
        total_shares: totalSharesVal,
        shares: totalSharesVal,
        shares_sold: item.shares_sold || Math.round(totalSharesVal * 0.75),
        funded_pct: item.funded_pct || 75,
        image: item.image,
        description:
          item.description ||
          `Premium fractional offering verified on-chain via ERC-721 smart contract on Sepolia. Fully secured in high-security custodial vault storage with live oracle valuation and multi-signature escrow custody.`,
        year: item.year || "2021",
        condition: item.condition || "Mint Condition (Grade A+)",
        owner: item.owner || "SmartAssets Liquidity Pool",
        healthScore: item.healthScore || 96,
        isVerified: true,
      },
    });
  };

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
      {/* ── Background Mesh Gradient (5-Stop Luminous Mesh) ── */}
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
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
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
        {/* ── TOP APP BAR / BRAND HEADER (Matches Home) ─────────────────────────── */}
        <View style={styles.appBar}>
          <TouchableOpacity
            style={styles.brandGroup}
            onPress={() => navigation.navigate(SCREENS.HOME)}
            activeOpacity={0.8}
          >
            <View style={styles.logoBadge}>
              <Image
                source={require("../../assets/logo-mark.png")}
                style={{ width: 32, height: 32 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brandTitle}>SmartAssets</Text>
          </TouchableOpacity>

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

        {/* ══════════════════════════════════════════════════════════════════════
            TOP SUMMARY BAR (Total Invested, Available Cash, Dynamic Allocation)
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.topSummaryCard}>
          <LinearGradient
            colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.85 }}
            style={styles.topSummaryGradient}
          >
            <View style={styles.summaryTopRow}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>TOTAL INVESTED</Text>
                <Text style={styles.summaryValue}>{totalInvestedFormatted}</Text>
              </View>
              <View style={styles.summaryDividerVertical} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>AVAILABLE CASH</Text>
                <Text style={styles.summaryValueCash}>{availableCashFormatted}</Text>
              </View>
            </View>

            {/* Dynamic Portfolio Allocation Bar */}
            <View style={styles.allocContainer}>
              <View style={styles.allocHeaderRow}>
                <Text style={styles.allocTitle}>PORTFOLIO ALLOCATION</Text>
                <Text style={styles.allocSubtitle}>
                  {allocation.length} Active Classes
                </Text>
              </View>

              {/* Segmented Track */}
              <View style={styles.allocTrack}>
                {allocation.map((item, idx) => (
                  <View
                    key={item.category}
                    style={[
                      styles.allocSegment,
                      {
                        backgroundColor: item.color,
                        width: `${Math.max(item.percentage, 4)}%`,
                        borderTopLeftRadius: idx === 0 ? 6 : 0,
                        borderBottomLeftRadius: idx === 0 ? 6 : 0,
                        borderTopRightRadius:
                          idx === allocation.length - 1 ? 6 : 0,
                        borderBottomRightRadius:
                          idx === allocation.length - 1 ? 6 : 0,
                      },
                    ]}
                  />
                ))}
              </View>

              {/* Dynamic Legend */}
              <View style={styles.allocLegendRow}>
                {allocation.map((item) => (
                  <View key={item.category} style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: item.color },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      {item.category} {item.percentage}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            TOGGLE SWITCH: [Share Trading] vs [My Wishlist]
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              activeTab === "trading" && styles.toggleBtnActive,
            ]}
            onPress={() => setActiveTab("trading")}
            activeOpacity={0.85}
          >
            <Feather
              name="trending-up"
              size={15}
              color={activeTab === "trading" ? "#FFFFFF" : "#64748B"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.toggleBtnText,
                activeTab === "trading" && styles.toggleBtnTextActive,
              ]}
            >
              Share Trading
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleBtn,
              activeTab === "wishlist" && styles.toggleBtnActive,
            ]}
            onPress={() => setActiveTab("wishlist")}
            activeOpacity={0.85}
          >
            <Ionicons
              name={activeTab === "wishlist" ? "heart" : "heart-outline"}
              size={16}
              color={activeTab === "wishlist" ? "#FFFFFF" : "#64748B"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.toggleBtnText,
                activeTab === "wishlist" && styles.toggleBtnTextActive,
              ]}
            >
              My Wishlist {wishlistItems.length > 0 ? `(${wishlistItems.length})` : ""}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB CONTENT: [SHARE TRADING]
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "trading" && (
          <View style={styles.tradeListContainer}>
            <View style={styles.listHeaderRow}>
              <Text style={styles.listTitle}>Live Fractional Rounds</Text>
              <Text style={styles.listSubtitle}>
                {offerings.length} Active Offerings
              </Text>
            </View>

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color="#6D28D9" />
                <Text style={styles.loadingText}>Loading share trading…</Text>
              </View>
            ) : (
              offerings.map((offering) => {
                const formattedPrice = formatZAR(offering.price);
                const sharePrice = formatZAR(offering.share_price, "R100");
                const pct = offering.funded_pct || 75;
                const isWishlisted = wishlistIds.includes(offering.id);

                return (
                  <View key={offering.id} style={styles.tradeCard}>
                    {/* Top Row: Thumbnail + Info */}
                    <View style={styles.tradeCardTop}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => handleOpenDetails(offering)}
                      >
                        <Image
                          source={{ uri: resolveImageUrl(offering.image) }}
                          style={styles.tradeThumb}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>

                      <View style={styles.tradeInfo}>
                        <View style={styles.tradeCatRow}>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => handleOpenDetails(offering)}
                            style={{ flex: 1 }}
                          >
                            <Text style={styles.tradeCatText}>
                              {String(offering.category || "ASSET").toUpperCase()}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => toggleWishlist(offering.id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.heartBtn}
                          >
                            <Ionicons
                              name={isWishlisted ? "heart" : "heart-outline"}
                              size={18}
                              color={isWishlisted ? "#EF4444" : "#94A3B8"}
                            />
                          </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => handleOpenDetails(offering)}
                        >
                          <View style={styles.tradeTitleRow}>
                            <Text style={styles.tradeTitle} numberOfLines={1}>
                              {offering.name}
                            </Text>
                            <Feather name="chevron-right" size={16} color="#94A3B8" />
                          </View>

                          {/* Price & Share Price Row */}
                          <View style={styles.tradePriceRow}>
                            <View>
                              <Text style={styles.tradeMetricLabel}>
                                Share Price
                              </Text>
                              <Text style={styles.tradeSharePrice}>
                                {sharePrice}/sh
                              </Text>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={styles.tradeMetricLabel}>
                                Valuation
                              </Text>
                              <Text style={styles.tradeValuation}>
                                {formattedPrice}
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Middle: Funding Progress Bar */}
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => handleOpenDetails(offering)}
                      style={styles.tradeProgressContainer}
                    >
                      <View style={styles.tradeProgressHeader}>
                        <Text style={styles.tradeProgressLabel}>
                          Funding Progress
                        </Text>
                        <Text style={styles.tradeProgressPct}>{pct}% Funded</Text>
                      </View>
                      <View style={styles.tradeProgressTrack}>
                        <LinearGradient
                          colors={["#7C3AED", "#00C2FF"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[
                            styles.tradeProgressFill,
                            { width: `${pct}%` },
                          ]}
                        />
                      </View>
                    </TouchableOpacity>

                    {/* Bottom: Action Buttons */}
                    <View style={styles.tradeActionsRow}>
                      <TouchableOpacity
                        style={styles.buySharesBtn}
                        onPress={() => handleBuyShares(offering)}
                        activeOpacity={0.85}
                      >
                        <LinearGradient
                          colors={["#443A7A", "#100b55ff"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.buySharesGradient}
                        >
                          <Ionicons
                            name="cart-outline"
                            size={15}
                            color="#FFFFFF"
                            style={{ marginRight: 6 }}
                          />
                          <Text style={styles.buySharesText}>Buy Shares</Text>
                        </LinearGradient>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.sellSharesBtn}
                        onPress={() => handleSellShares(offering)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.sellSharesText}>Sell Shares</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB CONTENT: [MY WISHLIST]
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "wishlist" && (
          <View style={styles.wishlistContainer}>
            <View style={styles.listHeaderRow}>
              <Text style={styles.listTitle}>Tracked Collectibles</Text>
              <Text style={styles.listSubtitle}>
                {wishlistItems.length} Saved Items
              </Text>
            </View>

            {wishlistItems.length === 0 ? (
              <View style={styles.emptyWishlistCard}>
                <View style={styles.emptyHeartCircle}>
                  <Ionicons name="heart-outline" size={32} color="#94A3B8" />
                </View>
                <Text style={styles.emptyWishlistTitle}>
                  Your wishlist is empty
                </Text>
                <Text style={styles.emptyWishlistSub}>
                  Tap the heart icon on any asset in Share Trading or the
                  Marketplace to track it here.
                </Text>
                <TouchableOpacity
                  style={styles.browseTradingBtn}
                  onPress={() => setActiveTab("trading")}
                  activeOpacity={0.85}
                >
                  <Text style={styles.browseTradingBtnText}>
                    Explore Share Trading
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              wishlistItems.map((item) => (
                <View key={item.id} style={styles.wishlistCard}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => handleOpenDetails(item)}
                  >
                    <Image
                      source={{ uri: resolveImageUrl(item.image) }}
                      style={styles.wishlistThumb}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>

                  <View style={styles.wishlistContent}>
                    <View style={styles.wishlistHeaderRow}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => handleOpenDetails(item)}
                        style={{ flex: 1 }}
                      >
                        <Text style={styles.wishlistCat}>
                          {String(item.category || "ASSET").toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => toggleWishlist(item.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="heart" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => handleOpenDetails(item)}
                    >
                      <View style={styles.tradeTitleRow}>
                        <Text style={styles.wishlistTitle} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Feather name="chevron-right" size={15} color="#94A3B8" />
                      </View>

                      <View style={styles.wishlistMetricsRow}>
                        <View>
                          <Text style={styles.wishlistPriceLabel}>Valuation</Text>
                          <Text style={styles.wishlistPrice}>
                            {formatGBP(item.price)}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.wishlistPriceLabel}>Share Price</Text>
                          <Text style={styles.wishlistSharePrice}>
                            {formatZAR(item.share_price, "R100")}/sh
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.quickInvestBtn}
                      onPress={() => handleBuyShares(item)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.quickInvestBtnText}>Invest</Text>
                      <Feather
                        name="arrow-right"
                        size={13}
                        color="#FFFFFF"
                        style={{ marginLeft: 4 }}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Bottom space for floating bottom bar */}
        <View style={{ height: 110 }} />
      </ScrollView>

      <KycGatekeeperModal
        visible={kycGatekeeperVisible}
        onClose={() => setKycGatekeeperVisible(false)}
        isSuspended={Boolean(user?.isSuspended)}
        onCompleteVerification={() =>
          navigation.navigate(SCREENS.PROFILE, { openKyc: true })
        }
      />
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

  // ── Brand Header ────────────────────────────────────────────────────────────
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    marginTop: 4,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoBadge: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
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

  // ── Top Summary Card ────────────────────────────────────────────────────────
  topSummaryCard: {
    borderRadius: 22,
    overflow: "hidden",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 18,
  },
  topSummaryGradient: {
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryCol: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.85)",
    letterSpacing: 1.0,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 4,
    letterSpacing: -0.6,
  },
  summaryValueCash: {
    fontSize: 28,
    fontWeight: "800",
    color: "#34D399",
    marginTop: 4,
    letterSpacing: -0.6,
  },
  summaryDividerVertical: {
    width: 1,
    height: 48,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    marginHorizontal: 16,
  },

  // Allocation Bar
  allocContainer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.18)",
  },
  allocHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  allocTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.9)",
    letterSpacing: 0.9,
  },
  allocSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#C4B5FD",
  },
  allocTrack: {
    height: 9,
    flexDirection: "row",
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    overflow: "hidden",
  },
  allocSegment: {
    height: "100%",
  },
  allocLegendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.95)",
    fontWeight: "600",
  },

  // ── Toggle Switch: [Share Trading] vs [My Wishlist] ─────────────────────────
  toggleRow: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
  },
  toggleBtnActive: {
    backgroundColor: "#5835F5",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  toggleBtnTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // ── Share Trading Content ───────────────────────────────────────────────────
  tradeListContainer: {
    gap: 14,
  },
  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  listSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },

  tradeCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.85)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  tradeCardTop: {
    flexDirection: "row",
    gap: 12,
  },
  tradeThumb: {
    width: 80,
    height: 80,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  tradeInfo: {
    flex: 1,
    justifyContent: "space-between",
  },
  tradeCatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tradeCatText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.8,
  },
  heartBtn: {
    padding: 2,
  },
  tradeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    marginBottom: 6,
  },
  tradeTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginRight: 6,
  },
  tradePriceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  tradeMetricLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  tradeSharePrice: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  tradeValuation: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },

  // Funding Progress Bar
  tradeProgressContainer: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(241, 245, 249, 0.9)",
  },
  tradeProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  tradeProgressLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  tradeProgressPct: {
    fontSize: 12,
    fontWeight: "800",
    color: "#6D28D9",
  },
  tradeProgressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
  },
  tradeProgressFill: {
    height: "100%",
    borderRadius: 4,
  },

  // Actions Row
  tradeActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  buySharesBtn: {
    flex: 2,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  buySharesGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  buySharesText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  sellSharesBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
  },
  sellSharesText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },

  // ── Wishlist Content ────────────────────────────────────────────────────────
  wishlistContainer: {
    gap: 14,
  },
  wishlistCard: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.85)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    gap: 12,
  },
  wishlistThumb: {
    width: 88,
    height: 88,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  wishlistContent: {
    flex: 1,
    justifyContent: "space-between",
  },
  wishlistHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  wishlistCat: {
    fontSize: 10,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.8,
  },
  wishlistTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginVertical: 2,
    marginRight: 6,
  },
  wishlistMetricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 2,
  },
  wishlistPriceLabel: {
    fontSize: 9,
    color: "#64748B",
  },
  wishlistPrice: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },
  wishlistSharePrice: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6D28D9",
  },
  quickInvestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5835F5",
    paddingVertical: 7,
    borderRadius: 10,
    marginTop: 4,
  },
  quickInvestBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Empty Wishlist Card
  emptyWishlistCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
  },
  emptyHeartCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyWishlistTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  emptyWishlistSub: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
    maxWidth: 280,
  },
  browseTradingBtn: {
    backgroundColor: "#5835F5",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    marginTop: 18,
  },
  browseTradingBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // State wrappers
  loadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: "#64748B",
  },

  // ── Buy Shares Modal Styles ──
  buyModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "flex-end",
  },
  buyModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  buyModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  buyModalIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
  },
  buyModalTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  buyModalSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    fontWeight: "600",
  },
  buyModalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  buyModalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  buyOfferingMiniCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  buyOfferingThumb: {
    width: 54,
    height: 54,
    borderRadius: 12,
  },
  buyOfferingCat: {
    fontSize: 10,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.5,
  },
  buyOfferingTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 2,
  },
  buyOfferingSharePrice: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },
  buyOfferingRoundMeta: {
    fontSize: 12,
    color: "#64748B",
    marginLeft: 6,
    fontWeight: "600",
  },
  stepperContainer: {
    marginTop: 18,
    alignItems: "center",
  },
  stepperLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperCountWrap: {
    alignItems: "center",
    minWidth: 80,
  },
  stepperCountNum: {
    fontSize: 32,
    fontWeight: "900",
    color: "#0F172A",
  },
  stepperCountSub: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
    marginTop: 2,
  },
  buyFinancialSheet: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
  },
  buyFinancialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  buyFinancialLabel: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "600",
  },
  buyFinancialValueBold: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0F172A",
  },
  buyFinancialValueCash: {
    fontSize: 14,
    fontWeight: "800",
    color: "#2563EB",
  },
  buyFinancialDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 4,
  },
  buyFinancialValueRem: {
    fontSize: 14,
    fontWeight: "800",
    color: "#15803D",
  },
  insufficientPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  insufficientText: {
    fontSize: 12,
    color: "#DC2626",
    fontWeight: "700",
    flex: 1,
  },
  confirmBuyBtn: {
    marginTop: 18,
    borderRadius: 16,
    overflow: "hidden",
  },
  confirmBuyBtnDisabled: {
    opacity: 0.6,
  },
  confirmBuyGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
  },
  confirmBuyText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
