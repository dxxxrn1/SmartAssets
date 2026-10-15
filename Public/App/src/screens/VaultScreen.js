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
import {
  getUserVault,
  depositFundsApi,
  withdrawFundsApi,
  getVaultTransactionsApi,
} from "../services/api";
import storage, { STORAGE_KEYS } from "../utils/storage";

// ── Currency Formatter (British Pounds £) ─────────────────────────────────────
const formatGBP = (val, fallback = "£0") => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "string" && val.startsWith("£")) return val;
  if (typeof val === "string" && val.startsWith("R")) {
    return "£" + val.replace(/^R\s?/, "");
  }
  const num =
    typeof val === "number"
      ? val
      : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return String(val);
  return "£" + num.toLocaleString("en-GB", { maximumFractionDigits: 0 });
};

export default function VaultScreen({ navigation }) {
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 860;
  const cardWidth = isDesktop ? (screenWidth - 36 - 32) / 3 : (screenWidth - 36 - 16) / 2;

  const { user, token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("Portfolio");
  const [holdings, setHoldings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({
    availableBalanceFormatted: "£45,200",
    availableBalanceNum: 45200,
    portfolioValueFormatted: "£1,251,500",
    portfolioValueNum: 1251500,
    totalValueFormatted: "£1,296,700",
    totalValueNum: 1296700,
    totalCount: 12,
    gainText: "+12.4% YTD",
  });

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

  const lastVaultFetchRef = useRef(0);

  // 1. Initial cached state restoration (runs only once on mount)
  useEffect(() => {
    let isMounted = true;
    storage.getJSON(STORAGE_KEYS.VAULT).then((cached) => {
      if (isMounted && cached) {
        if (cached.holdings && Array.isArray(cached.holdings)) setHoldings(cached.holdings);
        if (cached.summary) {
          setSummary((prev) => ({
            ...prev,
            totalValueFormatted: formatGBP(cached.summary.totalValueFormatted) || prev.totalValueFormatted,
            availableBalanceFormatted: formatGBP(cached.summary.availableBalanceFormatted) || prev.availableBalanceFormatted,
            portfolioValueFormatted: formatGBP(cached.summary.portfolioValueFormatted) || prev.portfolioValueFormatted,
          }));
        }
        if (cached.transactions && Array.isArray(cached.transactions)) setTransactions(cached.transactions);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Fetch fresh vault and transaction data on focus with 45s throttling
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
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
            setSummary((prev) => ({
              ...prev,
              totalValueFormatted: formatGBP(s.totalValueFormatted) || prev.totalValueFormatted,
              availableBalanceFormatted: formatGBP(s.availableBalanceFormatted) || prev.availableBalanceFormatted,
              portfolioValueFormatted: formatGBP(s.portfolioValueFormatted) || prev.portfolioValueFormatted,
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
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });

      getVaultTransactionsApi(token)
        .then((txRes) => {
          if (isMounted && txRes?.success && Array.isArray(txRes.transactions)) {
            setTransactions(txRes.transactions);
          }
        })
        .catch(() => {});

      return () => {
        isMounted = false;
      };
    }, [token]),
  );

  const onRefresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      lastVaultFetchRef.current = Date.now();
      const res = await getUserVault(token);
      if (res?.success) {
        const h = res.holdings || [];
        const s = res.summary || {};
        setHoldings(h);
        setSummary((prev) => ({
          ...prev,
          totalValueFormatted: formatGBP(s.totalValueFormatted) || prev.totalValueFormatted,
          availableBalanceFormatted: formatGBP(s.availableBalanceFormatted) || prev.availableBalanceFormatted,
          portfolioValueFormatted: formatGBP(s.portfolioValueFormatted) || prev.portfolioValueFormatted,
          totalCount: s.totalCount || h.length,
        }));
        await storage.setJSON(STORAGE_KEYS.VAULT, { holdings: h, summary: s });
      }
      const txRes = await getVaultTransactionsApi(token);
      if (txRes?.success && Array.isArray(txRes.transactions)) {
        setTransactions(txRes.transactions);
      }
    } catch (_) {}
    setRefreshing(false);
  }, [token]);

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount.replace(/[^0-9.]/g, ""));
    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid deposit amount greater than £0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    try {
      setDepositing(true);
      const res = await depositFundsApi(
        { amount: amt, method: depositMethod },
        token,
      );
      if (res?.success) {
        setSummary((prev) => ({
          ...prev,
          availableBalanceNum: res.newBalanceNum,
          availableBalanceFormatted: formatGBP(res.newBalanceFormatted),
          totalValueNum: res.newBalanceNum,
          totalValueFormatted: formatGBP(res.newBalanceFormatted),
        }));
        if (res.transaction) {
          setTransactions((prev) => [res.transaction, ...prev]);
        }
        setDepositModalVisible(false);
        setDepositAmount("");
        const msg = `Deposit of £${amt.toLocaleString()} confirmed! New balance: ${formatGBP(res.newBalanceFormatted)}`;
        Platform.OS === "web"
          ? alert("✅ " + msg)
          : Alert.alert("Deposit Confirmed", msg);
      } else {
        throw new Error(res?.error || "Deposit could not be processed.");
      }
    } catch (err) {
      const msg = err.message || "Failed to process deposit.";
      Platform.OS === "web" ? alert("⚠️ " + msg) : Alert.alert("Notice", msg);
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount.replace(/[^0-9.]/g, ""));
    const available = summary.availableBalanceNum || 45200;

    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid withdrawal amount greater than £0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    if (amt > available) {
      const msg = `Insufficient available balance. You requested £${amt.toLocaleString()} but available cash is £${available.toLocaleString()}.`;
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

      const res = await withdrawFundsApi(payload, token);
      if (res?.success) {
        setSummary((prev) => ({
          ...prev,
          availableBalanceNum: res.newBalanceNum,
          availableBalanceFormatted: formatGBP(res.newBalanceFormatted),
          totalValueNum: res.newBalanceNum,
          totalValueFormatted: formatGBP(res.newBalanceFormatted),
        }));
        if (res.transaction) {
          setTransactions((prev) => [res.transaction, ...prev]);
        }
        setWithdrawModalVisible(false);
        setWithdrawAmount("");
        const msg = `Withdrawal of £${amt.toLocaleString()} processed via ${withdrawMethod}.`;
        Platform.OS === "web"
          ? alert("✅ " + msg)
          : Alert.alert("Withdrawal Processed", msg);
      } else {
        throw new Error(res?.error || "Withdrawal could not be processed.");
      }
    } catch (err) {
      const msg = err.message || "Failed to process withdrawal.";
      Platform.OS === "web" ? alert("⚠️ " + msg) : Alert.alert("Notice", msg);
    } finally {
      setWithdrawing(false);
    }
  };

  const userName =
    user?.firstName ||
    user?.fullName?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "James";

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
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      {/* ── Background Mesh Gradient ─────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient
          colors={[
            "rgba(216, 214, 253, 1)",
            "#d5cdffff",
            "#fae3f4ff",
            "#fff0e6ff",
            "#FFF7EF",
          ]}
          locations={[0, 0.2, 0.5, 0.8, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>

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
        {/* ── TOP APP BAR ──────────────────────────────────────────────────────── */}
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
              style={styles.userPill}
              onPress={() => navigation.navigate(SCREENS.PROFILE)}
              activeOpacity={0.8}
            >
              <View style={styles.initialsCircle}>
                <Text style={styles.initialsText}>{userInitials}</Text>
              </View>
              <Text style={styles.userPillName} numberOfLines={1}>
                {userName}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.addAssetBtn}
              onPress={() => navigation.navigate(SCREENS.LIST_ASSET)}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={16} color="#FFFFFF" style={{ marginRight: 2 }} />
              <Text style={styles.addAssetBtnText}>Add asset</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            VAULT HERO CARD: SECURE VAULT LEDGER (Classic Purple-to-Cyan Gradient)
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

            {/* Total Balance */}
            <Text style={styles.totalBalanceNum}>
              {summary.totalValueFormatted || "£1,296,700"}
            </Text>

            {/* Cash & Gain Subtitle */}
            <View style={styles.heroSubtitleRow}>
              <Text style={styles.heroSubText}>
                Liquid Cash: {summary.availableBalanceFormatted || "£45,200"}
              </Text>
              <View style={styles.gainPill}>
                <Text style={styles.gainPillText}>
                  {summary.gainText || "↑ +12.4% YTD"}
                </Text>
              </View>
            </View>

            {/* Quick Actions (Deposit & Withdraw Buttons) */}
            <View style={styles.heroActionRow}>
              <TouchableOpacity
                style={styles.depositActionBtn}
                onPress={() => setDepositModalVisible(true)}
                activeOpacity={0.85}
              >
                <Feather
                  name="plus"
                  size={16}
                  color="#5835F5"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.depositActionBtnText}>Deposit funds</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.withdrawActionBtn}
                onPress={() => setWithdrawModalVisible(true)}
                activeOpacity={0.85}
              >
                <Feather
                  name="arrow-up-right"
                  size={16}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.withdrawActionBtnText}>Withdraw</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            HOLDINGS & TRANSACTIONS TABS
        ══════════════════════════════════════════════════════════════════════ */}
        <View style={styles.sectionWrap}>
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[
                styles.tabPill,
                activeTab === "Portfolio"
                  ? styles.tabPillActive
                  : styles.tabPillInactive,
              ]}
              onPress={() => setActiveTab("Portfolio")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabPillText,
                  activeTab === "Portfolio"
                    ? styles.tabPillTextActive
                    : styles.tabPillTextInactive,
                ]}
              >
                Holdings ({holdings.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabPill,
                activeTab === "Transactions"
                  ? styles.tabPillActive
                  : styles.tabPillInactive,
              ]}
              onPress={() => setActiveTab("Transactions")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabPillText,
                  activeTab === "Transactions"
                    ? styles.tabPillTextActive
                    : styles.tabPillTextInactive,
                ]}
              >
                Ledger Activity ({transactions.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tab 1: Portfolio Holdings */}
          {activeTab === "Portfolio" && (
            <View>
              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color="#6D28D9" />
                  <Text style={styles.loadingText}>Loading vault holdings…</Text>
                </View>
              ) : holdings.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="briefcase-outline" size={40} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>Your Vault is empty</Text>
                  <Text style={styles.emptySub}>
                    Explore verified luxury collectibles in the marketplace to start
                    building your private portfolio.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => navigation.navigate(SCREENS.SEARCH)}
                  >
                    <Text style={styles.emptyActionBtnText}>
                      Discover opportunities
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.gridWrap}>
                  {holdings.map((item, idx) => {
                    const price = formatGBP(item.price);
                    return (
                      <TouchableOpacity
                        key={item.id || idx}
                        style={[styles.holdingCard, { width: cardWidth }]}
                        onPress={() =>
                          navigation.navigate(SCREENS.ASSET_DETAIL, { asset: item })
                        }
                        activeOpacity={0.88}
                      >
                        {/* Image */}
                        <View style={styles.cardImgWrap}>
                          <Image
                            source={{ uri: item.image }}
                            style={styles.cardImg}
                            resizeMode="cover"
                          />
                          <View style={styles.verifiedBadge}>
                            <Ionicons
                              name="shield-checkmark"
                              size={11}
                              color="#FFFFFF"
                              style={{ marginRight: 3 }}
                            />
                            <Text style={styles.verifiedText}>Verified</Text>
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

                          <View style={styles.cardValuationRow}>
                            <Text style={styles.valuationLabel}>Valuation</Text>
                            <Text style={styles.valuationValue}>{price}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* Tab 2: Transaction Ledger */}
          {activeTab === "Transactions" && (
            <View>
              {transactions.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="receipt-outline" size={38} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No transaction history</Text>
                  <Text style={styles.emptySub}>
                    Your deposits, withdrawals, and share purchases will appear
                    here in the immutable ledger.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {transactions.map((tx, i) => (
                    <View key={tx.id || i} style={styles.txCard}>
                      <View style={styles.txIconBox}>
                        <Ionicons
                          name={
                            tx.type === "deposit"
                              ? "arrow-down-circle"
                              : tx.type === "withdrawal"
                              ? "arrow-up-circle"
                              : "swap-horizontal"
                          }
                          size={22}
                          color="#6D28D9"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txTitle}>
                          {tx.title || tx.description || "Vault Transaction"}
                        </Text>
                        <Text style={styles.txDate}>
                          {tx.created_at || "Recent"}
                        </Text>
                      </View>
                      <Text style={styles.txAmount}>
                        {formatGBP(tx.amount)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
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

              <Text style={styles.modalLabel}>Deposit Amount (£)</Text>
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
                    <Text style={styles.presetChipText}>+£{amt}</Text>
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
                <TouchableOpacity onPress={() => setWithdrawModalVisible(false)}>
                  <Feather name="x" size={20} color="#0F172A" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>Withdrawal Amount (£)</Text>
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
                placeholder="UK Bank Account / IBAN"
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
                  <Text style={styles.modalSubmitBtnText}>Process Withdrawal</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Bottom space */}
        <View style={{ height: 110 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
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
  userPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  initialsCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  initialsText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6D28D9",
  },
  userPillName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  addAssetBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6D28D9",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  addAssetBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
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
    paddingHorizontal: 16,
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
});
