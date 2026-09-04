import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { addUserHolding } from '../services/api';

const PAYMENT_METHODS = [
  { id: 'card', label: 'Credit / Debit Card', type: 'feather', icon: 'credit-card' },
  { id: 'wallet', label: 'MetaMask Wallet', type: 'ionicons', icon: 'wallet-outline' },
  { id: 'bank', label: 'Bank Transfer', type: 'ionicons', icon: 'business-outline' },
];

export default function CheckoutScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const { token } = useAuth();
  const asset = route?.params?.asset ?? {};
  const [selectedPayment, setSelectedPayment] = useState('card');
  const [confirmed, setConfirmed] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const priceNum = asset.price_num ?? asset.priceNum ?? 0;
  const platformFee = Math.round(priceNum * 0.025);
  const total = priceNum + platformFee;

  const handleConfirmPurchase = async () => {
    setPurchasing(true);
    try {
      if (token) {
        await addUserHolding(token, {
          name: asset.name,
          category: asset.category,
          price: asset.price || `£${priceNum.toLocaleString('en-GB')}`,
          priceNum: priceNum,
          image: asset.image,
          assetType: 'whole',
          gain: '+0.0%',
          gainPct: '0%',
          positive: true,
        });
      }
      setConfirmed(true);
    } catch (err) {
      Alert.alert('Notice', err.message || 'Could not complete purchase.');
      setConfirmed(true);
    } finally {
      setPurchasing(false);
    }
  };

  if (confirmed) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: c.greenBg }]}>
            <Ionicons name="checkmark-circle" size={48} color={c.green} />
          </View>
          <Text style={[styles.successTitle, { color: c.warm }]}>Purchase Confirmed!</Text>
          <Text style={[styles.successSub, { color: c.muted }]}>
            {asset.name} has been added to your Vault. A certificate of authenticity will be
            available shortly.
          </Text>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: c.primary }]}
            onPress={() => navigation.popToTop()}
          >
            <Text style={styles.doneBtnLabel}>Go to Vault</Text>
          </TouchableOpacity>
        </View>
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
        <Text style={[styles.navTitle, { color: c.warm }]}>Checkout</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Asset summary ── */}
        <View style={[styles.assetSummary, { backgroundColor: c.card, borderColor: c.border }]}>
          <Image source={{ uri: asset.image }} style={styles.assetThumb} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.assetCategory, { color: c.primary }]}>{asset.category}</Text>
            <Text style={[styles.assetName, { color: c.warm }]} numberOfLines={2}>
              {asset.name}
            </Text>
            <Text style={[styles.assetOwner, { color: c.muted }]}>by {asset.owner}</Text>
          </View>
        </View>

        {/* ── Price breakdown ── */}
        <View style={[styles.priceBreakdown, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.breakdownTitle, { color: c.warm }]}>Order Summary</Text>
          {[
            ['Asset price', asset.price],
            [`Platform fee (2.5%)`, `£${platformFee.toLocaleString()}`],
          ].map(([label, value]) => (
            <View key={label} style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: c.muted }]}>{label}</Text>
              <Text style={[styles.breakdownValue, { color: c.warm }]}>{value}</Text>
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.breakdownRow}>
            <Text style={[styles.totalLabel, { color: c.warm }]}>Total</Text>
            <Text style={[styles.totalValue, { color: c.primary }]}>
              £{total.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* ── Payment method ── */}
        <Text style={[styles.sectionTitle, { color: c.warm }]}>Payment Method</Text>
        {PAYMENT_METHODS.map((method) => (
          <TouchableOpacity
            key={method.id}
            style={[
              styles.paymentRow,
              {
                backgroundColor:
                  selectedPayment === method.id ? c.primaryBg : c.card,
                borderColor:
                  selectedPayment === method.id ? c.primary : c.border,
              },
            ]}
            onPress={() => setSelectedPayment(method.id)}
          >
            {method.type === 'feather' ? (
              <Feather name={method.icon} size={20} color={c.primary} />
            ) : (
              <Ionicons name={method.icon} size={20} color={c.primary} />
            )}
            <Text style={[styles.paymentLabel, { color: c.warm }]}>{method.label}</Text>
            <View
              style={[
                styles.radio,
                {
                  borderColor:
                    selectedPayment === method.id ? c.primary : c.border,
                },
              ]}
            >
              {selectedPayment === method.id && (
                <View style={[styles.radioDot, { backgroundColor: c.primary }]} />
              )}
            </View>
          </TouchableOpacity>
        ))}

        {/* ── Escrow notice ── */}
        <View style={[styles.escrowNotice, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
          <Text style={[styles.escrowText, { color: c.primary }]}>
            🔒 Funds are held in secure smart contract escrow until the asset is physically
            transferred and receipt is confirmed by both parties.
          </Text>
        </View>
      </ScrollView>

      {/* ── Confirm CTA ── */}
      <SafeAreaView edges={['bottom']} style={[styles.cta, { backgroundColor: c.vault, borderTopColor: c.border }]}>
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: c.primary }]}
          onPress={handleConfirmPurchase}
          disabled={purchasing}
          activeOpacity={0.85}
        >
          {purchasing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.confirmBtnLabel}>Confirm Purchase</Text>
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
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { fontSize: 18, fontWeight: '600' },
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
  assetCategory: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
  assetName: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  assetOwner: { fontSize: 11, marginTop: 2 },
  priceBreakdown: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 10 },
  breakdownTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 13 },
  breakdownValue: { fontSize: 13, fontWeight: '600' },
  divider: { height: 1, marginVertical: 4 },
  totalLabel: { fontSize: 14, fontWeight: '700' },
  totalValue: { fontSize: 18, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  paymentLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  escrowNotice: { padding: 14, borderRadius: 14, borderWidth: 1 },
  escrowText: { fontSize: 12, lineHeight: 18 },
  cta: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1 },
  confirmBtn: { borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  confirmBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  successIcon: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  successSub: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  doneBtn: { width: '100%', borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  doneBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
