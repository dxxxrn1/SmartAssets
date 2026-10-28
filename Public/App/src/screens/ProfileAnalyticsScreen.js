// ─── ProfileAnalyticsScreen (Two-Tab Net-Worth & Marketplace Intelligence) ─────
// SmartAssets Modern Glassmorphism Theme (2025/2026)
// Assets Tab: Net-worth first, category allocation, concentration alert, top assets & ownership.
// Selling Tab: Period filters (7d, 30d, 90d, all), revenue, escrow orders, 6-month sales chart, listings.
// Strictly ZERO mock data. Clean empty states when accounts have no activity yet.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Share,
  Alert,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { ALIM, ROYAL } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import {
  getUserVault,
  getMarketAssets,
  getMyEscrowOrdersApi,
  getSellerEscrowOrdersApi,
  getVaultTransactionsApi,
  resolveImageUrl,
} from "../services/api";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Palette for Category Allocation Stacked Bar
const CATEGORY_COLORS = [
  "#00C2FF", // Cyan
  "#8B5CF6", // Violet
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#EC4899", // Pink
  "#6366F1", // Indigo
  "#14B8A6", // Teal
  "#F43F5E", // Rose
];

const SELLING_PERIODS = [
  { id: "7d", label: "7 Days", days: 7 },
  { id: "30d", label: "30 Days", days: 30 },
  { id: "90d", label: "90 Days", days: 90 },
  { id: "all", label: "All Time", days: 99999 },
];

