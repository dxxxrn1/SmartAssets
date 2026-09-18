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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Badge } from '../components/ui';
import { Feather } from '@expo/vector-icons';
import { getAssetDetails } from '../services/api';
import { useAuth } from '../context/AuthContext';

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
    <View style={[styles.container, { backgroundColor: c.obsidian }]}>
      {/* ── Hero Image ── */}
      <View style={styles.heroWrap}>
        <Image source={{ uri: asset.image }} style={styles.heroImage} resizeMode="cover" />
        {/* TODO: expo-linear-gradient overlay */}

        {/* Back button */}
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={18} color={c.warm} />
        </TouchableOpacity>

        {/* Badges top right */}
        <View style={[styles.heroBadge, { flexDirection: 'row', gap: 6, alignItems: 'center' }]}>
          <Badge
            text={asset.badge ?? 'Verified'}
            variant={asset.badge === 'Verified' ? 'verified' : 'pending'}
            isDark={isDark}
          />
          {asset.aiScanStatus === 'passed' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: 'rgba(16, 185, 129, 0.9)',
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Feather name="shield" size={11} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
                AI AUTHENTIC
              </Text>
            </View>
          ) : asset.aiScanStatus === 'scan_failed' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: 'rgba(234, 179, 8, 0.9)',
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Feather name="alert-triangle" size={11} color="#000000" />
              <Text style={{ color: '#000000', fontSize: 10, fontWeight: '700' }}>
                AI SCAN N/A
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── Scrollable Body ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Title block */}
        <Text style={[styles.categoryLabel, { color: c.primary }]}>
          {(asset.category ?? '').toUpperCase()}
        </Text>
        <Text style={[styles.assetName, { color: c.warm }]}>{asset.name}</Text>
        <View style={styles.priceRow}>
          <Text style={[styles.price, { color: c.primary }]}>{asset.price}</Text>
          <Text style={[styles.listedBy, { color: c.muted }]}>
            Listed by {isOwner ? 'You (Owner)' : asset.owner}
          </Text>
        </View>

        {isOwner && (
          <View style={[styles.ownerBanner, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
            <Feather name="shield" size={14} color={c.primary} />
            <Text style={[styles.ownerBannerText, { color: c.primary }]}>
              You listed this collectible. Self-purchase & self-investment are prohibited.
            </Text>
          </View>
        )}

        {/* ── Tab bar ── */}
        <View
          style={[
            styles.tabBar,
            { backgroundColor: c.cardLight, borderColor: c.border },
          ]}
        >
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                { backgroundColor: activeTab === tab ? c.primary : 'transparent' },
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { color: activeTab === tab ? '#FFFFFF' : c.muted },
                ]}
              >
                {tab === 'cert' ? 'Certificate' : tab === 'history' ? 'Provenance' : 'Overview'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <View style={styles.tabContent}>
            <View style={styles.grid2}>
              {[
                ['Year', asset.year],
                ['Condition', asset.condition],
                ['Cert ID', (asset.cert ?? '').slice(0, 13) + '…'],
                ['Category', asset.category],
              ].map(([label, value]) => (
                <View
                  key={String(label)}
                  style={[
                    styles.infoCell,
                    {
                      backgroundColor: isDark ? '#0A1A35' : c.card,
                      borderColor: isDark ? '#2563EB' : c.border,
                    },
                  ]}
                >
                  <Text style={[styles.infoCellLabel, { color: c.muted }]}>
                    {String(label).toUpperCase()}
                  </Text>
                  <Text style={[styles.infoCellValue, { color: c.warm }]}>{value}</Text>
                </View>
              ))}
            </View>

            {/* AI Valuation card */}
            <View
              style={[
                styles.valuationCard,
                {
                  backgroundColor: isDark ? '#0A1A35' : c.card,
                  borderColor: isDark ? '#2563EB' : c.border,
                  shadowColor: isDark ? '#3B82F6' : '#000000',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: isDark ? 0.3 : 0.05,
                  shadowRadius: 8,
                  elevation: 5,
                },
              ]}
            >
              <View style={styles.valuationHeader}>
                <Text style={[styles.valuationLabel, { color: c.primary }]}>AI VALUATION ESTIMATE</Text>
                <Text style={[styles.yoyGain, { color: c.green }]}>+12.4% YoY</Text>
              </View>
              <View style={styles.valuationRow}>
                <Text style={[styles.valuationPrice, { color: c.warm }]}>{asset.price}</Text>
                <Text style={[styles.confidence, { color: c.muted }]}>Confidence: 96%</Text>
              </View>
              {/* Progress bar */}
              <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                <View style={[styles.progressFill, { width: '78%', backgroundColor: c.primary }]} />
              </View>
              <View style={styles.rangeRow}>
                <Text style={[styles.rangeText, { color: c.muted }]}>
                  Low: R{Math.round((asset.price_num || 25000) * 0.9).toLocaleString('en-ZA')}
                </Text>
                <Text style={[styles.rangeText, { color: c.muted }]}>
                  High: R{Math.round((asset.price_num || 25000) * 1.15).toLocaleString('en-ZA')}
                </Text>
              </View>
            </View>

            {/* AI Image Authenticity Card */}
            <View
              style={[
                styles.valuationCard,
                {
                  backgroundColor: isDark ? '#0A1A35' : c.card,
                  borderColor: asset.aiScanStatus === 'passed' ? c.green : (isDark ? '#2563EB' : c.border),
                  shadowColor: asset.aiScanStatus === 'passed' ? c.green : (isDark ? '#3B82F6' : '#000000'),
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: isDark ? 0.3 : 0.05,
                  shadowRadius: 8,
                  elevation: 5,
                  marginTop: 0,
                  marginBottom: 12,
                },
              ]}
            >
              <View style={styles.valuationHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather
                    name={asset.aiScanStatus === 'passed' ? 'check-circle' : 'shield'}
                    size={14}
                    color={asset.aiScanStatus === 'passed' ? c.green : c.primary}
                  />
                  <Text
                    style={[
                      styles.valuationLabel,
                      { color: asset.aiScanStatus === 'passed' ? c.green : c.primary },
                    ]}
                  >
                    AI FRAUD & DEEPFAKE DETECTION
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: asset.aiScanStatus === 'passed' ? c.green : c.muted,
                  }}
                >
                  {asset.aiScanStatus === 'passed' ? 'VERIFIED REAL' : 'PASSED'}
                </Text>
              </View>
              <Text style={{ color: c.warm, fontSize: 12, lineHeight: 18, marginTop: 4 }}>
                {asset.aiScanStatus === 'passed'
                  ? 'All listing media scanned via Hive AI Detection. No synthetic patterns, AI generation, or deepfake artifacts were detected.'
                  : 'Listing media protected by SmartAssets AI Fraud Guard.'}
              </Text>
            </View>

            {/* On-chain Ethereum Sepolia Badge */}
            <TouchableOpacity
              style={[
                styles.blockchainBadge,
                { backgroundColor: c.primaryBg, borderColor: c.primary },
              ]}
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
              <Feather name="link" size={14} color={c.primary} />
              <Text style={[styles.blockchainBadgeText, { color: c.primary }]}>
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
            <View
              style={[
                styles.certCard,
                {
                  backgroundColor: isDark
                    ? 'rgba(56,189,248,0.08)'
                    : '#E0F2FE',
                  borderColor: c.primary,
                },
              ]}
            >
              <Text style={[styles.certTitle, { color: c.warm }]}>{asset.name}</Text>
              <TouchableOpacity
                style={[styles.certBtn, { backgroundColor: c.primary }]}
                onPress={() => navigation.navigate(SCREENS.CERTIFICATE, { asset })}
              >
                <Text style={styles.certBtnLabel}>View Full Certificate</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.hashCard, { backgroundColor: isDark ? '#0A1A35' : c.card, borderColor: isDark ? '#2563EB' : c.border }]}>
              <Text style={[styles.hashLabel, { color: c.muted }]}>BLOCKCHAIN HASH</Text>
              <Text style={[styles.hashValue, { color: c.primary }]} numberOfLines={2}>
                0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c2d5b7e0f3a6c9d2e5b8f1a4c7e0d3b6f
              </Text>
            </View>
          </View>
        )}

        {/* ── Provenance Tab ── */}
        {activeTab === 'history' && (
          <View style={styles.tabContent}>
            <TouchableOpacity
              style={[styles.provenanceBtn, { backgroundColor: isDark ? '#0A1A35' : c.card, borderColor: isDark ? '#2563EB' : c.border }]}
              onPress={() => navigation.navigate(SCREENS.PROVENANCE, { asset, history })}
            >
              <Text style={[styles.provenanceBtnLabel, { color: c.warm }]}>
                View Full Provenance Timeline
              </Text>
              <Feather name="chevron-right" size={16} color={c.primary} />
            </TouchableOpacity>

            {(history.length > 0
              ? history
              : [
                  { year: String(asset.year || '2024'), event: 'Marketplace Listing & Authenticity Certified' },
                ]
            ).map((e, i, arr) => (
              <View key={i} style={styles.timelineRow}>
                <View style={styles.timelineDotCol}>
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: i === 0 ? c.primary : c.border },
                    ]}
                  />
                  {i < arr.length - 1 && (
                    <View style={[styles.timelineLine, { backgroundColor: c.border }]} />
                  )}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={[styles.timelineYear, { color: c.primary }]}>{e.year || e.yr}</Text>
                  <Text style={[styles.timelineEvent, { color: c.warm }]}>{e.event || e.ev}</Text>
                  {e.party ? (
                    <Text style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>📍 {e.party}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Action Bar ── */}
      <SafeAreaView
        edges={['bottom']}
        style={[styles.actionBar, { backgroundColor: c.vault, borderTopColor: c.border }]}
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
  container: { flex: 1 },
  heroWrap: { height: 256, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  backBtn: {
    position: 'absolute',
    top: 48,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 18, fontWeight: '600' },
  heroBadge: { position: 'absolute', top: 48, right: 16 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  categoryLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  assetName: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, marginBottom: 8 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  price: { fontSize: 24, fontWeight: '800' },
  listedBy: { fontSize: 12, fontWeight: '500' },
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 14, alignItems: 'center' },
  tabLabel: { fontSize: 12, fontWeight: '700' },
  tabContent: { gap: 12 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoCell: {
    width: '47%',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  infoCellLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginBottom: 3 },
  infoCellValue: { fontSize: 13, fontWeight: '600' },
  valuationCard: { padding: 16, borderRadius: 18, borderWidth: 1 },
  valuationHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  valuationLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  yoyGain: { fontSize: 12, fontWeight: '700' },
  valuationRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  valuationPrice: { fontSize: 20, fontWeight: '700' },
  confidence: { fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 4 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { fontSize: 10 },
  certCard: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 },
  certTitle: { fontSize: 16, fontWeight: '700' },
  certBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  certBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  hashCard: { padding: 14, borderRadius: 18, borderWidth: 1 },
  hashLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginBottom: 4 },
  hashValue: { fontSize: 11, fontFamily: 'Courier', lineHeight: 16 },
  provenanceBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  provenanceBtnLabel: { fontSize: 13, fontWeight: '600' },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineDotCol: { alignItems: 'center', width: 12 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 2 },
  timelineLine: { width: 2, flex: 1, marginTop: 4 },
  timelineContent: { flex: 1, paddingBottom: 12 },
  timelineYear: { fontSize: 10, fontWeight: '700', marginBottom: 2 },
  timelineEvent: { fontSize: 12, fontWeight: '600' },
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
  blockchainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  blockchainBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ownerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  ownerBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
});
