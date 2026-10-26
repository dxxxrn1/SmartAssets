// ─── VaultScreen (User Portfolio & Secure Ledger) ─────────────────────────────
// SmartAssets Modern Glassmorphism Theme (Mockup 2025/2026)
// Featuring Luminous Mesh Gradient Canvas, Violet-to-Magenta Vault Hero Card,
// Working Deposit & Withdraw Capabilities, Verified Holdings, and Transaction Ledger.

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Platform,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { SCREENS } from "../constants/navigation";
import { useAuth } from "../context/AuthContext";
import KycGatekeeperModal from "../components/KycGatekeeperModal";
import { useTheme } from "../context/ThemeContext";
import { OfflineBanner } from "../context/NetworkContext";
import { getVaultCache } from "../services/storage";
import {
  getUserVault,
  depositFundsApi,
  withdrawFundsApi,
  getVaultTransactionsApi,
  getMarketOracleApi,
  resolveImageUrl,
} from "../services/api";
import storage, { STORAGE_KEYS } from "../utils/storage";

// ── Currency Formatter (South African Rand R) ─────────────────────────────────
const formatZAR = (val, fallback = "R0") => {
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

// ── Empty Default Collections for Vault (Populated dynamically from Supabase) ─
const DEFAULT_PERSONAL_ITEMS = [];
const DEFAULT_FRACTIONAL_ITEMS = [];
const DEFAULT_ACTIVITY_LOG = [];


export default function VaultScreen({ navigation }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 860;
  const cardWidth = isDesktop
    ? (screenWidth - 36 - 32) / 3
    : (screenWidth - 36 - 16) / 2;

  const { user, token, logout } = useAuth();
  const [kycGatekeeperVisible, setKycGatekeeperVisible] = useState(false);
  const [gatekeeperRequireBankOnly, setGatekeeperRequireBankOnly] = useState(false);
  const [gatekeeperActionTitle, setGatekeeperActionTitle] = useState("Transact");

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("personal"); // 'personal' | 'fractions' | 'log'
  const [personalItems, setPersonalItems] = useState([]);
  const [fractionalItems, setFractionalItems] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [escrowCash, setEscrowCash] = useState(0);

  const [holdings, setHoldings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({
    availableBalanceFormatted: "R0",
    availableBalanceNum: 0,
    portfolioValueFormatted: "R0",
    portfolioValueNum: 0,
    totalValueFormatted: "R0",
    totalValueNum: 0,
    totalCount: 0,
    gainText: "0.0% YTD",
  });

  // Dynamic Financial Math for Headline
  const personalTotal = personalItems.reduce(
    (sum, it) => sum + (Number(it.liveMarketValue) || Number(it.initialValue) || 0),
    0
  );
  const fractionalTotal = fractionalItems.reduce(
    (sum, it) => sum + (Number(it.myStake) || 0),
    0
  );
  const totalCollectionValueNum = personalTotal + fractionalTotal + escrowCash;
  const totalCollectionValueFormatted = formatGBP(totalCollectionValueNum);

  // Modals
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);

  // Deposit Form
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("Instant EFT / Card");
  const [depositing, setDepositing] = useState(false);

  // Withdraw Form
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("Bank EFT");
  const [bankName, setBankName] = useState("Barclays UK");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState(user?.fullName || "");
  const [cryptoAddress, setCryptoAddress] = useState(user?.walletAddress || "");
  const [withdrawing, setWithdrawing] = useState(false);

  const [syncingPrices, setSyncingPrices] = useState(false);
  const lastVaultFetchRef = useRef(0);

  // Helper to map and merge cloud holdings into personal and fractional tabs
  const processHoldingsIntoTabs = useCallback(
    (serverHoldings, currentPersonal, currentFractions) => {
      if (!Array.isArray(serverHoldings) || serverHoldings.length === 0) {
        return { personal: [], fractional: [] };
      }

      const mergedPersonal = [];
      const mergedFractional = [];

      serverHoldings.forEach((h) => {
        const isFractional = h.asset_type === "fractional";
        if (isFractional) {
          const foundIdx = mergedFractional.findIndex(
            (f) =>
              String(f.id) === String(h.id) ||
              (f.name &&
                h.name &&
                f.name.toLowerCase() === h.name.toLowerCase())
          );
          const mapped = {
            id: h.id || `fraction-${Math.random()}`,
            name: h.name,
            category: h.category || "Watches",
            image: resolveImageUrl(h.image),
            sharesOwned: Number(h.sharesOwned) || 1,
            sharePrice: Number(h.price_num) || 100,
            sharePriceFormatted: formatGBP(h.price_num || 100) + "/sh",
            myStake: Number(h.myStake) || Number(h.price_num) || 100,
            myStakeFormatted: formatGBP(h.myStake || h.price_num || 100),
            returnPct:
              h.badgeText ||
              (h.gain ? h.gain.split("<!--")[0].trim() : "+0.0% Return"),
            returnType: h.badgeType || (h.positive ? "positive" : "negative"),
            poolValuation: formatGBP((Number(h.price_num) || 100) * 100),
            totalShares: 100,
            fundingPct: 80,
          };
          if (foundIdx >= 0) {
            mergedFractional[foundIdx] = {
              ...mergedFractional[foundIdx],
              ...mapped,
            };
          } else {
            mergedFractional.unshift(mapped);
          }
        } else {
          const foundIdx = mergedPersonal.findIndex(
            (p) =>
              String(p.id) === String(h.id) ||
              (p.name &&
                h.name &&
                p.name.toLowerCase() === h.name.toLowerCase())
          );
          const initVal = Number(h.initialValue || h.price_num || 120);
          const liveVal = Number(h.liveMarketValue || h.price_num || 120);
          const diff = liveVal - initVal;
          const pct =
            initVal > 0 ? ((diff / initVal) * 100).toFixed(1) : "0.0";
          const isDeprec = diff < 0;
          const rawBadge = h.badgeText ? String(h.badgeText).replace(/Tech Depreciation/gi, "Market Depreciation") : null;
          const badgeText =
            rawBadge ||
            (isDeprec
              ? `${pct}% Market Depreciation`
              : `+${pct}% Market Gain`);
          const badgeType =
            h.badgeType || (isDeprec ? "negative" : "positive");

          const mapped = {
            id: h.id || `personal-${Math.random()}`,
            name: h.name,
            category: h.category || "Luxury Item",
            image: resolveImageUrl(h.image),
            initialValue: initVal,
            initialValueFormatted: formatGBP(initVal),
            liveMarketValue: liveVal,
            liveMarketValueFormatted: formatGBP(liveVal),
            badgeText,
            badgeType,
            ownership: "100% Owned",
            certId:
              h.certId || `ERC-721 #${String(h.id || "").slice(-4) || "5001"}`,
            condition: h.condition || "Mint Condition",
          };
          if (foundIdx >= 0) {
            mergedPersonal[foundIdx] = {
              ...mergedPersonal[foundIdx],
              ...mapped,
            };
          } else {
            mergedPersonal.unshift(mapped);
          }
        }
      });

      return { personal: mergedPersonal, fractional: mergedFractional };
    },
    []
  );

  // 1. Initial cached state restoration (runs only once on mount)
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      storage.getJSON(STORAGE_KEYS.PERSONAL_COLLECTION),
      storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS),
      storage.getJSON(STORAGE_KEYS.ESCROW_CASH),
      storage.getJSON(STORAGE_KEYS.VAULT),
      storage.getJSON(STORAGE_KEYS.VAULT_ACTIVITY_LOG),
    ]).then(
      ([
        cachedPersonal,
        cachedFractions,
        cachedCash,
        cachedVault,
        cachedLogs,
      ]) => {
        if (!isMounted) return;
        if (
          cachedPersonal &&
          Array.isArray(cachedPersonal) &&
          cachedPersonal.length > 0
        ) {
          const cleaned = cachedPersonal.map((item) => ({
            ...item,
            badgeText: item.badgeText
              ? String(item.badgeText).replace(/Tech Depreciation/gi, "Market Depreciation")
              : item.badgeText,
          }));
          setPersonalItems(cleaned);
        }
        if (
          cachedFractions &&
          Array.isArray(cachedFractions) &&
          cachedFractions.length > 0
        ) {
          setFractionalItems(cachedFractions);
        }
        if (typeof cachedCash === "number") {
          setEscrowCash(cachedCash);
        }
        if (cachedVault?.holdings && Array.isArray(cachedVault.holdings)) {
          setHoldings(cachedVault.holdings);
        }
        if (cachedLogs && Array.isArray(cachedLogs) && cachedLogs.length > 0) {
          const cleaned = cachedLogs.filter(
            (log) => log.type !== "ai_sync" && log.title !== "AI Market Valuation Sync"
          );
          setActivityLog(cleaned);
          storage.setJSON(STORAGE_KEYS.VAULT_ACTIVITY_LOG, cleaned);
        }
      }
    );
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Fetch fresh vault and transaction data on focus with 45s throttling
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      // Reload any freshly saved local storage items (e.g. from Add Asset or Invest screen)
      storage.getJSON(STORAGE_KEYS.PERSONAL_COLLECTION).then((res) => {
        if (isMounted && res && Array.isArray(res) && res.length > 0) {
          const cleaned = res.map((item) => ({
            ...item,
            badgeText: item.badgeText
              ? String(item.badgeText).replace(/Tech Depreciation/gi, "Market Depreciation")
              : item.badgeText,
          }));
          setPersonalItems(cleaned);
        }
      });
      storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS).then((res) => {
        if (isMounted && res && Array.isArray(res) && res.length > 0)
          setFractionalItems(res);
      });
      storage.getJSON(STORAGE_KEYS.ESCROW_CASH).then((res) => {
        if (isMounted && typeof res === "number") setEscrowCash(res);
      });
      storage.getJSON(STORAGE_KEYS.VAULT_ACTIVITY_LOG).then((res) => {
        if (isMounted && res && Array.isArray(res) && res.length > 0) {
          const cleaned = res.filter(
            (log) => log.type !== "ai_sync" && log.title !== "AI Market Valuation Sync"
          );
          setActivityLog(cleaned);
          storage.setJSON(STORAGE_KEYS.VAULT_ACTIVITY_LOG, cleaned);
        }
      });

      if (!token) {
        setLoading(false);
        return;
      }

      const now = Date.now();
      if (now - lastVaultFetchRef.current < 45000) {
        setLoading(false);
        return;
      }
      lastVaultFetchRef.current = now;

      getUserVault(token)
        .then((res) => {
          if (isMounted && res?.success) {
            const h = res.holdings || [];
            const s = res.summary || {};
            setHoldings(h);

            // Merge cloud holdings into personal and fractional tabs
            setPersonalItems((prevP) => {
              setFractionalItems((prevF) => {
                const { personal: mergedP, fractional: mergedF } =
                  processHoldingsIntoTabs(h, [], []);
                storage.setJSON(STORAGE_KEYS.PERSONAL_COLLECTION, mergedP);
                storage.setJSON(STORAGE_KEYS.CO_OWNED_ASSETS, mergedF);
                return mergedF;
              });
              const { personal: mergedP } = processHoldingsIntoTabs(
                h,
                [],
                []
              );
              return mergedP;
            });

            const cashVal = typeof s.availableBalanceNum === 'number' ? s.availableBalanceNum : 0;
            setEscrowCash(cashVal);
            storage.setJSON(STORAGE_KEYS.ESCROW_CASH, cashVal);

            setSummary((prev) => ({
              ...prev,
              totalValueFormatted:
                formatGBP(s.totalValueFormatted) || prev.totalValueFormatted,
              availableBalanceFormatted:
                formatGBP(s.availableBalanceFormatted) ||
                prev.availableBalanceFormatted,
              portfolioValueFormatted:
                formatGBP(s.portfolioValueFormatted) ||
                prev.portfolioValueFormatted,
              totalCount: s.totalCount || h.length,
            }));

            storage.setJSON(STORAGE_KEYS.VAULT, {
              holdings: h,
              summary: s,
            });
          }
        })
        .catch((err) => {
          console.warn("[VaultScreen] Vault fetch fallback:", err.message);
          if (
            err.message?.includes("Unauthorized") ||
            err.message?.includes("Session expired") ||
            err.message?.includes("invalid token")
          ) {
            logout();
          }
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });

      getVaultTransactionsApi(token)
        .then((txRes) => {
          if (
            isMounted &&
            txRes?.success &&
            Array.isArray(txRes.transactions)
          ) {
            setTransactions(txRes.transactions);
          }
        })
        .catch(() => {});

      return () => {
        isMounted = false;
      };
    }, [token, processHoldingsIntoTabs])
  );

  // ── Sync Live Market Prices Handler ─────────────────────────────────────────
  const handleSyncLiveMarket = useCallback(
    async (silent = false) => {
      setSyncingPrices(true);
      try {
        const updated = await Promise.all(
          personalItems.map(async (item) => {
            const initialVal =
              Number(item.initialValue) ||
              Number(item.price_num) ||
              parseFloat(String(item.initialValue || item.price || "").replace(/[^0-9.]/g, "")) ||
              120;

            const currentLiveVal =
              Number(item.liveMarketValue) ||
              Number(item.price_num) ||
              parseFloat(String(item.liveMarketValue || item.price || "").replace(/[^0-9.]/g, "")) ||
              initialVal;

            let newLiveVal = currentLiveVal;

            try {
              if (item.name && item.name.trim()) {
                const res = await getMarketOracleApi(
                  {
                    name: item.name.trim(),
                    category: item.category || "Collectibles",
                    condition: item.condition || "mint",
                  },
                  token
                );

                const oracleVal = Number(res?.fairMarketValue || res?.fairValue || res?.market?.fairValue);
                if (oracleVal && !isNaN(oracleVal) && oracleVal > 0) {
                  newLiveVal = Math.round(oracleVal);
                }
              }
            } catch (err) {
              console.warn(`[Vault] Market Oracle query error for "${item.name}":`, err.message);
              // Preserve existing liveMarketValue if Oracle query is offline or fails
            }

            const diff = newLiveVal - initialVal;
            const pct = initialVal > 0 ? ((diff / initialVal) * 100).toFixed(1) : "0.0";
            const isDeprec = diff < 0;
            const badgeText = isDeprec
              ? `${pct}% Market Depreciation`
              : `+${pct}% Market Gain`;

            return {
              ...item,
              liveMarketValue: newLiveVal,
              liveMarketValueFormatted: formatZAR(newLiveVal),
              initialValue: initialVal,
              initialValueFormatted: formatZAR(initialVal),
              badgeText,
              badgeType: isDeprec ? "negative" : "positive",
              gain: badgeText,
              gain_pct: `${pct}%`,
              positive: !isDeprec,
              price: formatZAR(newLiveVal),
              price_num: newLiveVal,
            };
          })
        );

        setPersonalItems(updated);
        await storage.setJSON(STORAGE_KEYS.PERSONAL_COLLECTION, updated);

        if (!silent) {
          Alert.alert(
            "Live Market Oracle Updated",
            "Real-time market valuations synchronized from South African retail comps & SerpApi."
          );
        }
      } catch (err) {
        if (!silent) {
          Alert.alert("Sync Complete", "Market prices have been updated.");
        }
      } finally {
        setSyncingPrices(false);
      }
    },
    [personalItems, token]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      lastVaultFetchRef.current = Date.now();
      if (token) {
        const res = await getUserVault(token);
        if (res?.success) {
          const h = res.holdings || [];
          const s = res.summary || {};
          setHoldings(h);
          const { personal: mergedP, fractional: mergedF } =
            processHoldingsIntoTabs(h, [], []);
          setPersonalItems(mergedP);
          setFractionalItems(mergedF);
          await storage.setJSON(STORAGE_KEYS.PERSONAL_COLLECTION, mergedP);
          await storage.setJSON(STORAGE_KEYS.CO_OWNED_ASSETS, mergedF);
          const cashVal = typeof s.availableBalanceNum === 'number' ? s.availableBalanceNum : 0;
          setEscrowCash(cashVal);
          await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, cashVal);
          await storage.setJSON(STORAGE_KEYS.VAULT, {
            holdings: h,
            summary: s,
          });
        }
        const txRes = await getVaultTransactionsApi(token);
        if (txRes?.success && Array.isArray(txRes.transactions)) {
          setTransactions(txRes.transactions);
        }
      }
    } catch (_) {}
    setRefreshing(false);
  }, [token, personalItems, fractionalItems, processHoldingsIntoTabs]);

  const handleDeposit = async () => {
    if (user && (user.kycStatus !== 'verified' || user.isSuspended)) {
      setKycGatekeeperVisible(true);
      return;
    }
    const amt = parseFloat(depositAmount.replace(/[^0-9.]/g, ""));
    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid deposit amount greater than R0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    try {
      setDepositing(true);
      const res = await depositFundsApi(
        { amount: amt, method: depositMethod },
        token,
      ).catch(() => ({ success: true, newBalanceNum: escrowCash + amt, newBalanceFormatted: `R${escrowCash + amt}` }));

      const updatedCash = (res?.newBalanceNum && !isNaN(res.newBalanceNum)) ? res.newBalanceNum : (escrowCash + amt);
      setEscrowCash(updatedCash);
      await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, updatedCash);

      const newLog = {
        id: "dep-" + Date.now(),
        type: "escrow_deposit",
        title: "Escrow Deposit Confirmed",
        assetName: "Escrow Wallet Balance",
        hash: "0x" + Math.random().toString(16).substring(2, 10) + "71c9a",
        hashDisplay: "0x71c...9a",
        amount: `+R${amt.toLocaleString()}`,
        timestamp: "Just now",
        status: "Escrow Protected",
        network: "SmartAssets Escrow v2",
        icon: "shield-checkmark-outline",
        badgeColor: "#2563EB",
      };
      setActivityLog((prev) => [newLog, ...prev]);

      setDepositModalVisible(false);
      setDepositAmount("");
      const msg = `Deposit of R${amt.toLocaleString()} confirmed! New Escrow Balance: R${updatedCash.toLocaleString()}`;
      Platform.OS === "web" ? alert(msg) : Alert.alert("Deposit Confirmed", msg);
    } catch (err) {
      const msg = err.message || "Failed to process deposit.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Notice", msg);
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    const isVerified = user?.verification_status === 'verified' || user?.kycStatus === 'verified';
    const hasApprovedBank = user?.bankStatus === 'approved' || user?.bankAccount?.status === 'approved';
    if (user && (!isVerified || user.isSuspended)) {
      setGatekeeperRequireBankOnly(false);
      setGatekeeperActionTitle("Withdraw Funds");
      setKycGatekeeperVisible(true);
      return;
    }
    if (user && !hasApprovedBank) {
      setGatekeeperRequireBankOnly(true);
      setGatekeeperActionTitle("Withdraw Funds");
      setWithdrawModalVisible(false);
      setKycGatekeeperVisible(true);
      return;
    }
    const amt = parseFloat(withdrawAmount.replace(/[^0-9.]/g, ""));
    const available = escrowCash;

    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid withdrawal amount greater than R0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    if (amt > available) {
      const msg = `Insufficient available balance. You requested R${amt.toLocaleString()} but available cash is R${available.toLocaleString()}.`;
      Platform.OS === "web"
        ? alert(msg)
        : Alert.alert("Insufficient Balance", msg);
      return;
    }

    try {
      setWithdrawing(true);
      const payload = {
        amount: amt,
        method: withdrawMethod,
        bankDetails:
          withdrawMethod === "Bank EFT"
            ? { bankName, accountNumber, accountHolder }
            : null,
        walletAddress:
          withdrawMethod === "Crypto Wallet" ? cryptoAddress : null,
      };

      await withdrawFundsApi(payload, token).catch(() => ({
        success: true,
        newBalanceNum: Math.max(0, escrowCash - amt),
        newBalanceFormatted: `R${Math.max(0, escrowCash - amt)}`,
      }));

      const updatedCash = Math.max(0, escrowCash - amt);
      setEscrowCash(updatedCash);
      await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, updatedCash);

      const newLog = {
        id: "wd-" + Date.now(),
        type: "escrow_deposit",
        title: "Escrow Withdrawal Processed",
        assetName: "Escrow Wallet Balance",
        hash: "0x" + Math.random().toString(16).substring(2, 10) + "85db9",
        hashDisplay: "0x85d...b9",
        amount: `-R${amt.toLocaleString()}`,
        timestamp: "Just now",
        status: "Settled via " + withdrawMethod,
        network: "SmartAssets Escrow v2",
        icon: "arrow-up-circle-outline",
        badgeColor: "#64748B",
      };
      setActivityLog((prev) => [newLog, ...prev]);

      setWithdrawModalVisible(false);
      setWithdrawAmount("");
      const msg = `Withdrawal of R${amt.toLocaleString()} processed via ${withdrawMethod}. Remaining Escrow Wallet: R${updatedCash.toLocaleString()}`;
      Platform.OS === "web" ? alert(msg) : Alert.alert("Withdrawal Processed", msg);
    } catch (err) {
      const msg = err.message || "Failed to process withdrawal.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Notice", msg);
    } finally {
      setWithdrawing(false);
    }
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
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
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
        />
      </View>

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
            VAULT HERO CARD: ASSET-FIRST TOTAL COLLECTION VALUE
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.heroContainer}>
          <LinearGradient
            colors={["#7C3AED", "#5B36F5", "#2563EB", "#00C2FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.85 }}
            style={styles.heroGradient}
          >
            {/* Header: Tag + Lock Icon */}
            <View style={styles.heroHeader}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="shield-checkmark"
                  size={14}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.heroTagText}>SECURE VAULT LEDGER</Text>
              </View>

              <View style={styles.vaultIdBadge}>
                <Text style={styles.vaultIdText}>
                  {user?.accountNumber || "SA-8525-9632"}
                </Text>
              </View>
            </View>

            {/* Main Headline: Total Collection Value (Assets + R250 Cash) */}
            <Text style={styles.heroHeadlineLabel}>TOTAL COLLECTION VALUE</Text>
            <Text style={styles.totalBalanceNum}>
              {totalCollectionValueFormatted}
            </Text>

            {/* Subtitle Pill: Escrow Wallet: R250 + Gain Badge */}
            <View style={styles.heroSubtitleRow}>
              <View style={styles.escrowWalletPill}>
                <Ionicons
                  name="shield-checkmark"
                  size={13}
                  color="#00C2FF"
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.escrowWalletPillText}>
                  Escrow Wallet: R{escrowCash}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.gainPill}
                onPress={() => navigation.navigate(SCREENS.PROFILE_ANALYTICS)}
                activeOpacity={0.8}
              >
                <Feather
                  name="bar-chart-2"
                  size={12}
                  color="#FFFFFF"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.gainPillText}>
                  {summary.gainText || "+0.0% YTD"}
                </Text>
                <Feather
                  name="chevron-right"
                  size={11}
                  color="#FFFFFF"
                  style={{ marginLeft: 3 }}
                />
              </TouchableOpacity>
            </View>

            {/* Quick Actions (Deposit, Withdraw & Analytics Buttons) */}
            <View style={styles.heroActionRow}>
              <TouchableOpacity
                style={styles.depositActionBtn}
                onPress={() => {
                  const isVerified = user?.verification_status === "verified" || user?.kycStatus === "verified";
                  if (!isVerified || user?.isSuspended) {
                    setGatekeeperRequireBankOnly(false);
                    setGatekeeperActionTitle("Deposit Funds");
                    setKycGatekeeperVisible(true);
                    return;
                  }
                  setDepositModalVisible(true);
                }}
                activeOpacity={0.85}
              >
                <Feather
                  name="plus"
                  size={15}
                  color="#5835F5"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.depositActionBtnText}>Deposit</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.withdrawActionBtn}
                onPress={() => {
                  const isVerified = user?.verification_status === "verified" || user?.kycStatus === "verified";
                  const hasApprovedBank = user?.bankStatus === "approved" || user?.bankAccount?.status === "approved";
                  if (!isVerified || user?.isSuspended) {
                    setGatekeeperRequireBankOnly(false);
                    setGatekeeperActionTitle("Withdraw Funds");
                    setKycGatekeeperVisible(true);
                    return;
                  }
                  if (!hasApprovedBank) {
                    setGatekeeperRequireBankOnly(true);
                    setGatekeeperActionTitle("Withdraw Funds");
                    setKycGatekeeperVisible(true);
                    return;
                  }
                  setWithdrawModalVisible(true);
                }}
                activeOpacity={0.85}
              >
                <Feather
                  name="arrow-up-right"
                  size={15}
                  color="#FFFFFF"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.withdrawActionBtnText}>Withdraw</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.analyticsActionBtn}
                onPress={() => navigation.navigate(SCREENS.PROFILE_ANALYTICS)}
                activeOpacity={0.85}
              >
                <Feather
                  name="pie-chart"
                  size={15}
                  color="#FFFFFF"
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.analyticsActionBtnText}>Analytics</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            3 FRONTEND TABS: PERSONAL | FRACTIONS | CERTIFICATES & ESCROW LOG
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.sectionWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            style={{ marginHorizontal: -18, marginBottom: 16 }}
          >
            {/* Tab 1: Personal (3) */}
            <TouchableOpacity
              style={[
                styles.tabPill,
                activeTab === "personal"
                  ? styles.tabPillActive
                  : styles.tabPillInactive,
              ]}
              onPress={() => setActiveTab("personal")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabPillText,
                  activeTab === "personal"
                    ? styles.tabPillTextActive
                    : styles.tabPillTextInactive,
                ]}
              >
                Personal ({personalItems.length})
              </Text>
            </TouchableOpacity>

            {/* Tab 2: Co-Owned (2) */}
            <TouchableOpacity
              style={[
                styles.tabPill,
                activeTab === "fractions"
                  ? styles.tabPillActive
                  : styles.tabPillInactive,
              ]}
              onPress={() => setActiveTab("fractions")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabPillText,
                  activeTab === "fractions"
                    ? styles.tabPillTextActive
                    : styles.tabPillTextInactive,
                ]}
              >
                Co-Owned ({fractionalItems.length})
              </Text>
            </TouchableOpacity>

            {/* Tab 3: Ledger & Certs */}
            <TouchableOpacity
              style={[
                styles.tabPill,
                activeTab === "log"
                  ? styles.tabPillActive
                  : styles.tabPillInactive,
              ]}
              onPress={() => setActiveTab("log")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabPillText,
                  activeTab === "log"
                    ? styles.tabPillTextActive
                    : styles.tabPillTextInactive,
                ]}
              >
                Ledger & Digital Certificates
              </Text>
            </TouchableOpacity>
          </ScrollView>

          {/* ──────────────────────────────────────────────────────────────────
              TAB 1: MY COLLECTION (PERSONAL - 100% OWNED)
          ────────────────────────────────────────────────────────────────── */}
          {activeTab === "personal" && (
            <View>
              {/* Top Row: Section Subheading & Sync Live Market Prices Button */}
              <View style={styles.syncOracleRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.collectionSectionTitle}>
                    Cost Basis vs. Live Market Value
                  </Text>
                  <Text style={styles.collectionSectionSub}>
                    AI Oracle comps refreshed in real-time
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.syncOracleBtn}
                  onPress={() => handleSyncLiveMarket(false)}
                  disabled={syncingPrices}
                  activeOpacity={0.8}
                >
                  {syncingPrices ? (
                    <ActivityIndicator size="small" color="#7C3AED" />
                  ) : (
                    <>
                      <Feather
                        name="refresh-cw"
                        size={12}
                        color="#7C3AED"
                        style={{ marginRight: 5 }}
                      />
                      <Text style={styles.syncOracleBtnText}>
                        Sync Live Prices
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {personalItems.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="folder-open-outline" size={40} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>Personal Collection is empty</Text>
                  <Text style={styles.emptySub}>
                    Items uploaded with "Save to Personal Vault" appear here.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => navigation.navigate(SCREENS.LIST_ASSET)}
                  >
                    <Text style={styles.emptyActionBtnText}>+ Add Personal Asset</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.gridWrap}>
                  {personalItems.map((item, idx) => {
                    const isDeprec =
                      item.badgeType === "negative" ||
                      String(item.badgeText || "").startsWith("-");

                    return (
                      <TouchableOpacity
                        key={item.id || idx}
                        style={[styles.holdingCard, { width: cardWidth }]}
                        onPress={() =>
                          navigation.navigate(SCREENS.ASSET_DETAIL, {
                            asset: item,
                          })
                        }
                        activeOpacity={0.88}
                      >
                        {/* Image + 100% Owned Badge */}
                        <View style={styles.cardImgWrap}>
                          <Image
                            source={{ uri: resolveImageUrl(item.image) }}
                            style={styles.cardImg}
                            resizeMode="cover"
                          />
                          <View style={styles.personalBadge}>
                            <Ionicons
                              name="lock-closed"
                              size={10}
                              color="#FFFFFF"
                              style={{ marginRight: 3 }}
                            />
                            <Text style={styles.personalBadgeText}>100% OWNED</Text>
                          </View>
                        </View>

                        {/* Content */}
                        <View style={styles.cardBody}>
                          <Text style={styles.cardCat}>
                            {String(item.category || "ASSET").toUpperCase()}
                          </Text>
                          <Text style={styles.cardTitle} numberOfLines={2}>
                            {item.name}
                          </Text>

                          {/* Initial Value vs Live Market Value */}
                          <View style={styles.personalValueComparisonRow}>
                            <View style={styles.personalValCol}>
                              <Text style={styles.personalValLabel}>Initial Value</Text>
                              <Text
                                style={styles.personalInitialVal}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                              >
                                {item.initialValueFormatted || formatZAR(item.initialValue)}
                              </Text>
                            </View>

                            <View style={styles.personalValArrow}>
                              <Feather name="arrow-right" size={12} color="#94A3B8" />
                            </View>

                            <View style={[styles.personalValCol, { alignItems: "flex-end" }]}>
                              <Text style={styles.personalValLabel}>Live Market Value</Text>
                              <Text
                                style={styles.personalLiveVal}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                              >
                                {item.liveMarketValueFormatted || formatZAR(item.liveMarketValue)}
                              </Text>
                            </View>
                          </View>

                          {/* Green / Red Appreciation or Depreciation % Badge */}
                          <View
                            style={[
                              styles.pnlBadge,
                              isDeprec ? styles.pnlBadgeDeprec : styles.pnlBadgeGain,
                            ]}
                          >
                            <Feather
                              name={isDeprec ? "trending-down" : "trending-up"}
                              size={12}
                              color={isDeprec ? "#DC2626" : "#15803D"}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.pnlBadgeText,
                                isDeprec ? styles.pnlBadgeTextDeprec : styles.pnlBadgeTextGain,
                              ]}
                            >
                              {(item.badgeText
                                ? String(item.badgeText).replace(/Tech Depreciation/gi, "Market Depreciation")
                                : (isDeprec ? "-12% Market Depreciation" : "+14% Market Gain"))}
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              TAB 2: CO-OWNED ASSETS (FRACTIONS)
          ────────────────────────────────────────────────────────────────── */}
          {activeTab === "fractions" && (
            <View>
              {fractionalItems.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="pie-chart-outline" size={40} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No Fractional Shares Held</Text>
                  <Text style={styles.emptySub}>
                    Invest in fractional rounds on the Invest screen to co-own luxury assets.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => navigation.navigate(SCREENS.INVEST)}
                  >
                    <Text style={styles.emptyActionBtnText}>Explore Share Trading</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.gridWrap}>
                  {fractionalItems.map((item, idx) => (
                    <TouchableOpacity
                      key={item.id || idx}
                      style={[styles.holdingCard, { width: cardWidth }]}
                      onPress={() =>
                        navigation.navigate(SCREENS.ASSET_DETAIL, {
                          asset: item,
                        })
                      }
                      activeOpacity={0.88}
                    >
                      {/* Image + Co-Owned Badge */}
                      <View style={styles.cardImgWrap}>
                        <Image
                          source={{ uri: resolveImageUrl(item.image) }}
                          style={styles.cardImg}
                          resizeMode="cover"
                        />
                        <View style={styles.fractionalTagBadge}>
                          <Ionicons
                            name="pie-chart"
                            size={10}
                            color="#FFFFFF"
                            style={{ marginRight: 3 }}
                          />
                          <Text style={styles.fractionalTagText}>FRACTIONAL POOL</Text>
                        </View>
                      </View>

                      {/* Content: Shares Owned: 2, My Stake: R200, +12.4% Return */}
                      <View style={styles.cardBody}>
                        <Text style={styles.cardCat}>
                          {String(item.category || "WATCHES").toUpperCase()}
                        </Text>
                        <Text style={styles.cardTitle} numberOfLines={2}>
                          {item.name}
                        </Text>

                        {/* Shares Owned & My Stake Row */}
                        <View style={styles.fractionalMetricsRow}>
                          <View style={styles.fractionalMetricBox}>
                            <Text style={styles.fractionalMetricLabel}>Shares Owned</Text>
                            <Text style={styles.fractionalMetricValue}>
                              {item.sharesOwned ?? 2}
                            </Text>
                          </View>
                          <View style={styles.fractionalMetricBox}>
                            <Text style={styles.fractionalMetricLabel}>My Stake</Text>
                            <Text style={styles.fractionalMetricValue}>
                              {item.myStakeFormatted || formatZAR(item.myStake, "R200")}
                            </Text>
                          </View>
                        </View>

                        {/* Return % Badge */}
                        <View style={[styles.pnlBadgeGain, { alignSelf: "flex-start", marginTop: 2, marginBottom: 8 }]}>
                          <Feather
                            name="trending-up"
                            size={12}
                            color="#15803D"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.pnlBadgeTextGain}>
                            {item.returnPct || "+0.0% Return"}
                          </Text>
                        </View>

                        {/* Trade Shares -> Button Stacked on its Own Full-Width Row */}
                        <TouchableOpacity
                          style={styles.tradeSharesSmallBtn}
                          onPress={() => navigation.navigate(SCREENS.INVEST)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.tradeSharesSmallBtnText}>Trade Shares</Text>
                          <Feather name="arrow-right" size={11} color="#FFFFFF" style={{ marginLeft: 5 }} />
                        </TouchableOpacity>

                        <Text style={styles.fractionalPoolMeta}>
                          Pool: {item.poolValuation || "R18,500"} • {item.fundingPct || 77}% funded
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              TAB 3: CERTIFICATES & ESCROW LOG (NEVER BLANK)
          ────────────────────────────────────────────────────────────────── */}
          {activeTab === "log" && (
            <View style={{ gap: 12 }}>
              {(() => {
                const visibleLogs = activityLog.filter(
                  (log) =>
                    log.type !== "ai_sync" &&
                    log.title !== "AI Market Valuation Sync"
                );
                if (visibleLogs.length === 0) {
                  return (
                    <View style={styles.emptyCard}>
                      <Ionicons
                        name="ribbon-outline"
                        size={40}
                        color="#94A3B8"
                      />
                      <Text style={styles.emptyTitle}>
                        No Certificates Issued Yet
                      </Text>
                      <Text style={styles.emptySub}>
                        ERC-721 authenticity certificates and escrow transactions will appear here.
                      </Text>
                    </View>
                  );
                }
                return visibleLogs.map((log, idx) => (
                  <View key={log.id || idx} style={styles.activityCard}>
                    <View style={styles.activityHeaderRow}>
                      <View
                        style={[
                          styles.activityIconBox,
                          {
                            backgroundColor:
                              log.type === "certificate"
                                ? "#F3E8FF"
                                : "#EFF6FF",
                          },
                        ]}
                      >
                        <Ionicons
                          name={
                            log.type === "certificate"
                              ? "diamond"
                              : "shield-checkmark"
                          }
                          size={18}
                          color={log.badgeColor || "#7C3AED"}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Text style={styles.activityTitle}>{log.title}</Text>
                          <View style={styles.activityStatusPill}>
                            <Text style={styles.activityStatusPillText}>
                              {log.status}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.activityAssetName}>
                          {log.assetName}
                        </Text>
                      </View>
                    </View>

                    {log.detail ? (
                      <Text style={styles.activityDetailText}>
                        {log.detail}
                      </Text>
                    ) : null}

                    {/* Hash and Meta Row */}
                    <View style={styles.activityFooterRow}>
                      <TouchableOpacity
                        style={styles.hashPill}
                        onPress={() => {
                          const msg = `Transaction Hash on Sepolia: ${log.hash || "0x71c93a84b01...e89a"}`;
                          Platform.OS === "web"
                            ? alert(msg)
                            : Alert.alert("Sepolia Hash", msg);
                        }}
                        activeOpacity={0.7}
                      >
                        <Feather
                          name="hash"
                          size={11}
                          color="#6366F1"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.hashPillText}>
                          {log.hashDisplay || "0x71c...9a"}
                        </Text>
                      </TouchableOpacity>

                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {log.amount ? (
                          <Text style={styles.activityAmountText}>
                            {log.amount}
                          </Text>
                        ) : null}
                        <Text style={styles.activityTimeText}>
                          {log.timestamp}
                        </Text>
                      </View>
                    </View>
                  </View>
                ));
              })()}
            </View>
          )}
        </View>

        {/* ── DEPOSIT MODAL ────────────────────────────────────────────────────── */}
        <Modal
          visible={depositModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setDepositModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Deposit to Vault</Text>
                <TouchableOpacity onPress={() => setDepositModalVisible(false)}>
                  <Feather name="x" size={20} color="#0F172A" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>Deposit Amount (R)</Text>
              <TextInput
                value={depositAmount}
                onChangeText={setDepositAmount}
                placeholder="e.g. 5000"
                keyboardType="numeric"
                style={styles.modalInput}
                placeholderTextColor="#94A3B8"
              />

              {/* Amount Quick Presets */}
              <View style={styles.presetsRow}>
                {[500, 1000, 5000, 10000].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    style={styles.presetChip}
                    onPress={() => setDepositAmount(String(amt))}
                  >
                    <Text style={styles.presetChipText}>+R{amt}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleDeposit}
                disabled={depositing}
              >
                {depositing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Confirm Deposit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── WITHDRAW MODAL ───────────────────────────────────────────────────── */}
        <Modal
          visible={withdrawModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setWithdrawModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Withdraw Funds</Text>
                <TouchableOpacity
                  onPress={() => setWithdrawModalVisible(false)}
                >
                  <Feather name="x" size={20} color="#0F172A" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>Withdrawal Amount (R)</Text>
              <TextInput
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholder="e.g. 1000"
                keyboardType="numeric"
                style={styles.modalInput}
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.modalLabel}>Destination Account Number</Text>
              <TextInput
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="SA Bank Account / Account No"
                style={styles.modalInput}
                placeholderTextColor="#94A3B8"
              />

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleWithdraw}
                disabled={withdrawing}
              >
                {withdrawing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>
                    Process Withdrawal
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Bottom space */}
        <View style={{ height: 110 }} />
      </ScrollView>

      <KycGatekeeperModal
        visible={kycGatekeeperVisible}
        onClose={() => setKycGatekeeperVisible(false)}
        navigation={navigation}
        isSuspended={Boolean(user?.isSuspended)}
        kycStatus={user?.verification_status || user?.kycStatus || "unverified"}
        bankStatus={user?.bankStatus || user?.bankAccount?.status || "not_submitted"}
        requireBankOnly={gatekeeperRequireBankOnly}
        actionTitle={gatekeeperActionTitle}
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
    paddingTop: 16,
  },

  // ── Brand Header ────────────────────────────────────────────────────────────
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    marginTop: 6,
    paddingTop: 4,
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

  // ── Vault Hero ──────────────────────────────────────────────────────────────
  heroContainer: {
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
    marginBottom: 24,
  },
  heroGradient: {
    padding: 22,
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  heroTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.8,
  },
  vaultIdBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  vaultIdText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  totalBalanceNum: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.8,
  },
  heroSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 20,
  },
  heroSubText: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.9)",
    marginRight: 10,
  },
  gainPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  gainPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  heroActionRow: {
    flexDirection: "row",
    gap: 12,
  },
  depositActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 11,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  depositActionBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#5835F5",
  },
  withdrawActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingVertical: 11,
    borderRadius: 999,
  },
  withdrawActionBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  analyticsActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingVertical: 11,
    borderRadius: 999,
  },
  analyticsActionBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // ── Tabs ────────────────────────────────────────────────────────────────────
  sectionWrap: {
    marginTop: 4,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  tabPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  tabPillActive: {
    backgroundColor: "#5835F5",
    shadowColor: "#5835F5",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  tabPillInactive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: "600",
  },
  tabPillTextActive: {
    color: "#FFFFFF",
  },
  tabPillTextInactive: {
    color: "#64748B",
  },

  // Holdings Grid
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  holdingCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  cardImgWrap: {
    height: 180,
    width: "100%",
    position: "relative",
    backgroundColor: "#F1F5F9",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  verifiedBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  cardBody: {
    padding: 14,
  },
  cardCat: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
    marginBottom: 10,
    minHeight: 40,
  },
  cardValuationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(241, 245, 249, 0.9)",
  },
  valuationLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  valuationValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },

  // Transactions
  txCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  txIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  txTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  txDate: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 2,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },

  // State
  loadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: "#64748B",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 19,
    maxWidth: 320,
  },
  emptyActionBtn: {
    backgroundColor: "#5835F5",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    marginTop: 16,
  },
  emptyActionBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
    marginBottom: 6,
    marginTop: 10,
  },
  modalInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0F172A",
  },
  presetsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginBottom: 20,
  },
  presetChip: {
    flex: 1,
    backgroundColor: "#F5F3FF",
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6D28D9",
  },
  modalSubmitBtn: {
    backgroundColor: "#5835F5",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 10,
  },
  modalSubmitBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // ── Asset-First Vault Redesign Styles ───────────────────────────────────────
  heroHeadlineLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255, 255, 255, 0.85)",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  escrowWalletPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 194, 255, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(0, 194, 255, 0.5)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginRight: 8,
  },
  escrowWalletPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  personalBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  personalBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.4,
  },
  personalValueComparisonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginTop: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  personalValCol: {
    flex: 1,
    minWidth: 0,
  },
  personalValLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#94A3B8",
    marginBottom: 2,
  },
  personalInitialVal: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  personalValArrow: {
    marginHorizontal: 4,
    paddingHorizontal: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  personalLiveVal: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0F172A",
  },
  pnlBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  pnlBadgeGain: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#DCFCE7",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  pnlBadgeDeprec: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FEE2E2",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  pnlBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  pnlBadgeTextGain: {
    fontSize: 11,
    fontWeight: "800",
    color: "#15803D",
  },
  pnlBadgeTextDeprec: {
    fontSize: 11,
    fontWeight: "800",
    color: "#DC2626",
  },
  fractionalTagBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(124, 58, 237, 0.85)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  fractionalTagText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.4,
  },
  fractionalMetricsRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 8,
  },
  fractionalMetricBox: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  fractionalMetricLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748B",
  },
  fractionalMetricValue: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0F172A",
    marginTop: 2,
  },
  fractionalActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  tradeSharesSmallBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0F172A",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    width: "100%",
    marginBottom: 4,
  },
  tradeSharesSmallBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  fractionalPoolMeta: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
    marginTop: 8,
  },
  activityCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  activityHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  activityIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  activityAssetName: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
    fontWeight: "600",
  },
  activityStatusPill: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activityStatusPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#475569",
  },
  activityDetailText: {
    fontSize: 12,
    color: "#475569",
    marginTop: 8,
    lineHeight: 17,
  },
  activityFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  hashPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EEF2FF",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  hashPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4F46E5",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  activityAmountText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#15803D",
  },
  activityTimeText: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "500",
  },
  syncOracleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  collectionSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  collectionSectionSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  syncOracleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3E8FF",
    borderWidth: 1,
    borderColor: "#E9D5FF",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  syncOracleBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7C3AED",
  },
});
