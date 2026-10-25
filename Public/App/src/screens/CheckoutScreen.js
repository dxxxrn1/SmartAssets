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
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { ethers } from 'ethers';
import { useAuth } from '../context/AuthContext';
import { useLinkedWallet } from '../hooks/useLinkedWallet';
import KycGatekeeperModal from '../components/KycGatekeeperModal';
import InstallMetaMaskModal from '../components/InstallMetaMaskModal';
import { isMetaMaskAppInstalled } from '../services/mobileWalletService';
import {
  processPaymentApi,
  getPaymentRatesApi,
  createPaymentIntentApi,
  createStripePaymentMethod,
  confirmStripePayment,
  resolveImageUrl,
} from '../services/api';
import { SCREENS } from '../constants/navigation';
import storage, { STORAGE_KEYS } from '../utils/storage';

const CANVAS_MESH = [
  '#e4e0ffff', // Soft luminous lavender
  '#e0daffff', // Soft purple aura
  '#f5dfefff', // Soft lilac-pink
  '#fff5efff', // Soft peach aura
  '#ffffffff', // Ambient cream
];

const PAYMENT_METHODS = [
  { id: 'wallet', label: 'MetaMask Web3', type: 'ionicons', icon: 'wallet-outline', tag: 'Sepolia ETH' },
  { id: 'card', label: 'Credit / Debit Card', type: 'feather', icon: 'credit-card', tag: 'Stripe' },
  { id: 'bank', label: 'Bank Transfer', type: 'ionicons', icon: 'business-outline', tag: 'UK Wire / FPS' },
];

