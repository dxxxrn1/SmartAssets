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
import storage, { STORAGE_KEYS } from "../utils/storage";

// ── Currency Formatter (British Pounds £) ─────────────────────────────────────
const formatGBP = (val, fallback = "£250") => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "string") {
    let str = val.trim();
    if (str.startsWith("R") || str.startsWith("ZAR")) {
      str = str.replace(/^(R\s?|ZAR\s?)/i, "");
    }
    const cleanNum = parseFloat(str.replace(/[^0-9.-]+/g, ""));
    if (!isNaN(cleanNum)) {
      return "£" + cleanNum.toLocaleString("en-GB", { maximumFractionDigits: 0 });
    }
    if (str.startsWith("£")) return str;
    return "£" + str;
  }
  const num =
    typeof val === "number"
      ? val
      : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return fallback;
  return "£" + num.toLocaleString("en-GB", { maximumFractionDigits: 0 });
};

// Fallback verified investment offerings with authentic metrics
const DEFAULT_OFFERINGS = [
  {
    id: "offering-submariner",
    name: "Authentic Vintage Rolex Submariner",
    category: "WATCHES",
    filterCat: "Watches",
    image:
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80",
    price: "£18,500",
    share_price: "£100",
    total_shares: 185,
    shares_sold: 142,
    funded_pct: 77,
  },
  {
    id: "offering-1",
    name: "Rolex Daytona 116500LN",
    category: "WATCHES",
    filterCat: "Watches",
    image:
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&q=80",
    price: "£34,500",
    share_price: "£100",
    total_shares: 345,
    shares_sold: 282,
    funded_pct: 82,
  },
  {
    id: "offering-2",
    name: "1967 Ferrari 330 GTC",
    category: "CARS",
    filterCat: "Cars",
    image:
      "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=600&q=80",
    price: "£890,000",
    share_price: "£250",
    total_shares: 3560,
    shares_sold: 2314,
    funded_pct: 65,
  },
  {
    id: "offering-3",
    name: "Untitled, 1984 (Basquiat)",
    category: "ART",
    filterCat: "Art",
    image:
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&q=80",
    price: "£124,000",
    share_price: "£100",
    total_shares: 1240,
    shares_sold: 1100,
    funded_pct: 89,
  },
  {
    id: "offering-4",
    name: "Domaine de la Romanée-Conti 1990",
    category: "WINE",
    filterCat: "Wine",
    image:
      "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&q=80",
    price: "£28,900",
    share_price: "£50",
    total_shares: 578,
    shares_sold: 260,
    funded_pct: 45,
  },
  {
    id: "offering-5",
    name: "Patek Philippe Nautilus 5711",
    category: "WATCHES",
    filterCat: "Watches",
    image:
      "https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=600&q=80",
    price: "£98,000",
    share_price: "£200",
    total_shares: 490,
    shares_sold: 460,
    funded_pct: 94,
  },
  {
    id: "offering-6",
    name: "Mayfair Prime Residence",
    category: "REAL ESTATE",
    filterCat: "Real Estate",
    image:
      "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&q=80",
    price: "£1,450,000",
    share_price: "£500",
    total_shares: 2900,
    shares_sold: 1595,
    funded_pct: 55,
  },
];

const WISHLIST_STORAGE_KEY = "@smartassets_wishlist";

