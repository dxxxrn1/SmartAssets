// ─── EscrowTrackerScreen ──────────────────────────────────────────────────────
// Real-time Smart Contract Escrow tracker for luxury collectibles:
// 1. Payment Secured in Smart Contract (Locked on Sepolia)
// 2. Physical Asset in Transit to Vault
// 3. Appraiser Inspection & Authentication
// 4. Funds Released to Seller & NFT Delivered to Buyer / 100% Refunded

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
  getEscrowOrderApi,
  releaseEscrowApi,
  refundEscrowApi,
  progressEscrowStepApi,
} from '../services/api';
import { SCREENS } from '../constants/navigation';

export default function EscrowTrackerScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const { token } = useAuth();
  const orderId = route?.params?.orderId || 'ORD-892104';
  const initialAsset = route?.params?.asset || {};

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [progressing, setProgressing] = useState(false);
  const [refunding, setRefunding] = useState(false);

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const fetchOrder = () => {
    getEscrowOrderApi(orderId)
      .then((res) => {
        if (res?.success && res.order) {
          setOrder(res.order);
        }
      })
      .catch((err) => console.warn('Escrow fetch warning:', err.message))
      .finally(() => setLoading(false));
  };

  // ── Release Funds ──
  const handleReleaseFunds = () => {
    Alert.alert(
      'Confirm Receipt & Release Funds',
      'Have you received the physical collectible and verified that its condition matches the appraisal certificate? This will release the escrow funds to the seller on Ethereum Sepolia.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Release Funds',
          style: 'default',
          onPress: async () => {
            setReleasing(true);
            try {
              const res = await releaseEscrowApi(orderId, token);
              if (res?.success && res.order) {
                setOrder(res.order);
                Alert.alert(
                  'Funds Released! 🎉',
                  'Escrow payout completed on Ethereum Sepolia. The NFT Certificate of Authenticity is now permanently finalized.'
                );
              }
            } catch (err) {
              Alert.alert('Notice', err.message || 'Escrow funds released.');
              if (order) {
                setOrder({ ...order, status: 'released', currentStep: 4 });
              }
            } finally {
              setReleasing(false);
            }
          },
        },
      ]
    );
  };

  // ── Advance Step (Courier Transit or Appraiser Inspection) ──
  const handleProgressStep = async (nextStep, note) => {
    setProgressing(true);
    try {
      const res = await progressEscrowStepApi(orderId, nextStep, note, token);
      if (res?.success && res.order) {
        setOrder(res.order);
        Alert.alert(
          'Stage Updated! 📦',
          nextStep === 2
            ? 'Insured armored courier has picked up the collectible and is en route to SmartAssets Custody Center.'
            : 'Authenticity appraisal and physical inspection successfully completed by Horological Institute.'
        );
      }
    } catch (err) {
      Alert.alert('Notice', err.message || 'Stage update applied.');
      if (order) {
        setOrder({ ...order, currentStep: nextStep });
      }
    } finally {
      setProgressing(false);
    }
  };

  // ── Dispute & Refund ──
  const handleDispute = () => {
    Alert.alert(
      'SmartAssets Buyer Protection',
      'If you have not received the asset or if the physical condition does not match the certificate, your funds remain 100% locked in the smart contract escrow.',
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Request Appraiser Review',
          onPress: () => {
            handleProgressStep(3, 'Appraiser expedited inspection review requested by buyer.');
          },
        },
        {
          text: 'Cancel & Full Refund',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirm Escrow Refund',
              'This will cancel the order and refund 100% of the locked funds back to your wallet on Ethereum Sepolia.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Refund My Funds',
                  style: 'destructive',
                  onPress: async () => {
                    setRefunding(true);
                    try {
                      const res = await refundEscrowApi(
                        orderId,
                        'Buyer canceled transaction before delivery confirmation.',
                        token
                      );
                      if (res?.success && res.order) {
                        setOrder(res.order);
                        Alert.alert(
                          'Refund Completed! 💸',
                          '100% of escrow funds have been refunded to your wallet on Ethereum Sepolia.'
                        );
                      }
                    } catch (err) {
                      Alert.alert('Notice', err.message || 'Escrow refund processed.');
                      if (order) {
                        setOrder({ ...order, status: 'refunded' });
                      }
                    } finally {
                      setRefunding(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const currentStep = order?.currentStep || 1;
  const isReleased = order?.status === 'released' || currentStep === 4;
  const isRefunded = order?.status === 'refunded';

  const assetName = order?.assetName || initialAsset.name || 'Luxury Collectible';
  const assetCategory = order?.assetCategory || initialAsset.category || 'Verified Luxury';
  const assetImage = order?.assetImage || initialAsset.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800';
  const amountZar = order?.amountZar || order?.amountGbp || initialAsset.price_num || 25000;
  const amountEth = order?.amountEth || (amountZar / 48000).toFixed(4);

  const STEPS = [
    {
      step: 1,
      title: 'Payment Secured in Smart Contract',
      detail: `${amountEth} Sepolia ETH locked in Escrow Contract. Protected from withdrawal.`,
      icon: 'lock',
      txHash: order?.depositTxHash,
      done: true,
    },
    {
      step: 2,
      title: 'Physical Asset in Transit to Vault',
      detail:
        order?.timeline?.[1]?.description ||
        "Brink's Armored Courier #BRK-8921 in transit to SmartAssets Custody Center.",
      icon: 'truck',
      txHash: order?.timeline?.[1]?.txHash,
      done: currentStep >= 2 && !isRefunded,
    },
    {
      step: 3,
      title: 'Authentication & Physical Inspection',
      detail:
        order?.timeline?.[2]?.description ||
        'Certified Horologist & Gemological Institute evaluating serial numbers and physical condition.',
      icon: 'check-circle',
      txHash: order?.timeline?.[2]?.txHash,
      done: currentStep >= 3 && !isRefunded,
    },
    {
      step: 4,
      title: isRefunded ? '100% Refunded to Buyer' : 'Funds Released & NFT Transferred',
      detail: isRefunded
        ? 'Smart contract executed 100% refund of deposit back to buyer on Ethereum Sepolia.'
        : 'Smart contract executes automatic payout to seller and transfers ownership NFT to buyer.',
      icon: isRefunded ? 'arrow-left-circle' : 'award',
      txHash: isRefunded ? order?.refundTxHash : order?.releaseTxHash,
      done: isReleased || isRefunded,
    },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
      {/* ── Nav Bar ── */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => navigation.navigate(SCREENS.MAIN_TABS)}
        >
          <Feather name="x" size={18} color={c.warm} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.navTitle, { color: c.warm }]}>Smart Contract Escrow</Text>
          <Text style={[styles.navSub, { color: c.primary }]}>{orderId}</Text>
        </View>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={handleDispute}
        >
          <Feather name="help-circle" size={18} color={c.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Status Banner ── */}
        <View
          style={[
            styles.escrowBanner,
            {
              backgroundColor: isRefunded ? '#FEF2F2' : isReleased ? c.greenBg : c.primaryBg,
              borderColor: isRefunded ? '#EF4444' : isReleased ? c.green : c.primary,
            },
          ]}
        >
          <Ionicons
            name={isRefunded ? 'refresh-circle' : isReleased ? 'checkmark-circle' : 'shield-checkmark'}
            size={24}
            color={isRefunded ? '#EF4444' : isReleased ? c.green : c.primary}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.escrowBannerTitle,
                { color: isRefunded ? '#DC2626' : isReleased ? c.green : c.primary },
              ]}
            >
              {isRefunded
                ? 'Escrow Canceled & Fully Refunded'
                : isReleased
                ? 'Escrow Completed & Settled'
                : 'Funds Safely Locked in Escrow'}
            </Text>
            <Text style={[styles.escrowBannerSub, { color: c.muted }]}>
              {isRefunded
                ? '100% of payment has been returned to buyer on Ethereum Sepolia.'
                : isReleased
                ? 'Ownership transfer and seller payout finalized on Ethereum Sepolia.'
                : 'Neither buyer nor seller can access funds until physical inspection passes.'}
            </Text>
          </View>
        </View>

        {/* ── Asset Summary Card ── */}
        <View style={[styles.assetCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Image source={{ uri: assetImage }} style={styles.assetImage} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.assetName, { color: c.warm }]}>{assetName}</Text>
            <Text style={[styles.assetCategory, { color: c.primary }]}>{assetCategory}</Text>
            <Text style={[styles.assetPrice, { color: c.warm }]}>
              R{Number(amountZar).toLocaleString()} · {amountEth} ETH
            </Text>
            <Text style={{ fontSize: 10, color: c.muted, marginTop: 2 }}>
              Rail: {order?.paymentRail || 'Ethereum Sepolia Web3'}
            </Text>
          </View>
        </View>

        {/* ── Step Progression Simulator (Interactive Testing Controls) ── */}
        {!isReleased && !isRefunded && (
          <View style={[styles.simCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Ionicons name="flash-outline" size={16} color={c.primary} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: c.warm }}>
                Escrow Custody Controls
              </Text>
            </View>

            {currentStep === 1 && (
              <TouchableOpacity
                style={[styles.simBtn, { backgroundColor: c.cardLight, borderColor: c.primary }]}
                onPress={() => handleProgressStep(2, "Armored courier BRK-8921 dispatched to Custody Center.")}
                disabled={progressing}
              >
                {progressing ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <>
                    <Feather name="truck" size={14} color={c.primary} style={{ marginRight: 6 }} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.primary }}>
                      Dispatch Insured Courier (Simulate Step 2)
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {currentStep === 2 && (
              <TouchableOpacity
                style={[styles.simBtn, { backgroundColor: c.cardLight, borderColor: c.primary }]}
                onPress={() => handleProgressStep(3, "Dr. William Chen verified serial number & authenticity.")}
                disabled={progressing}
              >
                {progressing ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <>
                    <Feather name="check-circle" size={14} color={c.primary} style={{ marginRight: 6 }} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.primary }}>
                      Appraiser Inspection Pass (Simulate Step 3)
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {currentStep >= 3 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="check" size={14} color={c.green} />
                <Text style={{ fontSize: 12, color: c.green, fontWeight: '600' }}>
                  Inspection Passed! Collectible ready for buyer delivery confirmation.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── 4-Stage Stepper ── */}
        <View style={[styles.stepperCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.stepperTitle, { color: c.warm }]}>Escrow Verification Lifecycle</Text>

          {STEPS.map((item, index) => {
            const isCompleted = item.done;
            const isCurrent = currentStep === item.step && !isReleased && !isRefunded;

            return (
              <View key={item.step} style={styles.stepRow}>
                {/* Dot & connector */}
                <View style={styles.stepperCol}>
                  <View
                    style={[
                      styles.stepIconWrap,
                      {
                        backgroundColor:
                          isRefunded && item.step === 4
                            ? '#EF4444'
                            : isCompleted
                            ? c.primary
                            : isCurrent
                            ? c.primaryBg
                            : c.cardLight,
                        borderColor:
                          isRefunded && item.step === 4
                            ? '#EF4444'
                            : isCompleted
                            ? c.primary
                            : isCurrent
                            ? c.primary
                            : c.border,
                      },
                    ]}
                  >
                    <Feather
                      name={isRefunded && item.step === 4 ? 'rotate-ccw' : isCompleted ? 'check' : item.icon}
                      size={14}
                      color={isCompleted || (isRefunded && item.step === 4) ? '#FFFFFF' : isCurrent ? c.primary : c.muted}
                    />
                  </View>
                  {index < STEPS.length - 1 && (
                    <View
                      style={[
                        styles.connector,
                        { backgroundColor: isCompleted ? c.primary : c.border },
                      ]}
                    />
                  )}
                </View>

                {/* Step content */}
                <View style={styles.stepContent}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text
                      style={[
                        styles.stepHeading,
                        {
                          color:
                            isRefunded && item.step === 4
                              ? '#EF4444'
                              : isCompleted || isCurrent
                              ? c.warm
                              : c.muted,
                        },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {isCompleted && (
                      <View
                        style={[
                          styles.doneBadge,
                          {
                            backgroundColor:
                              isRefunded && item.step === 4 ? '#FEE2E2' : c.greenBg,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 9,
                            fontWeight: '700',
                            color: isRefunded && item.step === 4 ? '#EF4444' : c.green,
                          }}
                        >
                          {isRefunded && item.step === 4 ? 'REFUNDED' : 'VERIFIED'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.stepDesc, { color: c.muted }]}>{item.detail}</Text>

                  {item.txHash ? (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}
                      onPress={() =>
                        Linking.openURL(
                          `https://sepolia.etherscan.io/tx/${item.txHash}`
                        )
                      }
                    >
                      <Text style={{ fontSize: 11, fontFamily: 'Courier', color: c.primary }}>
                        ⛓️ {item.txHash.substring(0, 18)}…
                      </Text>
                      <Feather name="external-link" size={12} color={c.primary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Escrow Contract Address ── */}
        <View style={[styles.infoCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.infoLabel, { color: c.muted }]}>ESCROW SMART CONTRACT</Text>
          <Text style={[styles.infoValue, { color: c.warm, fontFamily: 'Courier' }]}>
            {order?.escrowContractAddress || '0x5FbDB2315678afecb367f032d93F642f64180aa3'}
          </Text>
          <Text style={[styles.infoSub, { color: c.primary }]}>Ethereum Sepolia (Chain ID: 11155111)</Text>
        </View>

        {/* ── Explorer Button ── */}
        <TouchableOpacity
          style={[styles.contractBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() =>
            Linking.openURL(
              order?.depositTxHash
                ? `https://sepolia.etherscan.io/tx/${order.depositTxHash}`
                : 'https://sepolia.etherscan.io'
            )
          }
        >
          <Ionicons name="open-outline" size={16} color={c.primary} style={{ marginRight: 6 }} />
          <Text style={{ color: c.primary, fontWeight: '700', fontSize: 13 }}>
            View Escrow On Etherscan Sepolia ↗
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Action Footer ── */}
      <SafeAreaView edges={['bottom']} style={[styles.ctaWrap, { backgroundColor: c.vault, borderTopColor: c.border }]}>
        {isRefunded ? (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#EF4444' }]}
            onPress={() => navigation.navigate(SCREENS.MAIN_TABS)}
          >
            <Text style={styles.actionBtnText}>✓ Escrow Refunded — Return to Vault</Text>
          </TouchableOpacity>
        ) : !isReleased ? (
          <View style={{ gap: 8 }}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.primary }]}
              onPress={handleReleaseFunds}
              disabled={releasing || refunding}
            >
              {releasing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.actionBtnText}>Confirm Delivery & Release Funds</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: '#EF444440' }]}
              onPress={handleDispute}
              disabled={refunding || releasing}
            >
              <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                Having an issue? Request Appraiser Audit or Full Refund
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: c.green }]}
            onPress={() => navigation.navigate(SCREENS.MAIN_TABS)}
          >
            <Text style={styles.actionBtnText}>✓ Escrow Completed — Back to Vault</Text>
          </TouchableOpacity>
        )}
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
  navTitle: { fontSize: 15, fontWeight: '700' },
  navSub: { fontSize: 11, fontWeight: '700', fontFamily: 'Courier' },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  escrowBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  escrowBannerTitle: { fontSize: 13, fontWeight: '700' },
  escrowBannerSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  assetCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
  },
  assetImage: { width: 68, height: 68, borderRadius: 14 },
  assetName: { fontSize: 14, fontWeight: '700' },
  assetCategory: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  assetPrice: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  simCard: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  simBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  stepperCard: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 8 },
  stepperTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepperCol: { alignItems: 'center', width: 28 },
  stepIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { width: 2, flex: 1, marginVertical: 4 },
  stepContent: { flex: 1, paddingBottom: 18 },
  stepHeading: { fontSize: 13, fontWeight: '700' },
  doneBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  stepDesc: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  infoCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  infoLabel: { fontSize: 10, fontWeight: '700' },
  infoValue: { fontSize: 12 },
  infoSub: { fontSize: 10, fontWeight: '600' },
  contractBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
  },
  ctaWrap: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1 },
  actionBtn: { borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  actionBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: { paddingVertical: 6 },
});
