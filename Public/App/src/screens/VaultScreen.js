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
  requestWithdrawalChallengeApi,
  verifyWithdrawalChallengeApi,
  cancelWithdrawalChallengeApi,
  getBankAccountApi,
  cancelVaultWithdrawalApi,
  getVaultTransactionsApi,
  getMarketOracleApi,
  resolveImageUrl,
  getShareRedemptionQuoteApi,
  requestShareRedemptionApi,
  cancelShareRedemptionApi,
  getUserRedemptionsApi,
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


export default function VaultScreen({ navigation, route }) {
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
  const [escrowLockedCash, setEscrowLockedCash] = useState(0);
  const [sellerPendingCash, setSellerPendingCash] = useState(0);

  const [holdings, setHoldings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({
    availableBalanceFormatted: "R0",
    availableBalanceNum: 0,
    escrowBalanceFormatted: "R0",
    escrowBalanceNum: 0,
    sellerPendingEscrowFormatted: "R0",
    sellerPendingEscrowNum: 0,
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
  const totalAssetsValueNum = personalTotal + fractionalTotal;
  const totalAssetsValueFormatted = formatGBP(totalAssetsValueNum);
  const totalCollectionValueNum = totalAssetsValueNum + escrowCash + escrowLockedCash;
  const totalCollectionValueFormatted = formatGBP(totalCollectionValueNum);

  // Modals
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);

  // Deposit Form
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("Manual Bank EFT");
  const [depositReference, setDepositReference] = useState("");
  const [depositing, setDepositing] = useState(false);

  // Withdraw Form & 3-Step Email OTP Verification State
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("Approved Bank EFT");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState("amount"); // 'amount' | 'confirm_bank' | 'otp_entry'
  const [withdrawBankDetails, setWithdrawBankDetails] = useState(null);
  const [withdrawChallengeId, setWithdrawChallengeId] = useState(null);
  const [withdrawAttemptId, setWithdrawAttemptId] = useState(null);
  const [withdrawMaskedEmail, setWithdrawMaskedEmail] = useState("");
  const [withdrawOtpCode, setWithdrawOtpCode] = useState("");
  const [withdrawCountdownSec, setWithdrawCountdownSec] = useState(0);
  const [withdrawChallengeStatus, setWithdrawChallengeStatus] = useState("idle"); // 'idle' | 'pending' | 'expired' | 'cancelled' | 'error'
  const [withdrawStatusMessage, setWithdrawStatusMessage] = useState("");
  const [sendingWithdrawOtp, setSendingWithdrawOtp] = useState(false);

  // Informational 2-minute countdown timer for active withdrawal OTP popup (server clock is authoritative)
  useEffect(() => {
    if (
      !withdrawModalVisible ||
      withdrawStep !== "otp_entry" ||
      withdrawChallengeStatus !== "pending" ||
      withdrawCountdownSec <= 0
    ) {
      return undefined;
    }
    const timer = setInterval(() => {
      setWithdrawCountdownSec((prev) => {
        if (prev <= 1) {
          setWithdrawChallengeStatus("expired");
          setWithdrawStatusMessage(
            "Verification code expired after 2 minutes. This withdrawal attempt was cancelled and no funds were reserved."
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [withdrawModalVisible, withdrawStep, withdrawChallengeStatus, withdrawCountdownSec]);

  // Share Redemption State & Modal
  const [sellModalVisible, setSellModalVisible] = useState(false);
  const [selectedSellItem, setSelectedSellItem] = useState(null);
  const [sellSharesCount, setSellSharesCount] = useState("1");
  const [sellQuote, setSellQuote] = useState(null);
  const [loadingSellQuote, setLoadingSellQuote] = useState(false);
  const [submittingSell, setSubmittingSell] = useState(false);
  const [sellDestinationMethod, setSellDestinationMethod] = useState("escrow_wallet");
  const [sellBankName, setSellBankName] = useState("Standard Bank");
  const [sellAccountNumber, setSellAccountNumber] = useState("");
  const [sellAccountHolder, setSellAccountHolder] = useState(user?.fullName || "");
  const [redemptionRequests, setRedemptionRequests] = useState([]);
  const [cancellingRequestId, setCancellingRequestId] = useState(null);

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
          const sOwned = Number(h.sharesOwned ?? h.shares_count ?? h.shares ?? 1);
          const sReserved = Number(h.reserved_shares ?? h.reservedShares ?? 0);
          const sAvailable = Math.max(0, sOwned - sReserved);
          const mapped = {
            id: h.id || `fraction-${Math.random()}`,
            asset_id: h.asset_id || h.assetId || h.id,
            name: h.name,
            category: h.category || "Watches",
            image: resolveImageUrl(h.image),
            sharesOwned: sOwned,
            reservedShares: sReserved,
            availableShares: sAvailable,
            sharePrice: Number(h.price_num) || 100,
            sharePriceFormatted: formatGBP(h.price_num || 100) + "/sh",
            myStake: Number(h.myStake) || (sOwned * (Number(h.price_num) || 100)),
            myStakeFormatted: formatGBP(Number(h.myStake) || (sOwned * (Number(h.price_num) || 100))),
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
      if (now - lastVaultFetchRef.current < 3000) {
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

            // Authoritatively update personal and fractional tabs from server holdings
            const { personal: mergedP, fractional: mergedF } =
              processHoldingsIntoTabs(h, [], []);
            setPersonalItems(mergedP);
            setFractionalItems(mergedF);
            storage.setJSON(STORAGE_KEYS.PERSONAL_COLLECTION, mergedP);
            storage.setJSON(STORAGE_KEYS.CO_OWNED_ASSETS, mergedF);

            const cashVal = typeof s.availableBalanceNum === 'number' ? s.availableBalanceNum : 0;
            const escVal = typeof s.escrowBalanceNum === 'number' ? s.escrowBalanceNum : 0;
            const sellVal = typeof s.sellerPendingEscrowNum === 'number' ? s.sellerPendingEscrowNum : 0;
            setEscrowCash(cashVal);
            setEscrowLockedCash(escVal);
            setSellerPendingCash(sellVal);
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
              escrowBalanceFormatted:
                formatGBP(s.escrowBalanceFormatted) ||
                prev.escrowBalanceFormatted,
              sellerPendingEscrowFormatted:
                formatGBP(s.sellerPendingEscrowFormatted) ||
                prev.sellerPendingEscrowFormatted,
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

      getUserRedemptionsApi(token)
        .then((redRes) => {
          if (
            isMounted &&
            redRes?.success &&
            Array.isArray(redRes.redemptions)
          ) {
            setRedemptionRequests(redRes.redemptions);
          }
        })
        .catch(() => {});

      return () => {
        isMounted = false;
      };
    }, [token, processHoldingsIntoTabs])
  );

  // ── Handle incoming route navigation parameters (e.g. from InvestScreen) ────
  useEffect(() => {
    if (route?.params?.tab) {
      setActiveTab(route.params.tab);
    }
    if (route?.params?.openSellFor) {
      const target = route.params.openSellFor;
      setActiveTab("fractions");
      openSellModal(target);
    }
  }, [route?.params]);

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
          const escVal = typeof s.escrowBalanceNum === 'number' ? s.escrowBalanceNum : 0;
          const sellVal = typeof s.sellerPendingEscrowNum === 'number' ? s.sellerPendingEscrowNum : 0;
          setEscrowCash(cashVal);
          setEscrowLockedCash(escVal);
          setSellerPendingCash(sellVal);
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
        const redRes = await getUserRedemptionsApi(token).catch(() => null);
        if (redRes?.success && Array.isArray(redRes.redemptions)) {
          setRedemptionRequests(redRes.redemptions);
        }
      }
    } catch (_) {}
    setRefreshing(false);
  }, [token, personalItems, fractionalItems, processHoldingsIntoTabs]);

  const handleDeposit = async () => {
    const isVerified = user?.verification_status === "verified" || user?.kycStatus === "verified";
    const hasApprovedBank = user?.bankStatus === "approved" || user?.bankAccount?.status === "approved";
    if (user && (!isVerified || !hasApprovedBank || user.isSuspended)) {
      setGatekeeperRequireBankOnly(!hasApprovedBank && isVerified);
      setGatekeeperActionTitle("Deposit Funds");
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
      const idempotencyKey = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await depositFundsApi(
        {
          amount: amt,
          method: depositMethod || "Manual Bank EFT",
          reference: depositReference ? depositReference.trim() : undefined,
          idempotencyKey,
        },
        token,
      );

      if (!res?.success) {
        throw new Error(res?.error || "Deposit request failed.");
      }

      // Only update spendable balance from authoritative server response
      if (typeof res.newBalanceNum === "number" && !isNaN(res.newBalanceNum)) {
        setEscrowCash(res.newBalanceNum);
        await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, res.newBalanceNum);
      }

      // Refresh authoritative transaction ledger from backend
      if (token) {
        const txRes = await getVaultTransactionsApi(token).catch(() => null);
        if (txRes?.success && Array.isArray(txRes.transactions)) {
          setTransactions(txRes.transactions);
        }
      }

      setDepositModalVisible(false);
      setDepositAmount("");
      setDepositReference("");

      const msg =
        res.message ||
        (res.credited
          ? `Verified deposit of R${amt.toLocaleString("en-ZA")} credited to your Vault.`
          : `Deposit request of R${amt.toLocaleString("en-ZA")} submitted (Pending Verification). Your spendable balance will update once treasury confirms receipt of funds.`);
      const alertTitle = res.credited ? "Deposit Credited" : "Deposit Pending Review";
      Platform.OS === "web" ? alert(msg) : Alert.alert(alertTitle, msg);
    } catch (err) {
      const msg = err.message || "Failed to submit deposit request.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Deposit Failed", msg);
    } finally {
      setDepositing(false);
    }
  };

  const resetWithdrawFlowState = useCallback(() => {
    setWithdrawStep("amount");
    setWithdrawChallengeId(null);
    setWithdrawAttemptId(null);
    setWithdrawMaskedEmail("");
    setWithdrawOtpCode("");
    setWithdrawCountdownSec(0);
    setWithdrawChallengeStatus("idle");
    setWithdrawStatusMessage("");
    setSendingWithdrawOtp(false);
    setWithdrawing(false);
  }, []);

  // Step 1: Validate amount & load masked approved bank details for confirmation prompt
  const handleProceedToBankConfirmation = async () => {
    const isVerified = user?.verification_status === "verified" || user?.kycStatus === "verified";
    const hasApprovedBank = user?.bankStatus === "approved" || user?.bankAccount?.status === "approved";
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

    const amt = parseFloat(String(withdrawAmount || "").replace(/[^0-9.]/g, ""));
    const available = escrowCash;

    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid withdrawal amount greater than R0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    if (amt > available) {
      const msg = `Insufficient available balance. You requested R${amt.toLocaleString("en-ZA")} but available spendable cash is R${available.toLocaleString("en-ZA")}.`;
      Platform.OS === "web" ? alert(msg) : Alert.alert("Insufficient Balance", msg);
      return;
    }

    try {
      setSendingWithdrawOtp(true);
      let bankInfo = user?.bankAccount || null;
      if (token) {
        const bankRes = await getBankAccountApi(token).catch(() => null);
        const fetched = bankRes?.bankAccount || bankRes?.bank_account || null;
        if (fetched) {
          bankInfo = fetched;
        }
      }

      const rawAcc = String(
        bankInfo?.account_number_masked ||
          bankInfo?.accountNumberMasked ||
          bankInfo?.account_number ||
          bankInfo?.accountNumber ||
          ""
      ).replace(/\s+/g, "");
      const maskedAcc = rawAcc.startsWith("****")
        ? rawAcc
        : rawAcc.length >= 4
        ? `****${rawAcc.slice(-4)}`
        : "****";

      setWithdrawBankDetails({
        id: bankInfo?.id || null,
        bankName: bankInfo?.bank_name || bankInfo?.bankName || "Approved Bank",
        accountHolder:
          bankInfo?.account_holder || bankInfo?.accountHolder || user?.fullName || "Account Holder",
        accountNumberMasked: maskedAcc,
        branchCode: bankInfo?.branch_code || bankInfo?.branchCode || "—",
        accountType: bankInfo?.account_type || bankInfo?.accountType || "Cheque / Current",
        status: bankInfo?.status || "approved",
      });
      setWithdrawStatusMessage("");
      setWithdrawStep("confirm_bank");
    } catch (err) {
      const msg = err.message || "Could not load your approved bank account details.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Bank Details Error", msg);
    } finally {
      setSendingWithdrawOtp(false);
    }
  };

  // Step 2 -> Step 3: Only after user taps Confirm on "Are these your bank details?", send 6-digit email OTP
  const handleConfirmBankAndSendOtp = async () => {
    const amt = parseFloat(String(withdrawAmount || "").replace(/[^0-9.]/g, ""));
    if (isNaN(amt) || amt <= 0) return;

    try {
      setSendingWithdrawOtp(true);
      setWithdrawStatusMessage("");
      setWithdrawOtpCode("");

      const res = await requestWithdrawalChallengeApi(
        {
          amount: amt,
          confirmedBankDetails: true,
        },
        token
      );

      if (!res?.success || !res?.challengeId) {
        throw new Error(res?.error || "Failed to send verification code to your email.");
      }

      if (res.bankAccount) {
        setWithdrawBankDetails({
          id: res.bankAccount.id,
          bankName: res.bankAccount.bankName || "Approved Bank",
          accountHolder: res.bankAccount.accountHolder || user?.fullName || "Account Holder",
          accountNumberMasked: res.bankAccount.accountNumberMasked || "****",
          branchCode: res.bankAccount.branchCode || "—",
          accountType: res.bankAccount.accountType || "Cheque / Current",
          status: res.bankAccount.status || "approved",
        });
      }

      setWithdrawChallengeId(res.challengeId);
      setWithdrawAttemptId(res.attemptId || null);
      setWithdrawMaskedEmail(res.maskedEmail || user?.email || "your verified email");
      setWithdrawCountdownSec(Number(res.expiresInSeconds) || 120);
      setWithdrawChallengeStatus("pending");
      setWithdrawStep("otp_entry");
    } catch (err) {
      const msg = err.message || "Unable to send verification code. Please try again.";
      setWithdrawChallengeStatus("error");
      setWithdrawStatusMessage(msg);
      Platform.OS === "web" ? alert(msg) : Alert.alert("Verification Code Error", msg);
    } finally {
      setSendingWithdrawOtp(false);
    }
  };

  // Cancel withdrawal at bank confirmation or OTP popup stage
  const handleCancelWithdrawalFlow = async (reason = "user_cancelled") => {
    const activeChallengeId = withdrawChallengeId;
    resetWithdrawFlowState();
    setWithdrawModalVisible(false);
    setWithdrawAmount("");
    if (token) {
      cancelWithdrawalChallengeApi(
        {
          challengeId: activeChallengeId || undefined,
          reason,
        },
        token
      ).catch(() => {});
    }
  };

  // Step 3: Submit single-use 6-digit email OTP code to verify & create pending_review withdrawal
  const handleVerifyOtpAndSubmitWithdrawal = async () => {
    const cleanCode = String(withdrawOtpCode || "").trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      const msg = "Please enter the 6-digit verification code sent to your email.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Code Format", msg);
      return;
    }

    if (withdrawChallengeStatus !== "pending" || withdrawCountdownSec <= 0) {
      const msg =
        "This verification challenge has expired or been cancelled. Please request a new code.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Challenge Inactive", msg);
      return;
    }

    const amt = parseFloat(String(withdrawAmount || "").replace(/[^0-9.]/g, ""));

    try {
      setWithdrawing(true);
      const idempotencyKey = `wth_${ withdrawChallengeId || Date.now() }`;
      const res = await verifyWithdrawalChallengeApi(
        {
          challengeId: withdrawChallengeId,
          code: cleanCode,
          amount: amt,
          idempotencyKey,
        },
        token
      );

      if (!res?.success) {
        throw new Error(res?.error || "Withdrawal verification failed.");
      }

      if (typeof res.newBalanceNum === "number" && !isNaN(res.newBalanceNum)) {
        setEscrowCash(res.newBalanceNum);
        await storage.setJSON(STORAGE_KEYS.ESCROW_CASH, res.newBalanceNum);
      }

      if (token) {
        const txRes = await getVaultTransactionsApi(token).catch(() => null);
        if (txRes?.success && Array.isArray(txRes.transactions)) {
          setTransactions(txRes.transactions);
        }
      }

      resetWithdrawFlowState();
      setWithdrawModalVisible(false);
      setWithdrawAmount("");

      const msg =
        res.message ||
        `Email verified. Withdrawal request of R${amt.toLocaleString("en-ZA")} submitted (Pending Review in Admin Treasury Queue). Funds are reserved for payout to your approved bank account (${res.destination || "on file"}).`;
      Platform.OS === "web" ? alert(msg) : Alert.alert("Withdrawal Submitted for Review", msg);
    } catch (err) {
      const msg = err.message || "Failed to verify withdrawal code.";
      // A wrong first code or expired challenge immediately invalidates the challenge on the server
      setWithdrawChallengeStatus("cancelled");
      setWithdrawCountdownSec(0);
      setWithdrawOtpCode("");
      setWithdrawStatusMessage(msg);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleWithdraw = handleProceedToBankConfirmation;

  // ── Share Redemption Modal & Action Handlers ──────────────────────────────
  const fetchQuote = useCallback(
    async (assetId, shares) => {
      if (!assetId || !shares || shares <= 0) return;
      setLoadingSellQuote(true);
      try {
        const res = await getShareRedemptionQuoteApi(assetId, shares, token);
        if (res?.success && res.quote) {
          setSellQuote(res.quote);
        }
      } catch (err) {
        console.warn("[VaultScreen] Quote fetch warning:", err.message);
      } finally {
        setLoadingSellQuote(false);
      }
    },
    [token]
  );

  const openSellModal = useCallback(
    (item) => {
      const avail =
        item.availableShares !== undefined
          ? item.availableShares
          : Math.max(
              0,
              (Number(item.sharesOwned ?? item.shares_count ?? item.shares) || 1) -
                (Number(item.reservedShares ?? item.reserved_shares) || 0)
            );

      if (avail <= 0) {
        const msg =
          "All of your shares in this offering are currently reserved in pending redemption requests. You can manage or cancel pending requests below.";
        Platform.OS === "web" ? alert(msg) : Alert.alert("No Shares Available", msg);
        return;
      }

      setSelectedSellItem(item);
      setSellSharesCount("1");
      setSellModalVisible(true);
      fetchQuote(item.asset_id || item.id, 1);
    },
    [fetchQuote]
  );

  const handleConfirmSell = async () => {
    if (!selectedSellItem) return;
    const count = parseInt(sellSharesCount, 10);
    const maxAvailable =
      selectedSellItem.availableShares !== undefined
        ? selectedSellItem.availableShares
        : Math.max(
            0,
            (Number(selectedSellItem.sharesOwned ?? selectedSellItem.shares_count ?? selectedSellItem.shares) || 1) -
              (Number(selectedSellItem.reservedShares ?? selectedSellItem.reserved_shares) || 0)
          );

    if (isNaN(count) || count < 1 || count > maxAvailable) {
      const msg = `Please enter between 1 and ${maxAvailable} shares to redeem.`;
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Share Quantity", msg);
      return;
    }

    if (sellDestinationMethod === "bank_account" && !sellAccountNumber.trim()) {
      const msg = "Please enter your bank account number for the settlement payout.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Bank Account Required", msg);
      return;
    }

    setSubmittingSell(true);
    try {
      const targetAssetId = selectedSellItem.asset_id || selectedSellItem.id;
      const res = await requestShareRedemptionApi(
        {
          assetId: targetAssetId,
          sharesToRedeem: count,
          payoutDestination: sellDestinationMethod,
          payoutDetails:
            sellDestinationMethod === "bank_account"
              ? {
                  bankName: sellBankName,
                  accountNumber: sellAccountNumber.trim(),
                  accountHolder: sellAccountHolder,
                }
              : { walletAddress: user?.walletAddress || "SmartAssets Escrow Cash Wallet" },
        },
        token
      );

      if (res?.success) {
        setSellModalVisible(false);
        const grossFmt = res.redemption?.grossValuationFormatted || "";
        const netFmt = res.redemption?.netPayoutFormatted || "";
        const msg = `Redemption Request Placed!\n\nYour request to redeem ${count} share${count > 1 ? "s" : ""} (${grossFmt}) for an estimated net payout of ${netFmt} has been placed into custodial review.\n\nShares have been reserved from your active trading pool. Payout will settle once approved.`;
        Platform.OS === "web" ? alert(msg) : Alert.alert("Redemption Request Submitted", msg);
        onRefresh();
      } else {
        const msg = res?.error || "Failed to submit share redemption request.";
        Platform.OS === "web" ? alert(msg) : Alert.alert("Redemption Notice", msg);
      }
    } catch (err) {
      const msg = err.message || "Failed to submit redemption request.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Notice", msg);
    } finally {
      setSubmittingSell(false);
    }
  };

  const handleCancelRedemption = (request) => {
    if (request.status === "settlement_processing") {
      const msg =
        "This redemption request is currently processing settlement with the custodial bank and cannot be cancelled.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Settlement in Progress", msg);
      return;
    }

    const proceedCancel = async () => {
      setCancellingRequestId(request.id);
      try {
        const res = await cancelShareRedemptionApi(request.id, token);
        if (res?.success) {
          const msg =
            "Your redemption request has been cancelled and your reserved shares have been restored to your active vault portfolio.";
          Platform.OS === "web" ? alert(msg) : Alert.alert("Request Cancelled", msg);
          onRefresh();
        } else {
          const msg = res?.error || "Could not cancel request.";
          Platform.OS === "web" ? alert(msg) : Alert.alert("Cancellation Notice", msg);
        }
      } catch (err) {
        const msg = err.message || "Could not cancel request.";
        Platform.OS === "web" ? alert(msg) : Alert.alert("Notice", msg);
      } finally {
        setCancellingRequestId(null);
      }
    };

    if (Platform.OS === "web") {
      if (
        window.confirm(
          `Cancel redemption request for ${request.shares_to_redeem} shares? Your shares will be unreserved immediately.`
        )
      ) {
        proceedCancel();
      }
    } else {
      Alert.alert(
        "Cancel Share Redemption",
        `Are you sure you want to cancel your redemption request for ${request.shares_to_redeem} shares? Your shares will be restored to your active portfolio.`,
        [
          { text: "Keep Request", style: "cancel" },
          { text: "Yes, Cancel Request", style: "destructive", onPress: proceedCancel },
        ]
      );
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

            {/* Main Headline: Asset Portfolio Value */}
            <Text style={styles.heroHeadlineLabel}>PORTFOLIO ASSETS VALUE</Text>
            <Text style={styles.totalBalanceNum}>
              {totalAssetsValueFormatted}
            </Text>

            {/* Subtitle Pill: Available Cash + Escrow Status + Gain */}
            <View style={styles.heroSubtitleRow}>
              <View style={styles.escrowWalletPill}>
                <Ionicons
                  name="wallet-outline"
                  size={13}
                  color="#00C2FF"
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.escrowWalletPillText}>
                  Cash: R{escrowCash.toLocaleString()}
                </Text>
              </View>

              {escrowLockedCash > 0 && (
                <View style={[styles.escrowWalletPill, { backgroundColor: 'rgba(16, 185, 129, 0.25)' }]}>
                  <Ionicons
                    name="shield-checkmark"
                    size={13}
                    color="#10B981"
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.escrowWalletPillText, { color: '#E2E8F0' }]}>
                    In Escrow: R{escrowLockedCash.toLocaleString()}
                  </Text>
                </View>
              )}

              {sellerPendingCash > 0 && (
                <View style={[styles.escrowWalletPill, { backgroundColor: 'rgba(245, 158, 11, 0.25)' }]}>
                  <Ionicons
                    name="time-outline"
                    size={13}
                    color="#F59E0B"
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.escrowWalletPillText, { color: '#E2E8F0' }]}>
                    Pending Sales: R{sellerPendingCash.toLocaleString()}
                  </Text>
                </View>
              )}

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
                  const hasApprovedBank = user?.bankStatus === "approved" || user?.bankAccount?.status === "approved";
                  if (!isVerified || user?.isSuspended) {
                    setGatekeeperRequireBankOnly(false);
                    setGatekeeperActionTitle("Deposit Funds");
                    setKycGatekeeperVisible(true);
                    return;
                  }
                  if (!hasApprovedBank) {
                    setGatekeeperRequireBankOnly(true);
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
                  resetWithdrawFlowState();
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

            <TouchableOpacity
              style={styles.escrowOrdersActionBtn}
              onPress={() => navigation.navigate(SCREENS.ESCROW_ORDERS)}
              activeOpacity={0.85}
            >
              <Feather name="package" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.escrowOrdersActionText}>Track escrow orders</Text>
              <Feather name="chevron-right" size={15} color="#FFFFFF" style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
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
                              {item.reservedShares > 0 ? (
                                <Text style={{ fontSize: 10, color: "#94A3B8" }}>
                                  {" "}({item.availableShares} free)
                                </Text>
                              ) : null}
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

                        {/* Dual Action Buttons: Sell Shares / Buy More */}
                        <View style={styles.fractionalActionsRow}>
                          <TouchableOpacity
                            style={styles.fractionalSellBtn}
                            onPress={() => openSellModal(item)}
                            activeOpacity={0.8}
                          >
                            <Feather name="arrow-up-right" size={12} color="#4F46E5" style={{ marginRight: 4 }} />
                            <Text style={styles.fractionalSellBtnText}>Sell Shares</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.fractionalBuyBtn}
                            onPress={() => navigation.navigate(SCREENS.INVEST)}
                            activeOpacity={0.8}
                          >
                            <Feather name="plus" size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
                            <Text style={styles.fractionalBuyBtnText}>Buy More</Text>
                          </TouchableOpacity>
                        </View>

                        <Text style={styles.fractionalPoolMeta}>
                          Pool: {item.poolValuation || "R18,500"} • {item.fundingPct || 77}% funded
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* ── Share Redemption Requests Section ── */}
              <View style={styles.redemptionSectionWrap}>
                <View style={styles.redemptionHeaderSection}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collectionSectionTitle}>Share Redemption Requests</Text>
                    <Text style={styles.collectionSectionSub}>
                      Custodial reviews and pending bank/escrow settlements
                    </Text>
                  </View>
                  <View style={styles.redemptionCounterBadge}>
                    <Text style={styles.redemptionCounterText}>{redemptionRequests.length}</Text>
                  </View>
                </View>

                {redemptionRequests.length === 0 ? (
                  <View style={styles.emptyRedemptionCard}>
                    <Feather name="shield" size={24} color="#6366F1" />
                    <Text style={styles.emptyRedemptionTitle}>No active redemption requests</Text>
                    <Text style={styles.emptyRedemptionSub}>
                      When you submit a request to redeem shares, the compliance review and payout status will appear here.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {redemptionRequests.map((req) => {
                      const isSettling = req.status === "settlement_processing";
                      const isReviewOrApproved = req.status === "pending_review" || req.status === "approved";

                      return (
                        <View key={req.id} style={styles.redemptionCard}>
                          <View style={styles.redemptionHeaderRow}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={styles.redemptionAssetName} numberOfLines={1}>
                                {req.assets?.name || req.asset_name || "Asset Shares"}
                              </Text>
                              <Text style={styles.redemptionMeta}>
                                {req.shares_to_redeem} share{req.shares_to_redeem > 1 ? "s" : ""} • {req.payout_destination === "bank_account" ? "Bank EFT" : "Escrow Cash"}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.redemptionStatusBadge,
                                req.status === "pending_review" && styles.statusBadgeReview,
                                req.status === "approved" && styles.statusBadgeApproved,
                                req.status === "settlement_processing" && styles.statusBadgeSettling,
                                req.status === "completed" && styles.statusBadgeCompleted,
                                req.status === "cancelled" && styles.statusBadgeCancelled,
                                req.status === "rejected" && styles.statusBadgeRejected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.redemptionStatusText,
                                  req.status === "pending_review" && styles.statusTextReview,
                                  req.status === "approved" && styles.statusTextApproved,
                                  req.status === "settlement_processing" && styles.statusTextSettling,
                                  req.status === "completed" && styles.statusTextCompleted,
                                  req.status === "cancelled" && styles.statusTextCancelled,
                                  req.status === "rejected" && styles.statusTextRejected,
                                ]}
                              >
                                {req.status === "pending_review"
                                  ? "Pending Review"
                                  : req.status === "approved"
                                  ? "Approved"
                                  : req.status === "settlement_processing"
                                  ? "Settling Payout"
                                  : req.status === "completed"
                                  ? "Settled & Paid"
                                  : req.status === "cancelled"
                                  ? "Cancelled"
                                  : "Rejected"}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.redemptionBodyRow}>
                            <View>
                              <Text style={styles.redemptionLabel}>Estimated Net Payout</Text>
                              <Text style={styles.redemptionValue}>
                                {formatZAR(req.net_payout || 0)}
                              </Text>
                            </View>
                            {isReviewOrApproved && (
                              <TouchableOpacity
                                style={styles.cancelRedemptionBtn}
                                onPress={() => handleCancelRedemption(req)}
                                disabled={cancellingRequestId === req.id}
                                activeOpacity={0.8}
                              >
                                {cancellingRequestId === req.id ? (
                                  <ActivityIndicator size="small" color="#DC2626" />
                                ) : (
                                  <>
                                    <Feather name="x-circle" size={13} color="#DC2626" style={{ marginRight: 4 }} />
                                    <Text style={styles.cancelRedemptionBtnText}>Cancel Request</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            )}
                            {isSettling && (
                              <View style={styles.settlementLockedBadge}>
                                <Feather name="lock" size={12} color="#7C3AED" style={{ marginRight: 4 }} />
                                <Text style={styles.settlementLockedText}>Settlement Locked</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              TAB 3: CERTIFICATES & ESCROW LOG (NEVER BLANK)
          ────────────────────────────────────────────────────────────────── */}
          {activeTab === "log" && (
            <View style={{ gap: 12 }}>
              {(() => {
                const combinedLogs = [];

                // 1. Real Transactions from Supabase vault_transactions
                (transactions || []).forEach((tx) => {
                  const isDep = tx.type === "deposit" || tx.type === "sale";
                  const isPurchase = tx.type === "purchase";
                  const rawStatus = String(tx.status || "").toLowerCase();
                  const statusLabel =
                    rawStatus === "completed"
                      ? "Settled"
                      : rawStatus === "settlement_processing"
                      ? "Payout Processing"
                      : rawStatus === "cancelled"
                      ? "Cancelled"
                      : rawStatus === "rejected" || rawStatus === "failed"
                      ? "Rejected"
                      : "Pending Review";
                  combinedLogs.push({
                    id: tx.id || `tx-${Math.random()}`,
                    type: isPurchase ? "purchase" : isDep ? "deposit" : "withdrawal",
                    title:
                      tx.title ||
                      (isPurchase
                        ? "Marketplace Purchase"
                        : tx.type === "sale"
                        ? "Marketplace Sale Proceeds"
                        : isDep
                        ? rawStatus === "completed"
                          ? "Vault Cash Deposit"
                          : "Vault Deposit Request"
                        : rawStatus === "completed"
                        ? "Vault Withdrawal Settled"
                        : "Vault Withdrawal Request"),
                    status: statusLabel,
                    assetName: tx.notes || tx.reference || "Vault Transaction",
                    detail: `${tx.method || "Direct Transfer"}${
                      tx.destinationSummary ? ` • To: ${tx.destinationSummary}` : ""
                    }${
                      tx.settlementRef
                        ? ` • Settled Ref: ${tx.settlementRef}`
                        : tx.reference
                        ? ` • Ref: ${tx.reference}`
                        : ""
                    }`,
                    hash: tx.settlementRef || tx.reference || tx.id,
                    hashDisplay: tx.settlementRef || tx.reference
                      ? (tx.settlementRef || tx.reference).length > 16
                        ? (tx.settlementRef || tx.reference).slice(0, 14) + "..."
                        : tx.settlementRef || tx.reference
                      : String(tx.id || "").slice(-8),
                    amount:
                      tx.amountFormatted ||
                      (isDep
                        ? `+${formatGBP(tx.amount)}`
                        : `-${formatGBP(tx.amount)}`),
                    badgeColor:
                      rawStatus === "rejected" || rawStatus === "failed" || rawStatus === "cancelled"
                        ? "#EF4444"
                        : isPurchase
                        ? "#8B5CF6"
                        : isDep
                        ? rawStatus === "completed"
                          ? "#10B981"
                          : "#F59E0B"
                        : "#F59E0B",
                    timestamp: tx.createdAt
                      ? new Date(tx.createdAt).toLocaleDateString("en-ZA", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Recent",
                    rawTime: tx.createdAt ? new Date(tx.createdAt).getTime() : 0,
                  });
                });

                // 2. Real Authenticity Certificates from Supabase holdings
                (holdings || []).forEach((h) => {
                  const rawTx = h.txHash || h.tx_hash;
                  const hasTx = typeof rawTx === "string" && /^0x[0-9a-fA-F]{64}$/.test(rawTx.trim());
                  const certId =
                    h.certId ||
                    (hasTx ? `ERC-721 #${String(h.id || "").slice(-4)}` : "Authenticity Record");
                  const hash = hasTx ? rawTx.trim() : null;
                  const hashDisplay = hasTx ? `${hash.slice(0, 6)}...${hash.slice(-4)}` : null;
                  combinedLogs.push({
                    id: `cert-${h.id}`,
                    type: "certificate",
                    title: "Authenticity Certificate",
                    status: hasTx ? "ERC-721 Verified" : "Off-Chain Sealed",
                    assetName: h.name || "Verified Collectible",
                    detail: hasTx
                      ? `${certId} • Smart Contract Cryptographically Verified`
                      : `${certId} • SmartAssets Custody Certified`,
                    hash: hash,
                    hashDisplay: hashDisplay,
                    amount: formatGBP(h.price_num || h.price || 0),
                    badgeColor: hasTx ? "#7C3AED" : "#64748B",
                    timestamp: h.created_at
                      ? new Date(h.created_at).toLocaleDateString("en-ZA", {
                          month: "short",
                          day: "numeric",
                        })
                      : "Permanent",
                    rawTime: h.created_at
                      ? new Date(h.created_at).getTime()
                      : 0,
                  });
                });

                // 3. Any additional cached activity logs
                (activityLog || [])
                  .filter(
                    (log) =>
                      log.type !== "ai_sync" &&
                      log.title !== "AI Market Valuation Sync"
                  )
                  .forEach((log) => {
                    if (
                      !combinedLogs.some(
                        (cl) =>
                          cl.id === log.id ||
                          (cl.assetName === log.assetName &&
                            cl.title === log.title)
                      )
                    ) {
                      combinedLogs.push(log);
                    }
                  });

                combinedLogs.sort((a, b) => (b.rawTime || 0) - (a.rawTime || 0));

                if (combinedLogs.length === 0) {
                  return (
                    <View style={styles.emptyCard}>
                      <Ionicons
                        name="ribbon-outline"
                        size={40}
                        color="#94A3B8"
                      />
                      <Text style={styles.emptyTitle}>
                        No Certificates or Transactions Yet
                      </Text>
                      <Text style={styles.emptySub}>
                        ERC-721 authenticity certificates and escrow transactions will appear here.
                      </Text>
                    </View>
                  );
                }
                return combinedLogs.map((log, idx) => (
                  <View key={log.id || idx} style={styles.activityCard}>
                    <View style={styles.activityHeaderRow}>
                      <View
                        style={[
                          styles.activityIconBox,
                          {
                            backgroundColor:
                              log.type === "certificate"
                                ? "#F3E8FF"
                                : log.type === "purchase"
                                ? "#EDE9FE"
                                : log.type === "deposit"
                                ? "#ECFDF5"
                                : "#EFF6FF",
                          },
                        ]}
                      >
                        <Ionicons
                          name={
                            log.type === "certificate"
                              ? "diamond"
                              : log.type === "purchase"
                              ? "bag-check-outline"
                              : log.type === "deposit"
                              ? "arrow-down-circle"
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
                    {log.hashDisplay ? (
                      <TouchableOpacity
                        style={styles.hashPill}
                        onPress={() => {
                          const msg = `Transaction Reference / Hash: ${log.hash || log.hashDisplay}`;
                          Platform.OS === "web"
                            ? alert(msg)
                            : Alert.alert("Transaction Reference", msg);
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
                          {log.hashDisplay}
                        </Text>
                      </TouchableOpacity>
                    ) : null}

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

              <View
                style={{
                  backgroundColor: "#FFFBEB",
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: "#FDE68A",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#92400E" }}>
                  Manual Bank EFT — Pending Treasury Verification
                </Text>
                <Text style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>
                  Submitting a deposit request records it as Pending Review. Your spendable balance increases only after settlement is independently verified.
                </Text>
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

              <Text style={styles.modalLabel}>Bank EFT Reference (Optional)</Text>
              <TextInput
                value={depositReference}
                onChangeText={setDepositReference}
                placeholder="e.g. EFT-2026-88412"
                style={styles.modalInput}
                placeholderTextColor="#94A3B8"
              />

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleDeposit}
                disabled={depositing}
              >
                {depositing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Submit Deposit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── WITHDRAW MODAL (3-STAGE: AMOUNT -> BANK CONFIRMATION -> 6-DIGIT EMAIL OTP) ── */}
        <Modal
          visible={withdrawModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => handleCancelWithdrawalFlow("modal_dismissed")}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {withdrawStep === "confirm_bank"
                    ? "Confirm Bank Details"
                    : withdrawStep === "otp_entry"
                    ? "Email Code Verification"
                    : "Request Withdrawal"}
                </Text>
                <TouchableOpacity
                  onPress={() => handleCancelWithdrawalFlow("user_closed_modal")}
                >
                  <Feather name="x" size={20} color="#0F172A" />
                </TouchableOpacity>
              </View>

              {/* STAGE 1: ENTER AMOUNT */}
              {withdrawStep === "amount" && (
                <>
                  <View
                    style={{
                      backgroundColor: "#EFF6FF",
                      borderRadius: 10,
                      padding: 10,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: "#BFDBFE",
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#1E40AF" }}>
                      Destination: Approved Bank Account on File
                    </Text>
                    <Text style={{ fontSize: 11, color: "#1D4ED8", marginTop: 2 }}>
                      Payouts are sent exclusively to your KYC-verified, admin-approved bank account after you confirm your bank details and verify a single-use 6-digit email code.
                    </Text>
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

                  <TouchableOpacity
                    style={styles.modalSubmitBtn}
                    onPress={handleProceedToBankConfirmation}
                    disabled={sendingWithdrawOtp}
                  >
                    {sendingWithdrawOtp ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.modalSubmitBtnText}>Continue</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {/* STAGE 2: BANK DETAILS CONFIRMATION ("Are these your bank details?") */}
              {withdrawStep === "confirm_bank" && (
                <>
                  <View
                    style={{
                      backgroundColor: "#F8FAFC",
                      borderRadius: 12,
                      padding: 14,
                      marginBottom: 14,
                      borderWidth: 1,
                      borderColor: "#CBD5E1",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "800",
                        color: "#0F172A",
                        marginBottom: 6,
                      }}
                    >
                      Are these your bank details?
                    </Text>
                    <Text style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>
                      Please verify your approved payout destination below. Destination bank details cannot be replaced during a withdrawal.
                    </Text>

                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>
                          Withdrawal Amount:
                        </Text>
                        <Text style={{ fontSize: 13, color: "#0F172A", fontWeight: "800" }}>
                          {formatZAR(withdrawAmount)}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>
                          Bank Name:
                        </Text>
                        <Text style={{ fontSize: 12, color: "#0F172A", fontWeight: "700" }}>
                          {withdrawBankDetails?.bankName || "Approved Bank"}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>
                          Account Holder:
                        </Text>
                        <Text style={{ fontSize: 12, color: "#0F172A", fontWeight: "700" }}>
                          {withdrawBankDetails?.accountHolder || user?.fullName || "Verified Holder"}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>
                          Account Number (Masked):
                        </Text>
                        <Text style={{ fontSize: 13, color: "#4F46E5", fontWeight: "800" }}>
                          {withdrawBankDetails?.accountNumberMasked || "****"}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>
                          Branch Code:
                        </Text>
                        <Text style={{ fontSize: 12, color: "#0F172A", fontWeight: "700" }}>
                          {withdrawBankDetails?.branchCode || "—"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {withdrawStatusMessage ? (
                    <View
                      style={{
                        backgroundColor: "#FEF2F2",
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 12,
                        borderWidth: 1,
                        borderColor: "#FECACA",
                      }}
                    >
                      <Text style={{ fontSize: 12, color: "#B91C1C", fontWeight: "600" }}>
                        {withdrawStatusMessage}
                      </Text>
                    </View>
                  ) : null}

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      style={[
                        styles.modalSubmitBtn,
                        {
                          flex: 1,
                          backgroundColor: "#F1F5F9",
                          borderWidth: 1,
                          borderColor: "#CBD5E1",
                        },
                      ]}
                      onPress={() => handleCancelWithdrawalFlow("user_declined_bank_details")}
                      disabled={sendingWithdrawOtp}
                    >
                      <Text style={[styles.modalSubmitBtnText, { color: "#334155" }]}>
                        Cancel
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modalSubmitBtn, { flex: 1 }]}
                      onPress={handleConfirmBankAndSendOtp}
                      disabled={sendingWithdrawOtp}
                    >
                      {sendingWithdrawOtp ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.modalSubmitBtnText}>Confirm</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* STAGE 3: 6-DIGIT EMAIL CODE POPUP WITH 2-MINUTE COUNTDOWN */}
              {withdrawStep === "otp_entry" && (
                <>
                  <View
                    style={{
                      backgroundColor: "#EEF2FF",
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: "#C7D2FE",
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#3730A3" }}>
                      6-Digit Verification Code Sent to {withdrawMaskedEmail}
                    </Text>
                    <Text style={{ fontSize: 11, color: "#4338CA", marginTop: 3 }}>
                      Amount: {formatZAR(withdrawAmount)} • Destination:{" "}
                      {withdrawBankDetails?.bankName || "Bank"} (
                      {withdrawBankDetails?.accountNumberMasked || "****"})
                    </Text>
                    <Text style={{ fontSize: 11, color: "#6366F1", marginTop: 3, fontWeight: "600" }}>
                      Single attempt only: Entering a wrong code or letting the 2-minute timer expire immediately cancels this withdrawal attempt.
                    </Text>
                  </View>

                  {/* Visible 2-Minute Countdown Pill */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor:
                        withdrawChallengeStatus === "pending" && withdrawCountdownSec > 0
                          ? "#F0FDF4"
                          : "#FEF2F2",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor:
                        withdrawChallengeStatus === "pending" && withdrawCountdownSec > 0
                          ? "#BBF7D0"
                          : "#FECACA",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "700",
                        color:
                          withdrawChallengeStatus === "pending" && withdrawCountdownSec > 0
                            ? "#166534"
                            : "#991B1B",
                      }}
                    >
                      {withdrawChallengeStatus === "pending" && withdrawCountdownSec > 0
                        ? "Code Expires In:"
                        : withdrawChallengeStatus === "expired"
                        ? "Challenge Expired"
                        : "Challenge Cancelled"}
                    </Text>
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "800",
                        fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
                        color:
                          withdrawChallengeStatus === "pending" && withdrawCountdownSec > 30
                            ? "#15803D"
                            : "#DC2626",
                      }}
                    >
                      {`${String(Math.floor(withdrawCountdownSec / 60)).padStart(2, "0")}:${String(
                        withdrawCountdownSec % 60
                      ).padStart(2, "0")}`}
                    </Text>
                  </View>

                  {withdrawStatusMessage ? (
                    <View
                      style={{
                        backgroundColor: "#FEF2F2",
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 12,
                        borderWidth: 1,
                        borderColor: "#FECACA",
                      }}
                    >
                      <Text style={{ fontSize: 12, color: "#B91C1C", fontWeight: "600" }}>
                        {withdrawStatusMessage}
                      </Text>
                    </View>
                  ) : null}

                  {withdrawChallengeStatus === "pending" && withdrawCountdownSec > 0 ? (
                    <>
                      <Text style={styles.modalLabel}>Enter 6-Digit Email Code</Text>
                      <TextInput
                        value={withdrawOtpCode}
                        onChangeText={(val) =>
                          setWithdrawOtpCode(String(val || "").replace(/[^0-9]/g, "").slice(0, 6))
                        }
                        placeholder="6-digit code"
                        keyboardType="number-pad"
                        maxLength={6}
                        style={[
                          styles.modalInput,
                          {
                            letterSpacing: 6,
                            fontSize: 18,
                            fontWeight: "800",
                            textAlign: "center",
                          },
                        ]}
                        placeholderTextColor="#94A3B8"
                      />

                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <TouchableOpacity
                          style={[
                            styles.modalSubmitBtn,
                            {
                              flex: 1,
                              backgroundColor: "#F1F5F9",
                              borderWidth: 1,
                              borderColor: "#CBD5E1",
                            },
                          ]}
                          onPress={() => handleCancelWithdrawalFlow("user_cancelled_otp_popup")}
                          disabled={withdrawing}
                        >
                          <Text style={[styles.modalSubmitBtnText, { color: "#334155" }]}>
                            Cancel
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.modalSubmitBtn, { flex: 1.5 }]}
                          onPress={handleVerifyOtpAndSubmitWithdrawal}
                          disabled={withdrawing || withdrawOtpCode.length !== 6}
                        >
                          {withdrawing ? (
                            <ActivityIndicator color="#FFFFFF" />
                          ) : (
                            <Text style={styles.modalSubmitBtnText}>
                              Verify & Submit
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        style={[
                          styles.modalSubmitBtn,
                          {
                            flex: 1,
                            backgroundColor: "#F1F5F9",
                            borderWidth: 1,
                            borderColor: "#CBD5E1",
                          },
                        ]}
                        onPress={() => handleCancelWithdrawalFlow("closed_after_invalidation")}
                        disabled={sendingWithdrawOtp}
                      >
                        <Text style={[styles.modalSubmitBtnText, { color: "#334155" }]}>
                          Close
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.modalSubmitBtn, { flex: 1.5 }]}
                        onPress={handleConfirmBankAndSendOtp}
                        disabled={sendingWithdrawOtp}
                      >
                        {sendingWithdrawOtp ? (
                          <ActivityIndicator color="#FFFFFF" />
                        ) : (
                          <Text style={styles.modalSubmitBtnText}>
                            Send New Code
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* ── SHARE REDEMPTION MODAL ────────────────────────────────────────────── */}
        <Modal
          visible={sellModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setSellModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: "90%" }]}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={styles.modalTitle}>Redeem Asset Shares</Text>
                    <Text style={styles.modalSubTitle} numberOfLines={1}>
                      {selectedSellItem?.name || "Asset Offering"}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSellModalVisible(false)}>
                    <Feather name="x" size={20} color="#0F172A" />
                  </TouchableOpacity>
                </View>

                {/* Informational Regulatory Notice */}
                <View style={styles.redemptionNoticeBox}>
                  <Feather name="info" size={15} color="#4F46E5" style={{ marginRight: 8, marginTop: 2 }} />
                  <Text style={styles.redemptionNoticeText}>
                    Share redemptions are processed as formal exit requests pending custodial verification. Once payout settlement begins, requests are locked. Your shares are reserved immediately upon submission to prevent double-trading.
                  </Text>
                </View>

                {/* Shares Selection */}
                <Text style={styles.modalLabel}>
                  Shares to Redeem (Available: {selectedSellItem?.availableShares ?? selectedSellItem?.sharesOwned ?? 1})
                </Text>
                <View style={styles.sharesStepperRow}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => {
                      const cur = parseInt(sellSharesCount, 10) || 1;
                      if (cur > 1) {
                        const next = cur - 1;
                        setSellSharesCount(String(next));
                        fetchQuote(selectedSellItem?.asset_id || selectedSellItem?.id, next);
                      }
                    }}
                  >
                    <Feather name="minus" size={16} color="#0F172A" />
                  </TouchableOpacity>
                  <TextInput
                    value={sellSharesCount}
                    onChangeText={(txt) => {
                      const cleaned = txt.replace(/[^0-9]/g, "");
                      setSellSharesCount(cleaned);
                      const num = parseInt(cleaned, 10);
                      if (num > 0) {
                        fetchQuote(selectedSellItem?.asset_id || selectedSellItem?.id, num);
                      }
                    }}
                    keyboardType="numeric"
                    style={styles.stepperInput}
                  />
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => {
                      const cur = parseInt(sellSharesCount, 10) || 0;
                      const max = selectedSellItem?.availableShares ?? selectedSellItem?.sharesOwned ?? 1;
                      if (cur < max) {
                        const next = cur + 1;
                        setSellSharesCount(String(next));
                        fetchQuote(selectedSellItem?.asset_id || selectedSellItem?.id, next);
                      }
                    }}
                  >
                    <Feather name="plus" size={16} color="#0F172A" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.maxSharesBtn}
                    onPress={() => {
                      const max = selectedSellItem?.availableShares ?? selectedSellItem?.sharesOwned ?? 1;
                      setSellSharesCount(String(max));
                      fetchQuote(selectedSellItem?.asset_id || selectedSellItem?.id, max);
                    }}
                  >
                    <Text style={styles.maxSharesBtnText}>MAX</Text>
                  </TouchableOpacity>
                </View>

                {/* Live Financial Breakdown Quote */}
                <View style={styles.quoteSummaryBox}>
                  {loadingSellQuote ? (
                    <ActivityIndicator size="small" color="#4F46E5" style={{ paddingVertical: 12 }} />
                  ) : (
                    <>
                      <View style={styles.quoteRow}>
                        <Text style={styles.quoteLabel}>Authoritative Share Price</Text>
                        <Text style={styles.quoteVal}>{sellQuote?.sharePriceFormatted || "R0"}</Text>
                      </View>
                      <View style={styles.quoteRow}>
                        <Text style={styles.quoteLabel}>Gross Valuation</Text>
                        <Text style={styles.quoteVal}>{sellQuote?.grossValuationFormatted || "R0"}</Text>
                      </View>
                      <View style={styles.quoteRow}>
                        <Text style={styles.quoteLabel}>Platform Redemption Fee (2.5%)</Text>
                        <Text style={[styles.quoteVal, { color: "#DC2626" }]}>
                          -{sellQuote?.redemptionFeeFormatted || "R0"}
                        </Text>
                      </View>
                      <View style={[styles.quoteRow, styles.quoteTotalRow]}>
                        <Text style={styles.quoteTotalLabel}>Estimated Net Proceeds</Text>
                        <Text style={styles.quoteTotalVal}>
                          {sellQuote?.estimatedNetProceedsFormatted || "R0"}
                        </Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Payout Destination Selector */}
                <Text style={styles.modalLabel}>Payout Destination</Text>
                <View style={styles.destinationOptionsRow}>
                  <TouchableOpacity
                    style={[
                      styles.destinationOption,
                      sellDestinationMethod === "escrow_wallet" && styles.destinationOptionActive,
                    ]}
                    onPress={() => setSellDestinationMethod("escrow_wallet")}
                  >
                    <Feather
                      name="shield"
                      size={16}
                      color={sellDestinationMethod === "escrow_wallet" ? "#4F46E5" : "#64748B"}
                      style={{ marginBottom: 4 }}
                    />
                    <Text
                      style={[
                        styles.destinationOptionText,
                        sellDestinationMethod === "escrow_wallet" && styles.destinationOptionTextActive,
                      ]}
                    >
                      SmartAssets Escrow
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.destinationOption,
                      sellDestinationMethod === "bank_account" && styles.destinationOptionActive,
                    ]}
                    onPress={() => setSellDestinationMethod("bank_account")}
                  >
                    <Feather
                      name="credit-card"
                      size={16}
                      color={sellDestinationMethod === "bank_account" ? "#4F46E5" : "#64748B"}
                      style={{ marginBottom: 4 }}
                    />
                    <Text
                      style={[
                        styles.destinationOptionText,
                        sellDestinationMethod === "bank_account" && styles.destinationOptionTextActive,
                      ]}
                    >
                      Bank EFT
                    </Text>
                  </TouchableOpacity>
                </View>

                {sellDestinationMethod === "bank_account" && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.modalSubLabel}>Bank Name</Text>
                    <TextInput
                      value={sellBankName}
                      onChangeText={setSellBankName}
                      placeholder="e.g. Standard Bank / FNB / Absa"
                      style={styles.modalInput}
                      placeholderTextColor="#94A3B8"
                    />
                    <Text style={styles.modalSubLabel}>Account Number</Text>
                    <TextInput
                      value={sellAccountNumber}
                      onChangeText={setSellAccountNumber}
                      placeholder="Enter your bank account number"
                      keyboardType="numeric"
                      style={styles.modalInput}
                      placeholderTextColor="#94A3B8"
                    />
                    <Text style={styles.modalSubLabel}>Account Holder Name</Text>
                    <TextInput
                      value={sellAccountHolder}
                      onChangeText={setSellAccountHolder}
                      placeholder="Account holder name"
                      style={styles.modalInput}
                      placeholderTextColor="#94A3B8"
                    />
                  </View>
                )}

                {/* Submit Button */}
                <TouchableOpacity
                  style={[styles.modalSubmitBtn, { marginTop: 20 }]}
                  onPress={handleConfirmSell}
                  disabled={submittingSell}
                >
                  {submittingSell ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit Redemption Request</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
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
  escrowOrdersActionBtn: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  escrowOrdersActionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
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

  // ── Fractional Actions & Redemption Styling ─────────────────────────────
  fractionalActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  fractionalSellBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
    paddingVertical: 7,
    borderRadius: 8,
  },
  fractionalSellBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4F46E5",
  },
  fractionalBuyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5835F5",
    paddingVertical: 7,
    borderRadius: 8,
  },
  fractionalBuyBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  redemptionSectionWrap: {
    marginTop: 24,
    marginBottom: 8,
  },
  redemptionHeaderSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  redemptionCounterBadge: {
    backgroundColor: "#EEF2FF",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  redemptionCounterText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4F46E5",
  },
  emptyRedemptionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },
  emptyRedemptionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 8,
  },
  emptyRedemptionSub: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 16,
    paddingHorizontal: 12,
  },
  redemptionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  redemptionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  redemptionAssetName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  redemptionMeta: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    fontWeight: "600",
  },
  redemptionStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeReview: {
    backgroundColor: "#FEF3C7",
  },
  statusTextReview: {
    fontSize: 10,
    fontWeight: "800",
    color: "#D97706",
  },
  statusBadgeApproved: {
    backgroundColor: "#DBEAFE",
  },
  statusTextApproved: {
    fontSize: 10,
    fontWeight: "800",
    color: "#2563EB",
  },
  statusBadgeSettling: {
    backgroundColor: "#EDE9FE",
  },
  statusTextSettling: {
    fontSize: 10,
    fontWeight: "800",
    color: "#7C3AED",
  },
  statusBadgeCompleted: {
    backgroundColor: "#DCFCE7",
  },
  statusTextCompleted: {
    fontSize: 10,
    fontWeight: "800",
    color: "#15803D",
  },
  statusBadgeCancelled: {
    backgroundColor: "#F1F5F9",
  },
  statusTextCancelled: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  statusBadgeRejected: {
    backgroundColor: "#FEE2E2",
  },
  statusTextRejected: {
    fontSize: 10,
    fontWeight: "800",
    color: "#DC2626",
  },
  redemptionStatusText: {
    fontSize: 10,
    fontWeight: "800",
  },
  redemptionBodyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  redemptionLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
    textTransform: "uppercase",
  },
  redemptionValue: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 1,
  },
  cancelRedemptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  cancelRedemptionBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#DC2626",
  },
  settlementLockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F3FF",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  settlementLockedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
  },
  modalSubTitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    fontWeight: "600",
  },
  redemptionNoticeBox: {
    flexDirection: "row",
    backgroundColor: "#EEF2FF",
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  redemptionNoticeText: {
    flex: 1,
    fontSize: 11,
    color: "#3730A3",
    lineHeight: 16,
  },
  sharesStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  stepperBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperInput: {
    flex: 1,
    height: 42,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  maxSharesBtn: {
    backgroundColor: "#EDE9FE",
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  maxSharesBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6D28D9",
  },
  quoteSummaryBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  quoteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  quoteLabel: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
  },
  quoteVal: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  quoteTotalRow: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    marginBottom: 0,
  },
  quoteTotalLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },
  quoteTotalVal: {
    fontSize: 15,
    fontWeight: "800",
    color: "#15803D",
  },
  destinationOptionsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  destinationOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  destinationOptionActive: {
    backgroundColor: "#EEF2FF",
    borderColor: "#4F46E5",
  },
  destinationOptionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  destinationOptionTextActive: {
    color: "#4F46E5",
  },
  modalSubLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    marginTop: 8,
    marginBottom: 4,
  },
});