export default function InvestScreen({ navigation }) {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState("trading"); // 'trading' | 'wishlist'
  const [offerings, setOfferings] = useState(DEFAULT_OFFERINGS);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userHoldings, setUserHoldings] = useState([]);
  const [vaultSummary, setVaultSummary] = useState(null);
  const [wishlistIds, setWishlistIds] = useState(["offering-1", "offering-5"]);

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

  const [availableCash, setAvailableCash] = useState(250);
  const [totalInvested, setTotalInvested] = useState(400);

  // Buy Shares Modal State
  const [selectedOffering, setSelectedOffering] = useState(null);
  const [buyModalVisible, setBuyModalVisible] = useState(false);
  const [buySharesCount, setBuySharesCount] = useState(1);

  // Load live market assets and user vault
  const loadData = useCallback(async () => {
    try {
      const res = await getMarketAssets("All", "");
      if (res?.assets && Array.isArray(res.assets) && res.assets.length > 0) {
        const mapped = res.assets.map((a, i) => ({
          ...a,
          share_price: a.share_price
            ? formatGBP(a.share_price)
            : a.sharePrice
            ? formatGBP(a.sharePrice)
            : "£100",
          total_shares: a.shares || a.total_shares || 500,
          shares_sold: a.shares_sold || a.sharesSold || 350,
          funded_pct:
            a.fundedPct || Math.round(Math.min(95, 40 + ((i * 12) % 55))),
        }));
        setOfferings(mapped);
      } else {
        setOfferings(DEFAULT_OFFERINGS);
      }
    } catch (_) {
      setOfferings(DEFAULT_OFFERINGS);
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

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // ── Financial Math: Total Invested & Available Cash (Always £250 Currency Formatted) ──
  const totalInvestedFormatted = useMemo(() => {
    return formatGBP(totalInvested, "£400");
  }, [totalInvested]);

  const availableCashFormatted = useMemo(() => {
    return formatGBP(availableCash, "£250");
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
      { category: "Watches", percentage: 52, color: "#8B5CF6", valueFormatted: "£77,220" },
      { category: "Art", percentage: 28, color: "#EC4899", valueFormatted: "£41,580" },
      { category: "Cars", percentage: 20, color: "#06B6D4", valueFormatted: "£29,700" },
    ];
  }, [userHoldings]);

  // Wishlist items filtered from offerings
  const wishlistItems = useMemo(() => {
    return offerings.filter((o) => wishlistIds.includes(o.id));
  }, [offerings, wishlistIds]);

  // Handle Direct Share Actions
  const handleBuyShares = (offering) => {
    setSelectedOffering(offering);
    setBuySharesCount(1);
    setBuyModalVisible(true);
  };

  const confirmInvestment = async () => {
    if (!selectedOffering) return;
    const sharePriceNum =
      parseFloat(String(selectedOffering.share_price || "").replace(/[^0-9.]/g, "")) || 100;
    const totalCost = buySharesCount * sharePriceNum;

    if (totalCost > availableCash) {
      Alert.alert(
        "Insufficient Cash",
        `You have £${availableCash.toLocaleString()} available in escrow. Please deposit funds via your Vault to complete this £${totalCost.toLocaleString()} investment.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go to Vault", onPress: () => navigation.navigate(SCREENS.VAULT) },
        ]
      );
      return;
    }

    // 1. Update Available Cash state & storage
    const newCash = availableCash - totalCost;
    setAvailableCash(newCash);
    await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, newCash);

    // 2. Update Total Invested state
    const newInvested = totalInvested + totalCost;
    setTotalInvested(newInvested);

    // 3. Update Offering Funding Progress %
    setOfferings((prevOfferings) =>
      prevOfferings.map((off) => {
        if (off.id === selectedOffering.id) {
          const currentPct = off.funded_pct || 77;
          const newPct = Math.min(100, currentPct + buySharesCount);
          const currentSold = off.shares_sold || 142;
          return {
            ...off,
            funded_pct: newPct,
            shares_sold: currentSold + buySharesCount,
          };
        }
        return off;
      })
    );

    // 4. Update Co-Owned Fractional Holdings in Storage for VaultScreen
    try {
      const existingFractions = (await storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS)) || [
        {
          id: "fraction-rolex",
          name: "Rolex Submariner Date 126610LN",
          category: "Watches",
          image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80",
          sharesOwned: 2,
          sharePrice: 100,
          sharePriceFormatted: "£100/sh",
          myStake: 200,
          myStakeFormatted: "£200",
          returnPct: "+12.4% Return",
          returnType: "positive",
          poolValuation: "£18,500",
          totalShares: 185,
          fundingPct: 77,
        },
        {
          id: "fraction-jordan",
          name: "1985 Air Jordan 1 Chicago (OG Mint)",
          category: "Sneakers",
          image: "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&q=80",
          sharesOwned: 2,
          sharePrice: 100,
          sharePriceFormatted: "£100/sh",
          myStake: 200,
          myStakeFormatted: "£200",
          returnPct: "+12.4% Return",
          returnType: "positive",
          poolValuation: "£25,000",
          totalShares: 250,
          fundingPct: 88,
        },
      ];

      const foundIdx = existingFractions.findIndex(
        (f) =>
          f.id === selectedOffering.id ||
          (f.name &&
            selectedOffering.name &&
            f.name.toLowerCase().includes(selectedOffering.name.toLowerCase()))
      );

      let updatedFractions = [];
      if (foundIdx >= 0) {
        updatedFractions = [...existingFractions];
        const prev = updatedFractions[foundIdx];
        const updatedShares = (prev.sharesOwned || 0) + buySharesCount;
        const updatedStake = (prev.myStake || 0) + totalCost;
        updatedFractions[foundIdx] = {
          ...prev,
          sharesOwned: updatedShares,
          myStake: updatedStake,
          myStakeFormatted: `£${updatedStake.toLocaleString("en-GB")}`,
        };
      } else {
        const newFractional = {
          id: "fraction-" + selectedOffering.id,
          name: selectedOffering.name,
          category: selectedOffering.category || "Watches",
          image: selectedOffering.image,
          sharesOwned: buySharesCount,
          sharePrice: sharePriceNum,
          sharePriceFormatted: `£${sharePriceNum}/sh`,
          myStake: totalCost,
          myStakeFormatted: `£${totalCost.toLocaleString("en-GB")}`,
          returnPct: "+12.4% Return",
          returnType: "positive",
          poolValuation: selectedOffering.price,
          totalShares: selectedOffering.total_shares || 185,
          fundingPct: Math.min(100, (selectedOffering.funded_pct || 77) + buySharesCount),
        };
        updatedFractions = [newFractional, ...existingFractions];
      }
      await storage.setJSON(STORAGE_KEYS.CO_OWNED_ASSETS, updatedFractions);
    } catch (_) {}

    setBuyModalVisible(false);

    Alert.alert(
      "Investment Confirmed! 🎉",
      `You acquired ${buySharesCount} share(s) in "${selectedOffering.name}" for £${totalCost.toLocaleString()}.\n\nRemaining Available Cash: £${newCash.toLocaleString()}.\nYour new position is now live in your Vault under Co-Owned Assets!`,
      [
        { text: "Keep Trading", style: "cancel" },
        { text: "View in Vault", onPress: () => navigation.navigate(SCREENS.VAULT) },
      ]
    );
  };

  const handleSellShares = (offering) => {
    const sharePriceNum =
      parseFloat(String(offering.share_price || "").replace(/[^0-9.]/g, "")) || 100;

    Alert.alert(
      "Liquidate Shares",
      `Would you like to liquidate 1 share of "${offering.name}" at fair oracle benchmark of £${sharePriceNum}? Proceeds will immediately credit your Escrow Wallet.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Sell 1 Share (+£${sharePriceNum})`,
          onPress: async () => {
            const newCash = availableCash + sharePriceNum;
            setAvailableCash(newCash);
            await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, newCash);

            const newInvested = Math.max(0, totalInvested - sharePriceNum);
            setTotalInvested(newInvested);

            // Adjust offering
            setOfferings((prev) =>
              prev.map((off) =>
                off.id === offering.id
                  ? {
                      ...off,
                      funded_pct: Math.max(10, (off.funded_pct || 75) - 1),
                      shares_sold: Math.max(0, (off.shares_sold || 10) - 1),
                    }
                  : off
              )
            );

            Alert.alert(
              "Shares Liquidated",
              `Sold 1 share of ${offering.name}. £${sharePriceNum} credited to your Escrow Wallet (New balance: £${newCash.toLocaleString()}).`
            );
          },
        },
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
    const sharePriceVal = item.share_price || item.sharePrice || "£100";
    const totalSharesVal =
      item.total_shares || item.shares || Math.max(10, Math.round(priceNum / 100));

    navigation.navigate(SCREENS.ASSET_DETAIL, {
      asset: {
        ...item,
        id: item.id,
        name: item.name || item.title || "Fractional Asset",
        title: item.name || item.title || "Fractional Asset",
        category: item.category || item.filterCat || "Watches",
        price: item.price || `£${priceNum.toLocaleString("en-GB")}`,
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
            <LinearGradient
              colors={["#976af0", "#00fbff"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoBadge}
            >
              <Ionicons name="diamond" size={17} color="#FFFFFF" />
            </LinearGradient>
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
                const formattedPrice = formatGBP(offering.price);
                const sharePrice = formatGBP(offering.share_price, "£100");
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
                            {formatGBP(item.share_price, "£100")}/sh
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
    </SafeAreaView>

    {/* ── Fractional Share Purchase Modal ── */}
    <Modal
      visible={buyModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setBuyModalVisible(false)}
    >
      <View style={styles.buyModalOverlay}>
        <View style={styles.buyModalCard}>
          {/* Modal Header */}
          <View style={styles.buyModalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1, marginRight: 10 }}>
              <View style={styles.buyModalIconBadge}>
                <Ionicons name="pie-chart" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.buyModalTitle}>Acquire Fractional Shares</Text>
                <Text style={styles.buyModalSubtitle} numberOfLines={1}>
                  {selectedOffering?.name || "Luxury Asset Round"}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.buyModalCloseBtn}
              onPress={() => setBuyModalVisible(false)}
              activeOpacity={0.7}
            >
              <Feather name="x" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          {selectedOffering && (() => {
            const sharePriceNum =
              parseFloat(String(selectedOffering.share_price || "").replace(/[^0-9.]/g, "")) || 100;
            const totalCost = buySharesCount * sharePriceNum;
            const isInsufficient = totalCost > availableCash;

            return (
              <View style={styles.buyModalBody}>
                {/* Offering Summary Card */}
                <View style={styles.buyOfferingMiniCard}>
                  <Image
                    source={{ uri: resolveImageUrl(selectedOffering.image) }}
                    style={styles.buyOfferingThumb}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.buyOfferingCat}>
                      {String(selectedOffering.category || "WATCHES").toUpperCase()}
                    </Text>
                    <Text style={styles.buyOfferingTitle} numberOfLines={1}>
                      {selectedOffering.name}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                      <Text style={styles.buyOfferingSharePrice}>
                        {formatGBP(sharePriceNum)} / share
                      </Text>
                      <Text style={styles.buyOfferingRoundMeta}>
                        • {selectedOffering.funded_pct || 77}% Funded
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Share Stepper Selector */}
                <View style={styles.stepperContainer}>
                  <Text style={styles.stepperLabel}>SELECT NUMBER OF SHARES</Text>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={[
                        styles.stepperBtn,
                        buySharesCount <= 1 && styles.stepperBtnDisabled,
                      ]}
                      onPress={() => setBuySharesCount((prev) => Math.max(1, prev - 1))}
                      disabled={buySharesCount <= 1}
                      activeOpacity={0.75}
                    >
                      <Feather name="minus" size={20} color={buySharesCount <= 1 ? "#CBD5E1" : "#0F172A"} />
                    </TouchableOpacity>

                    <View style={styles.stepperCountWrap}>
                      <Text style={styles.stepperCountNum}>{buySharesCount}</Text>
                      <Text style={styles.stepperCountSub}>
                        {buySharesCount === 1 ? "Share" : "Shares"}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.stepperBtn,
                        buySharesCount >= 10 && styles.stepperBtnDisabled,
                      ]}
                      onPress={() => setBuySharesCount((prev) => Math.min(10, prev + 1))}
                      disabled={buySharesCount >= 10}
                      activeOpacity={0.75}
                    >
                      <Feather name="plus" size={20} color={buySharesCount >= 10 ? "#CBD5E1" : "#0F172A"} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Financial Balance & Escrow Calculations */}
                <View style={styles.buyFinancialSheet}>
                  <View style={styles.buyFinancialRow}>
                    <Text style={styles.buyFinancialLabel}>Investment Total</Text>
                    <Text style={styles.buyFinancialValueBold}>
                      {formatGBP(totalCost)}
                    </Text>
                  </View>

                  <View style={styles.buyFinancialRow}>
                    <Text style={styles.buyFinancialLabel}>Available Cash (Escrow)</Text>
                    <Text style={styles.buyFinancialValueCash}>
                      {formatGBP(availableCash)}
                    </Text>
                  </View>

                  <View style={styles.buyFinancialDivider} />

                  <View style={styles.buyFinancialRow}>
                    <Text style={styles.buyFinancialLabel}>Remaining Cash After</Text>
                    <Text
                      style={[
                        styles.buyFinancialValueRem,
                        isInsufficient && { color: "#DC2626" },
                      ]}
                    >
                      {formatGBP(Math.max(0, availableCash - totalCost))}
                    </Text>
                  </View>
                </View>

                {isInsufficient && (
                  <View style={styles.insufficientPill}>
                    <Ionicons name="warning" size={15} color="#DC2626" style={{ marginRight: 6 }} />
                    <Text style={styles.insufficientText}>
                      Insufficient Escrow Cash. Please deposit funds in Vault.
                    </Text>
                  </View>
                )}

                {/* Confirmation CTA */}
                <TouchableOpacity
                  style={[
                    styles.confirmBuyBtn,
                    isInsufficient && styles.confirmBuyBtnDisabled,
                  ]}
                  onPress={confirmInvestment}
                  disabled={isInsufficient}
                  activeOpacity={0.88}
                >
                  <LinearGradient
                    colors={isInsufficient ? ["#94A3B8", "#64748B"] : ["#7C3AED", "#2563EB"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.confirmBuyGradient}
                  >
                    <Ionicons name="shield-checkmark" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.confirmBuyText}>
                      {isInsufficient
                        ? `Insufficient Funds (${formatGBP(availableCash)} Available)`
                        : `Confirm Investment (${formatGBP(totalCost)})`}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            );
          })()}
        </View>
      </View>
    </Modal>
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
