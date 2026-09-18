// ─── CheckoutScreen ───────────────────────────────────────────────────────────
// Multi-rail Payment Gateway:
// 1. MetaMask Web3 Wallet (Sepolia ETH payment with deep-link & on-chain tx verification)
// 2. Credit / Debit Card (Interactive luxury card fields)
// 3. Direct Bank Transfer (Faster Payments / Wire reference)

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
  processPaymentApi,
  getPaymentRatesApi,
  createPaymentIntentApi,
  createStripePaymentMethod,
  confirmStripePayment,
} from '../services/api';
import { SCREENS } from '../constants/navigation';

const PAYMENT_METHODS = [
  { id: 'wallet', label: 'MetaMask Web3', type: 'ionicons', icon: 'wallet-outline', tag: 'Sepolia ETH' },
  { id: 'card', label: 'Credit / Debit Card', type: 'feather', icon: 'credit-card', tag: 'Stripe' },
  { id: 'bank', label: 'Bank Transfer', type: 'ionicons', icon: 'business-outline', tag: 'Stripe Wire' },
];

export default function CheckoutScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const { user, token } = useAuth();
  const asset = route?.params?.asset ?? {};
  const isFractional = route?.params?.isFractional ?? false;
  const isOwner = Boolean(
    user?.id && (user.id === asset.userId || user.id === asset.user_id)
  );

  const totalShares = asset.shares || 100;
  const sharesSold = asset.sharesSold || asset.shares_sold || 0;
  const remainingShares = Math.max(0, totalShares - sharesSold);
  const sharePrice = asset.sharePrice || asset.share_price || Math.round((asset.price_num || 1000) / totalShares);
  const maxAllowedShares = Math.min(remainingShares, Math.max(1, Math.floor(totalShares * 0.25)));

  const [sharesCount, setSharesCount] = useState(1);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  const [selectedPayment, setSelectedPayment] = useState('wallet');
  const [confirmed, setConfirmed] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  // Exchange rates, escrow details, and Stripe config
  const [rates, setRates] = useState({
    zarPerEth: 48000,
    gbpPerEth: 48000,
    escrowAddress: '0xCfD4D4c0c4A5CBeF1632Af0553776dFB72bdFDE9',
    stripePublishableKey: null,
    stripeMode: 'sandbox',
  });

  // Card form state (clear defaults — user must type real details)
  const [cardForm, setCardForm] = useState({
    cardNumber: '',
    cardName: user?.fullName || '',
    expiry: '',
    cvc: '',
  });

  // MetaMask transaction state
  const [walletTxHash, setWalletTxHash] = useState('');

  // Bank reference
  const [bankRef] = useState('SA-' + Math.floor(100000 + Math.random() * 900000));

  const subtotal = isFractional
    ? sharesCount * sharePrice
    : (asset.price_num ?? asset.priceNum ?? 0);
  const platformFee = Math.round(subtotal * 0.025);
  const total = subtotal + platformFee;

  // Calculate Sepolia ETH equivalent (1 ETH ≈ R48,000)
  const ethAmount = (total / (rates.zarPerEth || rates.gbpPerEth || 48000)).toFixed(4);

  useEffect(() => {
    getPaymentRatesApi()
      .then((res) => {
        if (res?.success) {
          setRates({
            zarPerEth: res.zarPerEth || res.gbpPerEth || 48000,
            gbpPerEth: res.zarPerEth || res.gbpPerEth || 48000,
            escrowAddress: res.escrowAddress || '0xCfD4D4c0c4A5CBeF1632Af0553776dFB72bdFDE9',
            stripePublishableKey: res.stripe?.publishableKey || null,
            stripeMode: res.stripe?.mode || 'sandbox',
          });
        }
      })
      .catch(() => {});
  }, []);

  // ── Open MetaMask Mobile App Deep Link ─────────────────────────────────────
  const handleOpenMetaMask = async () => {
    // Standard EIP-681 mobile deep link URL
    const weiValue = BigInt(Math.round(parseFloat(ethAmount) * 1e18)).toString(16);
    const deepLink = `https://metamask.app.link/send/${rates.escrowAddress}?value=${weiValue}`;
    const nativeScheme = `ethereum:${rates.escrowAddress}?value=${weiValue}`;

    try {
      const canOpen = await Linking.canOpenURL(nativeScheme);
      if (canOpen) {
        await Linking.openURL(nativeScheme);
      } else {
        await Linking.openURL(deepLink);
      }
    } catch {
      await Linking.openURL(deepLink);
    }
  };

  // ── Confirm Purchase Handler ───────────────────────────────────────────────
  const handleConfirmPurchase = async () => {
    if (isOwner) {
      Alert.alert(
        'Self-Dealing Prohibited',
        'You listed this collectible. Platform rules prohibit users from buying or investing in items they listed.'
      );
      return;
    }

    if (isFractional && !riskAcknowledged) {
      Alert.alert(
        'Acknowledgment Required',
        'Please review and acknowledge the Fractional Asset Risk Disclosure to proceed with your investment.'
      );
      return;
    }

    // ── Card validation ──
    if (selectedPayment === 'card') {
      const cleanNum = cardForm.cardNumber.replace(/\s+/g, '');
      if (cleanNum.length < 15) {
        Alert.alert('Invalid Card', 'Please enter a valid 15-16 digit card number.');
        return;
      }
      if (!cardForm.expiry || !cardForm.expiry.includes('/')) {
        Alert.alert('Invalid Expiry', 'Please enter expiry in MM/YY format.');
        return;
      }
      if (!cardForm.cvc || cardForm.cvc.length < 3) {
        Alert.alert('Invalid CVC', 'Please enter a valid 3 or 4 digit CVC.');
        return;
      }
    }

    setPurchasing(true);

    try {
      if (selectedPayment === 'card') {
        // ── STRIPE CARD FLOW ──────────────────────────────────────────────
        // Step 1: Create PaymentIntent on backend → get clientSecret
        const intentRes = await createPaymentIntentApi(
          {
            amount: total,
            currency: 'zar',
            assetId: asset.id,
            assetName: asset.name,
          },
          token
        );

        if (!intentRes?.success || !intentRes.clientSecret) {
          Alert.alert('Payment Error', 'Failed to initialize Stripe payment.');
          setPurchasing(false);
          return;
        }

        const { clientSecret, paymentIntentId, publishableKey, mode } = intentRes;

        let stripePaymentMethodId = null;
        let stripeStatus = 'succeeded';

        if (publishableKey && publishableKey.startsWith('pk_')) {
          // Step 2: Tokenize card via Stripe API (card data goes directly to Stripe — never to our server)
          const expParts = cardForm.expiry.split('/');
          let expYear = parseInt(expParts[1], 10);
          if (expYear < 100) expYear += 2000;

          const pm = await createStripePaymentMethod(publishableKey, {
            number: cardForm.cardNumber,
            exp_month: parseInt(expParts[0], 10),
            exp_year: expYear,
            cvc: cardForm.cvc,
            name: cardForm.cardName,
          });

          stripePaymentMethodId = pm.id;

          // Step 3: Confirm payment with Stripe
          const confirmation = await confirmStripePayment(publishableKey, clientSecret, pm.id);
          stripeStatus = confirmation.status;

          if (confirmation.status !== 'succeeded') {
            Alert.alert(
              'Payment Processing',
              `Payment status: ${confirmation.status}. Your order has been recorded and will be fulfilled once payment clears.`
            );
          }
        }

        // Step 4: Record purchase in backend (with Stripe reference)
        const res = await processPaymentApi(
          {
            assetId: asset.id,
            assetName: asset.name,
            assetCategory: asset.category,
            paymentMethod: 'card',
            paymentDetails: {
              stripePaymentIntentId: paymentIntentId,
              stripePaymentMethodId,
              stripeMode: mode,
              cardLast4: cardForm.cardNumber.replace(/\s+/g, '').slice(-4),
              cardName: cardForm.cardName,
            },
            amountGbp: total,
            purchaseType: isFractional ? 'fractional' : 'whole',
            sharesCount: isFractional ? sharesCount : undefined,
            riskAcknowledged: isFractional ? true : undefined,
          },
          token
        );

        if (res?.success) {
          setReceiptData({ ...res.receipt, stripePaymentIntentId: paymentIntentId, stripeMode: mode });
          setConfirmed(true);
        } else {
          Alert.alert('Payment Error', res?.error || 'Could not record payment.');
        }
      } else {
        // ── WALLET / BANK FLOW (unchanged) ──────────────────────────────
        let paymentDetails = {};
        if (selectedPayment === 'wallet') {
          paymentDetails = {
            txHash: walletTxHash.trim() || undefined,
            walletAddress: user?.walletAddress || undefined,
            ethAmount,
          };
        } else if (selectedPayment === 'bank') {
          paymentDetails = {
            reference: bankRef,
            accountName: 'SmartAssets Custody Ltd',
          };
        }

        const res = await processPaymentApi(
          {
            assetId: asset.id,
            assetName: asset.name,
            assetCategory: asset.category,
            paymentMethod: selectedPayment,
            paymentDetails,
            amountGbp: total,
            purchaseType: isFractional ? 'fractional' : 'whole',
            sharesCount: isFractional ? sharesCount : undefined,
            riskAcknowledged: isFractional ? true : undefined,
          },
          token
        );

        if (res?.success) {
          setReceiptData(res.receipt);
          setConfirmed(true);
        } else {
          Alert.alert('Payment Error', res?.error || 'Could not process payment.');
        }
      }
    } catch (err) {
      Alert.alert('Payment Notice', err.message || 'Payment processing issue.');
    } finally {
      setPurchasing(false);
    }
  };

  // ── Success Receipt Screen ─────────────────────────────────────────────────
  if (confirmed) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
        <ScrollView contentContainerStyle={styles.successScroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.successIcon, { backgroundColor: c.greenBg }]}>
            <Ionicons name="checkmark-circle" size={54} color={c.green} />
          </View>

          <Text style={[styles.successTitle, { color: c.warm }]}>Payment Complete!</Text>
          <Text style={[styles.successSub, { color: c.muted }]}>
            {asset.name} has been transferred and added to your personal Vault.
          </Text>

          {/* Receipt Card */}
          <View style={[styles.receiptCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: c.muted }]}>ORDER ID</Text>
              <Text style={[styles.receiptValue, { color: c.warm }]}>{receiptData?.orderId || 'ORD-892104'}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: c.muted }]}>PAYMENT METHOD</Text>
              <Text style={[styles.receiptValue, { color: c.primary }]}>
                {receiptData?.paymentRail || (selectedPayment === 'wallet' ? '🦊 MetaMask (Sepolia ETH)' : selectedPayment === 'card' ? '💳 Stripe Card' : '🏦 Stripe Wire')}
              </Text>
            </View>
            {receiptData?.stripePaymentIntentId ? (
              <View style={styles.receiptRow}>
                <Text style={[styles.receiptLabel, { color: c.muted }]}>STRIPE REF</Text>
                <Text style={[styles.receiptValue, { color: c.warm, fontFamily: 'Courier', fontSize: 11 }]}>
                  {receiptData.stripePaymentIntentId}
                </Text>
              </View>
            ) : null}
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: c.muted }]}>AMOUNT PAID</Text>
              <Text style={[styles.receiptValue, { color: c.warm }]}>R{total.toLocaleString()} {selectedPayment === 'wallet' ? `(${ethAmount} ETH)` : ''}</Text>
            </View>

            {receiptData?.txHash ? (
              <View style={[styles.txBlock, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Ionicons name="shield-checkmark" size={14} color={c.primary} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: c.primary }}>ETHEREUM SEPOLIA RECORD</Text>
                </View>
                <Text style={{ fontSize: 11, fontFamily: 'Courier', color: c.warm }} numberOfLines={1}>
                  {receiptData.txHash}
                </Text>
                {receiptData.etherscanUrl ? (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}
                    onPress={() => Linking.openURL(receiptData.etherscanUrl)}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: c.primary }}>View on Etherscan ↗</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: c.primary }]}
            onPress={() =>
              navigation.navigate(SCREENS.ESCROW_TRACKER, {
                orderId: receiptData?.orderId || 'ORD-892104',
                asset,
              })
            }
          >
            <Text style={styles.doneBtnLabel}>Track Escrow in Real-Time 🔒</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.vaultBtn, { borderColor: c.border }]}
            onPress={() => navigation.popToTop()}
          >
            <Text style={[styles.vaultBtnLabel, { color: c.warm }]}>Go to My Vault</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
      {/* ── Nav ── */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={18} color={c.warm} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: c.warm }]}>
          {isFractional ? 'Fractional Investment' : 'Secure Checkout'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Self-Dealing Warning Banner ── */}
        {isOwner && (
          <View style={[styles.ownerWarning, { backgroundColor: isDark ? '#3A1418' : '#FEE2E2', borderColor: '#EF4444' }]}>
            <Ionicons name="alert-circle" size={22} color="#EF4444" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.ownerWarningTitle, { color: '#EF4444' }]}>Self-Dealing Prohibited</Text>
              <Text style={[styles.ownerWarningSub, { color: isDark ? '#FCA5A5' : '#7F1D1D' }]}>
                You listed this collectible. Platform compliance rules strictly prohibit creators from buying or investing in items they listed.
              </Text>
            </View>
          </View>
        )}

        {/* ── Asset summary ── */}
        <View style={[styles.assetSummary, { backgroundColor: c.card, borderColor: c.border }]}>
          <Image source={{ uri: asset.image }} style={styles.assetThumb} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.assetCategory, { color: c.primary }]}>{asset.category?.toUpperCase()}</Text>
            <Text style={[styles.assetName, { color: c.warm }]} numberOfLines={2}>
              {asset.name}
            </Text>
            <Text style={[styles.assetPrice, { color: c.primary }]}>
              {isFractional ? `R${sharePrice.toLocaleString()} / share` : asset.price}
            </Text>
          </View>
        </View>

        {/* ── Fractional Investment Configurator & Rules ── */}
        {isFractional && (
          <View style={[styles.fractionalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View>
                <Text style={[styles.fractionalHeaderLabel, { color: c.primary }]}>FRACTIONAL CO-OWNERSHIP</Text>
                <Text style={[styles.fractionalHeaderTitle, { color: c.warm }]}>Select Shares to Purchase</Text>
              </View>
              <View style={[styles.sharePriceBadge, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.primary }}>R{sharePrice.toLocaleString()}/sh</Text>
              </View>
            </View>

            {/* Stepper */}
            <View style={[styles.stepperContainer, { backgroundColor: c.cardLight, borderColor: c.border }]}>
              <TouchableOpacity
                style={[styles.stepperBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => setSharesCount((prev) => Math.max(1, prev - 1))}
                disabled={sharesCount <= 1 || isOwner}
              >
                <Feather name="minus" size={18} color={sharesCount <= 1 || isOwner ? c.muted : c.warm} />
              </TouchableOpacity>

              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.stepperNumber, { color: c.primary }]}>{sharesCount} Shares</Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: c.muted }}>
                  {((sharesCount / totalShares) * 100).toFixed(1)}% Co-Ownership
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.stepperBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => setSharesCount((prev) => Math.min(maxAllowedShares, prev + 1))}
                disabled={sharesCount >= maxAllowedShares || isOwner}
              >
                <Feather name="plus" size={18} color={sharesCount >= maxAllowedShares || isOwner ? c.muted : c.warm} />
              </TouchableOpacity>
            </View>

            {/* Applied Investment Rules */}
            <View style={[styles.rulesContainer, { backgroundColor: c.cardLight, borderColor: c.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Feather name="shield" size={14} color={c.primary} />
                <Text style={[styles.rulesTitle, { color: c.warm }]}>Applied Investment Rules</Text>
              </View>
              {[
                { title: 'Minimum Investment', desc: `1 share required (R${sharePrice.toLocaleString()})` },
                { title: 'Anti-Whale Allocation Cap', desc: `Max 25% of total offering (${maxAllowedShares} shares)` },
                { title: 'Available Capacity', desc: `${remainingShares} of ${totalShares} shares open` },
                { title: 'Self-Dealing Prohibition', desc: 'Listing creators barred from participating' },
              ].map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
                  <Ionicons name="checkmark-circle" size={14} color={c.green} style={{ marginTop: 1 }} />
                  <Text style={{ fontSize: 11, color: c.muted, flex: 1, lineHeight: 16 }}>
                    <Text style={{ fontWeight: '700', color: c.warm }}>{r.title}: </Text>
                    {r.desc}
                  </Text>
                </View>
              ))}
            </View>

            {/* Risk Disclosure Acknowledgment */}
            <TouchableOpacity
              style={[
                styles.riskBox,
                {
                  backgroundColor: riskAcknowledged ? c.primaryBg : c.cardLight,
                  borderColor: riskAcknowledged ? c.primary : c.border,
                },
              ]}
              onPress={() => !isOwner && setRiskAcknowledged(!riskAcknowledged)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={riskAcknowledged ? "checkbox" : "square-outline"}
                size={20}
                color={riskAcknowledged ? c.primary : c.muted}
              />
              <Text style={[styles.riskText, { color: c.warm }]}>
                I acknowledge the <Text style={{ color: c.primary, fontWeight: '700' }}>Fractional Asset Custody & Risk Agreement</Text>. Collectible values may fluctuate.
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Price breakdown ── */}
        <View style={[styles.priceBreakdown, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.breakdownTitle, { color: c.warm }]}>
            {isFractional ? 'Investment Summary' : 'Order Summary'}
          </Text>
          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, { color: c.muted }]}>
              {isFractional ? `${sharesCount} Shares (${((sharesCount / totalShares) * 100).toFixed(1)}%)` : 'Asset Price'}
            </Text>
            <Text style={[styles.breakdownValue, { color: c.warm }]}>R{subtotal.toLocaleString()}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, { color: c.muted }]}>Escrow & Custody Fee (2.5%)</Text>
            <Text style={[styles.breakdownValue, { color: c.warm }]}>R{platformFee.toLocaleString()}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.breakdownRow}>
            <Text style={[styles.totalLabel, { color: c.warm }]}>Total</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.totalValue, { color: c.primary }]}>R{total.toLocaleString()}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: c.muted, marginTop: 2 }}>
                ≈ {ethAmount} Sepolia ETH
              </Text>
            </View>
          </View>
        </View>

        {/* ── Payment Method Selector ── */}
        <Text style={[styles.sectionTitle, { color: c.warm }]}>Select Payment Rail</Text>
        <View style={styles.methodsRow}>
          {PAYMENT_METHODS.map((method) => {
            const isSelected = selectedPayment === method.id;
            return (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodCard,
                  {
                    backgroundColor: isSelected ? c.primaryBg : c.card,
                    borderColor: isSelected ? c.primary : c.border,
                  },
                ]}
                onPress={() => setSelectedPayment(method.id)}
              >
                {method.type === 'feather' ? (
                  <Feather name={method.icon} size={20} color={isSelected ? c.primary : c.muted} />
                ) : (
                  <Ionicons name={method.icon} size={20} color={isSelected ? c.primary : c.muted} />
                )}
                <Text style={[styles.methodLabel, { color: isSelected ? c.primary : c.warm }]}>
                  {method.label}
                </Text>
                <Text style={[styles.methodTag, { color: c.muted }]}>{method.tag}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── 1. MetaMask Web3 Tab ── */}
        {selectedPayment === 'wallet' && (
          <View style={[styles.paymentDetailCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="wallet-outline" size={20} color={c.primary} />
                <Text style={[styles.detailTitle, { color: c.warm }]}>MetaMask Web3 Escrow</Text>
              </View>
              <View style={[styles.badgePill, { backgroundColor: c.greenBg }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.green }}>Sepolia Testnet</Text>
              </View>
            </View>

            <View style={[styles.ethAmountBox, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
              <Text style={[styles.ethBoxLabel, { color: c.primary }]}>AMOUNT TO SEND</Text>
              <Text style={[styles.ethBoxValue, { color: c.warm }]}>{ethAmount} ETH</Text>
              <Text style={{ fontSize: 11, color: c.muted }}>Rate: 1 ETH = R{(rates.zarPerEth || rates.gbpPerEth || 48000).toLocaleString()}</Text>
            </View>

            {user?.walletAddress ? (
              <View style={styles.connectedRow}>
                <Text style={[styles.connectedLabel, { color: c.muted }]}>Paying From:</Text>
                <Text style={[styles.connectedAddress, { color: c.primary }]}>
                  {user.walletAddress.substring(0, 6)}...{user.walletAddress.slice(-4)} (Connected)
                </Text>
              </View>
            ) : null}

            {/* Pay with MetaMask Deep Link Button */}
            <TouchableOpacity
              style={[styles.metaMaskBtn, { backgroundColor: '#F6851B' }]}
              onPress={handleOpenMetaMask}
            >
              <Ionicons name="open-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.metaMaskBtnText}>Open in MetaMask App 🦊</Text>
            </TouchableOpacity>

            {/* Optional Tx Hash Verification Input */}
            <View style={{ marginTop: 12 }}>
              <Text style={[styles.inputLabel, { color: c.muted }]}>
                TRANSACTION HASH (OPTIONAL / AUTO-VERIFIED)
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                placeholder="0x... (Paste your MetaMask tx hash)"
                placeholderTextColor={c.muted}
                value={walletTxHash}
                onChangeText={setWalletTxHash}
                autoCapitalize="none"
              />
            </View>
          </View>
        )}

        {/* ── 2. Credit Card Tab ── */}
        {selectedPayment === 'card' && (
          <View style={[styles.paymentDetailCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="credit-card" size={20} color={c.primary} />
                <Text style={[styles.detailTitle, { color: c.warm }]}>Credit / Debit Card</Text>
              </View>
              <View style={{ backgroundColor: '#635BFF20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#635BFF40' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#635BFF' }}>⚡ Stripe API</Text>
              </View>
            </View>

            <View style={{ gap: 10 }}>
              <View>
                <Text style={[styles.inputLabel, { color: c.muted }]}>CARD NUMBER</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                  value={cardForm.cardNumber}
                  onChangeText={(v) => setCardForm({ ...cardForm, cardNumber: v })}
                  keyboardType="numeric"
                />
              </View>

              <View>
                <Text style={[styles.inputLabel, { color: c.muted }]}>CARDHOLDER NAME</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                  value={cardForm.cardName}
                  onChangeText={(v) => setCardForm({ ...cardForm, cardName: v })}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: c.muted }]}>EXPIRES</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                    value={cardForm.expiry}
                    onChangeText={(v) => setCardForm({ ...cardForm, expiry: v })}
                    placeholder="MM/YY"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: c.muted }]}>CVC</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                    value={cardForm.cvc}
                    onChangeText={(v) => setCardForm({ ...cardForm, cvc: v })}
                    keyboardType="numeric"
                    secureTextEntry
                  />
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── 3. Bank Transfer Tab ── */}
        {selectedPayment === 'bank' && (
          <View style={[styles.paymentDetailCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="business-outline" size={20} color={c.primary} />
                <Text style={[styles.detailTitle, { color: c.warm }]}>Bank Wire Details</Text>
              </View>
              <View style={{ backgroundColor: '#635BFF20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#635BFF40' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#635BFF' }}>🏦 Stripe Wire</Text>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              {[
                ['BENEFICIARY', 'SmartAssets Custody SA (Pty) Ltd'],
                ['BANK', 'First National Bank (FNB) / Standard Bank'],
                ['BRANCH CODE', '250655'],
                ['ACCOUNT NUMBER', '62890192841'],
                ['PAYMENT REFERENCE', bankRef],
              ].map(([lbl, val]) => (
                <View key={lbl} style={styles.wireRow}>
                  <Text style={[styles.wireLabel, { color: c.muted }]}>{lbl}</Text>
                  <Text style={[styles.wireValue, { color: c.warm }]}>{val}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Escrow notice ── */}
        <View style={[styles.escrowNotice, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
          <Text style={[styles.escrowText, { color: c.primary }]}>
            🔒 SmartAssets Smart Contract Escrow guarantees funds are securely locked on-chain until the physical asset is transferred and verified.
          </Text>
        </View>
      </ScrollView>

      {/* ── Confirm CTA ── */}
      <SafeAreaView edges={['bottom']} style={[styles.cta, { backgroundColor: c.vault, borderTopColor: c.border }]}>
        <TouchableOpacity
          style={[
            styles.confirmBtn,
            {
              backgroundColor: isOwner || (isFractional && !riskAcknowledged) ? c.cardLight : c.primary,
              borderWidth: isOwner ? 1 : 0,
              borderColor: isOwner ? '#EF4444' : c.border,
            },
          ]}
          onPress={handleConfirmPurchase}
          disabled={purchasing || isOwner}
          activeOpacity={0.85}
        >
          {purchasing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text
              style={[
                styles.confirmBtnLabel,
                { color: isOwner || (isFractional && !riskAcknowledged) ? c.muted : '#FFFFFF' },
              ]}
            >
              {isOwner
                ? 'Self-Dealing Prohibited (Owner)'
                : isFractional && !riskAcknowledged
                ? 'Acknowledge Risk Disclosure'
                : selectedPayment === 'wallet'
                ? `Confirm ${ethAmount} ETH ${isFractional ? 'Investment' : 'Payment'}`
                : `Confirm R${total.toLocaleString()} ${isFractional ? 'Investment' : 'Payment'}`}
            </Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  assetSummary: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
  assetThumb: { width: 64, height: 64, borderRadius: 14 },
  assetCategory: { fontSize: 10, fontWeight: '700', marginBottom: 2 },
  assetName: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  assetPrice: { fontSize: 14, fontWeight: '800', marginTop: 3 },
  priceBreakdown: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 10 },
  breakdownTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { fontSize: 13 },
  breakdownValue: { fontSize: 13, fontWeight: '600' },
  divider: { height: 1, marginVertical: 4 },
  totalLabel: { fontSize: 14, fontWeight: '700' },
  totalValue: { fontSize: 18, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  methodsRow: { flexDirection: 'row', gap: 8 },
  methodCard: {
    flex: 1,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 4,
  },
  methodLabel: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  methodTag: { fontSize: 9, fontWeight: '600' },
  paymentDetailCard: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 },
  detailTitle: { fontSize: 14, fontWeight: '700' },
  badgePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  ethAmountBox: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 2,
  },
  ethBoxLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  ethBoxValue: { fontSize: 24, fontWeight: '800' },
  connectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  connectedLabel: { fontSize: 12 },
  connectedAddress: { fontSize: 12, fontWeight: '700' },
  metaMaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
  },
  metaMaskBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  inputLabel: { fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
  },
  wireRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  wireLabel: { fontSize: 10, fontWeight: '700' },
  wireValue: { fontSize: 13, fontWeight: '700', fontFamily: 'Courier' },
  escrowNotice: { padding: 14, borderRadius: 14, borderWidth: 1 },
  escrowText: { fontSize: 12, lineHeight: 18 },
  cta: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1 },
  confirmBtn: { borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  confirmBtnLabel: { fontWeight: '700', fontSize: 15 },
  successScroll: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40, gap: 16 },
  successIcon: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  successSub: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  receiptCard: { width: '100%', padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  receiptLabel: { fontSize: 10, fontWeight: '700' },
  receiptValue: { fontSize: 13, fontWeight: '700' },
  txBlock: { padding: 12, borderRadius: 14, borderWidth: 1 },
  doneBtn: { width: '100%', borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  doneBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  vaultBtn: {
    width: '100%',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 8,
  },
  vaultBtnLabel: { fontSize: 14, fontWeight: '700' },
  ownerWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 10,
  },
  ownerWarningTitle: { fontSize: 13, fontWeight: '700' },
  ownerWarningSub: { fontSize: 11, lineHeight: 16 },
  fractionalCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
  },
  fractionalHeaderLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  fractionalHeaderTitle: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  sharePriceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperNumber: { fontSize: 18, fontWeight: '800' },
  rulesContainer: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  rulesTitle: { fontSize: 12, fontWeight: '700' },
  riskBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  riskText: { fontSize: 11, lineHeight: 16, flex: 1 },
});
