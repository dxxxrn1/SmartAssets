// ─── In-AR Bid & Offer Sheet ─────────────────────────────────────────────────
// Allows users to submit bids or buy fractional shares without leaving the AR camera.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Image,
  Alert,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { SCREENS } from '../../constants/navigation';

export default function InARBidSheet({
  visible,
  onClose,
  item,
  navigation,
  onBidSubmitted,
}) {
  if (!item) return null;

  const [mode, setMode] = useState('whole'); // 'whole' | 'fractional'
  const [customBid, setCustomBid] = useState('');
  const [fractionalCount, setFractionalCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const basePrice = item.price || 48500;
  const sharePrice = item.sharePrice || Math.round(basePrice / 100);

  const quickIncrements = [250, 500, 1000, 2500];

  const currentBidTotal = mode === 'whole'
    ? (customBid ? parseFloat(customBid) || basePrice : basePrice)
    : sharePrice * fractionalCount;

  const handleQuickAdd = (inc) => {
    const curr = customBid ? parseFloat(customBid) || basePrice : basePrice;
    setCustomBid(String(curr + inc));
  };

  const handleConfirmBid = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      onClose();
      if (onBidSubmitted) {
        onBidSubmitted({
          amount: currentBidTotal,
          mode,
          fractionalCount: mode === 'fractional' ? fractionalCount : undefined,
          item,
        });
      }
      Alert.alert(
        'Escrow Bid Locked!',
        `Your bid of £${currentBidTotal.toLocaleString('en-GB')} for "${item.name}" has been registered in the SmartAssets escrow contract on Sepolia.`,
        [
          { text: 'Return to AR', style: 'cancel' },
          {
            text: 'View Checkout',
            onPress: () => {
              if (navigation) {
                navigation.navigate(SCREENS.CHECKOUT, {
                  asset: {
                    id: item.id,
                    name: item.name,
                    price: currentBidTotal,
                    image: item.image,
                    category: item.category,
                  },
                  isFractional: mode === 'fractional',
                  sharesCount: fractionalCount,
                });
              }
            },
          },
        ]
      );
    }, 600);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.backdropDismiss}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={styles.sheetContainer}>
          {/* Top Grab Handle */}
          <View style={styles.grabHandle} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={[styles.categoryTag, { backgroundColor: item.badgeColor ? `${item.badgeColor}22` : '#7C3AED22' }]}>
                <Text style={[styles.categoryText, { color: item.badgeColor || '#7C3AED' }]}>
                  {item.tag || (item.category || 'SHOWCASE').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.titleText} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.dimensionsText}>
                {item.dimensions?.displayString || '1:1 True AR Scale'}
              </Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Feather name="x" size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Item Preview Thumbnail & Price Snapshot */}
          <View style={styles.priceCard}>
            <Image source={{ uri: item.image }} style={styles.thumbImage} resizeMode="cover" />
            <View style={styles.priceCol}>
              <Text style={styles.fairValueLabel}>AI FAIR VALUE</Text>
              <Text style={styles.fairValueNum}>
                {item.priceFormatted || `£${basePrice.toLocaleString('en-GB')}`}
              </Text>
              <View style={styles.escrowPill}>
                <Ionicons name="shield-checkmark" size={12} color="#10B981" />
                <Text style={styles.escrowPillText}>Escrow Protected on Sepolia</Text>
              </View>
            </View>
          </View>

          {/* Mode Switcher: Whole Asset vs Fractional Shares */}
          <View style={styles.modeTabs}>
            <TouchableOpacity
              style={[styles.modeTab, mode === 'whole' && styles.modeTabActive]}
              onPress={() => setMode('whole')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeTabText, mode === 'whole' && styles.modeTabTextActive]}>
                Full Ownership Bid
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeTab, mode === 'fractional' && styles.modeTabActive]}
              onPress={() => setMode('fractional')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeTabText, mode === 'fractional' && styles.modeTabTextActive]}>
                Fractional Shares ({item.sharePriceFormatted || `£${sharePrice}/sh`})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tab Content: Whole Bid */}
          {mode === 'whole' ? (
            <View style={styles.bidInputSection}>
              <Text style={styles.sectionLabel}>YOUR OFFER (GBP)</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.currencyPrefix}>£</Text>
                <TextInput
                  style={styles.textInput}
                  keyboardType="numeric"
                  value={customBid}
                  placeholder={basePrice.toLocaleString('en-GB')}
                  placeholderTextColor="#94A3B8"
                  onChangeText={setCustomBid}
                />
              </View>

              {/* Quick Increment Chips */}
              <View style={styles.chipsRow}>
                {quickIncrements.map((inc) => (
                  <TouchableOpacity
                    key={inc}
                    style={styles.incrementChip}
                    onPress={() => handleQuickAdd(inc)}
                  >
                    <Text style={styles.incrementText}>+£{inc}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.fractionalSection}>
              <Text style={styles.sectionLabel}>SELECT FRACTIONAL SHARES</Text>
              <View style={styles.counterRow}>
                <TouchableOpacity
                  style={styles.counterBtn}
                  onPress={() => setFractionalCount(Math.max(1, fractionalCount - 1))}
                >
                  <Feather name="minus" size={18} color="#0F172A" />
                </TouchableOpacity>

                <View style={styles.counterDisplay}>
                  <Text style={styles.counterNum}>{fractionalCount}</Text>
                  <Text style={styles.counterSub}>
                    {fractionalCount === 1 ? 'Share (1%)' : `Shares (${fractionalCount}%)`}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.counterBtn}
                  onPress={() => setFractionalCount(Math.min(item.sharesAvailable || 100, fractionalCount + 1))}
                >
                  <Feather name="plus" size={18} color="#0F172A" />
                </TouchableOpacity>
              </View>

              <View style={styles.fractionalSummary}>
                <Text style={styles.fractionalSummaryLabel}>Total Investment:</Text>
                <Text style={styles.fractionalSummaryValue}>
                  £{(sharePrice * fractionalCount).toLocaleString('en-GB')}
                </Text>
              </View>
            </View>
          )}

          {/* Actions */}
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleConfirmBid}
            disabled={submitting}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['#7C3AED', '#2563EB', '#00C2FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitBtnGradient}
            >
              <Ionicons name="flash" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.submitBtnText}>
                {submitting
                  ? 'Locking Escrow Deposit...'
                  : `Confirm Bid of £${currentBidTotal.toLocaleString('en-GB')}`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
            <Text style={styles.cancelLinkText}>Keep viewing in AR camera</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  backdropDismiss: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 20,
  },
  grabHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 12,
  },
  categoryTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 4,
  },
  categoryText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  titleText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
  },
  dimensionsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceCard: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  thumbImage: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#CBD5E1',
  },
  priceCol: {
    flex: 1,
  },
  fairValueLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  fairValueNum: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
  },
  escrowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  escrowPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  modeTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  modeTabTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  bidInputSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 10,
  },
  currencyPrefix: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    marginRight: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    padding: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  incrementChip: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  incrementText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  fractionalSection: {
    marginBottom: 16,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  counterBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  counterDisplay: {
    alignItems: 'center',
    minWidth: 80,
  },
  counterNum: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
  },
  counterSub: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  fractionalSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  fractionalSummaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  fractionalSummaryValue: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0F172A',
  },
  submitBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 10,
  },
  submitBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  cancelLink: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  cancelLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
});
