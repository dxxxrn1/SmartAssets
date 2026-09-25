// ─── VaultScreen ──────────────────────────────────────────────────────────────
// User-Isolated Portfolio Vault — displays ONLY assets belonging to the logged-in user,
// with working Deposit & Withdraw capabilities and live transaction history.

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
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { useAuth } from "../context/AuthContext";
import {
  getUserVault,
  depositFundsApi,
  withdrawFundsApi,
  getVaultTransactionsApi,
} from "../services/api";
import { Feather, Ionicons } from "@expo/vector-icons";

export default function VaultScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { user, token, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Portfolio");
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
    wholeCount: 0,
    fractionalCount: 0,
    gainText: "+12.4% YTD",
  });

  // Modal states
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("Instant EFT / Card");
  const [depositing, setDepositing] = useState(false);

  // Withdraw form state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("Bank EFT");
  const [bankName, setBankName] = useState("Standard Bank");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState(user?.fullName || "");
  const [cryptoAddress, setCryptoAddress] = useState(user?.walletAddress || "");
  const [withdrawing, setWithdrawing] = useState(false);

  const loadVault = useCallback(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getUserVault(token)
      .then((res) => {
        if (res.success) {
          setHoldings(res.holdings || []);
          if (res.summary) setSummary(res.summary);
          if (res.transactions) setTransactions(res.transactions);
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch user vault:", err.message);
      })
      .finally(() => setLoading(false));

    getVaultTransactionsApi(token)
      .then((res) => {
        if (res?.success && res.transactions) {
          setTransactions(res.transactions);
        }
      })
      .catch(() => {});
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadVault();
    }, [loadVault]),
  );

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount.replace(/[^0-9.]/g, ""));
    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid deposit amount greater than R0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    try {
      setDepositing(true);
      const res = await depositFundsApi({ amount: amt, method: depositMethod }, token);
      if (res?.success) {
        setSummary((prev) => ({
          ...prev,
          availableBalanceNum: res.newBalanceNum,
          availableBalanceFormatted: res.newBalanceFormatted,
          totalValueNum: res.newBalanceNum,
          totalValueFormatted: res.newBalanceFormatted,
        }));
        if (res.transaction) {
          setTransactions((prev) => [res.transaction, ...prev]);
        }
        setDepositModalVisible(false);
        setDepositAmount("");
        const msg = `Deposit of R${amt.toLocaleString()} confirmed! New available balance: ${res.newBalanceFormatted}`;
        Platform.OS === "web" ? alert("✅ " + msg) : Alert.alert("Deposit Confirmed", msg);
      } else {
        throw new Error(res?.error || "Deposit could not be processed.");
      }
    } catch (err) {
      console.error("Deposit error:", err);
      const msg = err.message || "Failed to process deposit.";
      Platform.OS === "web" ? alert("⚠️ " + msg) : Alert.alert("Deposit Notice", msg);
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount.replace(/[^0-9.]/g, ""));
    const available = summary.availableBalanceNum || 0;

    if (isNaN(amt) || amt <= 0) {
      const msg = "Please enter a valid withdrawal amount greater than R0.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Invalid Amount", msg);
      return;
    }

    if (amt > available) {
      const msg = `Insufficient available balance. You requested R${amt.toLocaleString()} but your available balance is ${summary.availableBalanceFormatted || `R${available.toLocaleString()}`}.`;
      Platform.OS === "web" ? alert(msg) : Alert.alert("Insufficient Balance", msg);
      return;
    }

    if (withdrawMethod === "Bank EFT" && !accountNumber.trim()) {
      const msg = "Please provide your bank account number for the EFT payout.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Missing Details", msg);
      return;
    }

    if (withdrawMethod === "Crypto Wallet" && !cryptoAddress.trim()) {
      const msg = "Please provide a valid Ethereum/Web3 address for crypto payout.";
      Platform.OS === "web" ? alert(msg) : Alert.alert("Missing Details", msg);
      return;
    }

    try {
      setWithdrawing(true);
      const payload = {
        amount: amt,
        method: withdrawMethod,
        bankDetails: withdrawMethod === "Bank EFT" ? { bankName, accountNumber, accountHolder } : null,
        walletAddress: withdrawMethod === "Crypto Wallet" ? cryptoAddress : null,
      };

      const res = await withdrawFundsApi(payload, token);
      if (res?.success) {
        setSummary((prev) => ({
          ...prev,
          availableBalanceNum: res.newBalanceNum,
          availableBalanceFormatted: res.newBalanceFormatted,
          totalValueNum: res.newBalanceNum,
          totalValueFormatted: res.newBalanceFormatted,
        }));
        if (res.transaction) {
          setTransactions((prev) => [res.transaction, ...prev]);
        }
        setWithdrawModalVisible(false);
        setWithdrawAmount("");
        const msg = `Withdrawal of R${amt.toLocaleString()} processed! Dispatched via ${withdrawMethod}. New available balance: ${res.newBalanceFormatted}`;
        Platform.OS === "web" ? alert("✅ " + msg) : Alert.alert("Withdrawal Processed", msg);
      } else {
        throw new Error(res?.error || "Withdrawal could not be processed.");
      }
    } catch (err) {
      console.error("Withdrawal error:", err);
      const msg = err.message || "Failed to process withdrawal.";
      Platform.OS === "web" ? alert("⚠️ " + msg) : Alert.alert("Withdrawal Notice", msg);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleMaxWithdraw = () => {
    if (summary.availableBalanceNum) {
      setWithdrawAmount(String(summary.availableBalanceNum));
    }
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#2D0A4E" }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── UNIFIED GRADIENT (Deep Purple -> Midnight) ── */}
        <LinearGradient
          colors={[
            "#a6c2ffff",
            "#4d73d2ff",
            "#0b0f16ff",
            "#111827"
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.unifiedGradient}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.greetingName}>My Vault</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="settings" size={18} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn}>
                <Feather name="bell" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Balance Container */}
          <View style={styles.balanceContainer}>
            <Text style={styles.balanceLabel}>Available Liquid Balance</Text>
            <Text style={styles.balanceValue}>
              {summary.availableBalanceFormatted || summary.totalValueFormatted || "R0"}
            </Text>
            <Text style={styles.balanceGain}>
              Portfolio Assets: {summary.portfolioValueFormatted || "R0"}{" "}
              <Text style={styles.balanceGainPct}>{summary.gainText || "+12.4% YTD"}</Text>
            </Text>
          </View>

          {/* Deposit & Withdraw Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.withdrawBtn}
              onPress={() => setWithdrawModalVisible(true)}
              activeOpacity={0.8}
            >
              <Feather name="arrow-down-left" size={16} color="#FFFFFF" />
              <Text style={styles.withdrawBtnText}>Withdraw</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.depositBtn}
              onPress={() => setDepositModalVisible(true)}
              activeOpacity={0.8}
            >
              <Feather name="arrow-up-right" size={16} color="#0F172A" />
              <Text style={styles.depositBtnText}>Deposit</Text>
            </TouchableOpacity>
          </View>

          {/* ── PORTFOLIO SECTION (Elevated Dark Container) ── */}
          <View style={styles.portfolioSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleDark}>Vault Ledger</Text>
              <TouchableOpacity onPress={() => loadVault()}>
                <Text style={styles.viewAllTextDark}>Refresh</Text>
              </TouchableOpacity>
            </View>

            {/* Custom Pill Tab Navigator */}
            <View style={styles.tabContainer}>
              {["Portfolio", "Shares", "Transactions"].map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                      {tab}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Tab 1: Portfolio (All Whole Assets) */}
            {activeTab === "Portfolio" && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardsScroll}
              >
                {loading ? (
                  <ActivityIndicator size="large" color="#BBF7D0" style={{ margin: 40 }} />
                ) : holdings.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Feather name="shield" size={28} color="#94A3B8" style={{ marginBottom: 8 }} />
                    <Text style={{ color: "#F1F5F9", fontWeight: "700", fontSize: 13 }}>No Assets in Vault</Text>
                    <Text style={{ color: "#94A3B8", fontSize: 11, textAlign: "center", marginTop: 4, paddingHorizontal: 20 }}>
                      Purchase certified luxury goods from the marketplace to lock in your vault.
                    </Text>
                  </View>
                ) : (
                  holdings.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.portfolioAssetCardWhite}
                      activeOpacity={0.9}
                      onPress={() =>
                        navigation.navigate(SCREENS.ASSET_DETAIL, {
                          asset: { ...item, priceNum: item.price_num || 0 },
                        })
                      }
                    >
                      <View style={styles.cardTopRow}>
                        <View style={styles.cardThumbWrapWhite}>
                          <Image source={{ uri: item.image }} style={styles.cardLogo} />
                        </View>
                        <View style={{ justifyContent: "center", flex: 1 }}>
                          <Text style={styles.cardTitleDark} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.cardSub}>{item.category || "Certified Asset"}</Text>
                        </View>
                      </View>
                      <View style={styles.cardBottomRow}>
                        <Text style={styles.cardPrice}>{item.price}</Text>
                        <View style={styles.cardGainPill}>
                          <Feather name={item.positive ? "trending-up" : "trending-down"} size={10} color="#059669" />
                          <Text style={styles.cardGainText}>{item.gain_pct || "+0%"}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}

            {/* Tab 2: Fractional Shares */}
            {activeTab === "Shares" && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardsScroll}
              >
                {holdings.filter((i) => i.asset_type === "fractional").length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Feather name="pie-chart" size={28} color="#94A3B8" style={{ marginBottom: 8 }} />
                    <Text style={{ color: "#F1F5F9", fontWeight: "700", fontSize: 13 }}>No Fractional Shares</Text>
                    <Text style={{ color: "#94A3B8", fontSize: 11, textAlign: "center", marginTop: 4, paddingHorizontal: 20 }}>
                      Buy fractional co-ownership shares in fine art and supercars to trade on-chain.
                    </Text>
                  </View>
                ) : (
                  holdings
                    .filter((i) => i.asset_type === "fractional")
                    .map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.portfolioAssetCardWhite}
                        activeOpacity={0.9}
                      >
                        <View style={styles.cardTopRow}>
                          <View style={styles.cardThumbWrapWhite}>
                            <Image source={{ uri: item.image }} style={styles.cardLogo} />
                          </View>
                          <View style={{ justifyContent: "center", flex: 1 }}>
                            <Text style={styles.cardTitleDark} numberOfLines={1}>{item.name}</Text>
                            <Text style={styles.cardSub}>Fractional Holding</Text>
                          </View>
                        </View>
                        <View style={styles.cardBottomRow}>
                          <Text style={styles.cardPrice}>{item.price}</Text>
                          <View style={styles.cardGainPill}>
                            <Feather name="check" size={10} color="#059669" />
                            <Text style={styles.cardGainText}>Verified Co-Owner</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ))
                )}
              </ScrollView>
            )}

            {/* Tab 3: Transactions (Deposits, Withdrawals, Escrow) */}
            {activeTab === "Transactions" && (
              <View style={styles.transactionsContainer}>
                {transactions.length === 0 ? (
                  <View style={[styles.emptyCard, { width: "100%", height: 130 }]}>
                    <Feather name="file-text" size={24} color="#94A3B8" style={{ marginBottom: 6 }} />
                    <Text style={{ color: "#F1F5F9", fontWeight: "700", fontSize: 13 }}>No Transaction History</Text>
                    <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 2 }}>
                      Make a deposit or withdrawal to track activity.
                    </Text>
                  </View>
                ) : (
                  transactions.slice(0, 6).map((tx) => (
                    <View key={tx.id} style={styles.txRow}>
                      <View style={styles.txLeft}>
                        <View
                          style={[
                            styles.txIconWrap,
                            {
                              backgroundColor: tx.positive
                                ? "rgba(16, 185, 129, 0.15)"
                                : "rgba(56, 189, 248, 0.15)",
                            },
                          ]}
                        >
                          <Feather
                            name={tx.type === "deposit" ? "arrow-up-right" : "arrow-down-left"}
                            size={16}
                            color={tx.positive ? "#10B981" : "#38BDF8"}
                          />
                        </View>
                        <View style={{ gap: 2 }}>
                          <Text style={styles.txTitle}>
                            {tx.title || (tx.type === "deposit" ? "Cash Deposit" : "Cash Withdrawal")}
                          </Text>
                          <Text style={styles.txSub}>
                            {tx.method || "Vault"} · {new Date(tx.createdAt).toLocaleDateString()}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.txRight}>
                        <Text
                          style={[
                            styles.txAmount,
                            { color: tx.positive ? "#10B981" : "#FFFFFF" },
                          ]}
                        >
                          {tx.amountFormatted}
                        </Text>
                        <Text style={styles.txStatus}>{tx.status || "Completed"}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        </LinearGradient>

        {/* ── BOTTOM DARK SECTION (WATCHLIST) ── */}
        <View style={styles.bottomDarkSectionWrapper}>
          <View style={styles.bottomDarkSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleDark}>Market Watchlist</Text>
              <TouchableOpacity>
                <Text style={styles.viewAllTextDark}>View All</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.watchlistContainer}>
              <View style={styles.watchlistItem}>
                <View style={styles.watchLeft}>
                  <View style={styles.watchIconWrap}>
                    <Image
                      source={{
                        uri: "https://images.unsplash.com/photo-1548171915-e79a380a2a4b?q=80&w=300&auto=format&fit=crop",
                      }}
                      style={styles.watchLogo}
                    />
                  </View>
                  <View>
                    <Text style={styles.watchTitle}>Rolex Submariner Date</Text>
                    <Text style={styles.watchSub}>Watches · High Liquidity</Text>
                  </View>
                </View>
                <View style={styles.watchRight}>
                  <Text style={styles.watchPrice}>R245,000</Text>
                  <Text style={[styles.watchGain, { color: "#059669" }]}>+2.4% MoM</Text>
                </View>
              </View>

              <View style={styles.watchlistItem}>
                <View style={styles.watchLeft}>
                  <View style={styles.watchIconWrap}>
                    <Image
                      source={{
                        uri: "https://images.unsplash.com/photo-1614165936126-2ed18e471b3b?q=80&w=300&auto=format&fit=crop",
                      }}
                      style={styles.watchLogo}
                    />
                  </View>
                  <View>
                    <Text style={styles.watchTitle}>Ferrari Testarossa</Text>
                    <Text style={styles.watchSub}>Supercars · Blue Chip</Text>
                  </View>
                </View>
                <View style={styles.watchRight}>
                  <Text style={styles.watchPrice}>R3,450,000</Text>
                  <Text style={[styles.watchGain, { color: "#059669" }]}>+1.1% MoM</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── DEPOSIT MODAL ── */}
      <Modal
        visible={depositModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDepositModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0" }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: "#0F172A" }]}>Deposit Funds</Text>
              <TouchableOpacity
                onPress={() => setDepositModalVisible(false)}
                style={styles.closeBtn}
              >
                <Feather name="x" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: "#475569" }]}>Deposit Amount (ZAR)</Text>
            <View style={[styles.amountInputWrap, { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0" }]}>
              <Text style={[styles.currencyPrefix, { color: "#475569" }]}>R</Text>
              <TextInput
                style={[styles.amountInput, { color: "#0F172A" }]}
                placeholder="0.00"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
                value={depositAmount}
                onChangeText={setDepositAmount}
              />
            </View>

            {/* Quick Chips */}
            <View style={styles.quickChipsRow}>
              {[500, 1000, 5000, 10000].map((val) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.chipBtn, { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" }]}
                  onPress={() => setDepositAmount(String(val))}
                >
                  <Text style={[styles.chipText, { color: "#334155" }]}>+R{val.toLocaleString()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Payment Method Selector */}
            <Text style={[styles.inputLabel, { color: "#475569" }]}>Payment Method</Text>
            <View style={styles.methodSelectorRow}>
              {[
                { id: "Instant EFT / Card", label: "Instant EFT / Card", icon: "credit-card" },
                { id: "Sepolia ETH / Web3", label: "Sepolia ETH / Web3", icon: "link" },
              ].map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.methodBtn,
                    { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" },
                    depositMethod === m.id && { backgroundColor: "#0F172A", borderColor: "#0F172A" },
                  ]}
                  onPress={() => setDepositMethod(m.id)}
                >
                  <Feather
                    name={m.icon}
                    size={14}
                    color={depositMethod === m.id ? "#FFFFFF" : "#64748B"}
                  />
                  <Text
                    style={[
                      styles.methodBtnText,
                      { color: "#475569" },
                      depositMethod === m.id && { color: "#FFFFFF" },
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Summary info */}
            <View style={[styles.modalSummaryBox, { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0" }]}>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: "#475569" }]}>Transaction Fee</Text>
                <Text style={styles.summaryValueFree}>R0.00 (Free)</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: "#475569" }]}>Vault Processing</Text>
                <Text style={[styles.summaryValue, { color: "#0F172A" }]}>Instant Credit</Text>
              </View>
            </View>

            {/* Confirm Button */}
            <TouchableOpacity
              style={[
                styles.modalActionBtn, 
                { 
                  backgroundColor: "#ffffffff", 
                  borderWidth: 1, 
                  borderColor: "#E2E8F0", 
                  shadowOpacity: 0.15, 
                  shadowRadius: 8, 
                  elevation: 4, 
                  shadowOffset: { width: 0, height: 4 },
                  marginTop: 16
                }
              ]}
              onPress={handleDeposit}
              disabled={depositing}
            >
              {depositing ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={[styles.modalActionBtnText, { color: "#0F172A" }]}>Confirm Deposit</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── WITHDRAW MODAL ── */}
      <Modal
        visible={withdrawModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setWithdrawModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: "#000000", borderColor: "rgba(255, 255, 255, 0.08)" }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: "#F1F5F9" }]}>Withdraw Funds</Text>
              <TouchableOpacity
                onPress={() => setWithdrawModalVisible(false)}
                style={styles.closeBtn}
              >
                <Feather name="x" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={[styles.availBanner, { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(255, 255, 255, 0.06)" }]}>
              <Text style={[styles.availBannerLabel, { color: "#94A3B8" }]}>Available to withdraw:</Text>
              <Text style={[styles.availBannerValue, { color: "#F1F5F9" }]}>
                {summary.availableBalanceFormatted || "R0"}
              </Text>
            </View>

            <Text style={[styles.inputLabel, { color: "#94A3B8" }]}>Withdraw Amount (ZAR)</Text>
            <View style={[styles.amountInputWrap, { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(255, 255, 255, 0.06)" }]}>
              <Text style={[styles.currencyPrefix, { color: "#94A3B8" }]}>R</Text>
              <TextInput
                style={[styles.amountInput, { color: "#F1F5F9" }]}
                placeholder="0.00"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
              />
              <TouchableOpacity style={[styles.maxBtn, { backgroundColor: "rgba(255, 255, 255, 0.08)" }]} onPress={handleMaxWithdraw}>
                <Text style={[styles.maxBtnText, { color: "#F1F5F9" }]}>MAX</Text>
              </TouchableOpacity>
            </View>

            {/* Destination Selector */}
            <Text style={[styles.inputLabel, { color: "#94A3B8" }]}>Payout Destination</Text>
            <View style={styles.methodSelectorRow}>
              {[
                { id: "Bank EFT", label: "Bank Account (EFT)", icon: "home" },
                { id: "Crypto Wallet", label: "Crypto Wallet", icon: "cpu" },
              ].map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.methodBtn,
                    { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(255, 255, 255, 0.06)" },
                    withdrawMethod === m.id && { backgroundColor: "#F1F5F9", borderColor: "#F1F5F9" },
                  ]}
                  onPress={() => setWithdrawMethod(m.id)}
                >
                  <Feather
                    name={m.icon}
                    size={14}
                    color={withdrawMethod === m.id ? "#0F172A" : "#94A3B8"}
                  />
                  <Text
                    style={[
                      styles.methodBtnText,
                      { color: "#94A3B8" },
                      withdrawMethod === m.id && { color: "#0F172A" },
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {withdrawMethod === "Bank EFT" ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                <TextInput
                  style={[styles.textInput, { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(255, 255, 255, 0.06)", color: "#F1F5F9" }]}
                  placeholder="Bank Name (e.g. Standard Bank, FNB)"
                  placeholderTextColor="#64748B"
                  value={bankName}
                  onChangeText={setBankName}
                />
                <TextInput
                  style={[styles.textInput, { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(255, 255, 255, 0.06)", color: "#F1F5F9" }]}
                  placeholder="Account Number"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                />
              </View>
            ) : (
              <View style={{ marginTop: 4 }}>
                <TextInput
                  style={[styles.textInput, { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(255, 255, 255, 0.06)", color: "#F1F5F9" }]}
                  placeholder="Ethereum / Sepolia Address (0x...)"
                  placeholderTextColor="#64748B"
                  value={cryptoAddress}
                  onChangeText={setCryptoAddress}
                />
              </View>
            )}

            {/* Confirm Withdrawal Button */}
            <TouchableOpacity
              style={[
                styles.modalActionBtn, 
                { 
                  backgroundColor: "#F1F5F9", 
                  borderColor: "#F1F5F9", 
                  borderWidth: 1, 
                  marginTop: 16 
                }
              ]}
              onPress={handleWithdraw}
              disabled={withdrawing}
            >
              {withdrawing ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={[styles.modalActionBtnText, { color: "#0F172A" }]}>Confirm Withdrawal</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, backgroundColor: "#0F1A2E" },

  unifiedGradient: {
    paddingTop: 10,
    paddingBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  greetingName: { fontSize: 24, fontWeight: "700", color: "#FFFFFF", letterSpacing: -0.4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  balanceContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  balanceLabel: { fontSize: 13, color: "#E2E8F0", fontWeight: "500", marginBottom: 8 },
  balanceValue: { fontSize: 38, fontWeight: "800", color: "#FFFFFF", letterSpacing: -1, marginBottom: 8 },
  balanceGain: { fontSize: 12, color: "#E2E8F0", fontWeight: "600" },
  balanceGainPct: { color: "#10B981", fontWeight: "700" },

  actionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  withdrawBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  withdrawBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  depositBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  depositBtnText: { fontSize: 15, fontWeight: "700", color: "#0F172A" },

  // -- Portfolio Elevated Card --
  portfolioSection: {
    backgroundColor: "#000000",
    marginTop: 20,
    marginHorizontal: 16,
    paddingVertical: 24,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
    minHeight: 250,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  sectionTitleDark: { fontSize: 15, fontWeight: "700", color: "#F1F5F9", marginBottom: 2 },
  viewAllTextDark: { fontSize: 12, fontWeight: "600", color: "#38BDF8" },

  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#0F172A",
    marginHorizontal: 24,
    borderRadius: 999,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 999,
  },
  tabBtnActive: { backgroundColor: "#3B82F6" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#94A3B8" },
  tabTextActive: { color: "#FFFFFF" },

  // -- Horizontal asset cards --
  cardsScroll: {
    paddingHorizontal: 24,
    gap: 16,
  },
  portfolioAssetCardWhite: {
    width: 220,
    height: 140,
    borderRadius: 24,
    padding: 16,
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTopRow: { gap: 10 },
  cardThumbWrapWhite: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cardLogo: { width: 36, height: 36, borderRadius: 8 },
  cardTitleDark: { fontSize: 13, fontWeight: "600", marginBottom: 2, color: "#F1F5F9" },
  cardSub: { fontSize: 11, fontWeight: "500", color: "#94A3B8" },
  cardBottomRow: { gap: 6 },
  cardPrice: { fontSize: 13, fontWeight: "700", color: "#F1F5F9" },
  cardGainPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(52,211,153,0.12)",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardGainText: { fontSize: 9, fontWeight: "700", color: "#34D399" },
  emptyCard: {
    width: 300,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 16,
  },

  // -- Transactions Tab --
  transactionsContainer: {
    paddingHorizontal: 24,
    gap: 12,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.03)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  txLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  txIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  txTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F1F5F9",
  },
  txSub: {
    fontSize: 11,
    color: "#94A3B8",
  },
  txRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: "800",
  },
  txStatus: {
    fontSize: 10,
    color: "#10B981",
    fontWeight: "700",
  },

  // -- Bottom Dark Section (Watchlist) --
  bottomDarkSectionWrapper: {
    backgroundColor: "transparent",
  },
  bottomDarkSection: {
    backgroundColor: "#000000",
    paddingTop: 32,
    paddingBottom: 40,
    minHeight: 260,
  },
  watchlistContainer: {
    paddingHorizontal: 24,
    gap: 20,
  },
  watchlistItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  watchLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  watchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  watchLogo: { width: "100%", height: "100%", borderRadius: 12 },
  watchTitle: { fontSize: 13, fontWeight: "600", color: "#F1F5F9", marginBottom: 2 },
  watchSub: { fontSize: 11, fontWeight: "500", color: "#94A3B8" },
  watchRight: { alignItems: "flex-end", gap: 4 },
  watchPrice: { fontSize: 13, fontWeight: "700", color: "#F1F5F9" },
  watchGain: { fontSize: 9, fontWeight: "700" },

  // -- Modal Styles --
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#0F172A",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  closeBtn: {
    padding: 4,
  },
  availBanner: {
    backgroundColor: "rgba(56, 189, 248, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.2)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  availBannerLabel: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "500",
  },
  availBannerValue: {
    fontSize: 14,
    fontWeight: "800",
    color: "#38BDF8",
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94A3B8",
    marginBottom: 8,
    marginTop: 6,
  },
  amountInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  currencyPrefix: {
    fontSize: 18,
    fontWeight: "700",
    color: "#94A3B8",
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  maxBtn: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  maxBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#38BDF8",
  },
  quickChipsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  chipBtn: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#E2E8F0",
  },
  methodSelectorRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  methodBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 10,
    borderRadius: 12,
  },
  methodBtnActive: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },
  methodBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
  },
  methodBtnTextActive: {
    color: "#FFFFFF",
  },
  textInput: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  modalSummaryBox: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    padding: 12,
    marginVertical: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#94A3B8",
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#F1F5F9",
  },
  summaryValueFree: {
    fontSize: 12,
    fontWeight: "700",
    color: "#10B981",
  },
  modalActionBtn: {
    backgroundColor: "#10B981",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
  },
  modalActionBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
});
