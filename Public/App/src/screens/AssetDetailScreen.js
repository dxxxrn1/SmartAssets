// ─── AssetDetailScreen ────────────────────────────────────────────────────────
// Hero image + Overview / Certificate / Provenance tabs + action bar

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Badge } from '../components/ui';
import { Feather } from '@expo/vector-icons';

const TABS = ['overview', 'cert', 'history'];

export default function AssetDetailScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const asset = route?.params?.asset ?? {};
  const [activeTab, setActiveTab] = useState('overview');

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

        {/* Badge top right */}
        <View style={styles.heroBadge}>
          <Badge
            text={asset.badge ?? 'Verified'}
            variant={asset.badge === 'Verified' ? 'verified' : 'pending'}
            isDark={isDark}
          />
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
            Listed by {asset.owner}
          </Text>
        </View>

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
                  style={[styles.infoCell, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <Text style={[styles.infoCellLabel, { color: c.muted }]}>
                    {String(label).toUpperCase()}
                  </Text>
                  <Text style={[styles.infoCellValue, { color: c.warm }]}>{value}</Text>
                </View>
              ))}
            </View>

            {/* AI Valuation card */}
            <View style={[styles.valuationCard, { backgroundColor: c.card, borderColor: c.border }]}>
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
                <Text style={[styles.rangeText, { color: c.muted }]}>Low: £31,000</Text>
                <Text style={[styles.rangeText, { color: c.muted }]}>High: £37,500</Text>
              </View>
            </View>
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

            <View style={[styles.hashCard, { backgroundColor: c.card, borderColor: c.border }]}>
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
              style={[styles.provenanceBtn, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => navigation.navigate(SCREENS.PROVENANCE, { asset })}
            >
              <Text style={[styles.provenanceBtnLabel, { color: c.warm }]}>
                View Full Provenance Timeline
              </Text>
              <Feather name="chevron-right" size={16} color={c.primary} />
            </TouchableOpacity>

            {[
              { yr: '2024', ev: 'Submitted to SmartAssets & Verified' },
              { yr: '2021', ev: "Purchased at Christie's London" },
              { yr: '2019', ev: 'Rolex Authorised Dealer Delivery' },
              { yr: '2019', ev: 'Manufactured in Geneva, Switzerland' },
            ].map((e, i) => (
              <View key={i} style={styles.timelineRow}>
                <View style={styles.timelineDotCol}>
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: i === 0 ? c.primary : c.border },
                    ]}
                  />
                  {i < 3 && (
                    <View style={[styles.timelineLine, { backgroundColor: c.border }]} />
                  )}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={[styles.timelineYear, { color: c.primary }]}>{e.yr}</Text>
                  <Text style={[styles.timelineEvent, { color: c.warm }]}>{e.ev}</Text>
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
          style={[styles.primaryAction, { backgroundColor: c.primary }]}
          onPress={() => navigation.navigate(SCREENS.CHECKOUT, { asset })}
        >
          <Text style={[styles.actionLabel, { color: '#FFFFFF' }]}>Buy Now</Text>
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
});
