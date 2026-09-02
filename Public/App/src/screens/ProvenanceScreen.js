// ─── ProvenanceScreen ─────────────────────────────────────────────────────────
// Full provenance timeline — chain of custody authenticated events

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
import { PROVENANCE_EVENTS } from '../constants/data';

const EVENT_ICONS = ['file-text', 'check', 'link', 'tag', 'shopping-bag', 'box'];

export default function ProvenanceScreen({ navigation, route, isDark }) {
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
            <Text style={[styles.navTitle, { color: c.warm }]}>Provenance Timeline</Text>
            <Text style={[styles.navSub, { color: c.muted }]}>{asset.name}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Verified banner ── */}
        <View style={[styles.verifiedBanner, { backgroundColor: c.greenBg, borderColor: 'rgba(16,185,129,0.3)' }]}>
          <View style={[styles.verifiedIcon, { backgroundColor: c.green }]}>
            <Feather name="check" size={14} color="#FFFFFF" />
          </View>
          <View>
            <Text style={[styles.verifiedTitle, { color: c.green }]}>100% Provenance Verified</Text>
            <Text style={[styles.verifiedSub, { color: c.muted }]}>
              Chain of custody authenticated by certified specialists
            </Text>
          </View>
        </View>

        {/* ── Timeline ── */}
        {PROVENANCE_EVENTS.map((event, i) => (
          <View key={i} style={styles.timelineRow}>
            <View style={styles.dotCol}>
              <View style={[styles.dot, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
                <Feather name={EVENT_ICONS[i % EVENT_ICONS.length]} size={12} color={c.primary} />
              </View>
              {i < PROVENANCE_EVENTS.length - 1 && (
                <View style={[styles.line, { backgroundColor: c.border }]} />
              )}
            </View>
            <View style={styles.eventContent}>
              <Text style={[styles.eventDate, { color: c.primary }]}>{event.date}</Text>
              <Text style={[styles.eventTitle, { color: c.warm }]}>{event.title}</Text>
              <Text style={[styles.eventDetail, { color: c.muted }]}>{event.detail}</Text>
            </View>
          </View>
        ))}
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
  navSub: { fontSize: 10, fontWeight: '500' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  verifiedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
  },
  verifiedIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedTitle: { fontSize: 13, fontWeight: '700' },
  verifiedSub: { fontSize: 11, marginTop: 1 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  dotCol: { alignItems: 'center', width: 32 },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotIcon: { fontSize: 14 },
  line: { width: 2, flex: 1, marginVertical: 4 },
  eventContent: { flex: 1, paddingBottom: 20 },
  eventDate: { fontSize: 10, fontWeight: '700', fontFamily: 'Courier', marginBottom: 2 },
  eventTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  eventDetail: { fontSize: 12, lineHeight: 17 },
});
