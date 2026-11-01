import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import ScaleLock from './ScaleLock';
import ModelRenderer from './ModelRenderer';
import useGyroPinning from './useGyroPinning';
import useCachedGlb from './useCachedGlb';
import { DEFAULT_PX_PER_CM, DEFAULT_DEPTH_CM } from './constants';
import {
  resolveImageUrl,
  getListingModelStatusApi,
  generateListingModelApi,
  getCatalogMatchesApi,
  selectCatalogModelApi,
} from '../../services/api';
import { AR_SHOWCASE_ITEMS, BUILTIN_CATALOG_FALLBACKS } from '../../constants/arShowcase';
import { useAuth } from '../../context/AuthContext';
import { SCREENS } from '../../constants/navigation';

/**
 * Pure helper that resolves initial Room Preview metadata from route params.
 * Strictly guarantees that marketplace listings never get assigned sample demo models.
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
      statusBanner: null,
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

  const source =
    params.source || asset.model?.source || (explicitGlbUrl ? 'ai_generated' : 'ai_generated');
  const isCatalog = source === 'category_catalog';
  const statusBadge = isCatalog
    ? 'CATEGORY PREVIEW'
    : explicitGlbUrl
      ? 'AI 3D APPROXIMATION'
      : '3D LISTING PREVIEW';

  return {
    mode: 'marketplace_3d',
    isDemoShowcase: false,
    hasExplicit3dModel: Boolean(explicitGlbUrl),
    showcaseId: null,
    listingId,
    title,
    glbUrl: explicitGlbUrl,
    imageUri,
    placement,
    widthCm,
    heightCm,
    depthCm,
    source,
    attribution: params.attribution || asset.model?.attribution || null,
    license: params.license || asset.model?.license || null,
    statusBadge,
    statusBanner: isCatalog
      ? 'Category Preview · Approximate 3D model from Smart Assets licensed catalog. Not an exact physical scan.'
      : null,
  };
}

/**
 * LiveRoomPreview Component
 * High-fidelity, accessible 3D room preview experience:
 * - Marketplace listings render strictly their own generated or attached 3D GLB model.
 * - If model is missing or processing, connects to backend 3D pipeline (`/api/models/generate` and `/api/models/status/:id`).
 * - Displays luxury obsidian/cyan status HUDs: queued, generating with progress, ready, failed with retry.
 * - Never shows a 2D photo as the 3D room object and never substitutes unrelated demo models onto listings.
 * - Handles navigation safely with serializable params (no function-valued route params).
 * - Full 48dp accessible non-gesture controls for rotate, move, scale, reset, tilt assist, and A4 calibration.
 */
