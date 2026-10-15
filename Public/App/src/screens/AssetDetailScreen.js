// ─── AssetDetailScreen ────────────────────────────────────────────────────────
// Product Listing Page — unified with the Luminous Purple & Cyan Fintech theme (Mockup 4).
// Featuring Breadcrumb Header, Hero Image Showcase with Verified Badges, AI Fair Value Card,
// Overview/Provenance/Documents Tabs with Specs Grid, Smart Take Accent Card, and Action Bar.

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Linking,
  Alert,
  Dimensions,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { SCREENS } from '../constants/navigation';
import { getAssetDetails } from '../services/api';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');
const TABS = ['overview', 'history', 'cert'];

const CANVAS_MESH = [
  'rgba(216, 214, 253, 1)',
  '#d5cdffff',
  '#fae3f4ff',
  '#fff0e6ff',
  '#FFF7EF',
];

const formatGBP = (val, fallback = '£34,500') => {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'string' && val.startsWith('£')) return val;
  if (typeof val === 'string' && val.startsWith('R')) return '£' + val.replace(/^R\s?/, '');
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
  if (isNaN(num)) return String(val);
  return '£' + num.toLocaleString('en-GB', { maximumFractionDigits: 0 });
};

export default function AssetDetailScreen({ navigation, route }) {
  const { user } = useAuth();
  const initialAsset = route?.params?.asset ?? {};
  const [asset, setAsset] = useState(initialAsset);
  const [activeTab, setActiveTab] = useState('overview');
  const [history, setHistory] = useState([]);
  const [showHash, setShowHash] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const imageScrollRef = useRef(null);

  useEffect(() => {
    if (initialAsset.id) {
      getAssetDetails(initialAsset.id)
        .then((res) => {
          if (res?.asset) {
            setAsset((prev) => ({ ...prev, ...res.asset }));
          }
          if (res?.history && res.history.length > 0) {
            setHistory(res.history);
          }
        })
        .catch(() => {
          // Gracefully retain initialAsset passed via route params
        });
    }
  }, [initialAsset.id]);

  const isOwner = Boolean(
    user?.id && (user.id === asset.userId || user.id === asset.user_id)
  );

  // Extract all images (primary image, images array, or embedded in description)
  const extractAllImages = (item) => {
    const list = [];
    if (Array.isArray(item?.images) && item.images.length > 0) {
      item.images.forEach((img) => {
        if (img && !list.includes(img)) list.push(img);
      });
    }
    if (item?.image && !list.includes(item.image)) {
      list.unshift(item.image);
    }
    const rawDesc = item?.description || '';
    if (rawDesc.includes('<!--images:')) {
      const match = rawDesc.match(/<!--images:([\s\S]*?)-->/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          if (Array.isArray(parsed)) {
            parsed.forEach((img) => {
              if (img && !list.includes(img)) list.push(img);
            });
          }
        } catch (_) {}
      }
    }
    return list.length > 0 ? list : [item?.image].filter(Boolean);
  };

  const allImages = extractAllImages(asset);
  const cleanDescription = (asset.description || '')
    .replace(/<!--images:[\s\S]*?-->/g, '')
    .trim();

  // Price calculations for range
  const priceNum = typeof asset.price === 'number'
    ? asset.price
    : parseFloat(String(asset.price || '34500').replace(/[^0-9.-]+/g, '')) || 34500;
  const lowPrice = Math.round(priceNum * 0.92);
  const highPrice = Math.round(priceNum * 1.08);

  return (
    <View style={styles.container}>
      {/* ── Soft Luminous 6-Stop Mesh Gradient Background ── */}
      <LinearGradient
        colors={CANVAS_MESH}
        locations={[0, 0.2, 0.5, 0.8, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        {/* ── Top Header Bar / Breadcrumb Navigation ── */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Feather name="arrow-left" size={18} color="#0F172A" />
          </TouchableOpacity>

          <View style={styles.breadcrumbWrap}>
            <Text style={styles.breadcrumbMuted}>Marketplace</Text>
            <Feather name="chevron-right" size={14} color="#94A3B8" style={{ marginHorizontal: 4 }} />
            <Text style={styles.breadcrumbActive}>Investment spotlight</Text>
          </View>

          <TouchableOpacity
            style={styles.shareBtn}
            activeOpacity={0.8}
            onPress={() => {
              Alert.alert('Share Asset', `Share link copied for ${asset.name || 'Luxury Asset'}`);
            }}
          >
            <Feather name="share-2" size={16} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* ── Scrollable Body Content ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ════════════════════════════════════════════════════════════════════
              1. HERO IMAGE CARD WITH FLOATING BADGES & TITLE OVERLAY (Mockup 4)
          ════════════════════════════════════════════════════════════════════ */}
          <View style={styles.heroCard}>
            <ScrollView
              ref={imageScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const cardWidth = width - 40;
                const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
                if (idx >= 0 && idx < allImages.length) {
                  setActiveImageIdx(idx);
                }
              }}
              style={styles.heroImageScroll}
            >
              {allImages.map((imgUri, idx) => (
                <TouchableOpacity
                  key={idx}
                  activeOpacity={0.92}
                  onPress={() => setFullscreenImage(imgUri)}
                  style={styles.heroImageSlide}
                >
                  <Image
                    source={{ uri: imgUri }}
                    style={styles.heroImg}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Top Badges overlay: 🛡️ Fully verified & Limited edition */}
            <View style={styles.heroBadgesOverlay}>
              <View style={styles.heroBadgePill}>
                <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.heroBadgeText}>Fully verified</Text>
              </View>
              <View style={styles.heroBadgePill}>
                <Text style={styles.heroBadgeText}>Limited edition</Text>
              </View>
            </View>

            {/* Bottom title & category overlay vignette */}
            <LinearGradient
              colors={['transparent', 'rgba(15, 23, 42, 0.45)', 'rgba(15, 23, 42, 0.90)']}
              locations={[0, 0.4, 1]}
              style={styles.heroBottomOverlay}
            >
              <Text style={styles.heroCategoryText}>
                {`${(asset.category || 'COLLECTOR WATCH').toUpperCase()} · ${asset.year || '2019'}`}
              </Text>
              <Text style={styles.heroTitleText} numberOfLines={2}>
                {asset.name || 'Rolex Daytona 116500LN'}
              </Text>
            </LinearGradient>

            {/* Gallery Dots & Photo Counter (if multiple photos exist) */}
            {allImages.length > 1 && (
              <View style={styles.galleryCounterRow}>
                <View style={styles.dotsRow}>
                  {allImages.map((_, i) => (
                    <View
                      key={i}
                      style={[styles.dot, i === activeImageIdx && styles.dotActive]}
                    />
                  ))}
                </View>
                <View style={styles.photoCountBadge}>
                  <Feather name="camera" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
                  <Text style={styles.photoCountText}>
                    {activeImageIdx + 1}/{allImages.length}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Multiple Photos Thumbnails Carousel */}
          {allImages.length > 1 && (
            <View style={styles.thumbStripWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbStrip}>
                {allImages.map((imgUri, i) => {
                  const isSelected = i === activeImageIdx;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => {
                        setActiveImageIdx(i);
                        imageScrollRef.current?.scrollTo({ x: i * (width - 40), animated: true });
                      }}
                      style={[styles.thumbItem, isSelected && styles.thumbItemActive]}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: imgUri }} style={styles.thumbImg} resizeMode="cover" />
                      {isSelected && (
                        <View style={styles.thumbActiveBadge}>
                          <Feather name="check" size={10} color="#FFFFFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              2. AI FAIR VALUE CARD (Signature Mockup 4 Element)
          ════════════════════════════════════════════════════════════════════ */}
          <View style={styles.whiteCard}>
            <View style={styles.fairValueHeader}>
              <Text style={styles.fairValueLabel}>AI FAIR VALUE</Text>
              <View style={styles.gainBadge}>
                <Text style={styles.gainBadgeText}>+12.4%</Text>
              </View>
            </View>

            <Text style={styles.priceHeading}>{formatGBP(asset.price)}</Text>

            {/* Valuation Confidence Progress */}
            <View style={styles.confidenceBlock}>
              <View style={styles.confidenceRow}>
                <Text style={styles.confidenceTitle}>Valuation confidence</Text>
                <Text style={styles.confidencePct}>96%</Text>
              </View>

              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={['#976af0', '#00fbff']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: '96%' }]}
                />
              </View>

              <View style={styles.rangeRow}>
                <Text style={styles.rangeText}>£{lowPrice.toLocaleString('en-GB')} low</Text>
                <Text style={styles.rangeText}>£{highPrice.toLocaleString('en-GB')} high</Text>
              </View>
            </View>

            {/* 4-Metric Grid (2x2) */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>+18%</Text>
                <Text style={styles.metricSub}>Demand</Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>24 days</Text>
                <Text style={styles.metricSub}>Liquidity</Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>{asset.condition || 'A+'}</Text>
                <Text style={styles.metricSub}>Condition</Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricVal}>1 of 500</Text>
                <Text style={styles.metricSub}>Scarcity</Text>
              </View>
            </View>

            {/* Make an offer CTA Button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                isOwner && styles.primaryBtnDisabled,
              ]}
              onPress={() => {
                if (isOwner) {
                  Alert.alert('Self-Purchase Restricted', 'You listed this collectible. Platform rules prohibit buying or investing in items you listed yourself.');
                } else {
                  navigation.navigate(SCREENS.CHECKOUT, { asset });
                }
              }}
              activeOpacity={isOwner ? 0.9 : 0.85}
            >
              {isOwner ? (
                <View style={styles.ownerListingBtn}>
                  <Feather name="slash" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
                  <Text style={styles.ownerListingText}>Your Listing</Text>
                </View>
              ) : (
                <LinearGradient
                  colors={['#976af0', '#00fbff']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGradient}
                >
                  <Text style={styles.primaryBtnText}>Make an offer →</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>

            <View style={styles.escrowNoticeRow}>
              <Ionicons name="lock-closed" size={12} color="#64748B" style={{ marginRight: 4 }} />
              <Text style={styles.escrowNoticeText}>Protected by SmartAssets escrow</Text>
            </View>
          </View>

          {/* ════════════════════════════════════════════════════════════════════
              3. TABBED SPECS CARD (Overview, Provenance, Documents)
          ════════════════════════════════════════════════════════════════════ */}
          <View style={styles.whiteCard}>
            {/* Pill Tabs Header */}
            <View style={styles.tabsRow}>
              {TABS.map((tab) => {
                const isActive = activeTab === tab;
                const label = tab === 'cert' ? 'Documents' : tab === 'history' ? 'Provenance' : 'Overview';
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.tabPill, isActive && styles.tabPillActive]}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* TAB: Overview */}
            {activeTab === 'overview' && (
              <View style={styles.tabBody}>
                <Text style={styles.descriptionText}>
                  {cleanDescription ||
                    'The ceramic-bezel Daytona is one of the most liquid modern collector watches. This example includes its original box, warranty card and full service history, with condition independently graded A+.'}
                </Text>

                {/* 4 Specification Chips (YEAR, CASE, MOVEMENT, INCLUDED) */}
                <View style={styles.specsGrid}>
                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>YEAR</Text>
                    <Text style={styles.specValue}>{asset.year || '2019'}</Text>
                  </View>

                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>CASE</Text>
                    <Text style={styles.specValue}>{asset.condition?.includes('Steel') ? 'Steel' : 'Oystersteel'}</Text>
                  </View>

                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>MOVEMENT</Text>
                    <Text style={styles.specValue}>Automatic</Text>
                  </View>

                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>INCLUDED</Text>
                    <Text style={styles.specValue}>Full set</Text>
                  </View>
                </View>

                {/* Owner & Creator metadata */}
                <View style={styles.metaRow}>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Current Owner</Text>
                    <Text style={styles.metaVal}>{asset.owner || 'Verified Collector'}</Text>
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Category</Text>
                    <Text style={styles.metaVal}>{asset.category || 'Luxury Watch'}</Text>
                  </View>
                </View>

                {/* Sepolia Blockchain Badge */}
                <TouchableOpacity
                  style={styles.blockchainBadge}
                  onPress={() =>
                    Linking.openURL(
                      asset.etherscanUrl ||
                        (asset.txHash
                          ? `https://sepolia.etherscan.io/tx/${asset.txHash}`
                          : 'https://sepolia.etherscan.io')
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Feather name="link-2" size={14} color="#7C3AED" />
                  <Text style={styles.blockchainBadgeText}>
                    {asset.tokenId
                      ? `Token #${asset.tokenId} · Sepolia Etherscan ↗`
                      : 'ERC-721 Cryptographic Token · Sepolia ↗'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* TAB: Provenance History */}
            {activeTab === 'history' && (
              <View style={styles.tabBody}>
                <TouchableOpacity
                  style={styles.timelineBanner}
                  onPress={() => navigation.navigate(SCREENS.PROVENANCE, { asset, history })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.timelineBannerText}>View Interactive Provenance</Text>
                  <Feather name="arrow-right" size={14} color="#7C3AED" />
                </TouchableOpacity>

                {(history.length > 0
                  ? history
                  : [
                      { year: String(asset.year || '2019'), event: 'Acquired via Authorized Retailer', party: 'Geneva Custodian' },
                      { year: '2023', event: 'Certified Servicing & Pressure Testing', party: 'Independent Horology Lab' },
                      { year: '2024', event: 'SmartAssets Vault Ingestion & Tokenized Listing', party: 'London Vault #4' },
                    ]
                ).map((e, i, arr) => (
                  <View key={i} style={[styles.timelineItem, i < arr.length - 1 && { marginBottom: 16 }]}>
                    <View style={styles.timelineDotWrap}>
                      <View style={[styles.timelineDot, i === 0 && styles.timelineDotHighlight]} />
                      {i < arr.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineTextCol}>
                      <Text style={styles.timelineYear}>{e.year || e.yr}</Text>
                      <Text style={styles.timelineEvent}>{e.event || e.ev}</Text>
                      {e.party ? <Text style={styles.timelineParty}>📍 {e.party}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* TAB: Documents / Certificate */}
            {activeTab === 'cert' && (
              <View style={styles.tabBody}>
                <View style={styles.certCard}>
                  <Text style={styles.certHeading}>DIGITAL ASSET CERTIFICATE</Text>
                  <Text style={styles.certTitle}>{asset.name}</Text>
                  <Text style={styles.certSub}>
                    Dual-verified authentication record with embedded SHA-256 fingerprint.
                  </Text>
                  <TouchableOpacity
                    style={styles.certBtn}
                    onPress={() => navigation.navigate(SCREENS.CERTIFICATE, { asset })}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#7C3AED', '#5B36F5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.certBtnGradient}
                    >
                      <Text style={styles.certBtnText}>Open Full Digital Certificate</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>

                {/* Hash disclosure */}
                <View style={styles.hashWrap}>
                  <View style={styles.hashHeader}>
                    <Text style={styles.hashLabel}>BLOCKCHAIN HASH</Text>
                    <TouchableOpacity onPress={() => setShowHash(!showHash)}>
                      <Text style={styles.hashToggle}>{showHash ? 'Hide' : 'Reveal'}</Text>
                    </TouchableOpacity>
                  </View>
                  {showHash && (
                    <Text style={styles.hashText} numberOfLines={2}>
                      0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c2d5b7e0f3a6c9d2e5b8f1a4c7e0d3b6f
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* ════════════════════════════════════════════════════════════════════
              4. SLEEK DARK "SMART TAKE" ACCENT CARD (Mockup 4 Feature)
          ════════════════════════════════════════════════════════════════════ */}
          <View style={styles.smartTakeCard}>
            <View style={styles.smartTakeHeader}>
              <Ionicons name="sparkles" size={14} color="#A78BFA" style={{ marginRight: 6 }} />
              <Text style={styles.smartTakeTag}>SMART TAKE</Text>
            </View>

            <Text style={styles.smartTakeTitle}>A high-conviction collectible.</Text>
            <Text style={styles.smartTakeBody}>
              Low supply and strong global demand place this asset in the top 8% of our watch index.
              Backed by verified provenance and secondary liquidity.
            </Text>
          </View>
        </ScrollView>

        {/* ── Bottom Floating Action Bar ── */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.healthReportBtn}
            onPress={() => navigation.navigate(SCREENS.HEALTH_REPORT, { asset })}
            activeOpacity={0.8}
          >
            <Feather name="activity" size={16} color="#0F172A" style={{ marginRight: 6 }} />
            <Text style={styles.healthReportText}>Health Report</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.bottomOfferBtn,
              isOwner && styles.bottomOfferBtnDisabled,
            ]}
            onPress={() => {
              if (isOwner) {
                Alert.alert('Self-Purchase Restricted', 'You listed this collectible.');
              } else {
                navigation.navigate(SCREENS.CHECKOUT, { asset });
              }
            }}
            activeOpacity={isOwner ? 0.9 : 0.85}
          >
            <LinearGradient
              colors={['#976af0', '#00fbff']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.bottomOfferGradient}
            >
              <Text style={styles.bottomOfferText}>
                {isOwner ? 'Your Listing' : 'Make an offer →'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* ── Fullscreen Image Preview Modal ── */}
      <Modal visible={Boolean(fullscreenImage)} transparent animationType="fade">
        <View style={styles.fullscreenModalOverlay}>
          <SafeAreaView style={styles.fullscreenModalSafe}>
            <View style={styles.fullscreenTopBar}>
              <Text style={styles.fullscreenTitle} numberOfLines={1}>{asset.name}</Text>
              <TouchableOpacity
                style={styles.fullscreenCloseBtn}
                onPress={() => setFullscreenImage(null)}
              >
                <Feather name="x" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.fullscreenImgWrap}>
              {fullscreenImage && (
                <Image
                  source={{ uri: fullscreenImage }}
                  style={styles.fullscreenImg}
                  resizeMode="contain"
                />
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#d8d6fd',
  },
  safe: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  breadcrumbWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbMuted: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  breadcrumbActive: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '800',
  },
  shareBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },

  // 1. Hero Image Card
  heroCard: {
    width: '100%',
    height: 310,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  heroImageScroll: {
    width: '100%',
    height: '100%',
  },
  heroImageSlide: {
    width: width - 40,
    height: 310,
  },
  heroImg: {
    width: '100%',
    height: '100%',
  },
  heroBadgesOverlay: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    gap: 8,
    zIndex: 10,
  },
  heroBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  heroBottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 36,
  },
  heroCategoryText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#CBD5E1',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  heroTitleText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  galleryCounterRow: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  dotActive: {
    width: 14,
    backgroundColor: '#00fbff',
  },
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  photoCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Thumbnails Strip
  thumbStripWrap: {
    marginTop: -4,
  },
  thumbStrip: {
    flexDirection: 'row',
    gap: 10,
  },
  thumbItem: {
    width: 62,
    height: 62,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
  },
  thumbItemActive: {
    borderColor: '#7C3AED',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbActiveBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 2. White Cards
  whiteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
    gap: 14,
  },
  fairValueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fairValueLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1.2,
  },
  gainBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  gainBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#16A34A',
  },
  priceHeading: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.6,
  },

  // Confidence Block
  confidenceBlock: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confidenceTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  confidencePct: {
    fontSize: 13,
    fontWeight: '800',
    color: '#7C3AED',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },

  // 4-Metric Grid (2x2)
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: (width - 40 - 40 - 10) / 2,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricVal: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },

  // Make an Offer Button
  primaryBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#976af0',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 4,
  },
  primaryBtnDisabled: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  ownerListingBtn: {
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerListingText: {
    color: '#94A3B8',
    fontWeight: '800',
    fontSize: 15,
  },
  escrowNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  escrowNoticeText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },

  // 3. Tabbed Specs Card
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 12,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
  },
  tabPillActive: {
    backgroundColor: '#7C3AED',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tabBody: {
    gap: 14,
    paddingTop: 4,
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 21,
    color: '#334155',
    fontWeight: '500',
  },
  specsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specChip: {
    width: (width - 40 - 40 - 24) / 4,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  specLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  specValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  metaCol: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  metaVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  blockchainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: 'rgba(151, 106, 240, 0.3)',
  },
  blockchainBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7C3AED',
  },

  // Provenance Tab
  timelineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: 'rgba(151, 106, 240, 0.25)',
  },
  timelineBannerText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7C3AED',
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineDotWrap: {
    alignItems: 'center',
    width: 14,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#CBD5E1',
    marginTop: 3,
  },
  timelineDotHighlight: {
    backgroundColor: '#7C3AED',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginTop: 4,
  },
  timelineTextCol: {
    flex: 1,
    gap: 2,
  },
  timelineYear: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7C3AED',
  },
  timelineEvent: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineParty: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
  },

  // Documents Tab
  certCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  certHeading: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#7C3AED',
  },
  certTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  certSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
  },
  certBtn: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 6,
  },
  certBtnGradient: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  certBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  hashWrap: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  hashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hashLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
  },
  hashToggle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7C3AED',
  },
  hashText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#64748B',
    marginTop: 4,
  },

  // 4. Dark "Smart Take" Card
  smartTakeCard: {
    backgroundColor: '#1E1B4B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(151, 106, 240, 0.3)',
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  smartTakeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  smartTakeTag: {
    fontSize: 10,
    fontWeight: '900',
    color: '#A78BFA',
    letterSpacing: 1.2,
  },
  smartTakeTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  smartTakeBody: {
    fontSize: 13,
    lineHeight: 20,
    color: '#CBD5E1',
    fontWeight: '500',
  },

  // Bottom Floating Bar
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.9)',
  },
  healthReportBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthReportText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  bottomOfferBtn: {
    flex: 1.3,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#976af0',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomOfferBtnDisabled: {
    backgroundColor: '#F1F5F9',
    shadowOpacity: 0,
    elevation: 0,
  },
  bottomOfferGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomOfferText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  // Fullscreen Modal
  fullscreenModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  fullscreenModalSafe: {
    flex: 1,
  },
  fullscreenTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  fullscreenTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 16,
  },
  fullscreenCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImgWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fullscreenImg: {
    width: '100%',
    height: '100%',
  },
});
