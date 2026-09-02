// ─── CertificateScreen ────────────────────────────────────────────────────────
// Luxury digital certificate — styled card with QR + blockchain hash

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Feather, Ionicons } from '@expo/vector-icons';

export default function CertificateScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const asset = route?.params?.asset ?? {};

  const certFields = [
    ['CERTIFICATE ID', asset.cert],
    ['ISSUED DATE', '14 March 2024'],
    ['CATEGORY', asset.category],
    ['CONDITION', asset.condition],
    ['YEAR', String(asset.year)],
    ['APPRAISER', 'Dr. William Chen'],
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
      {/* ── Nav bar ── */}
      <View style={styles.navBar}>
        <View style={styles.navLeft}>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => navigation.goBack()}
          >
            <Feather name="arrow-left" size={18} color={c.warm} />
          </TouchableOpacity>
          <Text style={[styles.navTitle, { color: c.warm }]}>Certificate of Authenticity</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Certificate Card ── */}
        <View
          style={[
            styles.certCard,
            {
              backgroundColor: isDark ? '#13223A' : '#FFFFFF',
              borderColor: c.primaryLight,
            },
          ]}
        >
          {/* Blue ribbon top */}
          <View style={[styles.ribbon, { backgroundColor: c.primary }]} />

          <View style={styles.certBody}>
            {/* Header row */}
            <View style={styles.certHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.certBrandLabel, { color: c.primary }]}>
                  SMARTASSETS VERIFIED AUTHENTIC
                </Text>
                <Text style={[styles.certAssetName, { color: c.warm }]}>{asset.name}</Text>
              </View>
              <View style={[styles.shieldIcon, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
                <Ionicons name="shield-checkmark" size={20} color={c.primary} />
              </View>
            </View>

            {/* Fields grid */}
            <View style={styles.fieldsGrid}>
              {certFields.map(([label, value]) => (
                <View key={label} style={styles.fieldCell}>
                  <Text style={[styles.fieldLabel, { color: c.muted }]}>{label}</Text>
                  <Text style={[styles.fieldValue, { color: c.warm }]}>{value}</Text>
                </View>
              ))}
            </View>

            {/* QR / hash block */}
            <View style={[styles.hashBlock, { backgroundColor: c.card, borderColor: c.border }]}>
              {/* Simulated QR placeholder */}
              <View style={styles.qrWrap}>
                <Ionicons name="qr-code-outline" size={28} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.hashLabel, { color: c.muted }]}>BLOCKCHAIN RECORD</Text>
                <Text style={[styles.hashValue, { color: c.primary }]} numberOfLines={2}>
                  0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c…
                </Text>
              </View>
            </View>
          </View>

          {/* Blue ribbon bottom */}
          <View style={[styles.ribbon, { backgroundColor: c.primary }]} />
        </View>

        {/* ── Actions ── */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: c.card, borderColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}
          >
            <Feather name="download" size={15} color={c.warm} style={{ marginRight: 6 }} />
            <Text style={[styles.actionLabel, { color: c.warm }]}>Download PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: c.card, borderColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}
          >
            <Feather name="share-2" size={15} color={c.warm} style={{ marginRight: 6 }} />
            <Text style={[styles.actionLabel, { color: c.warm }]}>Share Link</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 18, fontWeight: '600' },
  navTitle: { fontSize: 15, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  certCard: {
    borderRadius: 24,
    borderWidth: 2,
    overflow: 'hidden',
    marginBottom: 20,
  },
  ribbon: { height: 8 },
  certBody: { padding: 20 },
  certHeader: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  certBrandLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'Courier',
    marginBottom: 4,
  },
  certAssetName: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  shieldIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  fieldCell: { width: '46%' },
  fieldLabel: { fontSize: 9, fontWeight: '700', fontFamily: 'Courier', marginBottom: 2 },
  fieldValue: { fontSize: 12, fontWeight: '600' },
  hashBlock: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  qrWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  hashLabel: { fontSize: 9, fontWeight: '700', fontFamily: 'Courier', marginBottom: 3 },
  hashValue: { fontSize: 11, fontFamily: 'Courier' },
  actions: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 12, fontWeight: '700' },
});
