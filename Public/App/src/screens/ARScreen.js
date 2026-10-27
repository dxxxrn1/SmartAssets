// ─── SmartAssets In-App AR Experience Screen ──────────────────────────────────
// Provides physical camera AR (ViroReact) on dev builds + 3D Studio fallback on web/preview.
// Features: wall & floor plane detection, 1:1 metric scale, gestures, lighting & soft shadows,
// showcase switcher, and in-AR "Bid Now" sheet without leaving AR.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import {
  AR_SHOWCASE_ITEMS,
  getShowcaseItemById,
  matchAssetToARShowcase,
} from '../constants/arShowcase';
import { isNativeARAvailable, getViroModules } from '../services/arPlatform';
import createViroARScene from '../components/ar/ViroNativeARScene';
import ARStudioPreview from '../components/ar/ARStudioPreview';
import UniversalARCamera from '../components/ar/UniversalARCamera';
import InARBidSheet from '../components/ar/InARBidSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ARScreen({ navigation, route }) {
  // Determine initial item from route params or fallback
  const passedAsset = route?.params?.asset;
  const passedShowcaseId = route?.params?.showcaseId;

  const initialItem = passedShowcaseId
    ? getShowcaseItemById(passedShowcaseId)
    : passedAsset
      ? matchAssetToARShowcase(passedAsset)
      : AR_SHOWCASE_ITEMS[0];

  const [selectedItem, setSelectedItem] = useState(initialItem);
  const [nativeARActive, setNativeARActive] = useState(false);
  const [planeStatus, setPlaneStatus] = useState('Detecting surfaces (Move camera slowly)...');
  const [planeType, setPlaneType] = useState(null); // 'wall' | 'floor'
  const [lightingLevel, setLightingLevel] = useState(80); // 0 - 100
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [bidSheetVisible, setBidSheetVisible] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(1.0);
  const [snapshotTaken, setSnapshotTaken] = useState(false);

  // Check native AR availability (only iOS ARKit; zero ARCore Google Play Services on Android)
  useEffect(() => {
    const supported = Platform.OS === 'ios' && isNativeARAvailable();
    setNativeARActive(supported);
    setPlaneStatus(
      supported
        ? 'ARKit 6DoF Plane Tracking Active'
        : 'Universal Live Camera AR • 1:1 Scale Active'
    );
  }, []);

  // Update selected item if route param changes
  useEffect(() => {
    if (passedAsset) {
      setSelectedItem(matchAssetToARShowcase(passedAsset));
    }
  }, [passedAsset]);

  // Handle plane detected from native AR scene
  const handlePlaneDetected = ({ alignment, position }) => {
    const isVertical = alignment === 'Vertical';
    setPlaneType(isVertical ? 'wall' : 'floor');
    setPlaneStatus(
      isVertical
        ? 'Wall Surface Detected • 1:1 Scale Locked'
        : 'Floor Surface Detected • 1:1 Scale Locked'
    );
  };

  // Handle snapshot
  const handleTakeSnapshot = () => {
    setSnapshotTaken(true);
    setTimeout(() => {
      setSnapshotTaken(false);
      Alert.alert(
        'Snapshot',
        'Use your phone\'s screenshot button to save this view. (In-app saving is not implemented yet.)',
        [{ text: 'OK' }]
      );
    }, 300);
  };

  // Toggle lighting preset (dim gallery -> balanced -> bright studio)
  const handleToggleLighting = () => {
    setLightingLevel((prev) => (prev >= 90 ? 40 : prev + 25));
  };

  // Build the native scene once per item/lighting/shadow change (only on iOS ARKit)
  const SceneComponent = useMemo(() => {
    if (!nativeARActive || Platform.OS !== 'ios') return null;
    return createViroARScene({
      item: selectedItem,
      lightingIntensity: lightingLevel * 6,
      isShadowsEnabled: shadowsEnabled,
      onPlaneDetected: handlePlaneDetected,
      onScaleChanged: setScaleFactor,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeARActive, selectedItem, lightingLevel, shadowsEnabled]);

  // Render AR Viewport: Universal Camera AR engine on Android/Web/Expo Go, Viro only on native iOS ARKit
  const renderARViewport = () => {
    if (nativeARActive && Platform.OS === 'ios') {
      const viro = getViroModules();
      if (viro?.ViroARSceneNavigator && SceneComponent) {
        return (
          <View style={StyleSheet.absoluteFillObject}>
            <viro.ViroARSceneNavigator
              key={`${selectedItem.id}-${lightingLevel}-${shadowsEnabled}`}
              autofocus
              initialScene={{ scene: SceneComponent }}
              style={StyleSheet.absoluteFillObject}
            />
          </View>
        );
      }
    }

    // Universal Live Camera AR engine (100% compatible with all Android devices, zero Google Play Services required)
    return (
      <View style={[StyleSheet.absoluteFillObject, { zIndex: 1, elevation: 1 }]}>
        <UniversalARCamera
          item={selectedItem}
          lighting={lightingLevel}
          showShadow={shadowsEnabled}
          onResetScale={() => setScaleFactor(1.0)}
          onScaleChanged={setScaleFactor}
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── AR Viewport (Live Camera or 3D Studio) ── */}
      {renderARViewport()}

      {/* Snapshot Shutter Flash */}
      {snapshotTaken && <View style={[styles.shutterFlash, { pointerEvents: 'none' }]} />}

      {/* ── Top HUD Header ── */}
      <SafeAreaView edges={['top']} style={[styles.topHudContainer, { pointerEvents: 'box-none' }]}>
        <View style={[styles.topBarRow, { pointerEvents: 'box-none' }]}>
          {/* Back Navigation */}
          <TouchableOpacity
            style={styles.hudIconBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Plane Detection & Tracking Pill */}
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: planeType ? '#10B981' : '#F59E0B' },
              ]}
            />
            <Text style={styles.statusPillText} numberOfLines={1}>
              {planeStatus}
            </Text>
          </View>

          {/* Top Actions: Lighting & Shadows */}
          <View style={styles.topActionGroup}>
            <TouchableOpacity
              style={styles.hudIconBtn}
              onPress={handleToggleLighting}
              activeOpacity={0.8}
            >
              <Ionicons
                name={lightingLevel > 70 ? 'sunny' : 'sunny-outline'}
                size={18}
                color={lightingLevel > 70 ? '#F59E0B' : '#FFFFFF'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.hudIconBtn, shadowsEnabled && styles.hudIconBtnActive]}
              onPress={() => setShadowsEnabled(!shadowsEnabled)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="contrast"
                size={16}
                color={shadowsEnabled ? '#00C2FF' : '#94A3B8'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Real-World Dimension Calibration Bar */}
        <View style={[styles.dimensionBarWrap, { pointerEvents: 'none' }]}>
          <View style={styles.dimensionPill}>
            <Ionicons name="scan-outline" size={13} color="#00C2FF" style={{ marginRight: 4 }} />
            <Text style={styles.dimensionPillText}>
              {selectedItem.dimensions?.displayString || '90 × 65 cm (1:1 Real Scale)'}
            </Text>
            <View style={styles.scaleMultiplierBadge}>
              <Text style={styles.scaleMultiplierText}>
                {scaleFactor === 1.0 ? 'TRUE 1:1' : `${scaleFactor.toFixed(2)}x`}
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Bottom HUD & Showcase Switcher ── */}
      <SafeAreaView edges={['bottom']} style={[styles.bottomHudContainer, { pointerEvents: 'box-none' }]}>
        {/* Showcase Item Switcher Strip */}
        <View style={[styles.showcaseStripWrap, { pointerEvents: 'auto' }]}>
          <Text style={styles.showcaseSectionLabel}>SHOWCASE CATALOG • TAP TO PLACE</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.showcaseStrip}
          >
            {AR_SHOWCASE_ITEMS.map((item) => {
              const isSelected = item.id === selectedItem.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.showcaseCard,
                    isSelected && styles.showcaseCardSelected,
                  ]}
                  onPress={() => {
                    setSelectedItem(item);
                    setScaleFactor(1.0);
                  }}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: item.image }} style={styles.showcaseCardImg} />
                  <View style={styles.showcaseCardInfo}>
                    <Text
                      style={[
                        styles.showcaseCardTag,
                        { color: item.badgeColor || '#00C2FF' },
                      ]}
                    >
                      {item.surface.toUpperCase()}
                    </Text>
                    <Text style={styles.showcaseCardTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.showcaseCardPrice}>
                      {item.priceFormatted}
                    </Text>
                  </View>

                  {isSelected && (
                    <View style={styles.selectedPillBadge}>
                      <Feather name="check" size={10} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Bottom Floating Action Card with "Bid Now" */}
        <View style={[styles.floatingActionCard, { pointerEvents: 'auto' }]}>
          {/* Item Meta Left */}
          <View style={styles.actionCardMeta}>
            <Text style={styles.actionCardTitle} numberOfLines={1}>
              {selectedItem.name}
            </Text>
            <View style={styles.actionCardPriceRow}>
              <Text style={styles.actionCardPriceNum}>
                {selectedItem.priceFormatted}
              </Text>
              <Text style={styles.actionCardSharePrice}>
                {`(${selectedItem.sharePriceFormatted || '£485/sh'})`}
              </Text>
            </View>
          </View>

          {/* Action Buttons Right: Snapshot + Luminous "Bid Now" */}
          <View style={styles.actionCardBtns}>
            <TouchableOpacity
              style={styles.snapshotBtn}
              onPress={handleTakeSnapshot}
              activeOpacity={0.8}
            >
              <Feather name="camera" size={18} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bidNowBtn}
              onPress={() => setBidSheetVisible(true)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#7C3AED', '#2563EB', '#00C2FF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.bidNowGradient}
              >
                <Ionicons name="flash" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.bidNowText}>Bid now</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* ── In-AR Quick Bid Modal ── */}
      <InARBidSheet
        visible={bidSheetVisible}
        onClose={() => setBidSheetVisible(false)}
        item={selectedItem}
        navigation={navigation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  shutterFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    zIndex: 999,
  },
  topHudContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  hudIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudIconBtnActive: {
    borderColor: '#00C2FF',
    backgroundColor: 'rgba(0, 194, 255, 0.2)',
  },
  statusPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F8FAFC',
    flex: 1,
  },
  topActionGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  dimensionBarWrap: {
    alignItems: 'center',
    marginTop: 10,
  },
  dimensionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0, 194, 255, 0.4)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 4,
  },
  dimensionPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  scaleMultiplierBadge: {
    backgroundColor: '#00C2FF22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  scaleMultiplierText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#00C2FF',
  },
  bottomHudContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    paddingBottom: Platform.OS === 'android' ? 16 : 8,
  },
  showcaseStripWrap: {
    marginBottom: 10,
  },
  showcaseSectionLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  showcaseStrip: {
    paddingHorizontal: 16,
    gap: 10,
  },
  showcaseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 200,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 10,
    position: 'relative',
  },
  showcaseCardSelected: {
    borderColor: '#00C2FF',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
  },
  showcaseCardImg: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  showcaseCardInfo: {
    flex: 1,
  },
  showcaseCardTag: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  showcaseCardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 1,
  },
  showcaseCardPrice: {
    fontSize: 11,
    fontWeight: '700',
    color: '#CBD5E1',
    marginTop: 1,
  },
  selectedPillBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#00C2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingActionCard: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  actionCardMeta: {
    flex: 1,
    paddingRight: 10,
  },
  actionCardTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  actionCardPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  actionCardPriceNum: {
    fontSize: 15,
    fontWeight: '900',
    color: '#00C2FF',
  },
  actionCardSharePrice: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  actionCardBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  snapshotBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidNowBtn: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#00C2FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  bidNowGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  bidNowText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
