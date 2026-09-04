// ─── InvestScreen (Fractional) ────────────────────────────────────────────────
// Fractional ownership — invest tab with asset share listings

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { getMarketAssets } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';

export default function InvestScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { user } = useAuth();

  const [offerings, setOfferings] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      getMarketAssets()
        .then((res) => {
          if (!cancelled) {
            setOfferings(Array.isArray(res?.assets) ? res.assets : []);
          }
        })
        .catch((err) => console.warn('InvestScreen fetch error:', err))
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [])
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.warm }]}>Fractional Invest</Text>
          <Text style={[styles.sub, { color: c.muted }]}>
            Co-own verified luxury assets from R100/share
          </Text>
        </View>

        {/* ── Summary stats ── */}
        <View style={[styles.statsCard, { backgroundColor: c.card, borderColor: c.border }]}>
          {[
            [
              'R' +
                offerings
                  .reduce((sum, o) => sum + (Number(o.price_num) || 0), 0)
                  .toLocaleString('en-ZA'),
              'Total Pool',
            ],
            [String(offerings.length), 'Offerings'],
            [
              String(
                offerings.reduce(
                  (sum, o) => sum + (Number(o.shares || 100) - Number(o.sharesSold || 0)),
                  0
                )
              ),
              'Shares Open',
            ],
          ].map(([value, label]) => (
            <View key={label} style={styles.statItem}>
              <Text style={[styles.statValue, { color: c.primary }]}>{value}</Text>
              <Text style={[styles.statLabel, { color: c.muted }]}>{label}</Text>
            </View>
          ))}
        </View>

        {/* ── Section: Available to invest ── */}
        <Text style={[styles.sectionTitle, { color: c.warm }]}>Available Offerings</Text>

        {loading ? (
          <ActivityIndicator size="large" color={c.primary} style={{ marginTop: 32 }} />
        ) : offerings.length === 0 ? (
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 32, fontSize: 14 }}>
            No offerings available right now.
          </Text>
        ) : (
          offerings.map((asset) => {
            const totalShares = asset.shares || 100;
            const sharePrice = asset.sharePrice || asset.share_price || Math.round((asset.price_num || 1000) / totalShares);
            const sharesSold = asset.sharesSold || asset.shares_sold || 0;
            const pct = Math.min(100, Math.round((sharesSold / totalShares) * 100));
            const isOwner = Boolean(user?.id && (user.id === asset.userId || user.id === asset.user_id));
            const isFunded = sharesSold >= totalShares;

            return (
              <TouchableOpacity
                key={asset.id}
                style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => navigation.navigate(SCREENS.ASSET_DETAIL, { asset })}
                activeOpacity={0.9}
              >
                {/* Thumbnail + info */}
                <View style={styles.cardTop}>
                  <Image source={{ uri: asset.image }} style={styles.thumb} resizeMode="cover" />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[styles.cardCategory, { color: c.primary }]}>{asset.category}</Text>
                      {isOwner && (
                        <View style={{ backgroundColor: c.primaryBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ color: c.primary, fontSize: 10, fontWeight: '700' }}>Your Listing</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.cardName, { color: c.warm }]} numberOfLines={2}>
                      {asset.name}
                    </Text>
                    <Text style={[styles.sharePrice, { color: c.muted }]}>
                      R{sharePrice.toLocaleString()} / share
                    </Text>
                  </View>
                </View>

                {/* Funding bar */}
                <View style={styles.fundingSection}>
                  <View style={styles.fundingHeader}>
                    <Text style={[styles.fundingLabel, { color: c.muted }]}>
                      {sharesSold}/{totalShares} shares sold
                    </Text>
                    <Text style={[styles.fundingPct, { color: c.primary }]}>{pct}%</Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                    <View
                      style={[styles.progressFill, { width: `${pct}%`, backgroundColor: c.primary }]}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.investBtn,
                    {
                      backgroundColor: isOwner || isFunded ? c.cardLight : c.primary,
                      borderWidth: isOwner ? 1 : 0,
                      borderColor: c.border,
                    },
                  ]}
                  onPress={() => {
                    if (isOwner) {
                      Alert.alert(
                        'Self-Investment Restricted',
                        'You listed this collectible. Platform rules prohibit investing in your own listings.'
                      );
                    } else if (isFunded) {
                      Alert.alert('Offering Closed', 'This collectible is 100% funded and closed to new investors.');
                    } else {
                      navigation.navigate(SCREENS.CHECKOUT, { asset, isFractional: true });
                    }
                  }}
                  activeOpacity={isOwner || isFunded ? 0.9 : 0.8}
                >
                  <Text style={[styles.investBtnLabel, { color: isOwner || isFunded ? c.muted : '#FFFFFF' }]}>
                    {isOwner ? 'Your Listing (Cannot Invest)' : isFunded ? '100% Funded (Closed)' : 'Invest Now'}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  sub: { fontSize: 13 },
  statsCard: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'space-around',
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', paddingHorizontal: 20, marginBottom: 12 },
  card: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
  },
  cardTop: { flexDirection: 'row', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  cardCategory: { fontSize: 10, fontWeight: '600' },
  cardName: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  sharePrice: { fontSize: 12 },
  fundingSection: { gap: 6 },
  fundingHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  fundingLabel: { fontSize: 11 },
  fundingPct: { fontSize: 12, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  investBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  investBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
