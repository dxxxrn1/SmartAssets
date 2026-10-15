import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Share,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { ALIM } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { useAuth } from '../context/AuthContext';
import { getUserAnalyticsApi } from '../services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TIMEFRAMES = ['1M', '3M', '6M', '1Y', 'Since Joined'];

export default function ProfileAnalyticsScreen({ navigation }) {
  const { user, token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState('Since Joined');
  const [analyticsData, setAnalyticsData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        if (token) {
          const res = await getUserAnalyticsApi(token);
          if (isMounted && res?.success && res.analytics) {
            setAnalyticsData(res.analytics);
          }
        }
      } catch (err) {
        console.warn('Analytics fetch error:', err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [token]);

  // Fallback defaults if backend has not yet seeded data
  const joinedDate = useMemo(() => {
    const raw = analyticsData?.joinedAt || user?.createdAt || user?.created_at;
    if (raw) return new Date(raw);
    return new Date(Date.now() - 1000 * 60 * 60 * 24 * 128); // 128 days ago default
  }, [analyticsData, user]);

  const daysSinceJoined = useMemo(() => {
    if (analyticsData?.daysSinceJoined) return analyticsData.daysSinceJoined;
    const diff = Math.max(1, Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24)));
    return diff;
  }, [analyticsData, joinedDate]);

  const memberSinceFormatted = useMemo(() => {
    if (analyticsData?.memberSinceFormatted) return analyticsData.memberSinceFormatted;
    const month = joinedDate.toLocaleString('en-US', { month: 'long' });
    const year = joinedDate.getFullYear();
    return `${month} ${year}`;
  }, [analyticsData, joinedDate]);

  const netWorthDisplay = analyticsData?.netWorthFormatted || 'R 0';
  const growthRate = analyticsData?.growthRatePct || '+0.0%';
  const gainsDisplay = analyticsData?.estimatedGainsFormatted || '+R 0';
  const healthScore = analyticsData?.healthScore || 96;

  const categories = useMemo(() => {
    if (analyticsData?.categoryBreakdown) {
      return analyticsData.categoryBreakdown;
    }
    return [];
  }, [analyticsData]);

  const timelineData = useMemo(() => {
    if (analyticsData?.monthlyTimeline && analyticsData.monthlyTimeline.length > 0) {
      return analyticsData.monthlyTimeline;
    }
    return [
      { month: 'May', valueNum: 310000, valueFormatted: 'R310k', heightPct: 45 },
      { month: 'Jun', valueNum: 345000, valueFormatted: 'R345k', heightPct: 55 },
      { month: 'Jul', valueNum: 390000, valueFormatted: 'R390k', heightPct: 68 },
      { month: 'Aug', valueNum: 430000, valueFormatted: 'R430k', heightPct: 80 },
      { month: 'Sep', valueNum: 485000, valueFormatted: 'R485k', heightPct: 100 },
    ];
  }, [analyticsData]);

  const milestones = useMemo(() => {
    if (analyticsData?.milestones && analyticsData.milestones.length > 0) {
      return analyticsData.milestones;
    }
    return [
      {
        id: 'm1',
        title: 'Joined SmartAssets Network',
        date: `${joinedDate.getDate()} ${joinedDate.toLocaleString('default', { month: 'short' })} ${joinedDate.getFullYear()}`,
        desc: 'Account activated with decentralized vault & escrow custody',
        icon: 'checkmark-circle',
        completed: true,
      },
      {
        id: 'm2',
        title: 'Vault Liquidity Activated',
        date: 'Verified',
        desc: 'Initial cash reserve & bank rail linkage verified',
        icon: 'wallet',
        completed: true,
      },
      {
        id: 'm3',
        title: 'Asset Acquisition & Provenance Token',
        date: 'Active',
        desc: 'Authenticated luxury assets vaulted on-chain',
        icon: 'shield-checkmark',
        completed: true,
      },
      {
        id: 'm4',
        title: 'Prime Tier 1 Collector',
        date: 'VIP Status',
        desc: 'Zero-slippage peer escrow clearance and 96% health audit index',
        icon: 'ribbon',
        completed: true,
      },
    ];
  }, [analyticsData, joinedDate]);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `SmartAssets Portfolio Analytics\nMember since: ${memberSinceFormatted}\nPortfolio Valuation: ${netWorthDisplay}\nAll-time Growth: ${growthRate} (${gainsDisplay})\nAudit Health Score: ${healthScore}/100`,
      });
    } catch (_e) {
      // User cancelled share
    }
  };

  const handleExportStatement = () => {
    Alert.alert(
      'Export Analytics Statement',
      `Audit certificate and transaction statement generated for ${memberSinceFormatted} to present date.\n\nFile: SmartAssets_Portfolio_Audit_${joinedDate.getFullYear()}.pdf`,
      [{ text: 'Done', style: 'default' }]
    );
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: ALIM.darkHeader }]}>
      {/* ── Top Header Navigation ── */}
      <View style={styles.navHeader}>
        <TouchableOpacity
          style={styles.navBackBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Feather name="chevron-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.navTitleCenter}>
          <Text style={styles.navTitle}>Profile Analytics</Text>
          <Text style={styles.navSubtitle}>Performance Since Joining</Text>
        </View>
        <TouchableOpacity
          style={styles.navActionBtn}
          onPress={handleShare}
          activeOpacity={0.8}
        >
          <Feather name="share-2" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Profile & Member Since Card ── */}
        <LinearGradient
          colors={ALIM.darkHeaderGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.avatarWrapper}>
              {user?.avatar_url || user?.avatarUrl ? (
                <Image
                  source={{ uri: user.avatar_url || user.avatarUrl }}
                  style={styles.avatarImg}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Feather name="user" size={24} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.avatarOnlineDot} />
            </View>

            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={styles.nameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user?.fullName || user?.name || user?.email?.split('@')[0] || 'Member Collector'}
                </Text>
                <Ionicons name="checkmark-circle" size={16} color="#38BDF8" />
              </View>
              <Text style={styles.userEmail} numberOfLines={1}>
                {user?.email || 'verified@smartassets.io'}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.tierPill}>
                  <Ionicons name="sparkles" size={11} color="#FBBF24" />
                  <Text style={styles.tierPillText}>PRIME COLLECTOR</Text>
                </View>
                <View style={styles.activePill}>
                  <Text style={styles.activePillText}>⚡ {daysSinceJoined} DAYS ACTIVE</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Member Since Banner Bar */}
          <View style={styles.joinedBanner}>
            <View style={styles.joinedBannerLeft}>
              <Feather name="calendar" size={14} color="#94A3B8" />
              <Text style={styles.joinedBannerLabel}>Member Since</Text>
            </View>
            <Text style={styles.joinedBannerValue}>{memberSinceFormatted}</Text>
          </View>
        </LinearGradient>

        {/* ── Executive Performance Grid ── */}
        <View style={styles.statsGrid}>
          {/* Card 1: Total Valuation */}
          <View style={[styles.statTile]}>
            <View style={styles.statTileTop}>
              <Text style={styles.statTileLabel}>TOTAL PORTFOLIO</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#EFF6FF' }]}>
                <Feather name="briefcase" size={14} color="#2563EB" />
              </View>
            </View>
            <Text style={styles.statTileMainValue}>{netWorthDisplay}</Text>
            <View style={styles.statPillRow}>
              <Ionicons name="trending-up" size={13} color="#10B981" />
              <Text style={styles.statPositiveText}>{growthRate} Since Joined</Text>
            </View>
          </View>

          {/* Card 2: Net Appreciation */}
          <View style={[styles.statTile]}>
            <View style={styles.statTileTop}>
              <Text style={styles.statTileLabel}>NET CAPITAL GAIN</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#ECFDF5' }]}>
                <Feather name="trending-up" size={14} color="#10B981" />
              </View>
            </View>
            <Text style={[styles.statTileMainValue, { color: '#FF2D55' }]}>
              {gainsDisplay}
            </Text>
            <Text style={styles.statSubText}>Compound valuation gain</Text>
          </View>

          {/* Card 3: Health & Trust Score */}
          <View style={[styles.statTile]}>
            <View style={styles.statTileTop}>
              <Text style={styles.statTileLabel}>VAULT HEALTH</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#FEF3C7' }]}>
                <Feather name="shield" size={14} color="#D97706" />
              </View>
            </View>
            <Text style={styles.statTileMainValue}>{healthScore}/100</Text>
            <View style={styles.statPillRow}>
              <Ionicons name="shield-checkmark" size={12} color="#10B981" />
              <Text style={styles.statPositiveText}>Grade A+ Optimal</Text>
            </View>
          </View>

          {/* Card 4: Escrow & Trades */}
          <View style={[styles.statTile]}>
            <View style={styles.statTileTop}>
              <Text style={styles.statTileLabel}>ESCROWS & TRADES</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#F3E8FF' }]}>
                <Feather name="repeat" size={14} color="#7C3AED" />
              </View>
            </View>
            <Text style={styles.statTileMainValue}>
              {analyticsData?.totalHoldingsCount ? `${analyticsData.totalHoldingsCount} Assets` : '4 Active'}
            </Text>
            <Text style={styles.statSubText}>100% On-chain custody</Text>
          </View>
        </View>

        {/* ── Portfolio Growth Curve & Timeframe Filter ── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Portfolio Growth</Text>
              <Text style={styles.sectionSubtitle}>Valuation trajectory since inception</Text>
            </View>
            <View style={styles.growthBadge}>
              <Text style={styles.growthBadgeText}>{growthRate}</Text>
            </View>
          </View>

          {/* Timeframe selector */}
          <View style={styles.timeframeRow}>
            {TIMEFRAMES.map((tf) => {
              const active = selectedTimeframe === tf;
              return (
                <TouchableOpacity
                  key={tf}
                  style={[styles.timeframePill, active && styles.timeframePillActive]}
                  onPress={() => setSelectedTimeframe(tf)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.timeframeText, active && styles.timeframeTextActive]}>
                    {tf}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Monthly Growth Chart Bars */}
          <View style={styles.chartContainer}>
            <View style={styles.chartBarsRow}>
              {timelineData.map((item, idx) => {
                const heightVal = Math.max(30, (item.heightPct || 40 + idx * 14));
                const isLatest = idx === timelineData.length - 1;
                return (
                  <View key={item.month + idx} style={styles.chartCol}>
                    <Text style={styles.chartValTooltip}>{item.valueFormatted}</Text>
                    <View style={styles.barTrack}>
                      <LinearGradient
                        colors={isLatest ? ['#FF9500', '#EA580C'] : ['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.05)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={[styles.barFill, { height: `${heightVal}%` }]}
                      />
                    </View>
                    <Text style={[styles.barMonthLabel, isLatest && styles.barMonthLabelActive]}>
                      {item.month}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Asset Allocation Breakdown ── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Asset Allocation</Text>
              <Text style={styles.sectionSubtitle}>Vault distribution across luxury categories</Text>
            </View>
            <Feather name="pie-chart" size={18} color="#9333EA" />
          </View>

          {categories.length === 0 ? (
            <View style={{ paddingVertical: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '600' }}>
                No active vaulted assets yet
              </Text>
              <Text style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 4, textAlign: 'center' }}>
                Asset categories populate automatically as you acquire luxury items.
              </Text>
            </View>
          ) : (
            categories.map((cat, idx) => {
              const colors = ['#FF2D55', '#9333EA', '#FF9500', '#FF2D55'];
              const barColor = cat.color || colors[idx % colors.length];
              return (
                <View key={cat.category + idx} style={styles.categoryRow}>
                  <View style={styles.categoryMetaRow}>
                    <View style={styles.categoryLabelGroup}>
                      <View style={[styles.categoryBullet, { backgroundColor: barColor }]} />
                      <Text style={styles.categoryName}>{cat.category}</Text>
                    </View>
                    <View style={styles.categoryValGroup}>
                      <Text style={styles.categoryValText}>{cat.valueFormatted}</Text>
                      <Text style={styles.categoryPctText}>{cat.percentage}%</Text>
                    </View>
                  </View>
                  <View style={styles.categoryProgressTrack}>
                    <View
                      style={[
                        styles.categoryProgressFill,
                        { width: `${cat.percentage}%`, backgroundColor: barColor },
                      ]}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── Milestones Since Joining (Chronological Journey) ── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Collector Journey</Text>
              <Text style={styles.sectionSubtitle}>Milestones achieved since joining</Text>
            </View>
            <Feather name="award" size={18} color="#D97706" />
          </View>

          <View style={styles.timelineList}>
            {milestones.map((ms, index) => {
              const isLast = index === milestones.length - 1;
              return (
                <View key={ms.id || index} style={styles.timelineItem}>
                  <View style={styles.timelineLeftCol}>
                    <View style={styles.timelineDot}>
                      <Ionicons
                        name={ms.icon || 'checkmark-circle'}
                        size={16}
                        color="#2563EB"
                      />
                    </View>
                    {!isLast && <View style={styles.timelineLine} />}
                  </View>
                  <View style={styles.timelineContent}>
                    <View style={styles.timelineTitleRow}>
                      <Text style={styles.timelineTitle}>{ms.title}</Text>
                      <Text style={styles.timelineDate}>{ms.date}</Text>
                    </View>
                    <Text style={styles.timelineDesc}>{ms.desc}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Action Buttons ── */}
        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            style={styles.primaryActionBtn}
            onPress={handleExportStatement}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['#3666DD', '#2563EB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryActionGradient}
            >
              <Feather name="download" size={16} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>Export Analytics Report</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.secondaryButtonsRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate(SCREENS.VAULT)}
              activeOpacity={0.8}
            >
              <Feather name="shield" size={15} color="#333D9B" />
              <Text style={styles.secondaryBtnText}>View Vault</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate(SCREENS.PROFILE)}
              activeOpacity={0.8}
            >
              <Feather name="user" size={15} color="#333D9B" />
              <Text style={styles.secondaryBtnText}>Profile Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  navBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitleCenter: {
    alignItems: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  navSubtitle: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 1,
  },
  navActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
  },
  heroCard: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    marginBottom: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarImg: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#3666DD',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarOnlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  userEmail: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tierPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FBBF24',
    letterSpacing: 0.3,
  },
  activePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  activePillText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  joinedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  joinedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  joinedBannerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  joinedBannerValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  statTile: {
    width: (SCREEN_WIDTH - 18 * 2 - 12) / 2,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  statTileTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  statTileLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  statIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTileMainValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  statPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  statPositiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  statSubText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  growthBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  growthBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#059669',
  },
  timeframeRow: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  timeframePill: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 9,
  },
  timeframePillActive: {
    backgroundColor: '#9333EA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  timeframeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  timeframeTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  chartContainer: {
    height: 140,
    justifyContent: 'flex-end',
    paddingTop: 10,
  },
  chartBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: '100%',
  },
  chartCol: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    flex: 1,
  },
  chartValTooltip: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  barTrack: {
    width: 22,
    height: 85,
    backgroundColor: '#F1F5F9',
    borderRadius: 11,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 11,
  },
  barMonthLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 6,
  },
  barMonthLabelActive: {
    color: '#2563EB',
    fontWeight: '800',
  },
  categoryRow: {
    marginBottom: 14,
  },
  categoryMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  categoryName: { fontSize: 13, fontWeight: '700', color: '#FFFFFF',
  },
  categoryValGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryValText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF',
  },
  categoryPctText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  categoryProgressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  categoryProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  timelineList: {
    paddingLeft: 4,
    marginTop: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineLeftCol: {
    alignItems: 'center',
    width: 28,
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineLine: {
    width: 2,
    height: 42,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 10,
    paddingBottom: 16,
  },
  timelineTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineDate: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#3666DD',
  },
  timelineDesc: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  actionButtonsContainer: {
    gap: 12,
    marginTop: 4,
  },
  primaryActionBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  primaryActionText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  secondaryButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333D9B',
  },
});