export default function LiveRoomPreview(props) {
  const { token, isAuthenticated, user } = useAuth();
  const routeParams = props.route?.params || {};
  const mergedParams = { ...props, ...routeParams };
  const navigation = props.navigation;

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

  const isSellerOrAdmin = useMemo(() => {
    if (!isAuthenticated || !user) return false;
    const userRole = String(user.role || '').toLowerCase();
    const userEmail = String(user.email || '').toLowerCase();
    if (userRole === 'admin' || userEmail.includes('admin')) return true;
    const sellerId =
      effectiveParams.asset?.user_id ||
      effectiveParams.asset?.seller_id ||
      effectiveParams.asset?.seller?.id ||
      effectiveParams.sellerId ||
      effectiveParams.userId;
    return Boolean(sellerId && String(sellerId) === String(user.id));
  }, [isAuthenticated, user, effectiveParams]);

  const config = useMemo(() => resolveRoomPreviewConfig(effectiveParams), [effectiveParams]);

  const {
    isDemoShowcase,
    showcaseId,
    listingId,
    title,
    glbUrl: initialGlbUrl,
    imageUri,
    placement,
    widthCm,
    heightCm,
    depthCm,
    statusBadge,
    statusBanner,
  } = config;

  const onBack = useCallback(() => {
    if (typeof mergedParams.onBack === 'function') {
      mergedParams.onBack();
      return;
    }
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else if (navigation?.navigate) {
      navigation.navigate(SCREENS.MAIN_TABS);
    }
  }, [mergedParams.onBack, navigation]);

  // Per-listing 3D pipeline state
  const [modelStatus, setModelStatus] = useState(initialGlbUrl ? 'ready' : 'initial'); // 'initial' | 'processing' | 'ready' | 'failed' | 'none'
  const [modelProgress, setModelProgress] = useState(initialGlbUrl ? 100 : 0);
  const [activeGlbUrl, setActiveGlbUrl] = useState(initialGlbUrl);
  const [modelError, setModelError] = useState(null);
  const [canRetry, setCanRetry] = useState(true);
  const [isRequestingGeneration, setIsRequestingGeneration] = useState(false);
  const [modelSource, setModelSource] = useState(config.source || 'ai_generated');
  const [modelAttribution, setModelAttribution] = useState(config.attribution || null);
  const [modelLicense, setModelLicense] = useState(config.license || null);
  const [candidateMatches, setCandidateMatches] = useState(BUILTIN_CATALOG_FALLBACKS);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isSelectingCatalog, setIsSelectingCatalog] = useState(false);
  const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);

  // Sensor, camera & layout state
  const [permission, requestPermission] = useCameraPermissions();
  const [useStudioBackdrop, setUseStudioBackdrop] = useState(Platform.OS === 'web');
  const [cameraReady, setCameraReady] = useState(Platform.OS === 'web');
  const [cameraMountError, setCameraMountError] = useState(null);

  const [pxPerCm, setPxPerCm] = useState(DEFAULT_PX_PER_CM);
  const [isScaleCalibrated, setIsScaleCalibrated] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [interactMode, setInteractMode] = useState('rotate');
  const [modelLoaded, setModelLoaded] = useState(false);
  const [rendererError, setRendererError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const modelRendererRef = useRef(null);
  const hasTriggeredInitialGen = useRef(false);
  const isCatalogPreviewActiveRef = useRef(false);

  // Gyroscope Hook with safe API alignment & defaults
  const {
    offset: gyroOffset,
    rotation: gyroRotation,
    rotation3D,
    resetReference,
    recenter,
  } = useGyroPinning(pinned);

  // Safe reset helper that guards against missing methods
  const safeResetOrientation = useCallback(() => {
    if (typeof resetReference === 'function') {
      resetReference();
    } else if (typeof recenter === 'function') {
      recenter();
    }
  }, [resetReference, recenter]);

  // Model download & caching hook
  const effectiveGlbUrl = isDemoShowcase ? initialGlbUrl : activeGlbUrl;
  const cacheKeyUrl = effectiveGlbUrl
    ? `${effectiveGlbUrl}${retryNonce ? `?retry=${retryNonce}` : ''}`
    : null;
  const {
    localUri,
    dataUri: glbDataUri,
    loading: glbDownloading,
    progress: glbProgress,
    error: glbDownloadError,
    reload: reloadCachedGlb,
  } = useCachedGlb(cacheKeyUrl);

  // Request camera permission on native if not yet decided
  useEffect(() => {
    if (Platform.OS !== 'web' && !permission) {
      requestPermission?.().catch(() => {});
    }
  }, [permission, requestPermission]);

  // Reset state when listingId changes
  useEffect(() => {
    if (initialGlbUrl) {
      setActiveGlbUrl(initialGlbUrl);
      setModelStatus('ready');
      setModelProgress(100);
      setModelError(null);
    } else if (!isDemoShowcase) {
      setActiveGlbUrl(null);
      setModelStatus('initial');
      setModelProgress(0);
      setModelError(null);
      hasTriggeredInitialGen.current = false;
    }
    setModelLoaded(false);
    setRendererError(null);
  }, [initialGlbUrl, isDemoShowcase, listingId]);

  // ── Backend Per-Listing 3D Model Status & Generation Pipeline ───────────────
  const pollStatus = useCallback(async () => {
    if (isDemoShowcase || !listingId || listingId.startsWith('showcase-')) return;
    if (isCatalogPreviewActiveRef.current) return;
    try {
      const res = await getListingModelStatusApi(listingId, token);
      if (isCatalogPreviewActiveRef.current) return;
      if (res?.status === 'ready' && res?.model?.glb_url) {
        setActiveGlbUrl(res.model.glb_url);
        setModelStatus('ready');
        setModelProgress(100);
        setModelError(null);
        setCanRetry(false);
        const src = res.source || res.model?.source || 'ai_generated';
        setModelSource(src);
        setModelAttribution(res.attribution || res.model?.attribution || null);
        setModelLicense(res.license || res.model?.license || null);
      } else if (res?.status === 'processing') {
        setModelStatus('processing');
        setModelProgress(Math.max(10, Math.min(95, Number(res.progress) || 25)));
        setModelError(null);
        setCanRetry(Boolean(res.canRetry));
      } else if (res?.status === 'failed') {
        setModelStatus('failed');
        setModelError(
          res.error || '3D model is being prepared / try again later. Please check back shortly.',
        );
        if (Array.isArray(res.candidateMatches) && res.candidateMatches.length > 0) {
          setCandidateMatches(res.candidateMatches);
        }
        setCanRetry(Boolean(res.canRetry));
      } else if (res?.status === 'none') {
        // No 3D model generated yet for listing. Never trigger paid generation automatically on AR view.
        setModelStatus('none');
        setCanRetry(true);
      }
    } catch (err) {
      // Graceful fallback to none status without LogBox warning
      if (candidateMatches.length === 0) setCandidateMatches(BUILTIN_CATALOG_FALLBACKS);
      if (modelStatus === 'initial') {
        setModelStatus('none');
        setCanRetry(true);
      }
    }
  }, [isDemoShowcase, listingId, token, modelStatus]);

  const startGeneration = useCallback(
    async (force = false) => {
      if (isDemoShowcase || !listingId || isRequestingGeneration) return;
      setIsRequestingGeneration(true);
      setModelStatus('processing');
      setModelProgress(15);
      setModelError(null);

      try {
        const res = await generateListingModelApi(listingId, token, force);
        if (res?.status === 'ready' && res?.model?.glb_url) {
          setActiveGlbUrl(res.model.glb_url);
          setModelStatus('ready');
          setModelProgress(100);
          setModelError(null);
          const src = res.source || res.model?.source || 'ai_generated';
          setModelSource(src);
          setModelAttribution(res.attribution || res.model?.attribution || null);
          setModelLicense(res.license || res.model?.license || null);
        } else if (res?.candidateMatches && res.candidateMatches.length > 0) {
          setModelStatus('failed');
          setModelError(res.message || 'AI 3D generation is unavailable. Suggested catalog models available.');
          setCandidateMatches(res.candidateMatches);
          setCanRetry(true);
        } else if (res?.status === 'processing' || res?.success) {
          setModelStatus('processing');
          setModelProgress(25);
          setModelError(null);
        } else {
          setModelStatus('failed');
          setModelError(res?.error || '3D model generation could not be started.');
          if (Array.isArray(res?.candidateMatches) && res.candidateMatches.length > 0) {
            setCandidateMatches(res.candidateMatches);
          }
          setCanRetry(Boolean(res?.canRetry));
        }
      } catch (err) {
        console.warn('[LiveRoomPreview] Generation dispatch error:', err.message);
        setModelStatus('failed');
        setModelError(
          err?.message || '3D model is being prepared / try again later. Please check back shortly.',
        );
        setCanRetry(true);
      } finally {
        setIsRequestingGeneration(false);
      }
    },
    [isDemoShowcase, listingId, isRequestingGeneration, token],
  );

  const handleSelectCatalogModel = async (catalogModelId) => {
    if (isSelectingCatalog) return;
    setIsSelectingCatalog(true);
    isCatalogPreviewActiveRef.current = true;
    setRendererError(null);
    setModelLoaded(false);
    try {
      if (token && listingId) {
        const res = await selectCatalogModelApi(listingId, catalogModelId, token).catch(() => null);
        if (res?.success && res?.model?.glb_url) {
          setActiveGlbUrl(res.model.glb_url);
          setModelStatus('ready');
          setModelProgress(100);
          setModelError(null);
          setModelSource('category_catalog');
          setModelAttribution(res.attribution || res.catalogModel?.attribution || null);
          setModelLicense(res.license || res.catalogModel?.license || null);
          setShowCatalogModal(false);
          return;
        }
      }
    } finally {
      setIsSelectingCatalog(false);
    }

    // Client-side fallback: immediately preview chosen catalog model in room
    const match = candidateMatches.find((m) => (m.model?.id || m.id) === catalogModelId);
    const chosenModel = match?.model || match;
    if (chosenModel?.glb_url) {
      handlePreviewCatalogModel(chosenModel);
    }
  };

  const handlePreviewCatalogModel = (model) => {
    if (!model?.glb_url) return;
    isCatalogPreviewActiveRef.current = true;
    setRendererError(null);
    setModelLoaded(false);
    setActiveGlbUrl(model.glb_url);
    setModelStatus('ready');
    setModelProgress(100);
    setModelError(null);
    setModelSource('category_catalog');
    setModelAttribution(model.attribution || null);
    setModelLicense(model.license || null);
    setShowCatalogModal(false);
  };

  const loadCatalogMatches = useCallback(async () => {
    if (isSearchingCatalog) return;
    setIsSearchingCatalog(true);
    try {
      const res = await getCatalogMatchesApi(listingId, token, {
        category: mergedParams.category || mergedParams.asset?.category,
        title,
        tags: mergedParams.tags || mergedParams.asset?.tags,
      });
      if (res?.success && Array.isArray(res.matches) && res.matches.length > 0) {
        setCandidateMatches(res.matches);
      } else {
        setCandidateMatches(BUILTIN_CATALOG_FALLBACKS);
      }
      setShowCatalogModal(true);
    } catch (_) {
      setCandidateMatches(BUILTIN_CATALOG_FALLBACKS);
      setShowCatalogModal(true);
    } finally {
      setIsSearchingCatalog(false);
    }
  }, [isSearchingCatalog, listingId, token, mergedParams, title]);

  // Initial check on mount for marketplace listings
  useEffect(() => {
    if (!isDemoShowcase && !initialGlbUrl) {
      pollStatus();
    }
  }, [isDemoShowcase, initialGlbUrl, pollStatus]);

  // Polling timer while model is actively processing
  useEffect(() => {
    if (isDemoShowcase || modelStatus !== 'processing') return undefined;

    const interval = setInterval(() => {
      pollStatus();
    }, 3500);

    return () => clearInterval(interval);
  }, [isDemoShowcase, modelStatus, pollStatus]);

  // Determine whether 3D model is ready to display
  const is3dModelReady = Boolean(
    (isDemoShowcase && initialGlbUrl) ||
      (!isDemoShowcase && modelStatus === 'ready' && activeGlbUrl && !rendererError),
  );

  // Non-gesture accessible button controls
  const handleRotateLeft = () => {
    modelRendererRef.current?.rotateBy?.(-45, 0);
  };

  const handleRotateRight = () => {
    modelRendererRef.current?.rotateBy?.(45, 0);
  };

  const handleScaleDown = () => {
    modelRendererRef.current?.scaleBy?.(0.86);
  };

  const handleScaleUp = () => {
    modelRendererRef.current?.scaleBy?.(1.16);
  };

  const handleMoveLeft = () => {
    modelRendererRef.current?.moveBy?.(-10, 0);
  };

  const handleMoveRight = () => {
    modelRendererRef.current?.moveBy?.(10, 0);
  };

  const handleResetView = () => {
    safeResetOrientation();
    modelRendererRef.current?.resetTransform?.();
  };

  const handleRetry3d = () => {
    setRendererError(null);
    setModelLoaded(false);
    setRetryNonce((n) => n + 1);
    if (typeof reloadCachedGlb === 'function') {
      reloadCachedGlb();
    }
    if (!isDemoShowcase) {
      startGeneration(true);
    }
  };

  // Safe serializable navigation to Checkout / Buy
  const handleProceedToCheckout = () => {
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate(SCREENS.CHECKOUT, {
        listingId,
        asset: mergedParams.asset || {
          id: listingId,
          name: title,
          title,
          image: imageUri,
        },
      });
    }
  };

  // Camera permission prompt state (unless user chose Studio Backdrop)
  if (Platform.OS !== 'web' && !useStudioBackdrop && (!permission || !permission.granted)) {
    return (
      <SafeAreaView style={styles.permissionScreen} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionCard}>
          <View style={styles.permissionIconCircle}>
            <Ionicons name="cube-outline" size={32} color="#22D3EE" />
          </View>
          <Text style={styles.permissionTitle} maxFontSizeMultiplier={1.3}>
            Camera Access for 3D Room Preview
          </Text>
          <Text style={styles.permissionBody} maxFontSizeMultiplier={1.3}>
            Room Preview projects this 3D model over your live camera feed so you can inspect its real-world scale and materials in your space.
          </Text>

          <Pressable
            style={styles.permissionPrimaryBtn}
            onPress={() => requestPermission?.()}
            accessibilityRole="button"
            accessibilityLabel="Allow camera access"
            accessibilityHint="Requests camera permission from Android to project the 3D model over your room"
          >
            <Ionicons name="camera" size={18} color="#041019" />
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
            accessibilityHint="Previews the 3D model on a dark studio floor without turning on the camera"
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
          pointerEvents="none"
          facing="back"
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => {
            setCameraMountError(e?.message || 'Camera unavailable');
            setUseStudioBackdrop(true);
            setCameraReady(true);
          }}
        />
      ) : (
        <View style={styles.studioBackdrop} pointerEvents="none">
          <View style={styles.studioFloorGrid} />
        </View>
      )}

      {/* 2. Center 3D Stage (Unobscured Central Viewport) */}
      <View style={styles.stage} pointerEvents="box-none">
        {/* Active 3D Model Renderer */}
        {is3dModelReady && (effectiveGlbUrl || localUri || glbDataUri) ? (
          Platform.OS === 'web' ? (
            <View style={styles.webModelContainer}>
              {React.createElement('model-viewer', {
                src: effectiveGlbUrl,
                poster: imageUri || undefined,
                alt: title,
                'camera-controls': 'true',
                'auto-rotate': 'true',
                'shadow-intensity': '1.2',
                style: { width: '100%', height: '100%', backgroundColor: 'transparent' },
              })}
            </View>
          ) : (
            <ModelRenderer
              ref={modelRendererRef}
              glbDataUri={effectiveGlbUrl || localUri || glbDataUri}
              widthCm={widthCm}
              heightCm={heightCm}
              depthCm={depthCm}
              placement={placement}
              pxPerCm={pxPerCm}
              gyroRotation={gyroRotation || rotation3D}
              interactMode={interactMode}
              onLoaded={() => setModelLoaded(true)}
              onError={(msg) => setRendererError(msg || 'Failed to render 3D model')}
            />
          )
        ) : null}

        {/* State A: Model is Generating / Queued / Downloading */}
        {((!isDemoShowcase && (modelStatus === 'processing' || modelStatus === 'queued')) ||
          (is3dModelReady && (glbDownloading || (!modelLoaded && Platform.OS !== 'web')))) && (
          <View style={styles.reconstructionCard} accessibilityLiveRegion="polite">
            <View style={styles.pulseBadge}>
              <ActivityIndicator size="small" color="#22D3EE" />
            </View>
            <Text style={styles.reconstructionTitle} maxFontSizeMultiplier={1.3}>
              {modelStatus === 'processing'
                ? `Reconstructing 3D Model with AI… ${modelProgress}%`
                : glbDownloading
                  ? `Downloading 3D Mesh… ${Math.round((glbProgress || 0) * 100)}%`
                  : 'Preparing 3D Spatial Scene…'}
            </Text>
            <Text style={styles.reconstructionSub} maxFontSizeMultiplier={1.2}>
              {modelStatus === 'processing'
                ? 'Synthesizing watertight 3D geometry and PBR materials from the verified listing photograph.'
                : 'Rendering true-scale 3D geometry calibrated for your room.'}
            </Text>
            {modelStatus === 'processing' && (
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.max(12, modelProgress)}%` }]} />
              </View>
            )}
          </View>
        )}

        {/* State B: Model Failed or Being Prepared (Never displays 2D photo or unrelated chair) */}
        {!isDemoShowcase &&
          !activeGlbUrl &&
          (modelStatus === 'failed' || (modelStatus === 'none' && !is3dModelReady) || rendererError) && (
            <View style={styles.fallbackCard} accessibilityRole="alert">
              <View style={styles.fallbackIconWrap}>
                <Ionicons name="cube-outline" size={28} color="#38BDF8" />
              </View>
              <Text style={styles.fallbackTitle} maxFontSizeMultiplier={1.3}>
                {candidateMatches.length > 0 ? 'Category 3D Models Available' : '3D Model Unavailable'}
              </Text>
              <Text style={styles.fallbackBody} maxFontSizeMultiplier={1.25}>
                {modelError ||
                  'Photogrammetric AI 3D reconstruction is not currently ready for this listing photograph.'}
              </Text>

              {candidateMatches.length > 0 ? (
                <Pressable
                  style={({ pressed }) => [styles.browseCatalogBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => setShowCatalogModal(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Browse suggested category 3D models"
                >
                  <Ionicons name="albums-outline" size={18} color="#041019" />
                  <Text style={styles.browseCatalogText} maxFontSizeMultiplier={1.2}>
                    Browse Suggested Models ({candidateMatches.length})
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.browseCatalogBtn, pressed && { opacity: 0.85 }]}
                  onPress={loadCatalogMatches}
                  disabled={isSearchingCatalog}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Check Smart Assets catalog for category 3D models"
                >
                  {isSearchingCatalog ? (
                    <ActivityIndicator size="small" color="#041019" />
                  ) : (
                    <>
                      <Ionicons name="albums-outline" size={18} color="#041019" />
                      <Text style={styles.browseCatalogText} maxFontSizeMultiplier={1.2}>
                        Check Catalog Alternatives
                      </Text>
                    </>
                  )}
                </Pressable>
              )}

              {canRetry && isSellerOrAdmin && (
                <Pressable
                  style={styles.retryActionBtn}
                  onPress={handleRetry3d}
                  disabled={isRequestingGeneration}
                  accessibilityRole="button"
                  accessibilityLabel="Request 3D model reconstruction"
                  accessibilityHint="Dispatches a 3D generation request to the server"
                >
                  {isRequestingGeneration ? (
                    <ActivityIndicator size="small" color="#041019" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={16} color="#041019" />
                      <Text style={styles.retryActionText} maxFontSizeMultiplier={1.2}>
                        {modelStatus === 'none' ? 'Generate 3D Model with AI' : 'Retry AI Generation'}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}

              <Pressable
                style={({ pressed }) => [styles.returnBtn, pressed && { opacity: 0.7 }]}
                onPress={onBack}
                hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
                accessibilityRole="button"
                accessibilityLabel="Back to listing detail"
              >
                <Text style={styles.returnBtnText} maxFontSizeMultiplier={1.15}>
                  Back to Listing
                </Text>
              </Pressable>
            </View>
          )}
      </View>

      {/* 3. Safe-Area Top Header Bar */}
      {!calibrating && (
        <SafeAreaView edges={['top']} style={styles.topSafe} pointerEvents="box-none">
        <View style={styles.headerBar}>
          <Pressable
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.8 }]}
            onPress={onBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Closes 3D Room Preview and returns to previous screen"
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
                    : modelSource === 'category_catalog'
                      ? styles.modePillCatalog
                      : styles.modePill3d,
                ]}
              >
                <Text style={styles.modePillText} maxFontSizeMultiplier={1.15}>
                  {isDemoShowcase
                    ? 'DEMO 3D SHOWCASE'
                    : modelSource === 'category_catalog'
                      ? 'CATEGORY PREVIEW'
                      : modelStatus === 'ready'
                        ? 'AI 3D APPROXIMATION'
                        : '3D LISTING PREVIEW'}
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
            style={({ pressed }) => [styles.calibrateBtn, pressed && { opacity: 0.8 }]}
            onPress={() => setCalibrating(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Calibrate A4 scale"
            accessibilityHint="Opens the A4 paper calibration reference"
          >
            <Ionicons name="resize-outline" size={16} color="#22D3EE" />
            <Text style={styles.calibrateBtnText} maxFontSizeMultiplier={1.15}>
              Calibrate
            </Text>
          </Pressable>
        </View>

        

        
      </SafeAreaView>
      )}

      {/* 4. Accessible Bottom Control Dock */}
      {!calibrating && (
        <SafeAreaView edges={['bottom']} style={styles.bottomSafe} pointerEvents="box-none">
        <View style={styles.bottomDock}>
          {/* Demo Showcase Model Switcher (Strictly for Demo Showcase mode) */}
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

          {/* Touch Gesture Mode Selector for 3D Model */}
          {is3dModelReady && Platform.OS !== 'web' && (
            <View style={styles.gestureModeRow}>
              <Pressable
                style={({ pressed }) => [styles.gestureModeBtn, interactMode === "rotate" && styles.gestureModeBtnActive, pressed && { opacity: 0.8 }]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={() => setInteractMode('rotate')}
                accessibilityRole="button"
                accessibilityState={{ selected: interactMode === 'rotate' }}
                accessibilityLabel="Touch gesture mode: Rotate 360 degrees"
                accessibilityHint="Dragging on the model rotates it"
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
                style={({ pressed }) => [styles.gestureModeBtn, interactMode === "move" && styles.gestureModeBtnActive, pressed && { opacity: 0.8 }]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={() => setInteractMode('move')}
                accessibilityRole="button"
                accessibilityState={{ selected: interactMode === 'move' }}
                accessibilityLabel={`Touch gesture mode: Move on ${placement}`}
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

          {/* Non-Gesture Accessible 48dp Controls */}
          <View style={styles.controlGrid} accessibilityRole="toolbar">
            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={handleRotateLeft}
              accessibilityRole="button"
              accessibilityLabel="Rotate 3D model left 45 degrees"
              accessibilityHint="Rotates the 3D model counter-clockwise"
            >
              <Ionicons
                name="refresh-outline"
                size={18}
                color="#FFFFFF"
                style={{ transform: [{ scaleX: -1 }] }}
              />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Rotate L
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={handleRotateRight}
              accessibilityRole="button"
              accessibilityLabel="Rotate 3D model right 45 degrees"
              accessibilityHint="Rotates the 3D model clockwise"
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Rotate R
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={handleScaleDown}
              accessibilityRole="button"
              accessibilityLabel="Scale 3D model smaller"
              accessibilityHint="Reduces 3D model scale by 14%"
            >
              <Ionicons name="remove-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Smaller
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={handleScaleUp}
              accessibilityRole="button"
              accessibilityLabel="Scale 3D model larger"
              accessibilityHint="Increases 3D model scale by 16%"
            >
              <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.controlBtnLabel} maxFontSizeMultiplier={1.15}>
                Larger
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={handleResetView}
              accessibilityRole="button"
              accessibilityLabel="Reset position and scale"
              accessibilityHint="Restores default position, scale, and sensor orientation"
            >
              <Ionicons name="locate-outline" size={18} color="#22D3EE" />
              <Text style={[styles.controlBtnLabel, { color: '#22D3EE' }]} maxFontSizeMultiplier={1.15}>
                Reset
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.controlBtn, pinned && styles.controlBtnActive, pressed && styles.controlBtnPressed]} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={() => {
                if (!pinned) safeResetOrientation();
                setPinned((p) => !p);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: pinned }}
              accessibilityLabel={
                pinned ? 'Gyroscope tilt assist active' : 'Gyroscope tilt assist disabled'
              }
              accessibilityHint="Toggles sensor-assisted room orientation"
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

          {/* Spatial Dimensions & Checkout Action Row */}
          <View style={styles.footerMetaRow}>
            <View style={styles.dimensionsCol}>
              <Text style={styles.dimensionsText} maxFontSizeMultiplier={1.25}>
                {`${widthCm} × ${heightCm} × ${depthCm} cm`}
              </Text>
              <Text style={styles.scaleStatusText} maxFontSizeMultiplier={1.2}>
                {isScaleCalibrated ? 'A4 calibrated metric scale' : 'Approximate 1:1 scale'}
                {useStudioBackdrop ? ' · Studio floor' : ' · Live camera'}
              </Text>
            </View>

            {!isDemoShowcase ? (
              <Pressable
                style={({ pressed }) => [styles.primaryCtaBtn, pressed && { opacity: 0.85 }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={handleProceedToCheckout}
                accessibilityRole="button"
                accessibilityLabel="Proceed to checkout for this asset"
                accessibilityHint="Opens the checkout screen"
              >
                <Text style={styles.primaryCtaText} maxFontSizeMultiplier={1.2}>
                  Buy / Invest
                </Text>
                <Ionicons name="arrow-forward" size={16} color="#041019" />
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.secondaryCtaBtn, pressed && { opacity: 0.85 }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setUseStudioBackdrop((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  useStudioBackdrop ? 'Switch to live camera view' : 'Switch to studio floor view'
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
      )}

      {/* 5. A4 Calibration Guide */}
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

      {/* 6. Catalog Selection Modal */}
      <Modal
        visible={showCatalogModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCatalogModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Category 3D Models</Text>
              <Pressable
                onPress={() => setShowCatalogModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Close category models catalog"
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text style={styles.modalSub}>
              Select a commercially licensed, category-matched 3D model from the Smart Assets catalog as a spatial approximation.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
              {candidateMatches.map((item, idx) => {
                const model = item.model || item;
                const matchPct = Math.round((item.score || 0.8) * 100);
                return (
                  <View key={model.id || idx} style={styles.catalogItemCard}>
                    <View style={styles.catalogItemRow}>
                      {model.thumbnail_url ? (
                        <Image source={{ uri: model.thumbnail_url }} style={styles.catalogThumb} />
                      ) : (
                        <View style={styles.catalogThumb}>
                          <Ionicons name="cube-outline" size={24} color="#38BDF8" />
                        </View>
                      )}
                      <View style={styles.catalogItemInfo}>
                        <Text style={styles.catalogItemName} numberOfLines={1}>
                          {model.name}
                        </Text>
                        <Text style={styles.catalogItemCategory}>
                          {`${model.category} · ${model.placement === 'wall' ? 'Wall' : 'Floor'}`}
                        </Text>
                        <View style={styles.catalogScoreBadge}>
                          <Text style={styles.catalogScoreText}>{`${matchPct}% Match`}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.catalogAttributionText} numberOfLines={2}>
                      {`${model.attribution || ''} (${model.license || ''})`}
                    </Text>
                    <Pressable
                      style={styles.selectCatalogBtn}
                      disabled={isSelectingCatalog}
                      onPress={() =>
                        isSellerOrAdmin
                          ? handleSelectCatalogModel(model.id)
                          : handlePreviewCatalogModel(model)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={
                        isSellerOrAdmin
                          ? `Select ${model.name} for listing`
                          : `Preview ${model.name} in room`
                      }
                    >
                      {isSelectingCatalog ? (
                        <ActivityIndicator size="small" color="#041019" />
                      ) : (
                        <>
                          <Ionicons
                            name={isSellerOrAdmin ? "checkmark-circle-outline" : "eye-outline"}
                            size={16}
                            color="#041019"
                          />
                          <Text style={styles.selectCatalogBtnText}>
                            {isSellerOrAdmin ? "Use This 3D Model" : "Preview In Room"}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* 7. Model Information & License Modal Popup */}
      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
        statusBarTranslucent
      >
        <View style={styles.infoModalBackdrop}>
          <View style={styles.infoModalCard} accessibilityViewIsModal>
            <View style={styles.infoModalHeader}>
              <View style={styles.infoModalBadge}>
                <Ionicons name="information-circle" size={15} color="#FBBF24" />
                <Text style={styles.infoModalBadgeText} maxFontSizeMultiplier={1.2}>
                  3D MODEL INFO
                </Text>
              </View>
              <Pressable
                onPress={() => setShowInfoModal(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={({ pressed }) => [styles.infoModalCloseBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Close 3D model information"
              >
                <Ionicons name="close" size={20} color="#94A3B8" />
              </Pressable>
            </View>

            <Text style={styles.infoModalTitle} maxFontSizeMultiplier={1.3}>
              Category 3D Approximation
            </Text>

            <View style={styles.infoModalNoticeBox}>
              <Ionicons name="information-circle-outline" size={18} color="#FBBF24" style={{ marginTop: 1 }} />
              <Text style={styles.infoModalNoticeText} maxFontSizeMultiplier={1.2}>
                Category Preview · Approximate 3D model from Smart Assets licensed catalog. Not an exact physical scan of this specific seller's item.
              </Text>
            </View>

            {modelAttribution && (
              <View style={styles.infoModalAttributionBox}>
                <View style={styles.infoModalAttributionHeader}>
                  <Ionicons name="shield-checkmark-outline" size={14} color="#38BDF8" />
                  <Text style={styles.infoModalAttributionTitle} maxFontSizeMultiplier={1.2}>
                    Attribution & License
                  </Text>
                </View>
                <Text style={styles.infoModalAttributionText} maxFontSizeMultiplier={1.2}>
                  {`${modelAttribution}${modelLicense ? ` (${modelLicense})` : ''}`}
                </Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.infoModalGotItBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setShowInfoModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss 3D model information"
            >
              <Text style={styles.infoModalGotItText} maxFontSizeMultiplier={1.2}>
                Got It
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    height: '44%',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderTopWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.25)',
  },
  stage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 190,
    paddingBottom: 290,
  },
  webModelContainer: {
    width: '100%',
    height: '70%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    elevation: 25,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 12, 26, 0.92)',
    elevation: 26,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    gap: 10,
  },
  headerIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 41, 59, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
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
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(192, 132, 252, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeBannerText: {
    flex: 1,
    color: '#E9D5FF',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
  },
  reconstructionCard: {
    marginHorizontal: 24,
    backgroundColor: 'rgba(10, 16, 36, 0.95)',
    zIndex: 998,
    elevation: 25,
    borderRadius: 22,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    gap: 8,
    maxWidth: 380,
  },
  pulseBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(34, 211, 238, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  reconstructionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  reconstructionSub: {
    color: '#94A3B8',
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: 'center',
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#22D3EE',
    borderRadius: 3,
  },
  fallbackCard: {
    marginHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    zIndex: 998,
    elevation: 25,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    gap: 10,
    maxWidth: 380,
  },
  fallbackIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  fallbackTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  fallbackBody: {
    color: '#94A3B8',
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryActionBtn: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: '#22D3EE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  retryActionText: {
    color: '#041019',
    fontSize: 13.5,
    fontWeight: '900',
  },
  bottomSafe: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 25,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  bottomDock: {
    backgroundColor: 'rgba(6, 12, 26, 0.92)',
    elevation: 26,
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
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
  controlBtnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },
  controlBtnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
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
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
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
    backgroundColor: '#22D3EE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  permissionPrimaryText: {
    color: '#041019',
    fontSize: 14,
    fontWeight: '900',
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
  modePillCatalog: {
    backgroundColor: 'rgba(245, 158, 11, 0.22)',
    borderColor: 'rgba(245, 158, 11, 0.55)',
  },
  catalogNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    gap: 8,
  },
  catalogNoticeText: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  attributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
    gap: 6,
  },
  attributionText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '400',
  },
  browseCatalogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 48,
    borderRadius: 24,
    gap: 8,
    marginBottom: 8,
    width: '100%',
  },
  browseCatalogText: {
    color: '#041019',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  returnBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 8,
    width: '100%',
  },
  returnBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0A0F1D',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  catalogItemCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  catalogItemRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  catalogThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogItemInfo: {
    flex: 1,
  },
  catalogItemName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  catalogItemCategory: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 4,
  },
  catalogScoreBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34, 211, 238, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  catalogScoreText: {
    color: '#22D3EE',
    fontSize: 11,
    fontWeight: '700',
  },
  catalogAttributionText: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  selectCatalogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22D3EE',
    borderRadius: 10,
    minHeight: 48,
    gap: 6,
  },
  selectCatalogBtnText: {
    color: '#041019',
    fontSize: 13,
    fontWeight: '700',
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(251, 191, 36, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  infoIconBtnText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '700',
  },
  infoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  infoModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0A0F1D',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(251, 191, 36, 0.45)',
    gap: 12,
    elevation: 25,
    shadowColor: '#FBBF24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  infoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  infoModalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  infoModalBadgeText: {
    color: '#FBBF24',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  infoModalCloseBtn: {
    padding: 4,
    borderRadius: 999,
  },
  infoModalTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  infoModalNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
  },
  infoModalNoticeText: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '500',
  },
  infoModalAttributionBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 6,
  },
  infoModalAttributionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoModalAttributionTitle: {
    color: '#38BDF8',
    fontSize: 11.5,
    fontWeight: '700',
  },
  infoModalAttributionText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 17,
  },
  infoModalGotItBtn: {
    minHeight: 46,
    backgroundColor: '#FBBF24',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  infoModalGotItText: {
    color: '#041019',
    fontSize: 14,
    fontWeight: '800',
  },
});