export default function ProfileAnalyticsScreen({ navigation }) {
  const { user, token } = useAuth();

  // Active Tab: 'assets' (Opens first by default) | 'selling'
  const [activeTab, setActiveTab] = useState("assets");
  const [sellingPeriod, setSellingPeriod] = useState("30d");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [fetchErrors, setFetchErrors] = useState({
    vault: null,
    market: null,
    escrow: null,
    transactions: null,
  });

  // Real Data Stores
  const [holdings, setHoldings] = useState([]);
  const [vaultSummary, setVaultSummary] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [marketAssets, setMarketAssets] = useState([]);
  const [escrowOrders, setEscrowOrders] = useState([]);

  const formatZAR = useCallback((val) => {
    if (val === undefined || val === null || val === "") return "R0";
    const num =
      typeof val === "number"
        ? val
        : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    if (isNaN(num)) return "R0";
    return "R" + Math.round(num).toLocaleString("en-ZA");
  }, []);

  const getHoldingValue = useCallback((h) => {
    if (!h) return 0;
    if (h.effectiveHoldingValue !== undefined && h.effectiveHoldingValue !== null) {
      return Number(h.effectiveHoldingValue) || 0;
    }
    if (h.asset_type === "fractional") {
      return Number(h.myStake) || 0;
    }
    return Number(h.liveMarketValue) || Number(h.initialValue) || Number(h.price_num) || 0;
  }, []);

  const loadAllAnalyticsData = useCallback(async () => {
    try {
      if (!token) return;

      const [vaultRes, marketRes, buyerEscrowRes, sellerEscrowRes, txRes] =
        await Promise.allSettled([
          getUserVault(token, true),
          getMarketAssets("All", "", true, true),
          getMyEscrowOrdersApi(token),
          getSellerEscrowOrdersApi(token),
          getVaultTransactionsApi(token),
        ]);

      const newErrors = { vault: null, market: null, escrow: null, transactions: null };
      let hadFailure = false;

      // 1. Vault Holdings & Authoritative Summary
      if (vaultRes.status === "fulfilled" && vaultRes.value?.success) {
        setHoldings(vaultRes.value.holdings || []);
        setVaultSummary(vaultRes.value.summary || {});
      } else {
        hadFailure = true;
        newErrors.vault = vaultRes.reason?.message || "Failed to load vault data";
      }

      // 2. Marketplace Listings
      if (marketRes.status === "fulfilled" && marketRes.value?.success) {
        setMarketAssets(marketRes.value.assets || []);
      } else {
        hadFailure = true;
        newErrors.market = marketRes.reason?.message || "Failed to load marketplace listings";
      }

      // 3. Buyer & Seller Escrow Orders (Strict deduplication by order ID)
      const combinedEscrows = [];
      let escrowSuccess = false;

      if (sellerEscrowRes.status === "fulfilled" && Array.isArray(sellerEscrowRes.value?.orders)) {
        escrowSuccess = true;
        sellerEscrowRes.value.orders.forEach((so) => {
          combinedEscrows.push({ ...so, isSellerOrder: true });
        });
      }

      if (buyerEscrowRes.status === "fulfilled" && Array.isArray(buyerEscrowRes.value?.orders)) {
        escrowSuccess = true;
        buyerEscrowRes.value.orders.forEach((bo) => {
          const key = bo.orderId || bo.id || bo.order_id;
          const existing = combinedEscrows.find((e) => (e.orderId || e.id || e.order_id) === key);
          if (existing) {
            existing.isBuyerOrder = true;
          } else {
            combinedEscrows.push({ ...bo, isBuyerOrder: true });
          }
        });
      }

      if (escrowSuccess) {
        setEscrowOrders(combinedEscrows);
      } else {
        hadFailure = true;
        newErrors.escrow = "Failed to load escrow orders";
      }

      // 4. Ledger Transactions
      if (txRes.status === "fulfilled" && txRes.value?.success) {
        setTransactions(txRes.value.transactions || []);
      } else {
        hadFailure = true;
        newErrors.transactions = txRes.reason?.message || "Failed to load transactions";
      }

      setFetchErrors(newErrors);
      setIsStale(hadFailure);
    } catch (err) {
      console.warn("Analytics data load warning:", err.message);
      setIsStale(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    loadAllAnalyticsData();
  }, [loadAllAnalyticsData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAllAnalyticsData();
  }, [loadAllAnalyticsData]);

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 1: ASSETS COMPUTATIONS
  // ══════════════════════════════════════════════════════════════════════════
  const assetsMetrics = useMemo(() => {
    // 1. Authoritative liquid cash and locked escrow balances
    const cash = Number(vaultSummary?.availableBalanceNum) || 0;
    const escrowLocked = Number(vaultSummary?.escrowBalanceNum) || 0;

    // 2. Authoritative portfolio valuation using effectiveHoldingValue
    const portfolioVal = holdings.reduce(
      (sum, h) => sum + getHoldingValue(h),
      0
    );

    // Combined Net Worth: separate liquid cash, escrow custody, and holdings
    const totalNetWorth = cash + escrowLocked + portfolioVal;

    // Valuation categorization from vault API
    const valuationType = vaultSummary?.valuationType || "recorded";
    const valuationLabel = vaultSummary?.valuationLabel ||
      (valuationType === "market"
        ? "Live Market Value"
        : valuationType === "mixed"
          ? "Mixed Market & Recorded"
          : "Recorded Vault Value");

    // Liquid Cash vs Vault Assets breakdown
    const cashPct = totalNetWorth > 0 ? Math.round((cash / totalNetWorth) * 100) : 0;
    const assetsPct = totalNetWorth > 0 ? Math.round((portfolioVal / totalNetWorth) * 100) : 0;

    const count = holdings.length;
    const avgValue = count > 0 ? Math.round(portfolioVal / count) : 0;

    // 3. Performance derived strictly from dated portfolio_snapshots via vault API
    // (Never invent values or calculate monthly change from holding metadata)
    const hasPerformanceHistory = Boolean(vaultSummary?.hasPerformanceHistory);
    const monthlyChangeNum = vaultSummary?.monthlyChangeNum !== undefined ? vaultSummary.monthlyChangeNum : null;
    const monthlyChangePct = vaultSummary?.monthlyChangePct || null;
    const monthlyChangeFormatted = vaultSummary?.monthlyChangeFormatted || null;
    const isPositive = vaultSummary?.isPositive !== undefined
      ? vaultSummary.isPositive
      : (monthlyChangeNum !== null && monthlyChangeNum >= 0);
    const history = Array.isArray(vaultSummary?.history) ? vaultSummary.history : [];

    // 4. Allocation by category using authoritative effectiveHoldingValue
    const categoryMap = {};
    holdings.forEach((h) => {
      const cat = h.category ? String(h.category).trim() : "Uncategorised";
      const val = getHoldingValue(h);
      if (!categoryMap[cat]) {
        categoryMap[cat] = { category: cat, totalValue: 0, count: 0 };
      }
      categoryMap[cat].totalValue += val;
      categoryMap[cat].count += 1;
    });

    const categories = Object.values(categoryMap)
      .map((c, idx) => ({
        ...c,
        percentage:
          portfolioVal > 0 ? Math.round((c.totalValue / portfolioVal) * 100) : 0,
        color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      }))
      .sort((a, b) => b.totalValue - a.totalValue);

    // 5. Top 5 Most Valuable Assets using authoritative holding value
    const sortedAssets = [...holdings]
      .map((a) => {
        const val = getHoldingValue(a);
        return {
          ...a,
          val,
        };
      })
      .sort((a, b) => b.val - a.val)
      .slice(0, 5)
      .map((a) => {
        const shareOfAssets =
          portfolioVal > 0 ? Math.round((a.val / portfolioVal) * 100) : 0;
        return {
          ...a,
          shareOfAssets,
          shareOfPortfolio: shareOfAssets,
        };
      });

    // Concentration notice (50%+ of assets across multiple items only)
    const topAsset = sortedAssets[0] || null;
    const isConcentrated =
      count > 1 && topAsset && portfolioVal > 0 && topAsset.shareOfAssets >= 50;

    // 6. Best and Lowest Performers
    // Calculate asset-level performance ONLY when both a reliable initial value
    // and a dated live market valuation exist. Never treat price_num fallback as 0% gain.
    const withReliablePerformance = holdings
      .filter((h) => {
        const hasLive = (h.hasMarketValue === true) || (h.liveMarketValue !== null && h.liveMarketValue !== undefined && Number(h.liveMarketValue) > 0);
        const hasInit = (h.initialValue !== null && h.initialValue !== undefined && Number(h.initialValue) > 0);
        return hasLive && hasInit;
      })
      .map((h) => {
        const init = Number(h.initialValue);
        const live = Number(h.liveMarketValue);
        const diff = live - init;
        const pct = init > 0 ? (diff / init) * 100 : 0;
        return { ...h, diff, pct, isPositive: diff >= 0 };
      });

    let bestPerformer = null;
    let lowestPerformer = null;
    if (withReliablePerformance.length > 0) {
      const sortedByGain = [...withReliablePerformance].sort((a, b) => b.pct - a.pct);
      bestPerformer = sortedByGain[0];
      if (sortedByGain.length > 1 && sortedByGain[sortedByGain.length - 1].pct !== bestPerformer.pct) {
        lowestPerformer = sortedByGain[sortedByGain.length - 1];
      }
    }

    // 7. Ownership Structure: Outright vs Fractional
    // Uses authoritative effectiveHoldingValue; fractional holdings use stake once without fallback to price_num
    const outrightHoldings = holdings.filter((h) => h.asset_type !== "fractional");
    const fractionalHoldings = holdings.filter((h) => h.asset_type === "fractional");

    const outrightValue = outrightHoldings.reduce(
      (sum, h) => sum + getHoldingValue(h),
      0
    );
    const fractionalValue = fractionalHoldings.reduce(
      (sum, h) => sum + getHoldingValue(h),
      0
    );

    return {
      cash,
      escrowLocked,
      portfolioVal,
      totalNetWorth,
      valuationType,
      valuationLabel,
      cashPct,
      assetsPct,
      count,
      avgValue,
      hasPerformanceHistory,
      monthlyChangeNum,
      monthlyChangePct,
      monthlyChangeFormatted,
      isPositive,
      history,
      categories,
      sortedAssets,
      topAsset,
      isConcentrated,
      bestPerformer,
      lowestPerformer,
      outrightHoldings,
      fractionalHoldings,
      outrightValue,
      fractionalValue,
    };
  }, [holdings, vaultSummary, getHoldingValue]);

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 2: SELLING COMPUTATIONS
  // ══════════════════════════════════════════════════════════════════════════
  const sellingMetrics = useMemo(() => {
    const currentUserId = user?.id || user?.userId || user?.sub;
    const now = Date.now();
    const periodObj =
      SELLING_PERIODS.find((p) => p.id === sellingPeriod) || SELLING_PERIODS[1];
    const isAllTime = sellingPeriod === "all";
    const cutoffTime = now - periodObj.days * 86400000;

    const ACTIVE_ESCROW_STATUSES = [
      "payment_secured",
      "in_transit",
      "in_inspection",
      "delivered",
      "accepted",
      "disputed",
      "held",
      "funded",
      "in_escrow",
    ];

    const TERMINAL_SUCCESSFUL_STATUSES = ["completed", "released"];

    const getOrderAmount = (o) => {
      return Number(o.amountZar) || Number(o.amount_zar) || Number(o.priceZar) || 0;
    };

    const getOrderTimestamp = (o) => {
      const raw = o.created_at || o.createdAt;
      if (!raw) return null;
      const ts = new Date(raw).getTime();
      return isNaN(ts) ? null : ts;
    };

    // 1. Seller's listings on marketplace with explicit verification distinction
    const myListings = marketAssets.filter(
      (a) =>
        String(a.seller_id || a.sellerId) === String(currentUserId) ||
        String(a.user_id || a.userId) === String(currentUserId)
    );

    const verifiedListings = myListings.filter(
      (a) =>
        a.is_verified === true ||
        a.verified === true ||
        a.verification_status === "verified" ||
        a.verification_status === "certified"
    );

    const activeUnverifiedListings = myListings.filter(
      (a) =>
        a.status === "active" &&
        !a.is_verified &&
        !a.verified &&
        a.verification_status !== "verified" &&
        a.verification_status !== "certified"
    );

    const awaitingReviewListings = myListings.filter(
      (a) =>
        a.status === "pending" ||
        a.status === "pending_review" ||
        a.verification_status === "in_review" ||
        a.verification_status === "pending"
    );

    const soldListings = myListings.filter((a) => a.status === "sold");

    // 2. Orders where user is the seller (strictly deduplicated)
    const mySalesOrders = escrowOrders.filter((o) => {
      if (o.isSellerOrder) return true;
      return String(o.sellerId || o.seller_id) === String(currentUserId);
    });

    // Period filter: "All Time" includes all records; time filters require valid timestamps
    const filteredOrders = mySalesOrders.filter((o) => {
      if (isAllTime) return true;
      const orderTs = getOrderTimestamp(o);
      if (orderTs === null) return false; // Exclude undated orders from strict time-window filters
      return orderTs >= cutoffTime;
    });

    // Completed orders: ONLY terminal successful states (released / completed)
    // Never count payment_secured, in_transit, or other active custody states as revenue!
    const completedOrders = filteredOrders.filter((o) =>
      TERMINAL_SUCCESSFUL_STATUSES.includes(o.status)
    );

    const revenueNum = completedOrders.reduce(
      (sum, o) => sum + getOrderAmount(o),
      0
    );

    // In Escrow: active locked funds awaiting completion
    const inEscrowOrders = filteredOrders.filter((o) =>
      ACTIVE_ESCROW_STATUSES.includes(o.status)
    );

    const inEscrowNum = inEscrowOrders.reduce(
      (sum, o) => sum + getOrderAmount(o),
      0
    );

    // 3. 6-Month Sales Volume Chart (Past 6 calendar months from terminal successful orders)
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mYear = d.getFullYear();
      const mIdx = d.getMonth();
      const mName = d.toLocaleString("default", { month: "short" });

      const monthRevenue = mySalesOrders
        .filter((o) => {
          const ts = getOrderTimestamp(o);
          if (ts === null) return false;
          const od = new Date(ts);
          return (
            od.getFullYear() === mYear &&
            od.getMonth() === mIdx &&
            TERMINAL_SUCCESSFUL_STATUSES.includes(o.status)
          );
        })
        .reduce((sum, o) => sum + getOrderAmount(o), 0);

      months.push({
        name: mName,
        value: monthRevenue,
      });
    }

    const maxMonthVal = Math.max(...months.map((m) => m.value), 1000);

    return {
      myListings,
      verifiedListings,
      activeUnverifiedListings,
      awaitingReviewListings,
      soldListings,
      filteredOrders,
      completedOrders,
      revenueNum,
      inEscrowNum,
      inEscrowOrders,
      months,
      maxMonthVal,
    };
  }, [marketAssets, escrowOrders, user, sellingPeriod]);

  // ══════════════════════════════════════════════════════════════════════════
  // EXPLICIT VERIFICATION BADGE HELPERS
  // ══════════════════════════════════════════════════════════════════════════
  const renderHoldingVerificationBadge = (asset) => {
    const isMinted = Boolean(
      asset.nft_token_id || asset.tokenId || (asset.certId && asset.isVerified)
    );
    if (isMinted) {
      return (
        <View style={[styles.certPill, { backgroundColor: "rgba(16, 185, 129, 0.15)", borderColor: "rgba(16, 185, 129, 0.3)" }]}>
          <Ionicons name="shield-checkmark" size={10} color="#10B981" />
          <Text style={[styles.certPillText, { color: "#10B981" }]}>Certificate Minted</Text>
        </View>
      );
    }
    if (asset.isVerified === true || asset.verified === true) {
      return (
        <View style={[styles.certPill, { backgroundColor: "rgba(0, 194, 255, 0.15)", borderColor: "rgba(0, 194, 255, 0.3)" }]}>
          <Ionicons name="checkmark-circle" size={10} color="#00C2FF" />
          <Text style={[styles.certPillText, { color: "#00C2FF" }]}>Verified</Text>
        </View>
      );
    }
    if (asset.verification_status === "in_review" || asset.status === "in_review") {
      return (
        <View style={[styles.certPill, { backgroundColor: "rgba(245, 158, 11, 0.15)", borderColor: "rgba(245, 158, 11, 0.3)" }]}>
          <Ionicons name="hourglass-outline" size={10} color="#F59E0B" />
          <Text style={[styles.certPillText, { color: "#F59E0B" }]}>Under Review</Text>
        </View>
      );
    }
    return (
      <View style={[styles.certPill, { backgroundColor: "rgba(148, 163, 184, 0.12)", borderColor: "rgba(148, 163, 184, 0.25)" }]}>
        <Ionicons name="help-circle-outline" size={10} color="#94A3B8" />
        <Text style={[styles.certPillText, { color: "#94A3B8" }]}>Unverified</Text>
      </View>
    );
  };

  const renderListingStatusBadge = (listing) => {
    const isMinted = Boolean(listing.nft_token_id || listing.token_id || listing.cert_id);
    const isVer =
      listing.is_verified === true ||
      listing.verified === true ||
      listing.verification_status === "verified" ||
      listing.verification_status === "certified";

    if (listing.status === "sold") {
      return (
        <View style={[styles.listingStatusPill, styles.statusSold]}>
          <Text style={styles.listingStatusText}>Sold</Text>
        </View>
      );
    }
    if (listing.status === "delisted") {
      return (
        <View style={[styles.listingStatusPill, { backgroundColor: "rgba(239, 68, 68, 0.15)" }]}>
          <Text style={[styles.listingStatusText, { color: "#EF4444" }]}>Delisted</Text>
        </View>
      );
    }
    if (isMinted && isVer) {
      return (
        <View style={[styles.listingStatusPill, { backgroundColor: "rgba(16, 185, 129, 0.15)" }]}>
          <Text style={[styles.listingStatusText, { color: "#10B981" }]}>Cert Minted</Text>
        </View>
      );
    }
    if (isVer) {
      return (
        <View style={[styles.listingStatusPill, styles.statusActive]}>
          <Text style={[styles.listingStatusText, { color: "#00C2FF" }]}>Verified</Text>
        </View>
      );
    }
    if (listing.status === "active") {
      return (
        <View style={[styles.listingStatusPill, { backgroundColor: "rgba(56, 189, 248, 0.15)" }]}>
          <Text style={[styles.listingStatusText, { color: "#38BDF8" }]}>Listed</Text>
        </View>
      );
    }
    if (
      listing.status === "pending" ||
      listing.status === "pending_review" ||
      listing.verification_status === "in_review"
    ) {
      return (
        <View style={[styles.listingStatusPill, styles.statusPending]}>
          <Text style={styles.listingStatusText}>In Review</Text>
        </View>
      );
    }
    return (
      <View style={[styles.listingStatusPill, { backgroundColor: "rgba(148, 163, 184, 0.15)" }]}>
        <Text style={[styles.listingStatusText, { color: "#94A3B8" }]}>Unverified</Text>
      </View>
    );
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `SmartAssets Portfolio Intelligence\nNet Worth: ${formatZAR(
          assetsMetrics.totalNetWorth
        )} (${assetsMetrics.valuationLabel})\nAssets Tracked: ${assetsMetrics.count}\nVault Liquidity: ${formatZAR(
          assetsMetrics.cash
        )}`,
      });
    } catch (_e) {}
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      {/* ── Top App Bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Feather name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.titleWrap}>
          <Text style={styles.screenTitle}>SmartAssets Analytics</Text>
          <Text style={styles.screenSubtitle}>
            {activeTab === "assets"
              ? "Net-Worth & Custody Breakdown"
              : "Marketplace Sales & Escrow"}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.shareBtn}
          onPress={handleShare}
          activeOpacity={0.8}
        >
          <Feather name="share-2" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* ── Segmented Main Tabs: Assets vs Selling ── */}
      <View style={styles.mainTabRow}>
        <TouchableOpacity
          style={[styles.mainTabBtn, activeTab === "assets" && styles.mainTabBtnActive]}
          onPress={() => setActiveTab("assets")}
          activeOpacity={0.85}
        >
          <Feather
            name="pie-chart"
            size={14}
            color={activeTab === "assets" ? "#FFFFFF" : "rgba(255,255,255,0.6)"}
            style={{ marginRight: 6 }}
          />
          <Text
            style={[
              styles.mainTabText,
              activeTab === "assets" && styles.mainTabTextActive,
            ]}
          >
            Assets
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.mainTabBtn, activeTab === "selling" && styles.mainTabBtnActive]}
          onPress={() => setActiveTab("selling")}
          activeOpacity={0.85}
        >
          <Feather
            name="trending-up"
            size={14}
            color={activeTab === "selling" ? "#FFFFFF" : "rgba(255,255,255,0.6)"}
            style={{ marginRight: 6 }}
          />
          <Text
            style={[
              styles.mainTabText,
              activeTab === "selling" && styles.mainTabTextActive,
            ]}
          >
            Selling
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#00C2FF" />
          <Text style={styles.loadingText}>Syncing Vault & Market Intelligence...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#00C2FF"
            />
          }
        >
          {/* Stale Cache Notice Banner */}
          {isStale && (
            <View style={styles.staleNoticeRow}>
              <Ionicons name="information-circle-outline" size={14} color="#F59E0B" style={{ marginRight: 6 }} />
              <Text style={styles.staleNoticeText}>
                Showing cached data — network sync encountered a notice. Pull down to refresh.
              </Text>
            </View>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 1: ASSETS VIEW (NET-WORTH FIRST)
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "assets" && (
            <View>
              {/* 1. Hero Portfolio & Net-Worth Card */}
              <LinearGradient
                colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.9 }}
                style={styles.heroCard}
              >
                <View style={styles.heroHeaderTag}>
                  <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
                  <Text style={styles.heroHeaderTagText}>
                    NET WORTH ({assetsMetrics.valuationLabel.toUpperCase()})
                  </Text>
                </View>

                <Text style={styles.heroTotalValue}>
                  {formatZAR(assetsMetrics.totalNetWorth)}
                </Text>

                {/* Performance Pill: strictly from dated snapshots or explicit unavailable state */}
                {assetsMetrics.hasPerformanceHistory ? (
                  <View style={styles.changeBadgeRow}>
                    <View
                      style={[
                        styles.changePill,
                        assetsMetrics.isPositive
                          ? styles.changePillPositive
                          : styles.changePillNegative,
                      ]}
                    >
                      <Feather
                        name={assetsMetrics.isPositive ? "trending-up" : "trending-down"}
                        size={12}
                        color="#FFFFFF"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.changePillText}>
                        {assetsMetrics.monthlyChangeFormatted}
                        {assetsMetrics.monthlyChangePct ? ` (${assetsMetrics.monthlyChangePct})` : ""}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.changeBadgeRow}>
                    <View style={[styles.changePill, styles.changePillNeutral]}>
                      <Feather
                        name="clock"
                        size={12}
                        color="rgba(255, 255, 255, 0.7)"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.changePillText}>
                        Performance history unavailable (requires baseline)
                      </Text>
                    </View>
                  </View>
                )}

                {/* Sub-Metrics 3-Column Strip */}
                <View style={styles.subMetricsStrip}>
                  <View style={styles.subMetricCol}>
                    <Text style={styles.subMetricLabel}>Asset Count</Text>
                    <Text style={styles.subMetricVal}>
                      {assetsMetrics.count} {assetsMetrics.count === 1 ? "Item" : "Items"}
                    </Text>
                  </View>

                  <View style={styles.subMetricDivider} />

                  <View style={styles.subMetricCol}>
                    <Text style={styles.subMetricLabel}>Average Value</Text>
                    <Text style={styles.subMetricVal}>
                      {formatZAR(assetsMetrics.avgValue)}
                    </Text>
                  </View>

                  <View style={styles.subMetricDivider} />

                  <View style={styles.subMetricCol}>
                    <Text style={styles.subMetricLabel}>Vault Cash</Text>
                    <Text style={styles.subMetricVal}>
                      {formatZAR(assetsMetrics.cash)}
                    </Text>
                  </View>
                </View>

                {/* Separate Escrow Custody Notice */}
                {assetsMetrics.escrowLocked > 0 && (
                  <View style={styles.escrowNoticeRow}>
                    <Ionicons name="lock-closed" size={12} color="#F59E0B" style={{ marginRight: 5 }} />
                    <Text style={styles.escrowNoticeText}>
                      {formatZAR(assetsMetrics.escrowLocked)} in escrow custody (separate from available cash)
                    </Text>
                  </View>
                )}

                {/* Liquid Cash vs Vault Assets breakdown */}
                {assetsMetrics.totalNetWorth > 0 && (
                  <View style={styles.cashVsAssetsRow}>
                    <Text style={styles.cashVsAssetsText}>
                      {assetsMetrics.cashPct}% liquid cash, {assetsMetrics.assetsPct}% vault assets{assetsMetrics.escrowLocked > 0 ? `, ${formatZAR(assetsMetrics.escrowLocked)} in escrow` : ""}
                    </Text>
                  </View>
                )}
              </LinearGradient>

              {/* Error notice for Vault if failed */}
              {fetchErrors.vault && holdings.length === 0 && (
                <View style={styles.sectionErrorBox}>
                  <Feather name="alert-circle" size={16} color="#F43F5E" />
                  <Text style={styles.sectionErrorText}>Unable to sync vault holdings from server.</Text>
                  <TouchableOpacity onPress={onRefresh} style={styles.retryBtn}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 2. Concentration Warning Alert (50%+ of assets across multiple items only) */}
              {assetsMetrics.isConcentrated && assetsMetrics.topAsset && (
                <View style={styles.concentrationAlertBox}>
                  <View style={styles.alertIconWrap}>
                    <Ionicons name="warning" size={20} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.concentrationTitle}>High Concentration Notice</Text>
                    <Text style={styles.concentrationDesc}>
                      "{assetsMetrics.topAsset.name}" represents {assetsMetrics.topAsset.shareOfAssets}% of your assets.
                    </Text>
                  </View>
                </View>
              )}

              {/* 3. Category Allocation */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Asset Allocation</Text>
                  <Text style={styles.sectionSubtitle}>By Category</Text>
                </View>

                {assetsMetrics.categories.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Feather name="inbox" size={24} color="#64748B" />
                    <Text style={styles.emptyBoxText}>No asset holdings in vault yet</Text>
                  </View>
                ) : (
                  <View>
                    {/* Horizontal Proportional Stacked Bar */}
                    <View style={styles.stackedBar}>
                      {assetsMetrics.categories.map((cat, idx) => (
                        <View
                          key={cat.category}
                          style={[
                            styles.stackedBarSegment,
                            {
                              backgroundColor: cat.color,
                              flex: Math.max(cat.percentage, 3),
                              borderTopLeftRadius: idx === 0 ? 8 : 0,
                              borderBottomLeftRadius: idx === 0 ? 8 : 0,
                              borderTopRightRadius:
                                idx === assetsMetrics.categories.length - 1 ? 8 : 0,
                              borderBottomRightRadius:
                                idx === assetsMetrics.categories.length - 1 ? 8 : 0,
                            },
                          ]}
                        />
                      ))}
                    </View>

                    {/* Legend */}
                    <View style={styles.categoryLegendList}>
                      {assetsMetrics.categories.map((cat) => (
                        <View key={cat.category} style={styles.categoryLegendItem}>
                          <View style={styles.legendLeft}>
                            <View style={[styles.legendDot, { backgroundColor: cat.color }]} />
                            <Text style={styles.legendCategoryName}>{cat.category}</Text>
                            <Text style={styles.legendCountText}>({cat.count})</Text>
                          </View>
                          <View style={styles.legendRight}>
                            <Text style={styles.legendValueText}>
                              {formatZAR(cat.totalValue)}
                            </Text>
                            <View style={styles.legendPctPill}>
                              <Text style={styles.legendPctText}>{cat.percentage}%</Text>
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {/* 4. Most Valuable Assets (Top 5) */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Most Valuable Assets</Text>
                  <Text style={styles.sectionSubtitle}>Top Holdings</Text>
                </View>

                {assetsMetrics.sortedAssets.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Feather name="layers" size={24} color="#64748B" />
                    <Text style={styles.emptyBoxText}>No assets logged</Text>
                  </View>
                ) : (
                  assetsMetrics.sortedAssets.map((asset, index) => (
                    <View key={asset.id || index} style={styles.topAssetRow}>
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankBadgeText}>#{index + 1}</Text>
                      </View>

                      {asset.image ? (
                        <Image
                          source={{ uri: resolveImageUrl(asset.image) }}
                          style={styles.topAssetImg}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.topAssetImgFallback}>
                          <Ionicons name="cube-outline" size={20} color="#94A3B8" />
                        </View>
                      )}

                      <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={styles.topAssetName} numberOfLines={1}>
                          {asset.name}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                          <Text style={styles.topAssetCategory}>{asset.category || "Luxury Asset"}</Text>
                          <View style={{ marginLeft: 6 }}>
                            {renderHoldingVerificationBadge(asset)}
                          </View>
                        </View>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.topAssetPrice}>{formatZAR(asset.val)}</Text>
                        <View style={styles.shareOfPortPill}>
                          <Text style={styles.shareOfPortText}>{asset.shareOfAssets}% of assets</Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* 5. Performance: Best & Lowest Performer (Only when reliable dated market data exists) */}
              {assetsMetrics.bestPerformer ? (
                <View style={styles.performanceGrid}>
                  <View style={[styles.perfCard, { borderColor: "rgba(16, 185, 129, 0.3)" }]}>
                    <View style={styles.perfHeader}>
                      <Feather name="arrow-up-right" size={16} color="#10B981" />
                      <Text style={[styles.perfTitle, { color: "#10B981" }]}>Best Performer</Text>
                    </View>
                    <Text style={styles.perfName} numberOfLines={1}>
                      {assetsMetrics.bestPerformer.name}
                    </Text>
                    <Text style={styles.perfGainText}>
                      +{assetsMetrics.bestPerformer.pct.toFixed(1)}% (+{formatZAR(assetsMetrics.bestPerformer.diff)})
                    </Text>
                  </View>

                  {assetsMetrics.lowestPerformer && assetsMetrics.lowestPerformer.id !== assetsMetrics.bestPerformer.id && (
                    <View style={[styles.perfCard, { borderColor: "rgba(244, 63, 94, 0.3)" }]}>
                      <View style={styles.perfHeader}>
                        <Feather name="arrow-down-right" size={16} color="#F43F5E" />
                        <Text style={[styles.perfTitle, { color: "#F43F5E" }]}>Lowest Performer</Text>
                      </View>
                      <Text style={styles.perfName} numberOfLines={1}>
                        {assetsMetrics.lowestPerformer.name}
                      </Text>
                      <Text style={[styles.perfGainText, { color: assetsMetrics.lowestPerformer.pct >= 0 ? "#10B981" : "#F43F5E" }]}>
                        {assetsMetrics.lowestPerformer.pct >= 0 ? "+" : ""}{assetsMetrics.lowestPerformer.pct.toFixed(1)}% ({assetsMetrics.lowestPerformer.diff >= 0 ? "+" : ""}{formatZAR(assetsMetrics.lowestPerformer.diff)})
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.perfUnavailableBox}>
                  <Ionicons name="stats-chart-outline" size={16} color="#94A3B8" style={{ marginRight: 8 }} />
                  <Text style={styles.perfUnavailableText}>
                    Asset-level market performance requires dated live appraisals. Holdings are currently tracked at recorded cost basis.
                  </Text>
                </View>
              )}

              {/* 6. How You Own Them: Outright vs Fractional */}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Ownership Structure</Text>
                <View style={styles.ownershipRow}>
                  <View style={styles.ownershipCard}>
                    <View style={styles.ownershipIconWrap}>
                      <Ionicons name="key" size={16} color="#00C2FF" />
                    </View>
                    <Text style={styles.ownershipType}>Outright (100%)</Text>
                    <Text style={styles.ownershipValue}>{formatZAR(assetsMetrics.outrightValue)}</Text>
                    <Text style={styles.ownershipCount}>
                      {assetsMetrics.outrightHoldings.length} {assetsMetrics.outrightHoldings.length === 1 ? "Asset" : "Assets"}
                    </Text>
                  </View>

                  <View style={styles.ownershipCard}>
                    <View style={[styles.ownershipIconWrap, { backgroundColor: "rgba(139, 92, 246, 0.15)" }]}>
                      <Ionicons name="pie-chart" size={16} color="#8B5CF6" />
                    </View>
                    <Text style={styles.ownershipType}>Fractional Co-Owned</Text>
                    <Text style={styles.ownershipValue}>{formatZAR(assetsMetrics.fractionalValue)}</Text>
                    <Text style={styles.ownershipCount}>
                      {assetsMetrics.fractionalHoldings.length} {assetsMetrics.fractionalHoldings.length === 1 ? "Stake" : "Stakes"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* 7. Recent Cash & Ledger Activity */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent Cash Activity</Text>
                  <Text style={styles.sectionSubtitle}>Vault Ledger</Text>
                </View>

                {transactions.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Feather name="clock" size={24} color="#64748B" />
                    <Text style={styles.emptyBoxText}>No transactions or cash activity logged yet</Text>
                  </View>
                ) : (
                  transactions.slice(0, 4).map((tx, idx) => {
                    const isPos = tx.positive || tx.type === "deposit" || tx.type === "sale";
                    const isPurchase = tx.type === "purchase";
                    return (
                      <View key={tx.id || idx} style={styles.txRow}>
                        <View
                          style={[
                            styles.txIconWrap,
                            isPos
                              ? styles.txIconDeposit
                              : isPurchase
                              ? { backgroundColor: "rgba(139, 92, 246, 0.15)" }
                              : styles.txIconWithdraw,
                          ]}
                        >
                          <Feather
                            name={
                              isPos
                                ? "arrow-down-left"
                                : isPurchase
                                ? "shopping-bag"
                                : "arrow-up-right"
                            }
                            size={14}
                            color={isPos ? "#10B981" : isPurchase ? "#A78BFA" : "#F43F5E"}
                          />
                        </View>
                        <View style={{ flex: 1, marginHorizontal: 12 }}>
                          <Text style={styles.txDescText} numberOfLines={1}>
                            {tx.notes || tx.title || (isPos ? "Sale Proceeds / Deposit" : "Marketplace Purchase")}
                          </Text>
                          <Text style={styles.txDateText}>
                            {tx.createdAt
                              ? new Date(tx.createdAt).toLocaleDateString("en-ZA", {
                                  day: "numeric",
                                  month: "short",
                                })
                              : "Recent"}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.txAmountText,
                            { color: isPos ? "#10B981" : "#FFFFFF" },
                          ]}
                        >
                          {isPos ? "+" : "-"}
                          {formatZAR(tx.amount)}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 2: SELLING VIEW (MARKETPLACE & ESCROW)
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "selling" && (
            <View>
              {/* Period Selector Pills */}
              <View style={styles.periodPillRow}>
                {SELLING_PERIODS.map((period) => (
                  <TouchableOpacity
                    key={period.id}
                    style={[
                      styles.periodPill,
                      sellingPeriod === period.id && styles.periodPillActive,
                    ]}
                    onPress={() => setSellingPeriod(period.id)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.periodPillText,
                        sellingPeriod === period.id && styles.periodPillTextActive,
                      ]}
                    >
                      {period.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 3 Summary Metric Cards */}
              <View style={styles.summaryGrid}>
                <View style={styles.metricCard}>
                  <View style={styles.metricCardHeader}>
                    <Feather name="dollar-sign" size={14} color="#10B981" />
                    <Text style={styles.metricCardLabel}>Revenue</Text>
                  </View>
                  <Text style={styles.metricCardVal}>
                    {formatZAR(sellingMetrics.revenueNum)}
                  </Text>
                  <Text style={styles.metricCardSub}>Completed sales (released)</Text>
                </View>

                <View style={styles.metricCard}>
                  <View style={styles.metricCardHeader}>
                    <Feather name="check-circle" size={14} color="#00C2FF" />
                    <Text style={styles.metricCardLabel}>Orders</Text>
                  </View>
                  <Text style={styles.metricCardVal}>
                    {sellingMetrics.completedOrders.length}
                  </Text>
                  <Text style={styles.metricCardSub}>Delivered & released</Text>
                </View>

                <View style={styles.metricCard}>
                  <View style={styles.metricCardHeader}>
                    <Ionicons name="lock-closed" size={14} color="#F59E0B" />
                    <Text style={styles.metricCardLabel}>In Escrow</Text>
                  </View>
                  <Text style={styles.metricCardVal}>
                    {formatZAR(sellingMetrics.inEscrowNum)}
                  </Text>
                  <Text style={styles.metricCardSub}>Active in settlement</Text>
                </View>
              </View>

              {/* 6-Month Sales Volume Chart */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Sales Volume</Text>
                  <Text style={styles.sectionSubtitle}>Past 6 Months</Text>
                </View>

                <View style={styles.barChartContainer}>
                  {sellingMetrics.months.map((m, idx) => {
                    const heightPct = Math.max(
                      8,
                      Math.round((m.value / sellingMetrics.maxMonthVal) * 100)
                    );
                    return (
                      <View key={idx} style={styles.barCol}>
                        <Text style={styles.barValText}>
                          {m.value > 0 ? formatZAR(m.value).replace("R", "") : ""}
                        </Text>
                        <View style={styles.barTrack}>
                          <LinearGradient
                            colors={m.value > 0 ? ["#00C2FF", "#5B36F5"] : ["#334155", "#1E293B"]}
                            style={[styles.barFill, { height: `${heightPct}%` }]}
                          />
                        </View>
                        <Text style={styles.barMonthLabel}>{m.name}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Your Marketplace Listings */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Your Listings Status</Text>
                  <Text style={styles.sectionSubtitle}>{sellingMetrics.myListings.length} Total</Text>
                </View>

                <View style={styles.listingStatRow}>
                  <View style={styles.listingStatPill}>
                    <View style={[styles.statDot, { backgroundColor: "#00C2FF" }]} />
                    <Text style={styles.listingStatText}>
                      {sellingMetrics.verifiedListings.length} Verified
                    </Text>
                  </View>

                  <View style={styles.listingStatPill}>
                    <View style={[styles.statDot, { backgroundColor: "#38BDF8" }]} />
                    <Text style={styles.listingStatText}>
                      {sellingMetrics.activeUnverifiedListings.length} Listed
                    </Text>
                  </View>

                  <View style={styles.listingStatPill}>
                    <View style={[styles.statDot, { backgroundColor: "#F59E0B" }]} />
                    <Text style={styles.listingStatText}>
                      {sellingMetrics.awaitingReviewListings.length} In Review
                    </Text>
                  </View>

                  <View style={styles.listingStatPill}>
                    <View style={[styles.statDot, { backgroundColor: "#8B5CF6" }]} />
                    <Text style={styles.listingStatText}>
                      {sellingMetrics.soldListings.length} Sold
                    </Text>
                  </View>
                </View>

                {sellingMetrics.myListings.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Feather name="shopping-bag" size={24} color="#64748B" />
                    <Text style={styles.emptyBoxText}>
                      You haven't listed any assets on the marketplace yet
                    </Text>
                  </View>
                ) : (
                  sellingMetrics.myListings.slice(0, 5).map((listing, idx) => {
                    const isFractional = listing.allow_investment || (listing.shares && listing.shares > 1);
                    const sharesSold = listing.shares_sold || 0;
                    const totalShares = listing.shares || 100;
                    const sharesPct = Math.round((sharesSold / totalShares) * 100);

                    return (
                      <TouchableOpacity
                        key={listing.id || idx}
                        style={styles.listingCard}
                        onPress={() => navigation.navigate(SCREENS.ASSET_DETAIL, { asset: listing })}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          {listing.image ? (
                            <Image
                              source={{ uri: resolveImageUrl(listing.image) }}
                              style={styles.listingThumb}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.listingThumbFallback}>
                              <Feather name="box" size={16} color="#94A3B8" />
                            </View>
                          )}

                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.listingName} numberOfLines={1}>
                              {listing.name}
                            </Text>
                            <Text style={styles.listingPrice}>{formatZAR(listing.price)}</Text>
                          </View>

                          <View style={{ marginLeft: 8 }}>
                            {renderListingStatusBadge(listing)}
                          </View>
                        </View>

                        {/* Fractional Shares Sold Progress Bar */}
                        {isFractional && listing.status !== "sold" && (
                          <View style={styles.fractionalProgressWrap}>
                            <View style={styles.fractionalProgressHeader}>
                              <Text style={styles.fractionalProgressLabel}>
                                Fractional Shares Sold
                              </Text>
                              <Text style={styles.fractionalProgressVal}>
                                {sharesSold} / {totalShares} ({sharesPct}%)
                              </Text>
                            </View>
                            <View style={styles.progressBarTrack}>
                              <View
                                style={[
                                  styles.progressBarFill,
                                  { width: `${Math.min(sharesPct, 100)}%` },
                                ]}
                              />
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#070A12",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  backBtn: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  titleWrap: {
    alignItems: "center",
  },
  screenTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  screenSubtitle: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.6)",
    marginTop: 2,
  },
  shareBtn: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },

  // Main Tabs
  mainTabRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 6,
    borderRadius: 12,
    padding: 4,
  },
  mainTabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
  },
  mainTabBtnActive: {
    backgroundColor: "#5B36F5",
    shadowColor: "#5B36F5",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  mainTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.6)",
  },
  mainTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loadingText: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 12,
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
  },

  // Hero Card
  heroCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#5B36F5",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  heroHeaderTag: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  heroHeaderTagText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.8,
  },
  heroTotalValue: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    marginVertical: 4,
  },
  changeBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 6,
  },
  changePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  changePillPositive: {
    backgroundColor: "rgba(16, 185, 129, 0.3)",
  },
  changePillNegative: {
    backgroundColor: "rgba(239, 68, 68, 0.3)",
  },
  changePillNeutral: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  changePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  subMetricsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  subMetricCol: {
    flex: 1,
    alignItems: "center",
  },
  subMetricLabel: {
    fontSize: 10,
    color: "rgba(255, 255, 255, 0.75)",
    fontWeight: "600",
    marginBottom: 2,
  },
  subMetricVal: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  subMetricDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  escrowNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  escrowNoticeText: {
    fontSize: 11,
    color: "#FDE68A",
    fontWeight: "600",
  },
  cashVsAssetsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
  },
  cashVsAssetsText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.85)",
    letterSpacing: 0.3,
  },

  // Concentration Alert
  concentrationAlertBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  alertIconWrap: {
    marginRight: 10,
    marginTop: 2,
  },
  concentrationTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F59E0B",
    marginBottom: 2,
  },
  concentrationDesc: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.8)",
    lineHeight: 17,
  },

  // General Section Card
  sectionCard: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: 16,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.5)",
  },

  // Stacked Bar
  stackedBar: {
    flexDirection: "row",
    height: 12,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginBottom: 14,
  },
  stackedBarSegment: {
    height: "100%",
  },
  categoryLegendList: {
    gap: 10,
  },
  categoryLegendItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  legendLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  legendCategoryName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  legendCountText: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.5)",
    marginLeft: 4,
  },
  legendRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendValueText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    marginRight: 8,
  },
  legendPctPill: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  legendPctText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#00C2FF",
  },

  // Top Assets List
  topAssetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  rankBadge: {
    width: 22,
    alignItems: "center",
  },
  rankBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.4)",
  },
  topAssetImg: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#1E293B",
  },
  topAssetImgFallback: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
  },
  topAssetName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  topAssetCategory: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.5)",
  },
  certPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingVertical: 1,
    paddingHorizontal: 5,
    borderRadius: 4,
    marginLeft: 6,
  },
  certPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#10B981",
    marginLeft: 3,
  },
  topAssetPrice: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  shareOfPortPill: {
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginTop: 2,
  },
  shareOfPortText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#00C2FF",
  },

  // Performance Cards
  performanceGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  perfCard: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  perfHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  perfTitle: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
  },
  perfName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  perfGainText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#10B981",
  },

  // Ownership Breakdown
  ownershipRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  ownershipCard: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  ownershipIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(0, 194, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  ownershipType: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.6)",
    fontWeight: "600",
  },
  ownershipValue: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 2,
    marginBottom: 2,
  },
  ownershipCount: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.4)",
  },

  // Transactions
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  txIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  txIconDeposit: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  txIconWithdraw: {
    backgroundColor: "rgba(244, 63, 94, 0.15)",
  },
  txDescText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  txDateText: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.45)",
    marginTop: 1,
  },
  txAmountText: {
    fontSize: 13,
    fontWeight: "700",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 2: SELLING STYLES
  // ══════════════════════════════════════════════════════════════════════════
  periodPillRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  periodPill: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  periodPillActive: {
    backgroundColor: "#00C2FF",
    borderColor: "#00C2FF",
  },
  periodPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.6)",
  },
  periodPillTextActive: {
    color: "#070A12",
    fontWeight: "700",
  },

  summaryGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  metricCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  metricCardLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.6)",
    marginLeft: 4,
  },
  metricCardVal: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  metricCardSub: {
    fontSize: 10,
    color: "rgba(255, 255, 255, 0.4)",
    marginTop: 2,
  },

  // 6-Month Chart
  barChartContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 120,
    paddingTop: 10,
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    height: "100%",
    justifyContent: "flex-end",
  },
  barValText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#00C2FF",
    marginBottom: 4,
  },
  barTrack: {
    width: 14,
    height: 80,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 7,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  barFill: {
    width: "100%",
    borderRadius: 7,
  },
  barMonthLabel: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 6,
  },

  // Listings Breakdown
  listingStatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  listingStatPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  listingStatText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  listingCard: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    padding: 12,
    marginBottom: 10,
  },
  listingThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#1E293B",
  },
  listingThumbFallback: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
  },
  listingName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  listingPrice: {
    fontSize: 12,
    fontWeight: "700",
    color: "#00C2FF",
    marginTop: 1,
  },
  listingStatusPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  statusPending: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  statusSold: {
    backgroundColor: "rgba(139, 92, 246, 0.15)",
  },
  listingStatusText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  fractionalProgressWrap: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  fractionalProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  fractionalProgressLabel: {
    fontSize: 10,
    color: "rgba(255, 255, 255, 0.5)",
  },
  fractionalProgressVal: {
    fontSize: 10,
    fontWeight: "700",
    color: "#00C2FF",
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#00C2FF",
    borderRadius: 3,
  },

  // Notices and Unavailable States
  staleNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  staleNoticeText: {
    fontSize: 11,
    color: "#F59E0B",
    fontWeight: "600",
    flex: 1,
  },
  sectionErrorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(244, 63, 94, 0.12)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.25)",
  },
  sectionErrorText: {
    fontSize: 12,
    color: "#F43F5E",
    flex: 1,
    marginLeft: 8,
    fontWeight: "600",
  },
  retryBtn: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: "rgba(244, 63, 94, 0.25)",
    borderRadius: 6,
  },
  retryBtnText: {
    fontSize: 11,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  perfUnavailableBox: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  perfUnavailableText: {
    fontSize: 12,
    color: "#94A3B8",
    flex: 1,
    lineHeight: 17,
  },

  // Empty State Box
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  emptyBoxText: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 8,
  },
});
