// ─── HomeScreen ───────────────────────────────────────────────────────────────
// Market tab — portfolio stats card, category filter, dynamic asset card list

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Badge } from '../components/ui';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { getUserVault, getMarketAssets } from '../services/api';

const CATEGORIES = ['All', 'Watches', 'Art', 'Cars', 'Wine'];

const CATEGORY_MAP = {
  All: 'All',
  Watches: 'Luxury Watch',
  Art: 'Fine Art',
  Cars: 'Classic Car',
  Wine: 'Fine Wine',
};

export default function HomeScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { user, token, logout } = useAuth();
  const [activeCategory, setActiveCategory] = useState('All');
  const [marketAssets, setMarketAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [vaultSummary, setVaultSummary] = useState({
    totalValueFormatted: 'R0',
    totalCount: 0,
    wholeCount: 0,
    fractionalCount: 0,
    gainText: '+0.0% MoM',
  });

  const loadMarket = useCallback((cat) => {
    setLoadingAssets(true);
    const apiCat = CATEGORY_MAP[cat] || 'All';
    getMarketAssets(apiCat)
      .then((res) => {
        if (res?.assets) setMarketAssets(res.assets);
      })
      .catch((err) => console.warn('Market fetch error:', err.message))
      .finally(() => setLoadingAssets(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      if (token) {
        getUserVault(token)
          .then((res) => {
            if (isMounted && res?.summary) {
              setVaultSummary(res.summary);
            }
          })
          .catch((err) => console.warn('Vault fetch error:', err.message));
      }
      loadMarket(activeCategory);
      return () => { isMounted = false; };
    }, [token, activeCategory, loadMarket])
  );

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of SmartAssets?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const handleCategoryPress = (cat) => {
    setActiveCategory(cat);
    loadMarket(cat);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: c.muted }]}>Welcome back,</Text>
            <Text style={[styles.username, { color: c.warm }]}>
              {user?.fullName || user?.email?.split('@')[0] || 'Member'}
            </Text>
            {user?.walletAddress ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <Ionicons name="wallet-outline" size={12} color={c.primary} />
                <Text style={{ color: c.primary, fontSize: 11, fontWeight: '600' }}>
                  {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)} (Web3)
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => navigation.navigate(SCREENS.SEARCH)}
            >
              <Feather name="search" size={16} color={c.warm} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={handleLogout}
            >
              <Feather name="log-out" size={16} color={c.red} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Portfolio Stats Card (User-Specific) ── */}
        <View
          style={[
            styles.portfolioCard,
            {
              backgroundColor: isDark ? '#13223A' : '#E0F2FE',
              borderColor: c.border,
            },
          ]}
        >
          <View style={styles.portfolioHeader}>
            <Text style={[styles.portfolioLabel, { color: c.primary }]}>YOUR PORTFOLIO VALUE</Text>
            <View style={[styles.gainBadge, { backgroundColor: c.greenBg, flexDirection: 'row', alignItems: 'center', gap: 3 }]}>
              <Feather name="trending-up" size={12} color={c.green} />
              <Text style={[styles.gainText, { color: c.green }]}>{vaultSummary.gainText}</Text>
            </View>
          </View>
          <Text style={[styles.portfolioValue, { color: c.warm }]}>
            {vaultSummary.totalValueFormatted}
          </Text>

          <View style={styles.statsRow}>
            {[
              [String(vaultSummary.totalCount), 'Holdings'],
              [String(vaultSummary.wholeCount), 'Whole'],
              [String(vaultSummary.fractionalCount), 'Fractional'],
            ].map(([v, l]) => (
              <View
                key={l}
                style={[styles.statCell, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <Text style={[styles.statValue, { color: c.primary }]}>{v}</Text>
                <Text style={[styles.statLabel, { color: c.muted }]}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Category Filter ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: activeCategory === cat ? c.primary : c.card,
                  borderColor: activeCategory === cat ? c.primary : c.border,
                },
              ]}
              onPress={() => handleCategoryPress(cat)}
            >
              <Text
                style={[
                  styles.categoryText,
                  { color: activeCategory === cat ? '#FFFFFF' : c.muted },
                ]}
              >
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Featured Listings header ── */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: c.warm }]}>Featured Listings</Text>
          <TouchableOpacity onPress={() => navigation.navigate(SCREENS.SEARCH)}>
            <Text style={[styles.seeAll, { color: c.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {/* ── Asset Cards (Dynamic from Supabase) ── */}
        {loadingAssets ? (
          <View style={{ padding: 36, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={{ color: c.muted, marginTop: 8, fontSize: 12 }}>Loading verified listings…</Text>
          </View>
        ) : marketAssets.length === 0 ? (
          <View style={{ padding: 36, alignItems: 'center' }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>No listings found in this category.</Text>
          </View>
        ) : (
          marketAssets.map((asset) => (
          <TouchableOpacity
            key={asset.id}
            style={[styles.assetCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() =>
              navigation.navigate(SCREENS.ASSET_DETAIL, { asset })
            }
            activeOpacity={0.9}
          >
            {/* Image */}
            <View style={styles.assetImageWrap}>
              <Image source={{ uri: asset.image }} style={styles.assetImage} resizeMode="cover" />
              <View style={styles.assetBadgeWrap}>
                <Badge
                  text={asset.badge || 'Verified'}
                  variant={asset.badge === 'Verified' ? 'verified' : 'pending'}
                  isDark={isDark}
                />
              </View>
              {asset.trending && (
                <View
                  style={[styles.trendingBadge, { backgroundColor: c.primaryBg, borderColor: c.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                >
                  <Ionicons name="flame" size={12} color={c.primary} />
                  <Text style={[styles.trendingText, { color: c.primary }]}>Trending</Text>
                </View>
              )}
              <View style={styles.assetMeta}>
                <Text style={[styles.assetCategory, { color: c.primary }]}>
                  {asset.category.toUpperCase()}
                </Text>
                <Text style={[styles.assetName, { color: c.warm }]}>{asset.name}</Text>
              </View>
            </View>

            {/* Footer */}
            <View
              style={[styles.assetFooter, { backgroundColor: c.cardLight, borderColor: c.border }]}
            >
              <View>
                <Text style={[styles.valueLabel, { color: c.muted }]}>ESTIMATED VALUE</Text>
                <Text style={[styles.assetPrice, { color: c.primary }]}>{asset.price}</Text>
              </View>
              <View style={styles.assetFooterRight}>
                <Text style={[styles.assetYear, { color: c.muted }]}>Est. {asset.year}</Text>
                <View style={[styles.arrowCircle, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="chevron-right" size={15} color={c.primary} />
                </View>
              </View>
            </View>
          </TouchableOpacity>
        ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 24 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  greeting: { fontSize: 12, fontWeight: '500' },
  username: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portfolioCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
  },
  portfolioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  portfolioLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  gainBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  gainText: { fontSize: 11, fontWeight: '700' },
  portfolioValue: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCell: {
    flex: 1,
    alignItems: 'center',
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  statValue: { fontSize: 13, fontWeight: '700' },
  statLabel: { fontSize: 10, fontWeight: '500', marginTop: 1 },
  categories: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 8,
    marginBottom: 12,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryText: { fontSize: 12, fontWeight: '700' },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  seeAll: { fontSize: 12, fontWeight: '600' },
  assetCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  assetImageWrap: {
    height: 176,
    position: 'relative',
  },
  assetImage: { width: '100%', height: '100%' },
  assetBadgeWrap: { position: 'absolute', top: 12, left: 12 },
  trendingBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  trendingText: { fontSize: 10, fontWeight: '700' },
  assetMeta: { position: 'absolute', bottom: 12, left: 14, right: 14 },
  assetCategory: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
  assetName: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  assetFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderTopWidth: 1,
  },
  valueLabel: { fontSize: 10, fontWeight: '500' },
  assetPrice: { fontSize: 16, fontWeight: '800' },
  assetFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assetYear: { fontSize: 12, fontWeight: '500' },
  arrowCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
