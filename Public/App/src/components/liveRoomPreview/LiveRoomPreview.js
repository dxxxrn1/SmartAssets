// ─── LiveRoomPreview Component ────────────────────────────────────────────────
// Universal Room Preview compatible with Expo Go on Android and iOS.
// Dual mode:
//   1. 3D Mode: Renders textured GLB model with ModelRenderer (Three.js inside transparent WebView)
//      - Real-world 1:1 metric scale projection (FOV 60° calibrated against A4 sheet)
//      - Gyroscope pinning relative to room reference orientation with low-pass filtering
//      - Place & Re-center drift controls, soft contact shadows, gestures (pan, pinch, rotate)
//      - AI disclaimer badge: "AI-generated 3D preview, not the certified item"
//   2. 2D Mode: Framed overlay with DraggableItem for flat art/paintings without a 3D model
//   - Fast local caching via expo-file-system with download progress percentage
//   - Zero native AR dependencies (no ARCore/ARKit/ViroReact), runs in standard Expo Go

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import ScaleLock from './ScaleLock';
import DraggableItem from './DraggableItem';
import ModelRenderer, { isWebViewAvailable } from './ModelRenderer';
import useGyroPinning from './useGyroPinning';
import useCachedGlb from './useCachedGlb';
import {
  DEFAULT_PX_PER_CM,
  DEFAULT_DEPTH_CM,
  MIN_ITEM_SCALE,
  MAX_ITEM_SCALE,
} from './constants';
import { SCREENS } from '../../constants/navigation';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LiveRoomPreview(props) {
  const navigation = props.navigation;
  const route = props.route;
  const params = route?.params || {};

  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [pxPerCm, setPxPerCm] = useState(null);
  const [approximate, setApproximate] = useState(false);
  const [gyroEnabled, setGyroEnabled] = useState(true);

  // Extract asset parameters with robust fallbacks
  const asset = props.asset || params.asset;

  const glbUrl =
    props.glbUrl ||
    params.glbUrl ||
    params.glb_url ||
    params.modelUrl ||
    params.model_url ||
    asset?.glbUrl ||
    asset?.glb_url ||
    asset?.model?.glb_url ||
    null;

  const source =
    props.source ||
    params.source ||
    asset?.model?.source ||
    'ai_generated';

  const category = (asset?.category || '').toLowerCase();
  const isWallItem = category.includes('art') || category.includes('paint') || category.includes('print');
  const placement =
    props.placement ||
    params.placement ||
    asset?.placement ||
    (isWallItem ? 'wall' : 'floor');

  const imageUri =
    props.imageUri ||
    params.imageUri ||
    params.image ||
    asset?.image ||
    asset?.imageUrl ||
    (Array.isArray(asset?.images) ? asset.images[0] : null) ||
    'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1200&q=80';

  const widthCm =
    Number(
      props.widthCm ??
      params.widthCm ??
      asset?.dimensions?.widthCm ??
      asset?.widthCm ??
      60
    ) || 60;

  const heightCm =
    Number(
      props.heightCm ??
      params.heightCm ??
      asset?.dimensions?.heightCm ??
      asset?.heightCm ??
      80
    ) || 80;

  const depthCm =
    Number(
      props.depthCm ??
      params.depthCm ??
      asset?.dimensions?.depthCm ??
      asset?.depth_cm ??
      DEFAULT_DEPTH_CM
    ) || DEFAULT_DEPTH_CM;

  const title =
    props.title ||
    params.title ||
    asset?.title ||
    asset?.name ||
    'Room preview';

  const listingId =
    props.listingId ||
    params.listingId ||
    asset?.id ||
    asset?._id ||
    '';

  const onBid = props.onBid || params.onBid;

  // Gyroscope pinning with 3D orientation, place, and re-center controls
  const {
    offset: gyroOffset,
    rotation3D: gyroRotation,
    available: motionAvailable,
    isPlaced,
    place,
    recenter,
  } = useGyroPinning(gyroEnabled && appActive && focused);

  // Cached GLB 3D model download
  const {
    glbDataUri,
    loading: loadingGlb,
    progress: downloadProgress,
    error: glbError,
  } = useCachedGlb(glbUrl);

  const canRender3D = isWebViewAvailable();
  const is3DMode = Boolean(glbUrl && glbDataUri && canRender3D);
  const cameraActive = appActive && focused && permission?.granted;

  // 3D Gesture state
  const [interactMode, setInteractMode] = useState('rotate'); // 'rotate' (360° spin & tilt) | 'move'
  const [resetTrigger, setResetTrigger] = useState(0);
  const [gestureTransform, setGestureTransform] = useState({
    panX: 0,
    panY: 0,
    scale: 1,
    rotation: 0,
  });

  const panStart = useRef({ x: 0, y: 0 });
  const pinchStartScale = useRef(1);
  const rotStart = useRef(0);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      panStart.current = { x: gestureTransform.panX, y: gestureTransform.panY };
    })
    .onUpdate((e) => {
      setGestureTransform((prev) => ({
        ...prev,
        panX: panStart.current.x + e.translationX,
        panY: panStart.current.y + e.translationY,
      }));
    });

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      pinchStartScale.current = gestureTransform.scale;
    })
    .onUpdate((e) => {
      const nextScale = Math.max(
        MIN_ITEM_SCALE,
        Math.min(MAX_ITEM_SCALE, pinchStartScale.current * e.scale)
      );
      setGestureTransform((prev) => ({
        ...prev,
        scale: nextScale,
      }));
    });

  const rotationGesture = Gesture.Rotation()
    .onBegin(() => {
      rotStart.current = gestureTransform.rotation;
    })
    .onUpdate((e) => {
      setGestureTransform((prev) => ({
        ...prev,
        rotation: rotStart.current + e.rotation,
      }));
    });

  const simultaneous3DGestures = Gesture.Simultaneous(panGesture, pinchGesture, rotationGesture);

  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else if (navigation?.navigate) {
      navigation.navigate(SCREENS.HOME);
    }
  };

  const handleBid = () => {
    if (typeof onBid === 'function') {
      onBid(listingId);
    } else if (navigation?.navigate) {
      navigation.navigate(SCREENS.CHECKOUT, { listingId, asset });
    }
  };

  // AppState change listener for camera and sensor lifecycle
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'active' && getPermission) {
        getPermission().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  // Lock orientation to portrait
  useEffect(() => {
    let previousLock;
    let disposed = false;
    ScreenOrientation.getOrientationLockAsync()
      .then((lock) => {
        if (!disposed) previousLock = lock;
      })
      .catch(() => {});
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return () => {
      disposed = true;
      if (previousLock !== undefined) ScreenOrientation.lockAsync(previousLock).catch(() => {});
    };
  }, []);

  const lockScale = useCallback((value) => {
    setPxPerCm(value);
    setApproximate(false);
  }, []);

  const skipScale = useCallback(() => {
    setPxPerCm(DEFAULT_PX_PER_CM);
    setApproximate(true);
  }, []);

  // 1. Camera permission check screen
  if (!permission) {
    return (
      <View style={styles.message}>
        <Pressable
          style={styles.floatingBackBtn}
          onPress={handleBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </Pressable>
        <ActivityIndicator color="#22D3EE" />
        <Text style={styles.body}>Checking camera access…</Text>
      </View>
    );
  }

  // 2. Camera permission denied screen
  if (!permission.granted) {
    return (
      <View style={styles.message}>
        <Pressable
          style={styles.floatingBackBtn}
          onPress={handleBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.heading}>
          {permission.canAskAgain ? 'Camera access needed' : 'Camera access is off'}
        </Text>
        <Text style={styles.body}>Allow camera access to see the live room preview.</Text>
        <Pressable
          style={styles.button}
          onPress={permission.canAskAgain ? requestPermission : Linking.openSettings}
        >
          <Text style={styles.buttonText}>
            {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          </Text>
        </Pressable>
      </View>
    );
  }

  // 2D Dimensions
  const effectivePxPerCm = pxPerCm || DEFAULT_PX_PER_CM;
  const itemWidth = Math.max(30, widthCm * effectivePxPerCm);
  const itemHeight = Math.max(30, heightCm * effectivePxPerCm);

  return (
    <View style={styles.container}>
      {/* ── Background Live Camera Feed ─────────────────────────────────── */}
      {cameraActive ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.paused]}>
          <Text style={styles.body}>Camera paused</Text>
        </View>
      )}

      {/* ── 3D Model Renderer Layer (Transparent WebGL Three.js) ──────────── */}
      {pxPerCm !== null && is3DMode && (
        <View style={StyleSheet.absoluteFill}>
          <ModelRenderer
            glbDataUri={glbDataUri}
            widthCm={widthCm}
            heightCm={heightCm}
            depthCm={depthCm}
            placement={placement}
            pxPerCm={effectivePxPerCm}
            gyroRotation={gyroRotation}
            gestureTransform={gestureTransform}
            interactMode={interactMode}
            resetTrigger={resetTrigger}
          />
        </View>
      )}

      {/* ── Foreground UI Overlay Controls ─────────────────────────────── */}
      <SafeAreaView style={styles.safe} pointerEvents="box-none" edges={['top', 'bottom']}>
        {/* Top Header Card */}
        <View style={styles.header} pointerEvents="auto">
          <Pressable
            onPress={handleBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerInfo}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.heading} numberOfLines={1}>
                {title || 'Room preview'}
              </Text>
              {is3DMode && (
                <View style={styles.mode3DPill}>
                  <Text style={styles.mode3DPillText}>3D MODEL</Text>
                </View>
              )}
            </View>
            <Text style={styles.caption}>
              {listingId ? `Listing ${listingId}` : 'Live camera preview'} ·{' '}
              {placement === 'wall' ? 'Wall Mounted' : 'Floor Standing'}
            </Text>
          </View>
        </View>

        {/* Calibration Step (A4 Sheet Scale Lock) */}
        {pxPerCm === null ? (
          <ScaleLock onLock={lockScale} onSkip={skipScale} />
        ) : (
          <>
            {/* Badges / Pill Controls */}
            <View style={styles.badges} pointerEvents="box-none">
              {approximate && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Size is approximate</Text>
                </View>
              )}

              {!canRender3D && Boolean(glbUrl) && (
                <View style={[styles.badge, styles.badgeNotice]}>
                  <Ionicons name="information-circle-outline" size={13} color="#FDE68A" style={{ marginRight: 4 }} />
                  <Text style={[styles.badgeText, { color: '#FDE68A' }]}>
                    2D mode (open in Expo Go for 3D)
                  </Text>
                </View>
              )}

              {/* 3D Specific Action Pills: 360 Rotate, Place & Re-center */}
              {is3DMode ? (
                <>
                  <Pressable
                    style={[
                      styles.badge,
                      interactMode === 'rotate' && styles.badgeActive,
                    ]}
                    onPress={() =>
                      setInteractMode((prev) => (prev === 'rotate' ? 'move' : 'rotate'))
                    }
                  >
                    <Ionicons
                      name={interactMode === 'rotate' ? 'refresh-circle' : 'hand-left-outline'}
                      size={14}
                      color={interactMode === 'rotate' ? '#22D3EE' : '#CBD5E1'}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[
                        styles.badgeText,
                        interactMode === 'rotate' && { color: '#22D3EE' },
                      ]}
                    >
                      {interactMode === 'rotate' ? '360° Rotate & Tilt' : 'Move Mode'}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.badge}
                    onPress={() => setResetTrigger((cnt) => cnt + 1)}
                  >
                    <Ionicons
                      name="cube-outline"
                      size={13}
                      color="#FDE68A"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.badgeText}>Reset Angle</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.badge, isPlaced && styles.badgePlaced]}
                    onPress={place}
                  >
                    <Ionicons
                      name={isPlaced ? 'checkmark-circle' : 'pin-outline'}
                      size={13}
                      color={isPlaced ? '#34D399' : '#FDE68A'}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[
                        styles.badgeText,
                        isPlaced && { color: '#34D399' },
                      ]}
                    >
                      {isPlaced ? 'Pinned in room' : 'Tap to Place'}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.badge}
                    onPress={() => {
                      recenter();
                      setResetTrigger((cnt) => cnt + 1);
                    }}
                  >
                    <Ionicons
                      name="refresh-outline"
                      size={13}
                      color="#7DD3FC"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.badgeText, { color: '#7DD3FC' }]}>
                      Re-center
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={styles.badge}
                  onPress={() => setGyroEnabled((value) => !value)}
                >
                  <Text style={styles.badgeText}>
                    {gyroEnabled && motionAvailable ? 'Motion active' : 'Manual placement'}
                  </Text>
                </Pressable>
              )}
            </View>

            {/* AI Generated Model Disclaimer Label (Strict Requirement 7) */}
            {is3DMode && source === 'ai_generated' && (
              <View style={styles.aiDisclaimerBadge}>
                <Ionicons name="sparkles" size={12} color="#FDE68A" style={{ marginRight: 6 }} />
                <Text style={styles.aiDisclaimerText}>
                  AI-generated 3D preview, not the certified item
                </Text>
              </View>
            )}

            {/* Model Download Progress Card */}
            {loadingGlb && (
              <View style={styles.downloadProgressCard}>
                <ActivityIndicator size="small" color="#22D3EE" style={{ marginRight: 10 }} />
                <Text style={styles.downloadProgressText}>
                  Downloading 3D model… {Math.round(downloadProgress * 100)}%
                </Text>
              </View>
            )}

            {/* 2D Fallback Overlay Mode (paintings and flat art without GLB) */}
            {!is3DMode && (
              <View style={styles.overlayArea} pointerEvents="box-none">
                <DraggableItem
                  imageUri={imageUri}
                  width={itemWidth}
                  height={itemHeight}
                  gyroOffset={gyroOffset}
                />
              </View>
            )}

            {/* Spacer for 3D layout */}
            {is3DMode && <View style={styles.spacer3D} pointerEvents="none" />}

            {/* Bottom Footer Action Bar */}
            <View style={styles.footer} pointerEvents="auto">
              <View style={styles.footerLeft}>
                <Text style={styles.dimensions}>
                  {widthCm} × {heightCm}
                  {is3DMode ? ` × ${depthCm}` : ''} cm · 1:1 Scale
                </Text>
                <Text style={styles.gestureHint}>
                  {is3DMode
                    ? '1 finger: 360° spin & tilt top/bottom · 2 fingers: move & scale'
                    : 'drag, pinch, rotate overlay'}
                </Text>
              </View>
              <Pressable style={styles.button} onPress={handleBid}>
                <Text style={styles.buttonText}>Bid now</Text>
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  safe: {
    flex: 1,
  },
  header: {
    marginHorizontal: 16,
    marginTop: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(8, 15, 30, 0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mode3DPill: {
    backgroundColor: 'rgba(34, 211, 238, 0.2)',
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 10,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#22D3EE',
  },
  mode3DPillText: {
    color: '#22D3EE',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  floatingBackBtn: {
    position: 'absolute',
    top: 52,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  heading: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
    flexShrink: 1,
  },
  caption: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: 'rgba(8, 15, 30, 0.80)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  badgePlaced: {
    backgroundColor: 'rgba(6, 78, 59, 0.85)',
    borderColor: '#10B981',
  },
  badgeActive: {
    backgroundColor: 'rgba(8, 145, 178, 0.45)',
    borderColor: '#22D3EE',
  },
  badgeText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '700',
  },
  aiDisclaimerBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(253, 230, 138, 0.3)',
  },
  aiDisclaimerText: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '600',
  },
  downloadProgressCard: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 15, 30, 0.88)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#0891B2',
  },
  downloadProgressText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  overlayArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer3D: {
    flex: 1,
  },
  footer: {
    margin: 16,
    padding: 14,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(8, 15, 30, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  footerLeft: {
    flex: 1,
    marginRight: 12,
  },
  dimensions: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  gestureHint: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  button: {
    backgroundColor: '#0891B2',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  buttonText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  message: {
    flex: 1,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  body: {
    color: '#E2E8F0',
    textAlign: 'center',
    marginTop: 10,
  },
  paused: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
  },
});
