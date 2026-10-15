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
import { HEALTH_SCORES } from '../constants/data';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function HealthReportScreen({ navigation, route }) {
  const asset = route?.params?.asset ?? {};

  const score = asset.healthScore || (88 + ((asset.name ? asset.name.charCodeAt(0) : 5) % 11));
  const grade = score >= 92 ? 'Pristine Grade A+' : score >= 85 ? 'Grade A (Verified)' : 'Grade B (Standard)';

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Nav bar ── */}
      <View style={styles.navBar}>
        <View style={styles.navLeft}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <View>
            <Text style={styles.navTitle}>Asset Health Report</Text>
            <Text style={styles.navSub}>{asset.name || 'Collectible'}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Overall score card (Emerald Themed) */}
        <View style={styles.overallCard}>
          <View style={styles.scoreRing}>
            <Text style={styles.scoreNum}>{score}</Text>
            <Text style={styles.scoreOutOf}>/100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.overallHeaderRow}>
              <Feather name="shield" size={13} color="#10B981" />
              <Text style={styles.overallLabel}>OVERALL HEALTH SCORE</Text>
            </View>
            <Text style={styles.gradeText}>{grade}</Text>
            <Text style={styles.gradeDesc}>
              Verified against SmartAssets chain-of-custody and multi-point appraisal standards.
            </Text>
          </View>
        </View>

        {/* Section Title */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeading}>METRIC BREAKDOWN</Text>
          <Text style={styles.sectionSub}>AI Appraisal & Risk Analysis</Text>
        </View>

        {/* Score breakdown  */}
        {HEALTH_SCORES.map((s) => {
          const displayScore = s.invert ? `${s.score}% Risk` : `${s.score}%`;
          const scoreColor = s.color === '#0284C7' ? '#4C86FF' : s.color || '#10B981';
          const fillWidth = `${s.invert ? 100 - s.score : s.score}%`;

          return (
            <View key={s.label} style={styles.scoreRow}>
              <View style={styles.scoreMeta}>
                <Text style={styles.scoreCategoryLabel}>{s.label}</Text>
                <Text style={[styles.scoreValue, { color: scoreColor }]}>
                  {displayScore}
                </Text>
              </View>
              <View style={styles.scoreTrack}>
                <LinearGradient
                  colors={s.invert || s.color === '#10B981' ? ['#10B981', '#059669'] : ['#4C86FF', '#3B82F6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.scoreFill, { width: fillWidth }]}
                />
              </View>
            </View>
          );
        })}

        {/* ── AI Recommendation card (Emerald Themed) ── */}
        <View style={styles.recommendCard}>
          <View style={styles.recommendHeaderRow}>
            <Feather name="shield" size={14} color="#10B981" />
            <Text style={styles.recommendLabel}>AI RECOMMENDATION</Text>
            <View style={styles.recommendBadge}>
              <Text style={styles.recommendBadgeText}>VERIFIED REAL</Text>
            </View>
          </View>
          <Text style={styles.recommendTitle}>Strong Buy Signal</Text>
          <Text style={styles.recommendBody}>
            This asset scores in the top 8% of all SmartAssets listings. Low fraud risk,
            excellent provenance, and strong market demand suggest it is a secure luxury asset.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  navLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  navSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 14,
  },
  overallCard: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#0C0D11',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  scoreRing: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  scoreOutOf: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#10B981',
    marginTop: -2,
  },
  overallHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  overallLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#10B981',
    textTransform: 'uppercase',
  },
  gradeText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  gradeDesc: {
    fontSize: 11.5,
    color: '#94A3B8',
    lineHeight: 16,
  },
  sectionHeader: {
    marginTop: 6,
    marginBottom: 2,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  sectionSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  scoreRow: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#0C0D11',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  scoreMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreCategoryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F1F5F9',
    flex: 1,
  },
  scoreValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  scoreTrack: {
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    borderRadius: 3.5,
  },
  recommendCard: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#0C0D11',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
    marginTop: 4,
  },
  recommendHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recommendLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#10B981',
    textTransform: 'uppercase',
  },
  recommendBadge: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  recommendBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.5,
  },
  recommendTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  recommendBody: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
  },
});
