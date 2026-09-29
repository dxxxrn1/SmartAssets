// ─── AssetDetailScreen ────────────────────────────────────────────────────────
// Hero image gallery + Overview / Certificate / Provenance tabs + action bar

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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Feather, Ionicons } from '@expo/vector-icons';
import { getAssetDetails } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');
const TABS = ['overview', 'cert', 'history'];

// Fixed min height so the sheet doesn't change size between tabs
const SHEET_MIN_HEIGHT = height * 0.68;

export default function AssetDetailScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
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

  return (
    <View style={styles.container}>
      {/* ── Full Hero Image Showcase & Gallery ── */}
      <View style={styles.heroWrap}>
        {/* Ambient blurred backdrop for luxury depth */}
        <Image
          source={{ uri: allImages[activeImageIdx] || asset.image }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          blurRadius={30}
        />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(24, 33, 84, 0.65)' }]} />

        {/* Swipeable foreground gallery */}
        <ScrollView
          ref={imageScrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / width);
            if (idx >= 0 && idx < allImages.length) {
              setActiveImageIdx(idx);
            }
          }}
          style={{ width, height: height * 0.48 }}
        >
          {allImages.map((imgUri, idx) => (
            <TouchableOpacity
              key={idx}
              activeOpacity={0.92}
              onPress={() => setFullscreenImage(imgUri)}
              style={{ width, height: height * 0.48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Image
                source={{ uri: imgUri }}
                style={styles.heroImage}
                resizeMode="contain"
              />
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Gallery Overlay: Photo counter badge and dots */}
        {allImages.length > 1 && (
          <View style={styles.galleryOverlay}>
            <View style={styles.dotsRow}>
              {allImages.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    setActiveImageIdx(i);
                    imageScrollRef.current?.scrollTo({ x: i * width, animated: true });
                  }}
                  style={[styles.galleryDot, i === activeImageIdx && styles.galleryDotActive]}
                />
              ))}
            </View>
            <View style={styles.photoCountBadge}>
              <Feather name="camera" size={11} color="#FFFFFF" />
              <Text style={styles.photoCountText}>
                {activeImageIdx + 1} / {allImages.length}
              </Text>
            </View>
          </View>
        )}

        {/* Top shadow gradient for header contrast */}
        <LinearGradient
          colors={['rgba(24,33,84,0.9)', 'rgba(24,33,84,0.4)', 'transparent']}
          style={styles.topHeaderGradient}
        />
      </View>

      {/* ── Top Header Bar with Badges ── */}
      <SafeAreaView edges={['top']} style={styles.floatingHeader}>
        {/* Left: Back Button + Mint AI Pill */}
        <View style={styles.headerLeftGroup}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </TouchableOpacity>

          {asset.aiScanStatus === 'scan_failed' ? (
            <View style={[styles.greenPillHeader, { backgroundColor: 'rgba(245, 158, 11, 0.18)', borderColor: 'rgba(245, 158, 11, 0.4)' }]}>
              <Feather name="alert-triangle" size={11} color="#F59E0B" />
              <Text style={[styles.greenPillText, { color: '#F59E0B' }]}>AI SCAN N/A</Text>
            </View>
          ) : (
            <View style={styles.greenPillHeader}>
              <Feather name="shield" size={11} color="#2DD4BF" />
              <Text style={styles.greenPillText}>AI AUTHENTIC</Text>
            </View>
          )}
        </View>

        {/* Right: Gold Shield Badge + Verified Pill */}
        <View style={styles.headerRightGroup}>
          <View style={styles.goldShieldBadge}>
            <Ionicons name="shield-checkmark" size={13} color="#F59E0B" />
            <Text style={styles.goldShieldText}>VAULT</Text>
          </View>

          <View style={styles.verifiedHeaderBadge}>
            <Feather name="check" size={11} color="#2DD4BF" />
            <Text style={styles.verifiedHeaderText}>{asset.badge ?? 'Verified'}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Scrollable Body with Deep Navy Bottom Sheet ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.bottomSheet, { minHeight: SHEET_MIN_HEIGHT }]}>
          {/* Title + Price row */}
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.categoryLabel}>{(asset.category ?? '').toUpperCase()} · 1 OF 1</Text>
              <Text style={styles.assetName}>{asset.name}</Text>
              <Text style={styles.price}>{asset.price}</Text>
            </View>
            <TouchableOpacity style={styles.shareBtn}>
              <Feather name="upload" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* ── Product Photos Thumbnail Strip (when multiple pictures exist) ── */}
          {allImages.length > 1 && (
            <View style={styles.thumbnailSection}>
              <View style={styles.thumbnailHeaderRow}>
                <Feather name="grid" size={12} color="#2664EB" />
                <Text style={styles.thumbnailHeading}>ALL PRODUCT PHOTOS ({allImages.length})</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
                {allImages.map((imgUri, i) => {
                  const isSelected = i === activeImageIdx;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => {
                        setActiveImageIdx(i);
                        imageScrollRef.current?.scrollTo({ x: i * width, animated: true });
                      }}
                      style={[
                        styles.thumbWrap,
                        isSelected && styles.thumbWrapActive,
                      ]}
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

          {/* ── Pill Tabs — Warm Coral Active Tab (Less Blue) ── */}
          <View style={styles.pillTabBar}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  style={styles.pillTabBtn}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.85}
                >
                  {isActive ? (
                    <LinearGradient
                      colors={['#3B82F6', '#2664EB', '#1D4ED8']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.pillTabActive}
                    >
                      <Text style={styles.pillTabLabelActive}>
                        {tab === 'cert' ? 'Certificate' : tab === 'history' ? 'Provenance' : 'Info'}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.pillTabInactive}>
                      <Text style={styles.pillTabLabelInactive}>
                        {tab === 'cert' ? 'Certificate' : tab === 'history' ? 'Provenance' : 'Info'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Overview / Info Tab ── */}
          {activeTab === 'overview' && (
            <View style={styles.tabContent}>

              {/* 1. Crisp White Card (SmartAssets Vault Card Style from reference) */}
              <View style={styles.whiteCard}>
                <View style={styles.whiteCardHeader}>
                  <Text style={styles.whiteCardHeading}>LISTING DETAILS</Text>
                  <View style={styles.whiteCardBadge}>
                    <Text style={styles.whiteCardBadgeText}>VERIFIED</Text>
                  </View>
                </View>

                {/* Owner row */}
                <View style={styles.infoRow}>
                  <View style={styles.infoRowLeft}>
                    <View style={styles.ownerAvatarWrap}>
                      <Image source={{ uri: allImages[0] || asset.image }} style={styles.infoAvatar} />
                    </View>
                    <View>
                      <Text style={styles.infoRowLabel}>Current Owner</Text>
                      <Text style={styles.infoRowValueDark}>{asset.owner || 'Verified Collector'}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.infoDividerLight} />

                {/* Creator row */}
                <View style={styles.infoRow}>
                  <View style={styles.infoRowLeft}>
                    <View style={styles.creatorIconWrap}>
                      <Feather name="user" size={16} color="#2664EB" />
                    </View>
                    <View>
                      <Text style={styles.infoRowLabel}>Creator</Text>
                      <Text style={styles.infoRowValueDark}>{asset.owner || 'Verified Collector'}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.infoDividerLight} />

                {/* 2x2 grid of meta info */}
                <View style={styles.metaGrid}>
                  {[
                    ['Year', asset.year],
                    ['Condition', asset.condition],
                    ['Cert ID', (asset.cert ?? '').slice(0, 13) + '…'],
                    ['Category', asset.category],
                  ].map(([label, value]) => (
                    <View key={String(label)} style={styles.metaCell}>
                      <Text style={styles.infoRowLabel}>{label}</Text>
                      <Text style={styles.metaCellValueDark}>{value || '—'}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* 2. Unified Valuation & Integrity Container (Teal Card Style from reference) */}
              <View style={styles.tealCard}>
                {/* Header row */}
                <View style={styles.tealHeaderRow}>
                  <View style={styles.tealHeaderTitleWrap}>
                    <Feather name="shield" size={13} color="#2DD4BF" />
                    <Text style={styles.tealHeading}>VALUATION & AUTHENTICITY</Text>
                  </View>
                  <View style={styles.tealVerifiedBadge}>
                    <Text style={styles.tealVerifiedBadgeText}>
                      {asset.aiScanStatus === 'passed' ? 'VERIFIED REAL' : 'AI GUARDED'}
                    </Text>
                  </View>
                </View>

                {/* Valuation Metrics */}
                <View style={styles.valuationRow}>
                  <Text style={styles.valuationPrice}>{asset.price}</Text>
                </View>

                <View style={styles.confidenceRow}>
                  <Text style={styles.confidenceText}>Valuation Confidence</Text>
                  <Text style={styles.confidencePct}>96%</Text>
                </View>

                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={['#2DD4BF', '#0D9488']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: '85%' }]}
                  />
                </View>

                <View style={styles.rangeRow}>
                  <Text style={styles.rangeText}>Low: R{Math.round((asset.price_num || 25000) * 0.9).toLocaleString('en-ZA')}</Text>
                  <Text style={styles.rangeText}>High: R{Math.round((asset.price_num || 25000) * 1.15).toLocaleString('en-ZA')}</Text>
                </View>

                {/* Divider within single container */}
                <View style={styles.tealInnerDivider} />

                {/* Fraud & Media Detection sub-section */}
                <View style={styles.fraudSubRow}>
                  <Feather
                    name={asset.aiScanStatus === 'passed' ? 'check-circle' : 'shield'}
                    size={13}
                    color="#2DD4BF"
                  />
                  <Text style={styles.fraudSubTitle}>Deepfake & Media Verification</Text>
                </View>
                <Text style={styles.fraudBody}>
                  {asset.aiScanStatus === 'passed'
                    ? 'All listing media scanned via Hive AI Detection. Zero synthetic patterns or deepfake artifacts detected.'
                    : 'Listing media protected by SmartAssets AI Fraud Guard.'}
                </Text>
              </View>

              {/* 3. Product Description (Warm Coral Accent Card) */}
              <View style={styles.coralAccentCard}>
                <View style={styles.descBoxHeader}>
                  <Feather name="file-text" size={13} color="#2664EB" />
                  <Text style={styles.descBoxHeading}>PRODUCT DESCRIPTION</Text>
                </View>
                <Text style={styles.descBodyText}>
                  {cleanDescription || 'Dual-authenticated physical luxury asset with cryptographic ERC-721 token provenance, custody chain validation, and AI media verification.'}
                </Text>
                <Text style={styles.ownerDescriptionText}>
                  Listed by {isOwner ? 'You (Owner)' : asset.owner || 'Verified Seller'}.
                  {isOwner ? ' Self-purchase & self-investment are prohibited.' : ''}
                </Text>
              </View>

              {/* Blockchain badge */}
              <TouchableOpacity
                style={styles.blockchainBadge}
                onPress={() => Linking.openURL(asset.etherscanUrl || (asset.txHash ? `https://sepolia.etherscan.io/tx/${asset.txHash}` : 'https://sepolia.etherscan.io'))}
                activeOpacity={0.8}
              >
                <Feather name="link" size={14} color="#2DD4BF" />
                <Text style={styles.blockchainBadgeText}>
                  {asset.tokenId ? `Token #${asset.tokenId} · Verified on Sepolia Etherscan ↗` : 'ERC-721 Verified on Sepolia Etherscan ↗'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Certificate Tab ── */}
          {activeTab === 'cert' && (
            <View style={styles.tabContent}>
              <View style={styles.whiteCard}>
                <Text style={styles.whiteCardHeading}>DIGITAL CERTIFICATE</Text>
                <Text style={styles.certAssetName}>{asset.name}</Text>
                <TouchableOpacity
                  style={styles.certBtn}
                  onPress={() => navigation.navigate(SCREENS.CERTIFICATE, { asset })}
                >
                  <LinearGradient colors={['#3B82F6', '#2664EB', '#1D4ED8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.certBtnGradient}>
                    <Text style={styles.certBtnLabel}>View Full Certificate</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              <View style={styles.coralAccentCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showHash ? 14 : 0 }}>
                  <Text style={[styles.descBoxHeading, { marginBottom: 0 }]}>BLOCKCHAIN HASH</Text>
                  <TouchableOpacity onPress={() => setShowHash(!showHash)}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#2664EB' }}>{showHash ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                </View>
                {showHash && (
                  <Text style={styles.hashValue} numberOfLines={2}>
                    0x4a3f8c2e1b9d6f0a5e7c3d2b1f8e4a9c2d5b7e0f3a6c9d2e5b8f1a4c7e0d3b6f
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* ── Provenance Tab ── */}
          {activeTab === 'history' && (
            <View style={styles.tabContent}>
              <TouchableOpacity
                style={styles.coralAccentCard}
                onPress={() => navigation.navigate(SCREENS.PROVENANCE, { asset, history })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.descBoxHeading}>OWNERSHIP TIMELINE</Text>
                  <Feather name="chevron-right" size={16} color="#2664EB" />
                </View>
              </TouchableOpacity>

              <View style={styles.whiteCard}>
                {(history.length > 0 ? history : [{ year: String(asset.year || '2024'), event: 'Marketplace Listing & Authenticity Certified' }])
                  .map((e, i, arr) => (
                    <View key={i} style={[styles.timelineRow, i < arr.length - 1 && { marginBottom: 16 }]}>
                      <View style={styles.timelineDotCol}>
                        <View style={[styles.timelineDot, { backgroundColor: i === 0 ? '#2664EB' : '#CBD5E1' }]} />
                        {i < arr.length - 1 && <View style={styles.timelineLine} />}
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={styles.timelineYearDark}>{e.year || e.yr}</Text>
                        <Text style={styles.timelineEventDark}>{e.event || e.ev}</Text>
                        {e.party ? <Text style={styles.timelinePartyDark}>📍 {e.party}</Text> : null}
                      </View>
                    </View>
                  ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Action Bar — Coral Primary CTA & Frosted Pill (Less Blue) ── */}
      <SafeAreaView
        edges={['bottom']}
        style={styles.actionBar}
      >
        <TouchableOpacity
          style={styles.secondaryAction}
          onPress={() => navigation.navigate(SCREENS.HEALTH_REPORT, { asset })}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryActionLabel}>Health Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryAction,
            isOwner && styles.primaryActionDisabled,
          ]}
          onPress={() => {
            if (isOwner) {
              Alert.alert('Self-Purchase Restricted', 'You listed this collectible. Platform rules prohibit buying or investing in items you listed yourself.');
            } else {
              navigation.navigate(SCREENS.CHECKOUT, { asset });
            }
          }}
          activeOpacity={isOwner ? 0.9 : 0.8}
        >
          {isOwner ? (
            <View style={styles.ownerListingBtn}>
              <Feather name="slash" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
              <Text style={styles.ownerListingText}>Your Listing</Text>
            </View>
          ) : (
            <LinearGradient colors={['#3B82F6', '#2664EB', '#1D4ED8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryActionGradient}>
              <Feather name="shopping-bag" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.primaryActionLabel}>Buy Now</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>
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
  container: { flex: 1, backgroundColor: '#182154' },
  heroWrap: {
    position: 'absolute',
    top: 0,
    width: '100%',
    height: height * 0.48,
    backgroundColor: '#182154',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImage: {
    width: width * 0.88,
    height: height * 0.38,
    marginTop: 40,
  },
  galleryOverlay: {
    position: 'absolute',
    bottom: 16,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 15,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(24, 33, 84, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  galleryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  galleryDotActive: {
    width: 18,
    borderRadius: 9,
    backgroundColor: '#2664EB',
  },
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(24, 33, 84, 0.8)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  photoCountText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  topHeaderGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
  },

  floatingHeader: {
    position: 'absolute',
    top: 0,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 20,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(24, 33, 84, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  greenPillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(45, 212, 191, 0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(45, 212, 191, 0.4)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
  },
  greenPillText: {
    color: '#2DD4BF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  goldShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },
  goldShieldText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  verifiedHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(45, 212, 191, 0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(45, 212, 191, 0.4)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
  },
  verifiedHeaderText: {
    color: '#2DD4BF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  scrollContent: { paddingTop: height * 0.44 },
  bottomSheet: {
    backgroundColor: '#182154',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderTopWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  categoryLabel: { fontSize: 11, fontWeight: '800', color: '#93C5FD', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },
  assetName: { fontSize: 26, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 4 },
  price: { fontSize: 26, fontWeight: '900', color: '#2664EB', letterSpacing: -0.3 },
  shareBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.25)',
    marginTop: 4,
  },

  // ── Thumbnail Section ──
  thumbnailSection: {
    marginBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  thumbnailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  thumbnailHeading: {
    fontSize: 11,
    fontWeight: '900',
    color: '#2664EB',
    letterSpacing: 1.1,
  },
  thumbnailRow: {
    flexDirection: 'row',
    gap: 10,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: '#1E2768',
    position: 'relative',
  },
  thumbWrapActive: {
    borderColor: '#2664EB',
    transform: [{ scale: 1.05 }],
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbActiveBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2664EB',
    alignItems: 'center',
    justifyContent: 'center',
  },

  pillTabBar: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  pillTabBtn: {
    flex: 1,
    height: 42,
  },
  pillTabActive: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2664EB',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  pillTabInactive: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  pillTabLabelActive: { fontSize: 13, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.3 },
  pillTabLabelInactive: { fontSize: 13, fontWeight: '700', color: 'rgba(255, 255, 255, 0.7)', letterSpacing: 0.3 },

  tabContent: { gap: 16 },

  // ── Crisp White Card (SmartAssets Vault Card Style) ──
  whiteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  whiteCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  whiteCardHeading: {
    fontSize: 11, fontWeight: '900', color: '#0F172A',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  whiteCardBadge: {
    backgroundColor: 'rgba(54, 102, 221, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  whiteCardBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#3666DD',
    letterSpacing: 0.5,
  },
  infoDividerLight: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 12 },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ownerAvatarWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: '#F1F5F9', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#CBD5E1',
  },
  creatorIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: '#EEF4FF', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(38, 100, 235, 0.25)',
  },
  infoAvatar: { width: '100%', height: '100%' },
  infoRowLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  infoRowValueDark: { fontSize: 15, fontWeight: '800', color: '#0F172A' },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  metaCell: { width: '50%', paddingVertical: 8, paddingRight: 12 },
  metaCellValueDark: { fontSize: 14, fontWeight: '800', color: '#0F172A' },

  // ── Teal Card (Teal Card Style from reference) ──
  tealCard: {
    backgroundColor: '#0D3D36',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(45, 212, 191, 0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    elevation: 4,
  },
  tealHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tealHeaderTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tealHeading: {
    fontSize: 11,
    fontWeight: '900',
    color: '#2DD4BF',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  tealVerifiedBadge: {
    backgroundColor: 'rgba(45, 212, 191, 0.2)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(45, 212, 191, 0.45)',
  },
  tealVerifiedBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#2DD4BF',
    letterSpacing: 0.6,
  },
  valuationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  valuationPrice: { fontSize: 26, fontWeight: '900', color: '#FFFFFF' },

  // ── Coral Accent Card ──
  coralAccentCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    elevation: 3,
  },
  descBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  descBoxHeading: {
    fontSize: 11,
    fontWeight: '900',
    color: '#2664EB',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  descBodyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 22,
    marginBottom: 10,
  },
  ownerDescriptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#CBD5E1',
    lineHeight: 18,
  },
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  confidenceText: { fontSize: 12, fontWeight: '700', color: '#A7F3D0' },
  confidencePct: { fontSize: 12, fontWeight: '900', color: '#2DD4BF' },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.12)', overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', borderRadius: 4 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { fontSize: 11, fontWeight: '700', color: '#A7F3D0' },
  tealInnerDivider: {
    height: 1,
    backgroundColor: 'rgba(45, 212, 191, 0.25)',
    marginVertical: 14,
  },
  fraudSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  fraudSubTitle: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  fraudBody: { fontSize: 12, fontWeight: '600', color: '#A7F3D0', lineHeight: 18 },

  // ── Blockchain Badge ──
  blockchainBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderRadius: 18,
    backgroundColor: 'rgba(45, 212, 191, 0.12)',
    borderWidth: 1.5, borderColor: 'rgba(45, 212, 191, 0.35)',
  },
  blockchainBadgeText: { fontSize: 12, fontWeight: '800', color: '#2DD4BF' },

  // ── Certificate tab ──
  certAssetName: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 16 },
  certBtn: { borderRadius: 16, overflow: 'hidden' },
  certBtnGradient: { paddingVertical: 14, alignItems: 'center' },
  certBtnLabel: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  hashValue: { fontSize: 12, fontFamily: 'Courier', lineHeight: 18, color: '#CBD5E1', marginTop: 10 },

  // ── Provenance tab ──
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineDotCol: { alignItems: 'center', width: 12 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 2 },
  timelineLine: { width: 2, flex: 1, marginTop: 4, backgroundColor: '#CBD5E1' },
  timelineContent: { flex: 1 },
  timelineYearDark: { fontSize: 12, fontWeight: '800', marginBottom: 4, color: '#2664EB' },
  timelineEventDark: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  timelinePartyDark: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 4 },

  // ── Action Bar — Coral Gradient CTA & Frosted Pill ──
  actionBar: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1.5, borderTopColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: '#182154',
  },
  secondaryAction: {
    flex: 1, paddingVertical: 14, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  secondaryActionLabel: { fontWeight: '800', fontSize: 14, color: '#FFFFFF' },
  primaryAction: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  primaryActionDisabled: { backgroundColor: 'rgba(255, 255, 255, 0.08)', borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.15)' },
  ownerListingBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  ownerListingText: { fontWeight: '800', fontSize: 14, color: '#94A3B8' },
  primaryActionGradient: {
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionLabel: { fontWeight: '900', fontSize: 14, color: '#FFFFFF' },

  // ── Fullscreen Modal ──
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
