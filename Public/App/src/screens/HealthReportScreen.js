// ─── HealthReportScreen ───────────────────────────────────────────────────────
// AI-generated asset health: overall score ring + category breakdown

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
import { HEALTH_SCORES } from '../constants/data';
import { Feather } from '@expo/vector-icons';

export default function HealthReportScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const asset = route?.params?.asset ?? {};

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
          <View>
            <Text style={[styles.navTitle, { color: c.warm }]}>Asset Health Report</Text>
            <Text style={[styles.navSub, { color: c.muted }]}>{asset.name}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Overall score card ── */}
        <View style={[styles.overallCard, { backgroundColor: c.card, borderColor: c.border }]}>
          {/* Circular score ring — TODO: replace with SVG/react-native-svg */}
          <View style={[styles.scoreRing, { borderColor: c.primary }]}>
            <Text style={[styles.scoreNum, { color: c.warm }]}>92</Text>
            <Text style={[styles.scoreOutOf, { color: c.muted }]}>/100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.overallLabel, { color: c.muted }]}>OVERALL HEALTH SCORE</Text>
            <Text style={[styles.gradeText, { color: c.primary }]}>Pristine Grade A+</Text>
            <Text style={[styles.gradeDesc, { color: c.muted }]}>
              Exceeds all platform safety and authenticity criteria
            </Text>
          </View>
        </View>

        {/* ── Score breakdown ── */}
        {HEALTH_SCORES.map((s) => (
          <View
            key={s.label}
            style={[styles.scoreRow, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={styles.scoreMeta}>
              <Text style={[styles.scoreCategoryLabel, { color: c.warm }]}>{s.label}</Text>
              <Text style={[styles.scoreValue, { color: s.color }]}>
                {s.invert ? `${s.score}% Risk` : `${s.score}%`}
              </Text>
            </View>
            <View style={[styles.scoreTrack, { backgroundColor: c.border }]}>
              <View
                style={[
                  styles.scoreFill,
                  {
                    width: `${s.invert ? 100 - s.score : s.score}%`,
                    backgroundColor: s.color,
                  },
                ]}
              />
            </View>
          </View>
        ))}

        {/* ── AI Recommendation card ── */}
        <View style={[styles.recommendCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.recommendLabel, { color: c.primary }]}>AI RECOMMENDATION</Text>
          <Text style={[styles.recommendTitle, { color: c.warm }]}>Strong Buy Signal</Text>
          <Text style={[styles.recommendBody, { color: c.muted }]}>
            This asset scores in the top 8% of all SmartAssets listings. Low fraud risk,
            excellent provenance, and strong market demand suggest it is a secure investment.
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
  navSub: { fontSize: 10 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  overallCard: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
  },
  scoreRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: { fontSize: 24, fontWeight: '800' },
  scoreOutOf: { fontSize: 9, fontWeight: '600', marginTop: -2 },
  overallLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 3 },
  gradeText: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  gradeDesc: { fontSize: 11, lineHeight: 15 },
  scoreRow: {
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
  },
  scoreMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  scoreCategoryLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
  scoreValue: { fontSize: 12, fontWeight: '700' },
  scoreTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 4 },
  recommendCard: { padding: 16, borderRadius: 18, borderWidth: 1, gap: 6 },
  recommendLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  recommendTitle: { fontSize: 16, fontWeight: '700' },
  recommendBody: { fontSize: 12, lineHeight: 18 },
});
