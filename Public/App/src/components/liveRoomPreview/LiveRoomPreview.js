import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import ScaleLock from './ScaleLock';
import DraggableItem from './DraggableItem';
import ModelRenderer from './ModelRenderer';
import useGyroPinning from './useGyroPinning';
import useCachedGlb from './useCachedGlb';
import { DEFAULT_PX_PER_CM, DEFAULT_DEPTH_CM } from './constants';
import { resolveImageUrl } from '../../services/api';
import { AR_SHOWCASE_ITEMS } from '../../constants/arShowcase';

/**
 * Pure helper that resolves the authoritative Room Preview configuration from
 * route params or props.
 *
 * IMPORTANT:
 * - Never substitutes a generic sample 3D furniture model onto a marketplace
 *   listing that lacks its own explicit 3D model URL.
 * - Sample 3D models are strictly confined to `isDemoShowcase: true`.
 */
export function resolveRoomPreviewConfig(params = {}) {
  const hasExplicitListingContext = Boolean(
    params.asset ||
      (params.listingId && !String(params.listingId).startsWith('showcase-')) ||
      params.imageUri ||
      params.title,
  );

  const isDemoShowcase =
    params.isDemoShowcase === true ||
    (!hasExplicitListingContext && params.isDemoShowcase !== false);

  if (isDemoShowcase) {
    const showcaseItem =
      AR_SHOWCASE_ITEMS.find(
        (item) =>
          item.id === params.showcaseId ||
          item.id === params.listingId ||
          item.glbUrl === params.glbUrl,
      ) || AR_SHOWCASE_ITEMS[0];

    return {
      mode: 'demo_3d',
      isDemoShowcase: true,
      hasExplicit3dModel: true,
      showcaseId: showcaseItem.id,
      listingId: showcaseItem.id,
      title: showcaseItem.name,
      glbUrl: showcaseItem.glbUrl,
      imageUri: showcaseItem.poster,
      placement: showcaseItem.placement || 'floor',
      widthCm: Number(showcaseItem.dimensions?.widthCm) || 75,
      heightCm: Number(showcaseItem.dimensions?.heightCm) || 85,
      depthCm: Number(showcaseItem.dimensions?.depthCm) || 80,
      source: 'demo_showcase',
      statusBadge: 'DEMO 3D SHOWCASE',
      statusBanner:
        'Sample 3D model rendered over your live camera feed. This is a demo showcase item, not a marketplace listing.',
    };
  }

  const asset = params.asset || {};
  const explicitGlbUrl =
    params.glbUrl ||
    params.glb_url ||
    asset.glbUrl ||
    asset.glb_url ||
    asset.model?.glb_url ||
    asset.modelUrl ||
    null;

  const rawImage =
    params.imageUri ||
    asset.image ||
    (Array.isArray(asset.images) && asset.images.length > 0 ? asset.images[0] : null) ||
    null;
  const imageUri = resolveImageUrl(rawImage, null);

  const title = params.title || asset.title || asset.name || 'Marketplace Listing';
  const listingId = String(params.listingId || asset.id || asset._id || 'listing-preview');
  const widthCm = Number(params.widthCm || asset.dimensions?.widthCm || asset.widthCm) || 40;
  const heightCm = Number(params.heightCm || asset.dimensions?.heightCm || asset.heightCm) || 40;
  const depthCm =
    Number(params.depthCm || asset.dimensions?.depthCm || asset.depthCm) || DEFAULT_DEPTH_CM;

  const isWallItem =
    (asset.category || '').toLowerCase().includes('art') ||
    (asset.category || '').toLowerCase().includes('paint');
  const placement = params.placement || asset.placement || (isWallItem ? 'wall' : 'floor');

  if (explicitGlbUrl) {
    return {
      mode: 'listing_3d',
      isDemoShowcase: false,
      hasExplicit3dModel: true,
      showcaseId: null,
      listingId,
      title,
      glbUrl: explicitGlbUrl,
      imageUri,
      placement,
      widthCm,
      heightCm,
      depthCm,
      source: params.source || asset.model?.source || 'verified_3d',
      statusBadge: '3D MODEL OVERLAY',
      statusBanner: null,
    };
  }

  if (imageUri) {
    return {
      mode: 'listing_2d',
      isDemoShowcase: false,
      hasExplicit3dModel: false,
      showcaseId: null,
      listingId,
      title,
      glbUrl: null,
      imageUri,
      placement,
      widthCm,
      heightCm,
      depthCm,
      source: 'listing_photo',
      statusBadge: '2D PHOTO OVERLAY',
      statusBanner:
        '2D Photo Overlay • No 3D model attached to this listing. Showing the real listing photo over your camera feed.',
    };
  }

  return {
    mode: 'no_media',
    isDemoShowcase: false,
    hasExplicit3dModel: false,
    showcaseId: null,
    listingId,
    title,
    glbUrl: null,
    imageUri: null,
    placement,
    widthCm,
    heightCm,
    depthCm,
    source: 'none',
    statusBadge: 'NO PREVIEW MEDIA',
    statusBanner: 'No 3D model or listing photo is attached to this item.',
  };
}

