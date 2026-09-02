// ─── VerificationScreen ───────────────────────────────────────────────────────
// Asset verification status tracker — appraiser progress steps

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '../constants/theme';

const VERIFICATION_STEPS = [
  { title: 'Submitted', detail: 'Asset received and documentation checked', status: 'done' },
  { title: 'Appraiser Assigned', detail: 'Dr. William Chen — Senior Appraiser', status: 'done' },
  { title: 'Physical Inspection', detail: 'In progress — expected 2 business days', status: 'active' },
  { title: 'Certificate Issued', detail: 'Blockchain certificate generation pending', status: 'pending' },
  { title: 'Live on Marketplace', detail: 'Ready for buyers', status: 'pending' },
];

export default function VerificationScreen({ navigation, isDark }) {
  const c = useColors(isDark);

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
        <Text style={[styles.navTitle, { color: c.warm }]}>Verification Status</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Status card ── */}
        <View style={[styles.statusCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.statusLabel, { color: c.primary }]}>VERIFICATION IN PROGRESS</Text>
          <Text style={[styles.assetName, { color: c.warm }]}>Rolex Daytona 116500LN</Text>
          <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
            <View style={[styles.progressFill, { width: '60%', backgroundColor: c.primary }]} />
          </View>
          <Text style={[styles.progressText, { color: c.muted }]}>Step 3 of 5</Text>
        </View>

        {/* ── Steps timeline ── */}
        {VERIFICATION_STEPS.map((step, i) => {
          const isDone = step.status === 'done';
          const isActive = step.status === 'active';

          return (
            <View key={i} style={styles.stepRow}>
              <View style={styles.dotCol}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: isDone
                        ? c.green
                        : isActive
                        ? c.primary
                        : c.card,
                      borderColor: isDone
                        ? c.green
                        : isActive
                        ? c.primary
                        : c.border,
                    },
                  ]}
                >
                  {isDone ? (
                    <Feather name="check" size={11} color="#FFFFFF" />
                  ) : isActive ? (
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} />
                  ) : (
                    <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>
                      {String(i + 1)}
                    </Text>
                  )}
                </View>
                {i < VERIFICATION_STEPS.length - 1 && (
                  <View style={[styles.line, { backgroundColor: isDone ? c.green : c.border }]} />
                )}
              </View>
              <View style={styles.stepContent}>
                <Text
                  style={[
                    styles.stepTitle,
                    {
                      color: isDone || isActive ? c.warm : c.muted,
                    },
                  ]}
                >
                  {step.title}
                </Text>
                <Text style={[styles.stepDetail, { color: c.muted }]}>{step.detail}</Text>
                {isActive && (
                  <View
                    style={[styles.activeBadge, { backgroundColor: c.primaryBg, borderColor: c.primary }]}
                  >
                    <Text style={[styles.activeBadgeText, { color: c.primary }]}>In Progress</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* ── Estimated completion ── */}
        <View
          style={[styles.etaCard, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <Text style={[styles.etaLabel, { color: c.muted }]}>ESTIMATED COMPLETION</Text>
          <Text style={[styles.etaDate, { color: c.warm }]}>3 September 2026</Text>
          <Text style={[styles.etaNote, { color: c.muted }]}>
            You will receive a notification when your certificate is ready.
          </Text>
        </View>
      </ScrollView>
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
  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  statusCard: { padding: 16, borderRadius: 22, borderWidth: 1, gap: 8 },
  statusLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  assetName: { fontSize: 16, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressText: { fontSize: 11 },
  stepRow: { flexDirection: 'row', gap: 12 },
  dotCol: { alignItems: 'center', width: 28 },
  dot: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  line: { width: 2, flex: 1, marginVertical: 4 },
  stepContent: { flex: 1, paddingBottom: 16, gap: 3 },
  stepTitle: { fontSize: 14, fontWeight: '700' },
  stepDetail: { fontSize: 12, lineHeight: 17 },
  activeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
  },
  activeBadgeText: { fontSize: 11, fontWeight: '700' },
  etaCard: { padding: 16, borderRadius: 18, borderWidth: 1, gap: 4 },
  etaLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  etaDate: { fontSize: 18, fontWeight: '700' },
  etaNote: { fontSize: 12, lineHeight: 17 },
});
