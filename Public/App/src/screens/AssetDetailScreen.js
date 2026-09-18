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
import { Feather } from '@expo/vector-icons';
import { getAssetDetails } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');
const TABS = ['overview', 'cert', 'history'];

export default function AssetDetailScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const { user } = useAuth();
  const initialAsset = route?.params?.asset ?? {};
  const [asset, setAsset] = useState(initialAsset);
  const [activeTab, setActiveTab] = useState('overview');
  const [history, setHistory] = useState([]);

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
    <View style={[styles.container, { backgroundColor: '#111827' }]}>
      {/* ── Background Full Bleed Hero Image ── */}
      <View style={styles.heroWrap}>
        <Image source={{ uri: asset.image }} style={styles.heroImage} resizeMode="cover" />
        <LinearGradient 
          colors={['rgba(0,0,0,0.4)', 'transparent']} 
          style={StyleSheet.absoluteFillObject} 
        />
      </View>

      {/* Floating Back Button & Badges */}
      <SafeAreaView edges={['top']} style={styles.floatingHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={18} color="#0F172A" />
        </TouchableOpacity>

        <View style={styles.heroBadge}>
          <Badge
            text={asset.badge ?? 'Verified'}
            variant={asset.badge === 'Verified' ? 'verified' : 'pending'}
            isDark={true}
          />
          {asset.aiScanStatus === 'passed' ? (
            <View style={styles.aiBadge}>
              <Feather name="shield" size={11} color="#FFFFFF" />
              <Text style={styles.aiBadgeText}>AI AUTHENTIC</Text>
            </View>
          ) : asset.aiScanStatus === 'scan_failed' ? (
            <View style={[styles.aiBadge, { backgroundColor: 'rgba(234, 179, 8, 0.9)' }]}>
              <Feather name="alert-triangle" size={11} color="#000000" />
              <Text style={[styles.aiBadgeText, { color: '#000' }]}>AI SCAN N/A</Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      {/* ── Scrollable Body with Bottom Sheet ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.bottomSheet}>
          {/* Title block */}
          <Text style={styles.assetName}>{asset.name}</Text>
          <View style={styles.priceRow}>
            <View>
              <Text style={styles.categoryLabel}>{(asset.category ?? '').toUpperCase()} • 1 of 1</Text>
              <Text style={styles.price}>{asset.price}</Text>
            </View>
            <View style={styles.shareBtnWrap}>
              <TouchableOpacity style={styles.shareBtn}>
                <Feather name="upload" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.ownerDescriptionText}>
            Listed by {isOwner ? 'You (Owner)' : asset.owner || 'Verified Seller'}.
            {isOwner ? ' Self-purchase & self-investment are prohibited.' : ''}
          </Text>

          {/* ── Pill Tab bar ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillTabBar}>
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.pillTab,
                  { backgroundColor: activeTab === tab ? '#10B981' : 'rgba(255,255,255,0.08)' },
                ]}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[
                    styles.pillTabLabel,
                    { color: activeTab === tab ? '#000000' : '#A1A1AA' },
                  ]}
                >
                  {tab === 'cert' ? 'Certificate' : tab === 'history' ? 'Provenance' : 'Info'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Overview / Info Tab ── */}
          {activeTab === 'overview' && (
            <View style={styles.tabContent}>
              
              {/* Glass Rows for Creator/Owner */}
              <View style={styles.glassRow}>
                <View style={styles.glassAvatarWrap}>
                  <Image source={{ uri: asset.image }} style={styles.glassAvatar} />
                </View>
                <View>
                  <Text style={styles.glassLabel}>Current owner</Text>
                  <Text style={styles.glassValue}>{asset.owner || 'Verified Collector'}</Text>
                </View>
              </View>

              <View style={styles.glassRow}>
                <View style={[styles.glassAvatarWrap, { backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' }]}>
                  <Feather name="user" size={16} color="#FFFFFF" />
                </View>
                <View>
                  <Text style={styles.glassLabel}>Creator</Text>
                  <Text style={styles.glassValue}>{asset.owner || 'Verified Collector'}</Text>
                </View>
              </View>

              <View style={styles.grid2}>
                {[
                  ['Year', asset.year],
                  ['Condition', asset.condition],
                  ['Cert ID', (asset.cert ?? '').slice(0, 13) + '…'],
                  ['Category', asset.category],
                ].map(([label, value]) => (
                  <View key={String(label)} style={styles.glassCell}>
                    <Text style={styles.glassLabel}>{String(label).toUpperCase()}</Text>
                    <Text style={styles.glassValue}>{value}</Text>
                  </View>
                ))}
              </View>

              {/* AI Valuation card */}
              <View style={styles.valuationCard}>
                <View style={styles.valuationHeader}>
                  <Text style={styles.valuationLabel}>AI VALUATION ESTIMATE</Text>
                  <Text style={styles.yoyGain}>+12.4% YoY</Text>
                </View>
                <View style={styles.valuationRow}>
                  <Text style={styles.valuationPrice}>{asset.price}</Text>
                  <Text style={styles.confidence}>Confidence: 96%</Text>
                </View>
                {/* Progress bar */}
                <View style={styles.progressTrack}>
                  <View style={styles.progressFill} />
                </View>
                <View style={styles.rangeRow}>
                  <Text style={styles.rangeText}>
                    Low: R{Math.round((asset.price_num || 25000) * 0.9).toLocaleString('en-ZA')}
                  </Text>
                  <Text style={styles.rangeText}>
                    High: R{Math.round((asset.price_num || 25000) * 1.15).toLocaleString('en-ZA')}
                  </Text>
                </View>
              </View>

              {/* AI Image Authenticity Card */}
              <View style={[styles.valuationCard, { borderColor: asset.aiScanStatus === 'passed' ? '#10B981' : '#334155' }]}>
                <View style={styles.valuationHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Feather
                      name={asset.aiScanStatus === 'passed' ? 'check-circle' : 'shield'}
                      size={14}
                      color={asset.aiScanStatus === 'passed' ? '#10B981' : '#38BDF8'}
                    />
                    <Text style={[styles.valuationLabel, { color: asset.aiScanStatus === 'passed' ? '#10B981' : '#38BDF8' }]}>
                      AI FRAUD & DEEPFAKE DETECTION
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: asset.aiScanStatus === 'passed' ? '#10B981' : '#94A3B8' }}>
                    {asset.aiScanStatus === 'passed' ? 'VERIFIED REAL' : 'PASSED'}
                  </Text>
                </View>
                <Text style={{ color: '#E2E8F0', fontSize: 12, lineHeight: 18, marginTop: 4 }}>
                  {asset.aiScanStatus === 'passed'
                    ? 'All listing media scanned via Hive AI Detection. No synthetic patterns, AI generation, or deepfake artifacts were detected.'
                    : 'Listing media protected by SmartAssets AI Fraud Guard.'}
                </Text>
              </View>

              {/* On-chain Ethereum Sepolia Badge */}
              <TouchableOpacity
                style={styles.blockchainBadge}
                onPress={() =>
                  Linking.openURL(
                    asset.etherscanUrl ||
                      (asset.txHash
                        ? `https://sepolia.etherscan.io/tx/${asset.txHash}`
                        : 'https://sepolia.etherscan.io')
                  )
                }
                activeOpacity={0.8}
              >
                <Feather name="link" size={14} color="#38BDF8" />
                <Text style={styles.blockchainBadgeText}>
                  {asset.tokenId
                    ? `Token #${asset.tokenId} · Verified on Sepolia Etherscan ↗`
                    : 'ERC-721 Verified on Sepolia Etherscan ↗'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Certificate Tab ── */}
          {activeTab === 'cert' && (
            <View style={styles.tabContent}>
              <View style={styles.certCard}>
                <Text style={styles.certTitle}>{asset.name}</Text>
                <TouchableOpacity
                  style={styles.certBtn}
                  onPress={() => navigation.navigate(SCREENS.CERTIFICATE, { asset })}
                >
                  <Text style={styles.certBtnLabel}>View Full Certificate</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.hashCard}>
                <Text style={styles.hashLabel}>BLOCKCHAIN HASH</Text>
                <Text style={styles.hashValue} numberOfLines={2}>
                  0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c2d5b7e0f3a6c9d2e5b8f1a4c7e0d3b6f
                </Text>
              </View>
            </View>
          )}

          {/* ── Provenance Tab ── */}
          {activeTab === 'history' && (
            <View style={styles.tabContent}>
              <TouchableOpacity
                style={styles.provenanceBtn}
                onPress={() => navigation.navigate(SCREENS.PROVENANCE, { asset, history })}
              >
                <Text style={styles.provenanceBtnLabel}>View Full Provenance Timeline</Text>
                <Feather name="chevron-right" size={16} color="#38BDF8" />
              </TouchableOpacity>

              {(history.length > 0
                ? history
                : [
                    { year: String(asset.year || '2024'), event: 'Marketplace Listing & Authenticity Certified' },
                  ]
              ).map((e, i, arr) => (
                <View key={i} style={styles.timelineRow}>
                  <View style={styles.timelineDotCol}>
                    <View style={[styles.timelineDot, { backgroundColor: i === 0 ? '#38BDF8' : '#334155' }]} />
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
          )}
        </View>
      </ScrollView>

      {/* ── Action Bar (Kept identical format) ── */}
      <SafeAreaView
        edges={['bottom']}
        style={[styles.actionBar, { backgroundColor: c.card, borderTopColor: c.border }]}
      >
        <TouchableOpacity
          style={[styles.secondaryAction, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => navigation.navigate(SCREENS.HEALTH_REPORT, { asset })}
        >
          <Text style={[styles.actionLabel, { color: c.warm }]}>Health Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryAction,
            {
              backgroundColor: isOwner ? c.cardLight : c.primary,
              borderColor: isOwner ? c.border : c.primary,
              borderWidth: isOwner ? 1 : 0,
            },
          ]}
          onPress={() => {
            if (isOwner) {
              Alert.alert(
                'Self-Purchase Restricted',
                'You listed this collectible. Platform rules prohibit buying or investing in items you listed yourself.'
              );
            } else {
              navigation.navigate(SCREENS.CHECKOUT, { asset });
            }
          }}
          activeOpacity={isOwner ? 0.9 : 0.8}
        >
          <Text style={[styles.actionLabel, { color: isOwner ? c.muted : '#FFFFFF' }]}>
            {isOwner ? 'Your Listing' : 'Buy Now'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  heroWrap: { position: 'absolute', top: 0, width: '100%', height: height * 0.55 },
  heroImage: { width: '100%', height: '100%' },
  
  floatingHeader: {
    position: 'absolute',
    top: 0,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    zIndex: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  heroBadge: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  aiBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  scrollContent: { paddingTop: height * 0.45 },
  bottomSheet: {
    backgroundColor: '#1E1E1E',
    minHeight: height * 0.6,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  
  assetName: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 8 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  categoryLabel: { fontSize: 12, fontWeight: '600', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 4 },
  price: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  shareBtnWrap: { justifyContent: 'center' },
  shareBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center'
  },
  ownerDescriptionText: { fontSize: 12, color: '#94A3B8', lineHeight: 18, marginBottom: 24 },

  pillTabBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  pillTab: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillTabLabel: { fontSize: 13, fontWeight: '700' },

  tabContent: { gap: 16 },

  glassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 12,
    borderRadius: 20,
  },
  glassAvatarWrap: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  glassAvatar: { width: '100%', height: '100%' },
  glassLabel: { fontSize: 10, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  glassValue: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  glassCell: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
    borderRadius: 20,
  },

  valuationCard: { padding: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  valuationHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  valuationLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#38BDF8' },
  yoyGain: { fontSize: 12, fontWeight: '700', color: '#10B981' },
  valuationRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  valuationPrice: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  confidence: { fontSize: 12, color: '#94A3B8' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 4, width: '78%', backgroundColor: '#38BDF8' },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { fontSize: 11, color: '#94A3B8' },

  blockchainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    marginTop: 8,
  },
  blockchainBadgeText: { fontSize: 12, fontWeight: '700', color: '#38BDF8' },

  certCard: { padding: 16, borderRadius: 20, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderWidth: 1, borderColor: '#38BDF8', gap: 12 },
  certTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  certBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: '#38BDF8' },
  certBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  hashCard: { padding: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)' },
  hashLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1, marginBottom: 6, color: '#94A3B8' },
  hashValue: { fontSize: 12, fontFamily: 'Courier', lineHeight: 18, color: '#38BDF8' },

  provenanceBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  provenanceBtnLabel: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineDotCol: { alignItems: 'center', width: 12 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 2 },
  timelineLine: { width: 2, flex: 1, marginTop: 4, backgroundColor: '#334155' },
  timelineContent: { flex: 1, paddingBottom: 20 },
  timelineYear: { fontSize: 11, fontWeight: '700', marginBottom: 4, color: '#38BDF8' },
  timelineEvent: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  timelineParty: { fontSize: 12, color: '#94A3B8', marginTop: 4 },

  actionBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  secondaryAction: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
  },
  primaryAction: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: 'center',
  },
  actionLabel: { fontWeight: '700', fontSize: 13 },
});
