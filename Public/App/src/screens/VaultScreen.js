// ─── VaultScreen ──────────────────────────────────────────────────────────────
// My portfolio vault — owned assets and fractional holdings

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { VAULT_ASSETS } from '../constants/data';

export default function VaultScreen({ navigation, isDark }) {
  const c = useColors(isDark);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.warm }]}>My Vault</Text>
          <Text style={[styles.sub, { color: c.muted }]}>Your verified assets & holdings</Text>
        </View>

        {/* ── Portfolio summary ── */}
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: isDark ? '#13223A' : '#E0F2FE', borderColor: c.border },
          ]}
        >
          <View style={styles.summaryHeader}>
            <Text style={[styles.summaryLabel, { color: c.primary }]}>TOTAL PORTFOLIO</Text>
            <View style={[styles.gainBadge, { backgroundColor: c.greenBg }]}>
              <Text style={[styles.gainText, { color: c.green }]}>↑ +5.8% MoM</Text>
            </View>
          </View>
          <Text style={[styles.totalValue, { color: c.warm }]}>£68,040</Text>
          <View style={styles.summaryStats}>
            {[['3', 'Holdings'], ['2', 'Whole Assets'], ['1', 'Fractional']].map(([v, l]) => (
              <View
                key={l}
                style={[styles.statCell, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <Text style={[styles.statVal, { color: c.primary }]}>{v}</Text>
                <Text style={[styles.statLbl, { color: c.muted }]}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Holdings list ── */}
        <Text style={[styles.sectionTitle, { color: c.warm }]}>Holdings</Text>

        {VAULT_ASSETS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.holdingCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() =>
              navigation.navigate(SCREENS.ASSET_DETAIL, {
                asset: {
                  ...item,
                  priceNum: 0,
                  owner: '',
                  year: 2024,
                  condition: '',
                  cert: '',
                  trending: false,
                  shares: 0,
                  sharePrice: 0,
                  sharesSold: 0,
                },
              })
            }
            activeOpacity={0.9}
          >
            <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="cover" />
            <View style={styles.holdingMeta}>
              <Text style={[styles.holdingCategory, { color: c.primary }]}>{item.category}</Text>
              <Text style={[styles.holdingName, { color: c.warm }]} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
            <View style={styles.holdingRight}>
              <Text style={[styles.holdingValue, { color: c.warm }]}>{item.price}</Text>
              <Text style={[styles.holdingGain, { color: item.positive ? c.green : c.red }]}>
                {item.gain} ({item.gainPct})
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 13, marginTop: 2 },
  summaryCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
  },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  gainBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  gainText: { fontSize: 11, fontWeight: '700' },
  totalValue: { fontSize: 30, fontWeight: '800', marginBottom: 12 },
  summaryStats: { flexDirection: 'row', gap: 8 },
  statCell: { flex: 1, alignItems: 'center', padding: 8, borderRadius: 16, borderWidth: 1 },
  statVal: { fontSize: 14, fontWeight: '700' },
  statLbl: { fontSize: 10, fontWeight: '500' },
  sectionTitle: { fontSize: 15, fontWeight: '700', paddingHorizontal: 20, marginBottom: 12 },
  holdingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  holdingMeta: { flex: 1, gap: 3 },
  holdingCategory: { fontSize: 10, fontWeight: '600' },
  holdingName: { fontSize: 13, fontWeight: '700' },
  holdingRight: { alignItems: 'flex-end', gap: 3 },
  holdingValue: { fontSize: 13, fontWeight: '700' },
  holdingGain: { fontSize: 11, fontWeight: '600' },
});