export default function CheckoutScreen({ navigation, route }) {
  const { user, token } = useAuth();
  const { linkedWallet, isMismatch, activeMetaMaskAccount, verifyTransactionWallet } = useLinkedWallet();
  const [kycGatekeeperVisible, setKycGatekeeperVisible] = useState(false);
  const [installModalVisible, setInstallModalVisible] = useState(false);
  const asset = route?.params?.asset ?? {};
  const isFractional = route?.params?.isFractional ?? false;
  const isOwner = Boolean(
    user?.id && (user.id === asset.userId || user.id === asset.user_id)
  );

  const totalShares = Number(
    asset.shares || asset.total_shares || asset.totalShares || 100
  );
  const rawSharesSold = Number(asset.sharesSold ?? asset.shares_sold ?? 0);
  const sharesSold = rawSharesSold < totalShares ? rawSharesSold : Math.round(totalShares * 0.45);
  const remainingShares = Math.max(1, totalShares - sharesSold);

  const rawSharePrice = asset.sharePrice || asset.share_price;
  const sharePrice =
    typeof rawSharePrice === 'number'
      ? rawSharePrice
      : parseFloat(String(rawSharePrice || '').replace(/[^0-9.-]+/g, '')) ||
        Math.round(
          (Number(asset.price_num) ||
            parseFloat(String(asset.price || '').replace(/[^0-9.-]+/g, '')) ||
            1000) / totalShares
        );

  const antiWhaleCap = Math.max(5, Math.floor(totalShares * 0.25));
  const maxAllowedShares = Math.max(1, Math.min(remainingShares, antiWhaleCap));

  const [sharesCount, setSharesCount] = useState(1);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  const [selectedPayment, setSelectedPayment] = useState('wallet');
  const [confirmed, setConfirmed] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  // Exchange rates, escrow details, and Stripe config
  const [rates, setRates] = useState({
    zarPerEth: 48000,
    gbpPerEth: 2500,
    escrowAddress: '0xCfD4D4c0c4A5CBeF1632Af0553776dFB72bdFDE9',
    stripePublishableKey: null,
    stripeMode: 'sandbox',
  });

  // Card form state
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

  const rawAssetPrice =
    asset.price_num ??
    asset.priceNum ??
    (typeof asset.price === 'number'
      ? asset.price
      : parseFloat(String(asset.price || '').replace(/[^0-9.-]+/g, '')) || 0);

  const subtotal = isFractional
    ? sharesCount * sharePrice
    : rawAssetPrice;
  const platformFee = Math.round(subtotal * 0.025);
  const total = subtotal + platformFee;

  // Calculate Sepolia ETH equivalent (1 ETH ≈ R48,000)
  const ethRate = rates.zarPerEth || rates.gbpPerEth || 48000;
  const ethAmount = (total / ethRate).toFixed(4);

  useEffect(() => {
    getPaymentRatesApi()
      .then((res) => {
        if (res?.success) {
          setRates({
            zarPerEth: res.zarPerEth || 48000,
            gbpPerEth: res.gbpPerEth || res.zarPerEth || 2500,
            escrowAddress: res.escrowAddress || '0xCfD4D4c0c4A5CBeF1632Af0553776dFB72bdFDE9',
            stripePublishableKey: res.stripe?.publishableKey || null,
            stripeMode: res.stripe?.mode || 'sandbox',
          });
        }
      })
      .catch(() => {});
  }, []);

  // ── Open MetaMask Mobile App Deep Link with deposit() calldata ────────────
  const handleOpenMetaMask = async () => {
    const isInstalled = await isMetaMaskAppInstalled();
    if (!isInstalled && Platform.OS !== 'web') {
      setInstallModalVisible(true);
      return;
    }

    const weiValue = BigInt(Math.round(parseFloat(ethAmount) * 1e18)).toString(16);
    const clientOrderId = Math.floor(100000 + Math.random() * 900000);
    const sellerAddr = asset?.seller_address || asset?.user_wallet || rates.escrowAddress;
    const assetTokenId = Math.abs(parseInt(String(asset?.token_id || asset?.tokenId || 1).replace(/[^0-9]/g, ''), 10)) || 1;

    let calldata = '';
    try {
      const escrowIface = new ethers.Interface([
        'function deposit(uint256 orderId, address seller, uint256 assetTokenId) payable'
      ]);
      calldata = escrowIface.encodeFunctionData('deposit', [clientOrderId, sellerAddr, assetTokenId]);
    } catch (_e) {}

    const deepLink = calldata
      ? `https://metamask.app.link/dapp/${rates.escrowAddress}?data=${calldata}&value=${weiValue}`
      : `https://metamask.app.link/send/${rates.escrowAddress}?value=${weiValue}`;
    const nativeScheme = calldata
      ? `ethereum:${rates.escrowAddress}?data=${calldata}&value=${weiValue}`
      : `ethereum:${rates.escrowAddress}?value=${weiValue}`;

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

  // ── Record Fractional Holding Helper ──────────────────────────────────────
  const recordFractionalHolding = async () => {
    if (!isFractional) return;
    try {
      const existingFractions = (await storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS)) || [];
      const matchIdx = existingFractions.findIndex(
        (f) =>
          String(f.id) === String(asset.id) ||
          (f.name && asset.name && f.name.toLowerCase() === asset.name.toLowerCase())
      );
      let updatedFractions = [];
      if (matchIdx >= 0) {
        updatedFractions = [...existingFractions];
        const prev = updatedFractions[matchIdx];
        const updatedShares = (prev.sharesOwned || 0) + sharesCount;
        const updatedStake = (prev.myStake || 0) + subtotal;
        updatedFractions[matchIdx] = {
          ...prev,
          sharesOwned: updatedShares,
          myStake: updatedStake,
          myStakeFormatted: `R${updatedStake.toLocaleString('en-ZA')}`,
        };
      } else {
        const newFractional = {
          id: asset.id || `fraction-${Date.now()}`,
          name: asset.name,
          category: asset.category || 'Luxury Item',
          image: primaryImage,
          sharesOwned: sharesCount,
          sharePrice: sharePrice,
          sharePriceFormatted: `R${sharePrice.toLocaleString('en-ZA')}/sh`,
          myStake: subtotal,
          myStakeFormatted: `R${subtotal.toLocaleString('en-ZA')}`,
          returnPct: '+12.4% Return',
          returnType: 'positive',
          poolValuation: `R${(sharePrice * totalShares).toLocaleString('en-ZA')}`,
          totalShares: totalShares,
          fundingPct: Math.min(100, Math.round(((sharesSold + sharesCount) / totalShares) * 100)),
        };
        updatedFractions = [newFractional, ...existingFractions];
      }
      await storage.setJSON(STORAGE_KEYS.CO_OWNED_ASSETS, updatedFractions);
    } catch (_) {}
  };

  // ── Confirm Purchase Handler ───────────────────────────────────────────────
  const handleConfirmPurchase = async () => {
    if (user && (user.kycStatus !== 'verified' || user.isSuspended)) {
      setKycGatekeeperVisible(true);
      return;
    }
    if (isFractional && !riskAcknowledged) {
      setRiskAcknowledged(true);
      return;
    }

    // MetaMask Web3 Linked Wallet Validation
    if (selectedPayment === 'wallet') {
      const isWalletValid = await verifyTransactionWallet();
      if (!isWalletValid) {
        return;
      }
    }

    // Card validation
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
        const publishableKey = rates.stripePublishableKey;
        const mode = rates.stripeMode;

        let paymentIntentId = null;
        let stripePaymentMethodId = null;

        // Initialize PaymentIntent
        const intentRes = await createPaymentIntentApi(
          {
            amountGbp: total,
            assetId: asset.id,
            assetName: asset.name,
            currency: 'zar',
          },
          token
        );

        if (!intentRes?.success || !intentRes.clientSecret) {
          throw new Error(intentRes?.error || 'Failed to initialize card payment session.');
        }

        const clientSecret = intentRes.clientSecret;
        paymentIntentId = intentRes.paymentIntentId;

        if (publishableKey && !paymentIntentId.startsWith('pi_sandbox_')) {
          const expParts = cardForm.expiry.split('/');
          let expYear = parseInt(expParts[1], 10);
          if (expYear < 100) expYear += 2000;

          const pm = await createStripePaymentMethod(publishableKey, {
            number: cardForm.cardNumber.replace(/\s+/g, ''),
            exp_month: parseInt(expParts[0], 10),
            exp_year: expYear,
            cvc: cardForm.cvc,
            name: cardForm.cardName,
          });

          stripePaymentMethodId = pm.id;

          const confirmation = await confirmStripePayment(publishableKey, clientSecret, pm.id);
          if (confirmation.status !== 'succeeded') {
            throw new Error(`Card payment not completed (Status: ${confirmation.status}). Please check card details or funds.`);
          }
        }

        const res = await processPaymentApi(
          {
            assetId: asset.id,
            assetName: asset.name,
            assetCategory: asset.category,
            paymentMethod: 'card',
            paymentDetails: {
              paymentIntentId,
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
          await recordFractionalHolding();
          setReceiptData({ ...res.receipt, stripePaymentIntentId: paymentIntentId, stripeMode: mode });
          setConfirmed(true);
        } else {
          Alert.alert('Payment Error', res?.error || 'Could not record payment.');
        }
      } else {
        // WALLET / BANK FLOW
        let paymentDetails = {};
        if (selectedPayment === 'wallet') {
          const trimmedTxHash = walletTxHash.trim();
          if (!trimmedTxHash) {
            Alert.alert(
              'Transaction Hash Required',
              'Please open MetaMask, send the escrow deposit transaction, and paste the transaction hash (0x...) to confirm payment.'
            );
            setPurchasing(false);
            return;
          }
          paymentDetails = {
            txHash: trimmedTxHash,
            walletAddress: linkedWallet || user?.walletAddress || user?.wallet_address || undefined,
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
          await recordFractionalHolding();
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

  const primaryImage = resolveImageUrl(
    asset.image || asset.primary_image || (asset.images && asset.images[0])
  );

  // ── Success Receipt Screen ─────────────────────────────────────────────────
  if (confirmed) {
    return (
      <View style={styles.root}>
        {/* ── Background Mesh Gradient (Matches HomeScreen.js) ── */}
        <LinearGradient
          colors={CANVAS_MESH}
          locations={[0, 0.22, 0.52, 0.78, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
          <ScrollView contentContainerStyle={styles.successScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={64} color="#10B981" />
            </View>

            <Text style={styles.successTitle}>
              {isFractional ? 'Investment Confirmed!' : 'Purchase Complete!'}
            </Text>
            <Text style={styles.successSub}>
              {isFractional
                ? `${sharesCount} shares (${((sharesCount / totalShares) * 100).toFixed(1)}% ownership) in ${asset.name} registered to your Vault.`
                : `${asset.name} has been secured and transferred to your personal Vault.`}
            </Text>

            {/* Receipt Card */}
            <View style={styles.receiptCard}>
              <View style={styles.receiptHeaderRow}>
                <Text style={styles.receiptCardTitle}>OFFICIAL SETTLEMENT RECEIPT</Text>
                <View style={styles.settledBadge}>
                  <Text style={styles.settledBadgeText}>SETTLED</Text>
                </View>
              </View>

              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>ORDER ID</Text>
                <Text style={styles.receiptValue}>{receiptData?.orderId || 'ORD-892104'}</Text>
              </View>

              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>PAYMENT RAIL</Text>
                <Text style={styles.receiptRailValue}>
                  {receiptData?.paymentRail ||
                    (selectedPayment === 'wallet'
                      ? 'MetaMask (Sepolia ETH)'
                      : selectedPayment === 'card'
                      ? 'Stripe Card Payment'
                      : 'UK Faster Payments / Wire')}
                </Text>
              </View>

              {receiptData?.stripePaymentIntentId ? (
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>STRIPE REF</Text>
                  <Text style={styles.receiptMonoValue}>
                    {receiptData.stripePaymentIntentId}
                  </Text>
                </View>
              ) : null}

              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>AMOUNT PAID</Text>
                <Text style={styles.receiptTotalPaid}>
                  R{total.toLocaleString()} {selectedPayment === 'wallet' ? `(${ethAmount} ETH)` : ''}
                </Text>
              </View>

              {receiptData?.txHash ? (
                <View style={styles.txBlock}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Ionicons name="shield-checkmark" size={14} color="#6C47FF" />
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#6C47FF' }}>
                      ETHEREUM SEPOLIA RECORD
                    </Text>
                  </View>
                  <Text style={styles.txMonoText} numberOfLines={1}>
                    {receiptData.txHash}
                  </Text>
                  {receiptData.etherscanUrl ? (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}
                      onPress={() => Linking.openURL(receiptData.etherscanUrl)}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#6C47FF' }}>
                        View on Sepolia Etherscan
                      </Text>
                      <Feather name="external-link" size={11} color="#6C47FF" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() =>
                navigation.navigate(SCREENS.ESCROW_TRACKER, {
                  orderId: receiptData?.orderId || 'ORD-892104',
                  asset,
                })
              }
              activeOpacity={0.85}
            >
              <Feather name="shield" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.doneBtnLabel}>Track Escrow in Real-Time</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.vaultBtn}
              onPress={() => navigation.popToTop()}
              activeOpacity={0.8}
            >
              <Text style={styles.vaultBtnLabel}>Go to My Vault</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Background Mesh Gradient (Matches HomeScreen.js) ── */}
      <LinearGradient
        colors={CANVAS_MESH}
        locations={[0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        {/* ── Top Header Bar / Breadcrumb ── */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Feather name="arrow-left" size={18} color="#0F172A" />
          </TouchableOpacity>

          <View style={styles.breadcrumbWrap}>
            <Text style={styles.breadcrumbMuted}>Marketplace</Text>
            <Feather
              name="chevron-right"
              size={13}
              color="#94A3B8"
              style={{ marginHorizontal: 4 }}
            />
            <Text style={styles.breadcrumbActive}>
              {isFractional ? 'Fractional Investment' : 'Secure Checkout'}
            </Text>
          </View>

          <View style={styles.escrowShieldIcon}>
            <Ionicons name="lock-closed" size={16} color="#10B981" />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* ── 1. Asset Spotlight Card ── */}
          <View style={styles.assetSummaryCard}>
            <Image source={{ uri: primaryImage }} style={styles.assetThumb} resizeMode="cover" />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.categoryPill}>
                <Text style={styles.categoryPillText}>
                  {(asset.category || 'COLLECTIBLE').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.assetName} numberOfLines={2}>
                {asset.name || 'Authentic Collectible'}
              </Text>
              <Text style={styles.assetPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {isFractional
                  ? `R${sharePrice.toLocaleString()} / share`
                  : `R${subtotal.toLocaleString()}`}
              </Text>
            </View>
          </View>

          {/* ── 2. Fractional Investment Configurator & Rules ── */}
          {isFractional && (
            <View style={styles.fractionalCard}>
              <View style={styles.fractionalHeaderRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.fractionalHeaderLabel}>FRACTIONAL CO-OWNERSHIP</Text>
                  <Text style={styles.fractionalHeaderTitle}>Select Shares to Purchase</Text>
                </View>
                <View style={styles.sharePriceBadge}>
                  <Text style={styles.sharePriceBadgeText}>
                    R{sharePrice.toLocaleString()}/sh
                  </Text>
                </View>
              </View>

              {/* Stepper */}
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={[styles.stepperBtn, sharesCount <= 1 && styles.stepperBtnDisabled]}
                  onPress={() => setSharesCount((prev) => Math.max(1, prev - 1))}
                  disabled={sharesCount <= 1}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="minus"
                    size={20}
                    color={sharesCount <= 1 ? '#CBD5E1' : '#0F172A'}
                  />
                </TouchableOpacity>

                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.stepperNumber}>{sharesCount} Shares</Text>
                  <Text style={styles.stepperSub}>
                    {((sharesCount / totalShares) * 100).toFixed(1)}% Co-Ownership
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.stepperBtn,
                    sharesCount >= maxAllowedShares && styles.stepperBtnDisabled,
                  ]}
                  onPress={() => setSharesCount((prev) => Math.min(maxAllowedShares, prev + 1))}
                  disabled={sharesCount >= maxAllowedShares}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="plus"
                    size={20}
                    color={sharesCount >= maxAllowedShares ? '#CBD5E1' : '#0F172A'}
                  />
                </TouchableOpacity>
              </View>

              {/* Quick Select Preset Share Chips */}
              <View style={styles.presetsRow}>
                {[1, 5, 10, maxAllowedShares]
                  .filter((amt, idx, arr) => arr.indexOf(amt) === idx && amt <= maxAllowedShares && amt > 0)
                  .map((amt) => {
                    const isSelected = sharesCount === amt;
                    return (
                      <TouchableOpacity
                        key={amt}
                        style={[styles.presetChip, isSelected && styles.presetChipActive]}
                        onPress={() => setSharesCount(amt)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                          {amt === maxAllowedShares && amt > 10 ? `Max (${amt} sh)` : `${amt} ${amt === 1 ? 'Share' : 'Shares'}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>

              {/* Applied Investment Rules */}
              <View style={styles.rulesContainer}>
                <View style={styles.rulesTitleRow}>
                  <Feather name="shield" size={13} color="#6C47FF" />
                  <Text style={styles.rulesTitle}>Applied Investment Rules</Text>
                </View>
                {[
                  { title: 'Minimum Investment', desc: `1 share required (R${sharePrice.toLocaleString()})` },
                  { title: 'Anti-Whale Allocation Cap', desc: `Max 25% of total offering (${maxAllowedShares} shares)` },
                  { title: 'Available Capacity', desc: `${remainingShares} of ${totalShares} shares open` },
                  { title: 'Escrow Guarantee', desc: 'Protected by SmartAssets Sepolia smart contracts' },
                ].map((rule, idx) => (
                  <View key={idx} style={styles.ruleRow}>
                    <Ionicons name="checkmark-circle" size={15} color="#10B981" style={{ marginRight: 6 }} />
                    <Text style={styles.ruleText}>
                      <Text style={styles.ruleTextBold}>{rule.title}: </Text>
                      {rule.desc}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Risk Agreement Checkbox */}
              <TouchableOpacity
                style={styles.riskBox}
                onPress={() => setRiskAcknowledged(!riskAcknowledged)}
                activeOpacity={0.8}
              >
                <View style={[styles.checkbox, riskAcknowledged && styles.checkboxActive]}>
                  {riskAcknowledged && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                </View>
                <Text style={styles.riskText}>
                  I acknowledge the{' '}
                  <Text style={styles.riskLink}>Fractional Asset Custody & Risk Agreement</Text>. Collectible
                  values may fluctuate.
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 3. Investment / Order Summary ── */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {isFractional ? 'Investment Summary' : 'Order Summary'}
            </Text>

            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel} numberOfLines={1}>
                {isFractional
                  ? `${sharesCount} Shares (${((sharesCount / totalShares) * 100).toFixed(1)}%)`
                  : 'Asset Price'}
              </Text>
              <Text
                style={styles.breakdownValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                R{subtotal.toLocaleString()}
              </Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel} numberOfLines={1}>Escrow & Custody Fee (2.5%)</Text>
              <Text
                style={styles.breakdownValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                R{platformFee.toLocaleString()}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.breakdownRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <View style={{ alignItems: 'flex-end', flex: 1, paddingLeft: 12 }}>
                <Text
                  style={styles.totalValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  R{total.toLocaleString()}
                </Text>
                <Text style={styles.totalEthSub}>≈ {ethAmount} Sepolia ETH</Text>
              </View>
            </View>
          </View>

          {/* ── 4. Payment Method Selector ── */}
          <Text style={styles.sectionHeaderTitle}>Select Payment Rail</Text>
          <View style={styles.methodsRow}>
            {PAYMENT_METHODS.map((method) => {
              const isSelected = selectedPayment === method.id;
              return (
                <TouchableOpacity
                  key={method.id}
                  style={[styles.methodCard, isSelected && styles.methodCardActive]}
                  onPress={() => setSelectedPayment(method.id)}
                  activeOpacity={0.8}
                >
                  {method.type === 'feather' ? (
                    <Feather
                      name={method.icon}
                      size={20}
                      color={isSelected ? '#6C47FF' : '#64748B'}
                    />
                  ) : (
                    <Ionicons
                      name={method.icon}
                      size={20}
                      color={isSelected ? '#6C47FF' : '#64748B'}
                    />
                  )}
                  <Text style={[styles.methodLabel, isSelected && styles.methodLabelActive]}>
                    {method.label}
                  </Text>
                  <Text style={styles.methodTag}>{method.tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── 5. MetaMask Web3 Tab ── */}
          {selectedPayment === 'wallet' && (
            <View style={styles.paymentDetailCard}>
              <View style={styles.paymentDetailHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="wallet-outline" size={20} color="#6C47FF" />
                  <Text style={styles.detailTitle}>MetaMask Web3 Escrow</Text>
                </View>
                <View style={styles.sepoliaBadge}>
                  <Text style={styles.sepoliaBadgeText}>Sepolia Testnet</Text>
                </View>
              </View>

              <View style={styles.ethAmountBox}>
                <Text style={styles.ethBoxLabel}>AMOUNT TO SEND</Text>
                <Text style={styles.ethBoxValue}>{ethAmount} ETH</Text>
                <Text style={styles.ethBoxRate}>
                  Rate: 1 ETH ≈ R{ethRate.toLocaleString()}
                </Text>
              </View>

              {linkedWallet ? (
                <View style={styles.connectedRow}>
                  <Ionicons name="link" size={14} color="#10B981" style={{ marginRight: 4 }} />
                  <Text style={styles.connectedLabel}>Paying From:</Text>
                  <Text style={styles.connectedAddress}>
                    {linkedWallet.substring(0, 6)}...{linkedWallet.slice(-4)} (Linked)
                  </Text>
                </View>
              ) : (
                <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.35)', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name="alert-triangle" size={16} color="#F59E0B" />
                  <Text style={{ flex: 1, fontSize: 12, color: '#F59E0B', fontWeight: '600' }}>
                    No wallet linked. Please link your MetaMask wallet in Profile before checking out with Web3.
                  </Text>
                </View>
              )}

              {isMismatch ? (
                <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name="alert-circle" size={16} color="#EF4444" />
                  <Text style={{ flex: 1, fontSize: 12, color: '#EF4444', fontWeight: '600' }}>
                    MetaMask account mismatch: Active wallet differs from your linked account ({linkedWallet?.substring(0, 6)}...{linkedWallet?.slice(-4)}). Please switch accounts in MetaMask.
                  </Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.metaMaskBtn}
                onPress={handleOpenMetaMask}
                activeOpacity={0.85}
              >
                <Ionicons name="open-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.metaMaskBtnText}>Open in MetaMask App</Text>
              </TouchableOpacity>

              <View style={{ marginTop: 6 }}>
                <Text style={styles.inputLabel}>TRANSACTION HASH (OPTIONAL / AUTO-VERIFIED)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0x... (Paste your MetaMask tx hash)"
                  placeholderTextColor="#94A3B8"
                  value={walletTxHash}
                  onChangeText={setWalletTxHash}
                  autoCapitalize="none"
                />
              </View>
            </View>
          )}

          {/* ── 6. Credit Card Tab ── */}
          {selectedPayment === 'card' && (
            <View style={styles.paymentDetailCard}>
              <View style={styles.paymentDetailHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name="credit-card" size={20} color="#6C47FF" />
                  <Text style={styles.detailTitle}>Credit / Debit Card</Text>
                </View>
                <View style={styles.stripeBadge}>
                  <Feather name="zap" size={11} color="#6C47FF" style={{ marginRight: 4 }} />
                  <Text style={styles.stripeBadgeText}>Stripe Secured</Text>
                </View>
              </View>

              <View style={{ gap: 10 }}>
                <View>
                  <Text style={styles.inputLabel}>CARD NUMBER</Text>
                  <TextInput
                    style={styles.input}
                    value={cardForm.cardNumber}
                    onChangeText={(v) => setCardForm({ ...cardForm, cardNumber: v })}
                    placeholder="4242 •••• •••• 4242"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                  />
                </View>

                <View>
                  <Text style={styles.inputLabel}>CARDHOLDER NAME</Text>
                  <TextInput
                    style={styles.input}
                    value={cardForm.cardName}
                    onChangeText={(v) => setCardForm({ ...cardForm, cardName: v })}
                    placeholder="Full Legal Name"
                    placeholderTextColor="#94A3B8"
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>EXPIRES</Text>
                    <TextInput
                      style={styles.input}
                      value={cardForm.expiry}
                      onChangeText={(v) => setCardForm({ ...cardForm, expiry: v })}
                      placeholder="MM/YY"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CVC</Text>
                    <TextInput
                      style={styles.input}
                      value={cardForm.cvc}
                      onChangeText={(v) => setCardForm({ ...cardForm, cvc: v })}
                      placeholder="CVC"
                      placeholderTextColor="#94A3B8"
                      keyboardType="numeric"
                      secureTextEntry
                    />
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ── 7. Bank Transfer Tab ── */}
          {selectedPayment === 'bank' && (
            <View style={styles.paymentDetailCard}>
              <View style={styles.paymentDetailHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="business-outline" size={20} color="#6C47FF" />
                  <Text style={styles.detailTitle}>UK Bank Wire / FPS Details</Text>
                </View>
                <View style={styles.stripeBadge}>
                  <Feather name="shield" size={11} color="#6C47FF" style={{ marginRight: 4 }} />
                  <Text style={styles.stripeBadgeText}>Faster Payments</Text>
                </View>
              </View>

              <View style={{ gap: 8 }}>
                {[
                  ['BENEFICIARY', 'SmartAssets Custody Ltd'],
                  ['BANK', 'Barclays / NatWest London'],
                  ['SORT CODE', '20-04-15'],
                  ['ACCOUNT NUMBER', '82941038'],
                  ['PAYMENT REFERENCE', bankRef],
                ].map(([lbl, val]) => (
                  <View key={lbl} style={styles.wireRow}>
                    <Text style={styles.wireLabel}>{lbl}</Text>
                    <Text style={styles.wireValue}>{val}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── 8. Escrow Notice ── */}
          <View style={styles.escrowNotice}>
            <Ionicons name="shield-checkmark" size={16} color="#6C47FF" style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.escrowText}>
              SmartAssets Smart Contract Escrow guarantees funds are securely held on-chain until the physical asset and share tokens are cryptographically authenticated.
            </Text>
          </View>
        </ScrollView>

        {/* ── Bottom Floating Action Bar ── */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.confirmBtn,
              isFractional && !riskAcknowledged && styles.confirmBtnDisabled,
            ]}
            onPress={handleConfirmPurchase}
            disabled={purchasing}
            activeOpacity={0.85}
          >
            {purchasing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text
                style={[
                  styles.confirmBtnLabel,
                  isFractional && !riskAcknowledged && styles.confirmBtnLabelDisabled,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {isFractional && !riskAcknowledged
                  ? 'Acknowledge Risk Disclosure'
                  : selectedPayment === 'wallet'
                  ? `Confirm ${ethAmount} ETH ${isFractional ? 'Investment' : 'Payment'}`
                  : `Confirm R${total.toLocaleString()} ${isFractional ? 'Investment' : 'Payment'}`}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <KycGatekeeperModal
          visible={kycGatekeeperVisible}
          onClose={() => setKycGatekeeperVisible(false)}
          isSuspended={Boolean(user?.isSuspended)}
          onCompleteVerification={() =>
            navigation.navigate(SCREENS.PROFILE, { openKyc: true })
          }
        />

        <InstallMetaMaskModal
          visible={installModalVisible}
          onClose={() => setInstallModalVisible(false)}
          onRetry={() => {
            setInstallModalVisible(false);
            handleOpenMetaMask();
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  breadcrumbWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbMuted: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  breadcrumbActive: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '800',
  },
  escrowShieldIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 120 : 100,
    gap: 16,
  },

  // Owner warning
  ownerWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  ownerWarningTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#EF4444',
  },
  ownerWarningSub: {
    fontSize: 11,
    lineHeight: 16,
    color: '#7F1D1D',
  },

  // Asset Summary
  assetSummaryCard: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    alignItems: 'center',
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  assetThumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#6C47FF',
    letterSpacing: 0.8,
  },
  assetName: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0F172A',
    lineHeight: 20,
    letterSpacing: -0.3,
  },
  assetPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6C47FF',
  },

  // Fractional Configurator Card
  fractionalCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    gap: 14,
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  fractionalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fractionalHeaderLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6C47FF',
    letterSpacing: 1,
  },
  fractionalHeaderTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  sharePriceBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    flexShrink: 0,
  },
  sharePriceBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6C47FF',
    paddingRight: 4,
  },

  // Stepper
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  stepperBtnDisabled: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  stepperNumber: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  stepperSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 2,
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipActive: {
    backgroundColor: '#6C47FF',
    borderColor: '#6C47FF',
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
  },

  // Rules
  rulesContainer: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  rulesTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  rulesTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ruleText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
    flex: 1,
  },
  ruleTextBold: {
    fontWeight: '700',
    color: '#0F172A',
  },

  // Risk Box
  riskBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#A78BFA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#6C47FF',
    borderColor: '#6C47FF',
  },
  riskText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
    color: '#334155',
  },
  riskLink: {
    color: '#6C47FF',
    fontWeight: '800',
  },

  // Summary Card
  summaryCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    gap: 10,
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
    flex: 1,
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'right',
    paddingRight: 6,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#6C47FF',
    letterSpacing: -0.4,
    textAlign: 'right',
    paddingRight: 6,
  },
  totalEthSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 2,
  },

  // Payment Selector
  sectionHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  methodsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  methodCard: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  methodCardActive: {
    backgroundColor: '#F5F3FF',
    borderColor: '#6C47FF',
  },
  methodLabel: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    color: '#0F172A',
  },
  methodLabelActive: {
    color: '#6C47FF',
  },
  methodTag: {
    fontSize: 9,
    fontWeight: '600',
    color: '#64748B',
  },

  // Payment Details Card
  paymentDetailCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    gap: 12,
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  paymentDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  sepoliaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  sepoliaBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  stripeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  stripeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6C47FF',
  },
  ethAmountBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    alignItems: 'center',
    gap: 2,
  },
  ethBoxLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6C47FF',
    letterSpacing: 1,
  },
  ethBoxValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
  },
  ethBoxRate: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  connectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  connectedLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  connectedAddress: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6C47FF',
  },
  metaMaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: '#F6851B',
  },
  metaMaskBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontWeight: '600',
  },
  wireRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  wireLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
  },
  wireValue: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'Courier',
    color: '#0F172A',
  },
  escrowNotice: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  escrowText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#6C47FF',
    fontWeight: '500',
    flex: 1,
  },

  // Bottom Floating Action Bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.9)',
  },
  confirmBtn: {
    borderRadius: 16,
    paddingVertical: 15,
    backgroundColor: '#6C47FF',
    alignItems: 'center',
    shadowColor: '#6C47FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnDisabled: {
    backgroundColor: '#F1F5F9',
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmBtnLabel: {
    fontWeight: '900',
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  confirmBtnLabelDisabled: {
    color: '#94A3B8',
  },

  // Success Screen
  successScroll: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 40,
    gap: 16,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  successSub: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: '#64748B',
    fontWeight: '500',
  },
  receiptCard: {
    width: '100%',
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    gap: 12,
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  receiptHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  receiptCardTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6C47FF',
    letterSpacing: 1.1,
  },
  settledBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  settledBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16A34A',
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
  },
  receiptValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  receiptRailValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6C47FF',
  },
  receiptMonoValue: {
    fontSize: 11,
    fontFamily: 'Courier',
    fontWeight: '700',
    color: '#0F172A',
  },
  receiptTotalPaid: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  txBlock: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  txMonoText: {
    fontSize: 11,
    fontFamily: 'Courier',
    color: '#0F172A',
  },
  doneBtn: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 15,
    backgroundColor: '#6C47FF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 10,
    shadowColor: '#6C47FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  doneBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 15,
  },
  vaultBtn: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(226, 232, 240, 0.9)',
  },
  vaultBtnLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
});