/**
 * LiveRoomPreview Component
 * Honest, accessible room-preview experience over a live camera feed (or studio backdrop):
 * - Renders a WebView 3D GLB overlay ONLY when an asset has an explicit 3D model URL or in Demo Showcase mode.
 * - Renders the real 2D listing photo (`DraggableItem`) with a clear no-model notice when a listing has no 3D model.
 * - Provides accessible 48×48 non-gesture controls (Rotate Left/Right, Scale −/+, Reset, Tilt Assist, A4 Calibration).
 */
export default function LiveRoomPreview(props) {
  const routeParams = props.route?.params || {};
  const mergedParams = { ...props, ...routeParams };

  const [demoOverrideId, setDemoOverrideId] = useState(null);
  const effectiveParams = useMemo(() => {
    if (demoOverrideId) {
      return {
        ...mergedParams,
        isDemoShowcase: true,
        showcaseId: demoOverrideId,
      };
    }
    return mergedParams;
  }, [mergedParams, demoOverrideId]);

  const config = useMemo(() => resolveRoomPreviewConfig(effectiveParams), [effectiveParams]);

  const {
    isDemoShowcase,
    hasExplicit3dModel,
    showcaseId,
    listingId,
    title,
    glbUrl,
    imageUri,
    placement,
    widthCm,
    heightCm,
    depthCm,
    statusBadge,
    statusBanner,
  } = config;

  const onBid = mergedParams.onBid;
  const onBack = mergedParams.onBack || (() => props.navigation?.goBack?.());

  const { width: screenW, height: screenH } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [useStudioBackdrop, setUseStudioBackdrop] = useState(Platform.OS === 'web');
  const [cameraReady, setCameraReady] = useState(Platform.OS === 'web');
  const [cameraMountError, setCameraMountError] = useState(null);

  const [pxPerCm, setPxPerCm] = useState(DEFAULT_PX_PER_CM);
  const [isScaleCalibrated, setIsScaleCalibrated] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [interactMode, setInteractMode] = useState('rotate');
  const [modelLoaded, setModelLoaded] = useState(false);
  const [rendererError, setRendererError] = useState(null);
  const [force2dFallback, setForce2dFallback] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const modelRendererRef = useRef(null);
  const draggableItemRef = useRef(null);

  const { offset: gyroOffset, rotation: gyroRotation, resetReference } = useGyroPinning(pinned);

  const cacheKeyUrl = glbUrl ? `${glbUrl}${retryNonce ? `?retry=${retryNonce}` : ''}` : null;
  const {
    localUri,
    dataUri: glbDataUri,
    loading: glbDownloading,
    progress: glbProgress,
    error: glbDownloadError,
  } = useCachedGlb(cacheKeyUrl);

  useEffect(() => {
    setModelLoaded(false);
    setRendererError(null);
    setForce2dFallback(false);
  }, [glbUrl, showcaseId, listingId]);

  useEffect(() => {
    if (Platform.OS !== 'web' && !permission) {
      requestPermission?.().catch(() => {});
    }
  }, [permission, requestPermission]);

  const shouldRender3D = Boolean(
    hasExplicit3dModel &&
      glbUrl &&
      !force2dFallback &&
      !glbDownloadError &&
      !rendererError,
  );

  const active3dError = glbDownloadError || rendererError;

  // Compute 2D photo display dimensions constrained safely to the center viewport
  const maxViewportW = Math.max(200, screenW * 0.72);
  const maxViewportH = Math.max(200, screenH * 0.44);
  const rawW = Math.max(96, widthCm * pxPerCm);
  const rawH = Math.max(96, heightCm * pxPerCm);
  const fitRatio = Math.min(1, maxViewportW / rawW, maxViewportH / rawH);
  const itemWidth = Math.round(rawW * fitRatio);
  const itemHeight = Math.round(rawH * fitRatio);

  // Unified imperative control handlers for both 3D ModelRenderer and 2D DraggableItem
  const handleRotateLeft = () => {
    if (shouldRender3D) {
      modelRendererRef.current?.rotateBy(-45);
    } else {
      draggableItemRef.current?.rotateBy(-45);
    }
  };

  const handleRotateRight = () => {
    if (shouldRender3D) {
      modelRendererRef.current?.rotateBy(45);
    } else {
      draggableItemRef.current?.rotateBy(45);
    }
  };

  const handleScaleDown = () => {
    if (shouldRender3D) {
      modelRendererRef.current?.scaleBy(0.86);
    } else {
      draggableItemRef.current?.scaleBy(0.86);
    }
  };

  const handleScaleUp = () => {
    if (shouldRender3D) {
      modelRendererRef.current?.scaleBy(1.16);
    } else {
      draggableItemRef.current?.scaleBy(1.16);
    }
  };

  const handleResetView = () => {
    resetReference();
    if (shouldRender3D) {
      modelRendererRef.current?.resetTransform();
    } else {
      draggableItemRef.current?.resetTransform();
    }
  };

  const handleRetry3dModel = () => {
    setRendererError(null);
    setForce2dFallback(false);
    setModelLoaded(false);
    setRetryNonce((n) => n + 1);
  };

  // Camera permission prompt state (unless user opted into Studio Backdrop)
  if (Platform.OS !== 'web' && !useStudioBackdrop && (!permission || !permission.granted)) {
    return (
      <SafeAreaView style={styles.permissionScreen} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionCard}>
          <View style={styles.permissionIconCircle}>
            <Ionicons name="camera-outline" size={32} color="#22D3EE" />
          </View>
          <Text style={styles.permissionTitle} maxFontSizeMultiplier={1.3}>
            Camera Access for Room Preview
          </Text>
          <Text style={styles.permissionBody} maxFontSizeMultiplier={1.3}>
            Room Preview overlays {hasExplicit3dModel ? 'this 3D model' : 'this listing photo'} over your live camera feed so you can inspect how it fits in your space.
          </Text>

          <Pressable
            style={styles.permissionPrimaryBtn}
            onPress={() => requestPermission?.()}
            accessibilityRole="button"
            accessibilityLabel="Allow camera access"
            accessibilityHint="Requests camera permission from Android to show the live room background"
          >
            <Ionicons name="camera" size={18} color="#FFFFFF" />
            <Text style={styles.permissionPrimaryText} maxFontSizeMultiplier={1.2}>
              Allow Camera Access
            </Text>
          </Pressable>

          <Pressable
            style={styles.permissionSecondaryBtn}
            onPress={() => {
              setUseStudioBackdrop(true);
              setCameraReady(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Continue with Studio Backdrop"
            accessibilityHint="Previews the item on a dark studio background without turning on the camera"
          >
            <Text style={styles.permissionSecondaryText} maxFontSizeMultiplier={1.2}>
              Continue with Studio Backdrop
            </Text>
          </Pressable>

          {onBack && (
            <Pressable
              style={styles.permissionBackBtn}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.permissionBackText} maxFontSizeMultiplier={1.2}>
                Back to previous screen
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* 1. Background Layer: Live Camera Feed or Studio Backdrop */}
      {!useStudioBackdrop && Platform.OS !== 'web' && !cameraMountError ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => {
            setCameraMountError(e?.message || 'Camera unavailable');
            setUseStudioBackdrop(true);
            setCameraReady(true);
          }}
        />
      ) : (
        <View style={styles.studioBackdrop}>
          <View style={styles.studioFloorGrid} />
        </View>
      )}

      {/* 2. Center Item Stage (Unobscured Viewport) */}
      <View style={styles.stage} pointerEvents="box-none">
        {/* Web 3D Preview via <model-viewer> when running in browser */}
        {Platform.OS === 'web' && shouldRender3D && glbUrl ? (
          <View style={styles.webModelContainer}>
            {React.createElement('model-viewer', {
              src: glbUrl,
              poster: imageUri || undefined,
              alt: title,
              'camera-controls': 'true',
              'auto-rotate': 'true',
              'shadow-intensity': '1.1',
              style: { width: '100%', height: '100%', backgroundColor: 'transparent' },
            })}
          </View>
        ) : shouldRender3D && (glbDataUri || localUri) ? (
          <ModelRenderer
            ref={modelRendererRef}
            glbDataUri={glbDataUri || localUri}
            widthCm={widthCm}
            heightCm={heightCm}
            depthCm={depthCm}
            placement={placement}
            pxPerCm={pxPerCm}
            gyroRotation={gyroRotation}
            interactMode={interactMode}
            onLoaded={() => setModelLoaded(true)}
            onError={(msg) => setRendererError(msg || 'Failed to render 3D model')}
          />
        ) : imageUri ? (
          <View style={styles.photoStageCenter} pointerEvents="box-none">
            <DraggableItem
              ref={draggableItemRef}
              imageUri={imageUri}
              width={itemWidth}
              height={itemHeight}
              gyroOffset={gyroOffset}
            />
          </View>
        ) : (
          <View style={styles.emptyStateCard} accessibilityRole="alert">
            <Ionicons name="image-outline" size={32} color="#94A3B8" />
            <Text style={styles.emptyStateTitle} maxFontSizeMultiplier={1.3}>
              No Preview Media Attached
            </Text>
            <Text style={styles.emptyStateSub} maxFontSizeMultiplier={1.3}>
              This listing does not have an attached 3D model or photo to overlay.
            </Text>
          </View>
        )}

        {/* Loading HUD for Camera or 3D GLB Download */}
        {((!cameraReady && !useStudioBackdrop) ||
          (shouldRender3D && (glbDownloading || (!modelLoaded && Platform.OS !== 'web')))) && (
          <View style={styles.loadingBadge} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color="#22D3EE" />
            <Text style={styles.loadingText} maxFontSizeMultiplier={1.2}>
              {!cameraReady && !useStudioBackdrop
                ? 'Starting live camera…'
                : glbDownloading
                  ? `Loading 3D model… ${Math.round((glbProgress || 0) * 100)}%`
                  : 'Preparing 3D scene…'}
            </Text>
          </View>
        )}

        {/* Error State if 3D Model Failed to Download or Render */}
        {hasExplicit3dModel && active3dError && !force2dFallback && (
          <View style={styles.errorStateCard} accessibilityRole="alert">
            <View style={styles.errorHeaderRow}>
              <Ionicons name="warning-outline" size={18} color="#FCA5A5" />
              <Text style={styles.errorStateTitle} maxFontSizeMultiplier={1.2}>
                3D Model Unavailable
              </Text>
            </View>
            <Text style={styles.errorStateBody} maxFontSizeMultiplier={1.2}>
              {imageUri
                ? 'Could not load the 3D model. Showing the 2D listing photo overlay instead.'
                : 'Could not load the 3D model over your network connection.'}
            </Text>
            <View style={styles.errorActionsRow}>
              <Pressable
                style={styles.errorRetryBtn}
                onPress={handleRetry3dModel}
                accessibilityRole="button"
                accessibilityLabel="Retry loading 3D model"
              >
                <Ionicons name="refresh" size={14} color="#FFFFFF" />
                <Text style={styles.errorRetryText} maxFontSizeMultiplier={1.2}>
                  Retry 3D
                </Text>
              </Pressable>
              {imageUri && (
                <Pressable
                  style={styles.errorFallbackBtn}
                  onPress={() => setForce2dFallback(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Keep 2D photo overlay"
                >
                  <Text style={styles.errorFallbackText} maxFontSizeMultiplier={1.2}>
                    Keep 2D Photo
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>

      {/* 3. Compact Accessible Safe-Area Top Header */}
      <SafeAreaView edges={['top']} style={styles.topSafe} pointerEvents="box-none">
        <View style={styles.headerBar}>
          <Pressable
            style={styles.headerIconBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Closes Room Preview and returns to the previous screen"
          >
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </Pressable>

          <View style={styles.headerCenter}>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.modePill,
                  isDemoShowcase
                    ? styles.modePillDemo
                    : shouldRender3D
                      ? styles.modePill3d
                      : styles.modePill2d,
                ]}
              >
                <Text style={styles.modePillText} maxFontSizeMultiplier={1.15}>
                  {statusBadge}
                </Text>
              </View>
              <Text style={styles.placementLabel} maxFontSizeMultiplier={1.15}>
                {`Camera overlay · ${placement === 'wall' ? 'Wall' : 'Floor'}`}
              </Text>
            </View>
            <Text
              style={styles.headerTitle}
              numberOfLines={1}
              allowFontScaling
              maxFontSizeMultiplier={1.3}
            >
              {title}
            </Text>
          </View>

          <Pressable
            style={styles.calibrateBtn}
            onPress={() => setCalibrating(true)}
            accessibilityRole="button"
            accessibilityLabel="Calibrate A4 scale"
            accessibilityHint="Opens the A4 paper reference guide to calibrate real-world centimetres"
          >
            <Ionicons name="resize-outline" size={16} color="#22D3EE" />
            <Text style={styles.calibrateBtnText} maxFontSizeMultiplier={1.15}>
              Calibrate
            </Text>
          </Pressable>
        </View>

        {/* Clear Status Notice Banner (No-3D-Model Notice or Demo Showcase Notice) */}
        {statusBanner && (
          <View style={styles.noticeBanner} accessibilityRole="summary">
            <Ionicons
              name={isDemoShowcase ? 'sparkles-outline' : 'information-circle-outline'}
              size={16}
              color={isDemoShowcase ? '#C084FC' : '#38BDF8'}
            />
            <Text style={styles.noticeBannerText} maxFontSizeMultiplier={1.25}>
              {statusBanner}
            </Text>
            {!isDemoShowcase && (
              <Pressable
                style={styles.tryDemoBtn}
                onPress={() => setDemoOverrideId(AR_SHOWCASE_ITEMS[0].id)}
                accessibilityRole="button"
                accessibilityLabel="Open Demo 3D Showcase"
                accessibilityHint="Switches to the labeled sample 3D model showcase"
              >
                <Text style={styles.tryDemoBtnText} maxFontSizeMultiplier={1.15}>
                  3D Demo
                </Text>
              </Pressable>
            )}
            {isDemoShowcase && demoOverrideId && mergedParams.isDemoShowcase === false && (
              <Pressable
                style={styles.tryDemoBtn}
                onPress={() => setDemoOverrideId(null)}
                accessibilityRole="button"
                accessibilityLabel="Return to listing photo preview"
              >
                <Text style={styles.tryDemoBtnText} maxFontSizeMultiplier={1.15}>
                  Back to Listing
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </SafeAreaView>

      {/* 4. Accessible Bottom Control Dock */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafe} pointerEvents="box-none">
        <View style={styles.bottomDock}>
          {/* Demo Showcase Model Switcher (only shown in Demo Showcase mode) */}
          {isDemoShowcase && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.demoSelectorRow}
            >
              {AR_SHOWCASE_ITEMS.map((item) => {
                const active = item.id === showcaseId;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.demoChip, active && styles.demoChipActive]}
                    onPress={() => setDemoOverrideId(item.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Select ${item.name}`}
                  >
                    <Image source={{ uri: item.poster }} style={styles.demoChipThumb} />
                    <Text
                      style={[styles.demoChipText, active && styles.demoChipTextActive]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.2}
                    >
                      {item.name.replace(' (Demo)', '')}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* Touch Gesture Mode Selector (for 3D models) */}
          {shouldRender3D && Platform.OS !== 'web' && (
            <View style={styles.gestureModeRow}>
              <Pressable
                style={[
                  styles.gestureModeBtn,
                  interactMode === 'rotate' && styles.gestureModeBtnActive,
                ]}
                onPress={() => setInteractMode('rotate')}
                accessibilityRole="button"
                accessibilityState={{ selected: interactMode === 'rotate' }}
                accessibilityLabel="Touch drag mode: Rotate 360 degrees"
                accessibilityHint="Dragging on the model rotates it in 3D"
              >
                <Ionicons
                  name="sync-outline"
                  size={15}
                  color={interactMode === 'rotate' ? '#041019' : '#E2E8F0'}
                />
                <Text
                  style={[
                    styles.gestureModeText,
                    interactMode === 'rotate' && styles.gestureModeTextActive,
                  ]}
                  maxFontSizeMultiplier={1.2}
                >
                  Drag: Rotate 3D
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.gestureModeBtn,
                  interactMode === 'move' && styles.gestureModeBtnActive,
                ]}
                onPress={() => setInteractMode('move')}
                accessibilityRole="button"
                accessibilityState={{ selected: interactMode === 'move' }}
                accessibilityLabel={`Touch drag mode: Move on ${placement}`}
                accessibilityHint={`Dragging on the model repositions it along the ${placement}`}
              >
                <Ionicons
                  name="move-outline"
                  size={15}
                  color={interactMode === 'move' ? '#041019' : '#E2E8F0'}
                />
                <Text
                  style={[
                    styles.gestureModeText,
                    interactMode === 'move' && styles.gestureModeTextActive,
                  ]}
                  maxFontSizeMultiplier={1.2}
                >
                  {`Drag: Move (${placement === 'wall' ? 'Wall' : 'Floor'})`}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Non-Gesture Accessible Control Buttons (48x48 minimum touch targets) */}
          <View style={styles.controlGrid} accessibilityRole="toolbar">
            <Pressable
              style={styles.controlBtn}
              onPress={handleRotateLeft}
              accessibilityRole="button"
              accessibilityLabel="Rotate left 45 degrees"
              accessibilityHint="Rotates the preview item counter-clockwise without needing a two-finger gesture"
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" style={{ transform: [{ scaleX: -1 }] }} />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Rotate L
              </Text>
            </Pressable>

            <Pressable
              style={styles.controlBtn}
              onPress={handleRotateRight}
              accessibilityRole="button"
              accessibilityLabel="Rotate right 45 degrees"
              accessibilityHint="Rotates the preview item clockwise without needing a two-finger gesture"
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Rotate R
              </Text>
            </Pressable>

            <Pressable
              style={styles.controlBtn}
              onPress={handleScaleDown}
              accessibilityRole="button"
              accessibilityLabel="Scale item smaller"
              accessibilityHint="Reduces the preview size without needing a pinch gesture"
            >
              <Ionicons name="remove-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Smaller
              </Text>
            </Pressable>

            <Pressable
              style={styles.controlBtn}
              onPress={handleScaleUp}
              accessibilityRole="button"
              accessibilityLabel="Scale item larger"
              accessibilityHint="Increases the preview size without needing a pinch gesture"
            >
              <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Larger
              </Text>
            </Pressable>

            <Pressable
              style={styles.controlBtn}
              onPress={handleResetView}
              accessibilityRole="button"
              accessibilityLabel="Reset position and scale"
              accessibilityHint="Centers the item and restores its default orientation and scale"
            >
              <Ionicons name="locate-outline" size={18} color="#22D3EE" />
              <Text style={[styles.controlBtnLabel, { color: '#22D3EE' }]} maxFontSizeMultiplier={1.15}>
                Reset
              </Text>
            </Pressable>

            <Pressable
              style={[styles.controlBtn, pinned && styles.controlBtnActive]}
              onPress={() => {
                if (!pinned) resetReference();
                setPinned((p) => !p);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: pinned }}
              accessibilityLabel={pinned ? 'Gyroscope tilt assist enabled' : 'Gyroscope tilt assist disabled'}
              accessibilityHint="Toggles gyroscope orientation compensation when tilting your phone"
            >
              <Ionicons
                name={pinned ? 'compass' : 'compass-outline'}
                size={18}
                color={pinned ? '#041019' : '#FFFFFF'}
              />
              <Text
                style={[styles.controlBtnLabel, pinned && styles.controlBtnLabelActive]}
                maxFontSizeMultiplier={1.15}
              >
                {pinned ? 'Tilt On' : 'Tilt Off'}
              </Text>
            </Pressable>
          </View>

          {/* Dimensions + Scale Status + Primary Action Row */}
          <View style={styles.footerMetaRow}>
            <View style={styles.dimensionsCol}>
              <Text style={styles.dimensionsText} maxFontSizeMultiplier={1.25}>
                {`${widthCm} × ${heightCm} × ${depthCm} cm`}
              </Text>
              <Text style={styles.scaleStatusText} maxFontSizeMultiplier={1.2}>
                {isScaleCalibrated ? 'A4 calibrated scale' : 'Approximate scale'}
                {useStudioBackdrop ? ' · Studio backdrop' : ' · Live camera'}
              </Text>
            </View>

            {!isDemoShowcase && typeof onBid === 'function' ? (
              <Pressable
                style={styles.primaryCtaBtn}
                onPress={() => onBid(listingId)}
                accessibilityRole="button"
                accessibilityLabel="Proceed to checkout for this listing"
                accessibilityHint="Opens checkout for this marketplace asset"
              >
                <Text style={styles.primaryCtaText} maxFontSizeMultiplier={1.2}>
                  Buy / Invest
                </Text>
                <Ionicons name="arrow-forward" size={16} color="#041019" />
              </Pressable>
            ) : (
              <Pressable
                style={styles.secondaryCtaBtn}
                onPress={() => setUseStudioBackdrop((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  useStudioBackdrop ? 'Switch to live camera background' : 'Switch to studio backdrop'
                }
              >
                <Ionicons
                  name={useStudioBackdrop ? 'camera-outline' : 'easel-outline'}
                  size={15}
                  color="#E2E8F0"
                />
                <Text style={styles.secondaryCtaText} maxFontSizeMultiplier={1.2}>
                  {useStudioBackdrop ? 'Live Camera' : 'Studio View'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* 5. Optional A4 Scale Calibration Modal */}
      {calibrating && (
        <ScaleLock
          onLock={(measuredPxPerCm) => {
            setPxPerCm(measuredPxPerCm);
            setIsScaleCalibrated(true);
            setCalibrating(false);
          }}
          onSkip={() => setCalibrating(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#040914',
  },
  studioBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0B1325',
    justifyContent: 'flex-end',
  },
  studioFloorGrid: {
    height: '42%',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderTopWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.22)',
  },
  stage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoStageCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 130,
  },
  webModelContainer: {
    width: '100%',
    height: '68%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 12, 26, 0.82)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    gap: 10,
  },
  headerIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  modePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  modePill3d: {
    backgroundColor: 'rgba(34, 211, 238, 0.16)',
    borderColor: 'rgba(34, 211, 238, 0.45)',
  },
  modePill2d: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  modePillDemo: {
    backgroundColor: 'rgba(192, 132, 252, 0.18)',
    borderColor: 'rgba(192, 132, 252, 0.48)',
  },
  modePillText: {
    color: '#F8FAFC',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  placementLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  calibrateBtn: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(8, 145, 178, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.42)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  calibrateBtnText: {
    color: '#22D3EE',
    fontSize: 12,
    fontWeight: '800',
  },
  noticeBanner: {
    marginTop: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeBannerText: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
  },
  tryDemoBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(192, 132, 252, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(192, 132, 252, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tryDemoBtnText: {
    color: '#E9D5FF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  loadingBadge: {
    position: 'absolute',
    top: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(6, 12, 26, 0.85)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  loadingText: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
  },
  errorStateCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '38%',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.45)',
    gap: 8,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorStateTitle: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '800',
  },
  errorStateBody: {
    color: '#E2E8F0',
    fontSize: 12.5,
    lineHeight: 18,
  },
  errorActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  errorRetryBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#0891B2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  errorRetryText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  errorFallbackBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(51, 65, 85, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorFallbackText: {
    color: '#E2E8F0',
    fontSize: 12.5,
    fontWeight: '700',
  },
  emptyStateCard: {
    marginHorizontal: 28,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    gap: 8,
  },
  emptyStateTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyStateSub: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  bottomSafe: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  bottomDock: {
    backgroundColor: 'rgba(6, 12, 26, 0.86)',
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 10,
  },
  demoSelectorRow: {
    gap: 8,
    paddingBottom: 2,
  },
  demoChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  demoChipActive: {
    backgroundColor: 'rgba(168, 85, 247, 0.26)',
    borderColor: '#C084FC',
  },
  demoChipThumb: {
    width: 26,
    height: 26,
    borderRadius: 6,
  },
  demoChipText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 130,
  },
  demoChipTextActive: {
    color: '#FFFFFF',
  },
  gestureModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gestureModeBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  gestureModeBtnActive: {
    backgroundColor: '#22D3EE',
    borderColor: '#22D3EE',
  },
  gestureModeText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '800',
  },
  gestureModeTextActive: {
    color: '#041019',
  },
  controlGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  controlBtn: {
    flex: 1,
    minWidth: 48,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 3,
  },
  controlBtnActive: {
    backgroundColor: '#22D3EE',
    borderColor: '#22D3EE',
  },
  controlBtnLabel: {
    color: '#F1F5F9',
    fontSize: 10.5,
    fontWeight: '700',
  },
  controlBtnLabelActive: {
    color: '#041019',
    fontWeight: '800',
  },
  footerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 2,
  },
  dimensionsCol: {
    flex: 1,
  },
  dimensionsText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  scaleStatusText: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 1,
  },
  primaryCtaBtn: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#22D3EE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryCtaText: {
    color: '#041019',
    fontSize: 13.5,
    fontWeight: '900',
  },
  secondaryCtaBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryCtaText: {
    color: '#E2E8F0',
    fontSize: 12.5,
    fontWeight: '700',
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: '#040914',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  permissionCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.28)',
    gap: 12,
  },
  permissionIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  permissionBody: {
    color: '#CBD5E1',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 6,
  },
  permissionPrimaryBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: '#0891B2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  permissionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  permissionSecondaryBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionSecondaryText: {
    color: '#E2E8F0',
    fontSize: 13.5,
    fontWeight: '700',
  },
  permissionBackBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBackText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
});
