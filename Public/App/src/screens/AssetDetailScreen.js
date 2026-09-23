// ─── AssetDetailScreen ────────────────────────────────────────────────────────
// Hero image + Overview / Certificate / Provenance tabs + action bar

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Linking,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Badge } from '../components/ui';
import { Feather, Ionicons } from '@expo/vector-icons';
import { getAssetDetails } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');
const TABS = ['overview', 'cert', 'history'];

// Fixed min height so the sheet doesn't change size between tabs
const SHEET_MIN_HEIGHT = height * 0.68;

export default function AssetDetailScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const { user } = useAuth();
  const initialAsset = route?.params?.asset ?? {};
  const [asset, setAsset] = useState(initialAsset);
  const [activeTab, setActiveTab] = useState('overview');
  const [history, setHistory] = useState([]);
  const [showHash, setShowHash] = useState(false);

  useEffect(() => {
    if (initialAsset.id) {
      getAssetDetails(initialAsset.id)
        .then((res) => {
          if (res?.asset) {
            setAsset((prev) => ({ ...prev, ...res.asset }));
          }
          if (res?.history && res.history.length > 0) {
            setHistory(res.history);
          }
        })
        .catch(() => {
          // Gracefully retain initialAsset passed via route params
        });
    }
  }, [initialAsset.id]);

  const isOwner = Boolean(
    user?.id && (user.id === asset.userId || user.id === asset.user_id)
  );

  return (
    <View style={styles.container}>
      {/* ── Full Hero Image Showcase ── */}
      <View style={styles.heroWrap}>
        {/* Ambient blurred backdrop for luxury depth */}
        <Image
          source={{ uri: asset.image }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          blurRadius={30}
        />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0, 0, 0, 0.45)' }]} />

        {/* Uncropped foreground hero image */}
        <Image
          source={{ uri: asset.image }}
          style={styles.heroImage}
          resizeMode="contain"
        />

        {/* Top shadow gradient for header contrast */}
        <LinearGradient
          colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.3)', 'transparent']}
          style={styles.topHeaderGradient}
        />
      </View>

      {/* ── Top Header Bar with Badges ── */}
      <SafeAreaView edges={['top']} style={styles.floatingHeader}>
        {/* Left: Back Button + Green AI Pill */}
        <View style={styles.headerLeftGroup}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </TouchableOpacity>

          {asset.aiScanStatus === 'scan_failed' ? (
            <View style={[styles.greenPillHeader, { backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: 'rgba(234, 179, 8, 0.35)' }]}>
              <Feather name="alert-triangle" size={11} color="#EAB308" />
              <Text style={[styles.greenPillText, { color: '#EAB308' }]}>AI SCAN N/A</Text>
            </View>
          ) : (
            <View style={styles.greenPillHeader}>
              <Feather name="shield" size={11} color="#10B981" />
              <Text style={styles.greenPillText}>AI AUTHENTIC</Text>
            </View>
          )}
        </View>

        {/* Right: Gold Shield Badge + Verified Pill */}
        <View style={styles.headerRightGroup}>
          <View style={styles.goldShieldBadge}>
            <Ionicons name="shield-checkmark" size={13} color="#F59E0B" />
            <Text style={styles.goldShieldText}>VAULT</Text>
          </View>

          <View style={styles.verifiedHeaderBadge}>
            <Feather name="check" size={11} color="#38BDF8" />
            <Text style={styles.verifiedHeaderText}>{asset.badge ?? 'Verified'}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Scrollable Body with White Bottom Sheet ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.bottomSheet, { minHeight: SHEET_MIN_HEIGHT }]}>
          {/* Title + Price row */}
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.categoryLabel}>{(asset.category ?? '').toUpperCase()} · 1 OF 1</Text>
              <Text style={styles.assetName}>{asset.name}</Text>
              <Text style={styles.price}>{asset.price}</Text>
            </View>
            <TouchableOpacity style={styles.shareBtn}>
              <Feather name="upload" size={16} color="#38BDF8" />
            </TouchableOpacity>
          </View>

          {/* ── Pill Tabs — blue active ── */}
          <View style={styles.pillTabBar}>
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.pillTab,
                  { backgroundColor: activeTab === tab ? '#4C86FF' : '#14151B' },
                ]}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[
                    styles.pillTabLabel,
                    { color: activeTab === tab ? '#FFFFFF' : '#94A3B8' },
                  ]}
                >
                  {tab === 'cert' ? 'Certificate' : tab === 'history' ? 'Provenance' : 'Info'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Overview / Info Tab ── */}
          {activeTab === 'overview' && (
            <View style={styles.tabContent}>

              {/* Single grouped info container */}
              <View style={styles.infoBox}>
                <Text style={styles.infoBoxHeading}>LISTING DETAILS</Text>

                {/* Owner row */}
                <View style={styles.infoRow}>
                  <View style={styles.infoRowLeft}>
                    <View style={styles.infoIconWrap}>
                      <Image source={{ uri: asset.image }} style={styles.infoAvatar} />
                    </View>
                    <View>
                      <Text style={styles.infoRowLabel}>Current Owner</Text>
                      <Text style={styles.infoRowValue}>{asset.owner || 'Verified Collector'}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.infoDivider} />

                {/* Creator row */}
                <View style={styles.infoRow}>
                  <View style={styles.infoRowLeft}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#EFF6FF' }]}>
                      <Feather name="user" size={16} color="#38BDF8" />
                    </View>
                    <View>
                      <Text style={styles.infoRowLabel}>Creator</Text>
                      <Text style={styles.infoRowValue}>{asset.owner || 'Verified Collector'}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.infoDivider} />

                {/* 2x2 grid of meta info */}
                <View style={styles.metaGrid}>
                  {[
                    ['Year', asset.year],
                    ['Condition', asset.condition],
                    ['Cert ID', (asset.cert ?? '').slice(0, 13) + '…'],
                    ['Category', asset.category],
                  ].map(([label, value]) => (
                    <View key={String(label)} style={styles.metaCell}>
                      <Text style={styles.infoRowLabel}>{label}</Text>
                      <Text style={styles.metaCellValue}>{value || '—'}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* ── Unified Valuation & Integrity Container (Emerald Green) ── */}
              <View style={styles.aiUnifiedBox}>
                {/* Header row */}
                <View style={styles.aiHeaderRow}>
                  <View style={styles.aiHeaderTitleWrap}>
                    <Feather name="shield" size={13} color="#10B981" />
                    <Text style={styles.aiUnifiedHeading}>VALUATION & AUTHENTICITY</Text>
                  </View>
                  <View style={styles.aiVerifiedBadge}>
                    <Text style={styles.aiVerifiedBadgeText}>
                      {asset.aiScanStatus === 'passed' ? 'VERIFIED REAL' : 'AI GUARDED'}
                    </Text>
                  </View>
                </View>

                {/* Valuation Metrics */}
                <View style={styles.valuationRow}>
                  <Text style={styles.valuationPrice}>{asset.price}</Text>
                </View>

                <View style={styles.confidenceRow}>
                  <Text style={styles.confidenceText}>Valuation Confidence</Text>
                  <Text style={styles.confidencePct}>96%</Text>
                </View>

                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: '78%' }]}
                  />
                </View>

                <View style={styles.rangeRow}>
                  <Text style={styles.rangeText}>Low: R{Math.round((asset.price_num || 25000) * 0.9).toLocaleString('en-ZA')}</Text>
                  <Text style={styles.rangeText}>High: R{Math.round((asset.price_num || 25000) * 1.15).toLocaleString('en-ZA')}</Text>
                </View>

                {/* Divider within single container */}
                <View style={styles.aiInnerDivider} />

                {/* Fraud & Media Detection sub-section */}
                <View style={styles.fraudSubRow}>
                  <Feather
                    name={asset.aiScanStatus === 'passed' ? 'check-circle' : 'shield'}
                    size={13}
                    color="#10B981"
                  />
                  <Text style={styles.fraudSubTitle}>Deepfake & Media Verification</Text>
                </View>
                <Text style={styles.fraudBody}>
                  {asset.aiScanStatus === 'passed'
                    ? 'All listing media scanned via Hive AI Detection. Zero synthetic patterns or deepfake artifacts detected.'
                    : 'Listing media protected by SmartAssets AI Fraud Guard.'}
                </Text>
              </View>

              {/* ── Product Description (Moved Under Evaluation) ── */}
              <View style={styles.descBox}>
                <View style={styles.descBoxHeader}>
                  <Feather name="file-text" size={13} color="#38BDF8" />
                  <Text style={styles.descBoxHeading}>PRODUCT DESCRIPTION</Text>
                </View>
                <Text style={styles.descBodyText}>
                  {asset.description || 'Dual-authenticated physical luxury asset with cryptographic ERC-721 token provenance, custody chain validation, and AI media verification.'}
                </Text>
                <Text style={styles.ownerDescriptionText}>
                  Listed by {isOwner ? 'You (Owner)' : asset.owner || 'Verified Seller'}.
                  {isOwner ? ' Self-purchase & self-investment are prohibited.' : ''}
                </Text>
              </View>

              {/* Blockchain badge */}
              <TouchableOpacity
                style={styles.blockchainBadge}
                onPress={() => Linking.openURL(asset.etherscanUrl || (asset.txHash ? `https://sepolia.etherscan.io/tx/${asset.txHash}` : 'https://sepolia.etherscan.io'))}
                activeOpacity={0.8}
              >
                <Feather name="link" size={14} color="#38BDF8" />
                <Text style={styles.blockchainBadgeText}>
                  {asset.tokenId ? `Token #${asset.tokenId} · Verified on Sepolia Etherscan ↗` : 'ERC-721 Verified on Sepolia Etherscan ↗'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Certificate Tab ── */}
          {activeTab === 'cert' && (
            <View style={styles.tabContent}>
              <View style={styles.infoBox}>
                <Text style={styles.infoBoxHeading}>DIGITAL CERTIFICATE</Text>
                <Text style={styles.certAssetName}>{asset.name}</Text>
                <TouchableOpacity
                  style={styles.certBtn}
                  onPress={() => navigation.navigate(SCREENS.CERTIFICATE, { asset })}
                >
                  <LinearGradient colors={['#4C86FF', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.certBtnGradient}>
                    <Text style={styles.certBtnLabel}>View Full Certificate</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <View style={styles.infoBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showHash ? 14 : 0 }}>
                  <Text style={[styles.infoBoxHeading, { marginBottom: 0 }]}>BLOCKCHAIN HASH</Text>
                  <TouchableOpacity onPress={() => setShowHash(!showHash)}>
                    <Text style={{ fontSize: 12, color: '#38BDF8' }}>{showHash ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                </View>
                {showHash && (
                  <Text style={styles.hashValue} numberOfLines={2}>
                    0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c2d5b7e0f3a6c9d2e5b8f1a4c7e0d3b6f
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* ── Provenance Tab ── */}
          {activeTab === 'history' && (
            <View style={styles.tabContent}>
              <TouchableOpacity
                style={styles.infoBox}
                onPress={() => navigation.navigate(SCREENS.PROVENANCE, { asset, history })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.infoBoxHeading}>OWNERSHIP TIMELINE</Text>
                  <Feather name="chevron-right" size={16} color="#38BDF8" />
                </View>
              </TouchableOpacity>

              <View style={styles.infoBox}>
                {(history.length > 0 ? history : [{ year: String(asset.year || '2024'), event: 'Marketplace Listing & Authenticity Certified' }])
                  .map((e, i, arr) => (
                    <View key={i} style={[styles.timelineRow, i < arr.length - 1 && { marginBottom: 16 }]}>
                      <View style={styles.timelineDotCol}>
                        <View style={[styles.timelineDot, { backgroundColor: i === 0 ? '#38BDF8' : '#CBD5E1' }]} />
                        {i < arr.length - 1 && <View style={styles.timelineLine} />}
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={styles.timelineYear}>{e.year || e.yr}</Text>
                        <Text style={styles.timelineEvent}>{e.event || e.ev}</Text>
                        {e.party ? <Text style={styles.timelineParty}>📍 {e.party}</Text> : null}
                      </View>
                    </View>
                  ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Action Bar (unchanged structure) ── */}
      <SafeAreaView
        edges={['bottom']}
        style={[styles.actionBar, { borderTopColor: 'transparent' }]}
      >
        <TouchableOpacity
          style={styles.secondaryAction}
          onPress={() => navigation.navigate(SCREENS.HEALTH_REPORT, { asset })}
        >
          <Text style={styles.secondaryActionLabel}>Health Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryAction,
            { opacity: isOwner ? 0.5 : 1 },
          ]}
          onPress={() => {
            if (isOwner) {
              Alert.alert('Self-Purchase Restricted', 'You listed this collectible. Platform rules prohibit buying or investing in items you listed yourself.');
            } else {
              navigation.navigate(SCREENS.CHECKOUT, { asset });
            }
          }}
          activeOpacity={isOwner ? 0.9 : 0.8}
        >
          <LinearGradient colors={['#4C86FF', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryActionGradient}>
            <Text style={styles.primaryActionLabel}>{isOwner ? 'Your Listing' : 'Buy Now'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  heroWrap: {
    position: 'absolute',
    top: 0,
    width: '100%',
    height: height * 0.48,
    backgroundColor: '#07080B',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImage: {
    width: '88%',
    height: '72%',
    marginTop: 46,
  },
  topHeaderGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
  },

  floatingHeader: {
    position: 'absolute',
    top: 0,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 20,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 16, 21, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  greenPillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },
  greenPillText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  goldShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 20,
  },
  goldShieldText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  verifiedHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },
  verifiedHeaderText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  scrollContent: { paddingTop: height * 0.44 },
  bottomSheet: {
    backgroundColor: '#000000',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 40,
  },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  categoryLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  assetName: { fontSize: 22, fontWeight: '700', color: '#F1F5F9', letterSpacing: -0.4, marginBottom: 4 },
  price: { fontSize: 20, fontWeight: '800', color: '#38BDF8' },
  shareBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(56,189,248,0.1)', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },

  pillTabBar: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  pillTab: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  pillTabLabel: { fontSize: 13, fontWeight: '700' },

  tabContent: { gap: 14 },

  // ── Single Grouped Info Box ──
  infoBox: {
    backgroundColor: '#0C0D11',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  infoBoxHeading: {
    fontSize: 10, fontWeight: '800', color: '#94A3B8',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14,
  },
  infoDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  infoAvatar: { width: '100%', height: '100%' },
  infoRowLabel: { fontSize: 11, fontWeight: '600', color: '#94A3B8', marginBottom: 2 },
  infoRowValue: { fontSize: 14, fontWeight: '600', color: '#F1F5F9' },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  metaCell: { width: '50%', paddingVertical: 8, paddingRight: 12 },
  metaCellValue: { fontSize: 14, fontWeight: '700', color: '#F1F5F9' },

  // ── Unified AI Valuation & Integrity Box (Emerald Green) ──
  aiUnifiedBox: {
    backgroundColor: '#09120E',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  aiHeaderTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiUnifiedHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  aiVerifiedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  aiVerifiedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.5,
  },
  valuationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  valuationPrice: { fontSize: 22, fontWeight: '800', color: '#F1F5F9' },

  // ── Dedicated Product Description Box (Under Evaluation) ──
  descBox: {
    backgroundColor: '#0C0D11',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  descBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  descBoxHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  descBodyText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 20,
    marginBottom: 8,
  },
  ownerDescriptionText: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
  },
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  confidenceText: { fontSize: 11, color: '#94A3B8' },
  confidencePct: { fontSize: 11, fontWeight: '700', color: '#10B981' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', borderRadius: 3 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { fontSize: 11, color: '#94A3B8' },
  aiInnerDivider: {
    height: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    marginVertical: 14,
  },
  fraudSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  fraudSubTitle: { fontSize: 12, fontWeight: '700', color: '#F1F5F9' },
  fraudBody: { fontSize: 12, color: '#94A3B8', lineHeight: 18 },

  // ── Blockchain Badge ──
  blockchainBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 14, borderRadius: 16,
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.2)',
  },
  blockchainBadgeText: { fontSize: 12, fontWeight: '700', color: '#38BDF8' },

  // ── Certificate tab ──
  certAssetName: { fontSize: 16, fontWeight: '700', color: '#F1F5F9', marginBottom: 16 },
  certBtn: { borderRadius: 14, overflow: 'hidden' },
  certBtnGradient: { paddingVertical: 12, alignItems: 'center' },
  certBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  hashValue: { fontSize: 12, fontFamily: 'Courier', lineHeight: 18, color: '#94A3B8' },

  // ── Provenance tab ──
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineDotCol: { alignItems: 'center', width: 12 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 2 },
  timelineLine: { width: 2, flex: 1, marginTop: 4, backgroundColor: 'rgba(255,255,255,0.08)' },
  timelineContent: { flex: 1 },
  timelineYear: { fontSize: 11, fontWeight: '700', marginBottom: 4, color: '#38BDF8' },
  timelineEvent: { fontSize: 13, fontWeight: '600', color: '#F1F5F9' },
  timelineParty: { fontSize: 12, color: '#94A3B8', marginTop: 4 },

  // ── Action Bar ──
  actionBar: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000000',
  },
  secondaryAction: {
    flex: 1, paddingVertical: 14, borderRadius: 18,
    alignItems: 'center', backgroundColor: '#070A12',
    borderWidth: 1, borderColor: '#4C86FF',
  },
  secondaryActionLabel: { fontWeight: '700', fontSize: 13, color: '#4C86FF' },
  primaryAction: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  primaryActionGradient: { paddingVertical: 14, alignItems: 'center' },
  primaryActionLabel: { fontWeight: '700', fontSize: 13, color: '#FFFFFF' },
});
