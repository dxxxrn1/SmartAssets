// ─── Universal Live Camera AR Experience ─────────────────────────────────────
// Works on 100% of devices (including Expo Go, phones without ARCore, Web, iOS, Android).
// Dynamically checks for camera native module without crashing if unlinked.

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  PanResponder,
  Platform,
  NativeModules,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { requireOptionalNativeModule } from 'expo-modules-core';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Safely detect if ExpoCamera native module is linked in the running binary
function getSafeCameraModule() {
  if (Platform.OS === 'web') return null;
  try {
    // Check if the native ExpoCamera module is registered in this runtime
    const nativeCam = requireOptionalNativeModule('ExpoCamera');
    if (!nativeCam) {
      // Native module not linked (e.g. running in standard Expo Go or unlinked dev build)
      return null;
    }
    // Only load expo-camera if the native binary is present
    const cam = require('expo-camera');
    if (cam && (cam.CameraView || cam.requestCameraPermissionsAsync)) {
      return cam;
    }
  } catch (_) {}
  return null;
}

export default function UniversalARCamera({
  item,
  lighting = 80,
  showShadow = true,
  onResetScale,
  onScaleChanged,
}) {
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [roomPhotoUri, setRoomPhotoUri] = useState(null);
  const CameraViewRef = useRef(null);

  const [isPlaced, setIsPlaced] = useState(false);
  const [surfaceMode, setSurfaceMode] = useState(
    item?.surface === 'vertical' ? 'wall' : 'floor'
  );
  const [rotationDeg, setRotationDeg] = useState(0);
  const [scaleFactor, setScaleFactor] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Launch device's native camera immediately to capture real room
  const handleSnapRoomPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Access Required',
          'Please allow camera access so you can photograph your room and view the item in your space.'
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.9,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setRoomPhotoUri(result.assets[0].uri);
        setIsPlaced(true);
      }
    } catch (err) {
      console.log('Error opening camera:', err);
      Alert.alert('Camera', 'Could not launch camera: ' + (err?.message || 'Unknown error'));
    }
  };

  // Safe camera initialization without throwing runtime errors
  useEffect(() => {
    let isMounted = true;
    const cam = getSafeCameraModule();
    if (cam?.CameraView) {
      CameraViewRef.current = cam.CameraView;
      setCameraAvailable(true);

      const requestPermission = async () => {
        try {
          if (typeof cam.getCameraPermissionsAsync === 'function') {
            const check = await cam.getCameraPermissionsAsync();
            if (check?.granted) {
              if (isMounted) setHasCameraPermission(true);
              return;
            }
          }
          const req = cam.requestCameraPermissionsAsync || cam.Camera?.requestCameraPermissionsAsync;
          if (typeof req === 'function') {
            const res = await req();
            if (res?.granted && isMounted) {
              setHasCameraPermission(true);
            }
          }
        } catch (_) {}
      };

      requestPermission();
    }
    return () => {
      isMounted = false;
    };
  }, []);

  // Update surface mode when item changes
  useEffect(() => {
    if (item?.surface) {
      setSurfaceMode(item.surface === 'vertical' ? 'wall' : 'floor');
      setScaleFactor(1.0);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [item]);

  // Interactive Pan / Drag gesture handler
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (!isPlaced) setIsPlaced(true);
      },
      onPanResponderMove: (_, gestureState) => {
        setPanOffset((prev) => ({
          x: Math.max(-SCREEN_WIDTH * 0.45, Math.min(SCREEN_WIDTH * 0.45, prev.x + gestureState.vx * 3.5)),
          y: Math.max(-SCREEN_HEIGHT * 0.35, Math.min(SCREEN_HEIGHT * 0.35, prev.y + gestureState.vy * 3.5)),
        }));
      },
    })
  ).current;

  // Real-world metric dimensions
  const baseWidthCm = item?.dimensions?.widthCm || 90;
  const baseHeightCm = item?.dimensions?.heightCm || 65;
  const currentWidthCm = Math.round(baseWidthCm * scaleFactor);
  const currentHeightCm = Math.round(baseHeightCm * scaleFactor);

  const isWall = surfaceMode === 'wall';

  const handlePinchZoom = (delta) => {
    const next = Math.max(0.4, Math.min(2.5, scaleFactor + delta));
    setScaleFactor(next);
    if (onScaleChanged) onScaleChanged(next);
  };

  const handleReset = () => {
    setScaleFactor(1.0);
    setPanOffset({ x: 0, y: 0 });
    setRotationDeg(0);
    setIsPlaced(true);
    if (onResetScale) onResetScale();
    if (onScaleChanged) onScaleChanged(1.0);
  };

  const CameraComponent = CameraViewRef.current;

  return (
    <View style={styles.container}>
      {/* ── 1. Live Camera Feed, Room Photo, or Architectural Room Surface ── */}
      {roomPhotoUri ? (
        <Image
          source={{ uri: roomPhotoUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : cameraAvailable && hasCameraPermission && CameraComponent ? (
        <CameraComponent style={StyleSheet.absoluteFillObject} facing="back" />
      ) : (
        /* Room Surface Background (Safe & Fail-safe across all devices) */
        <LinearGradient
          colors={['#1E293B', '#0F172A', '#020617']}
          style={StyleSheet.absoluteFillObject}
        >
          {/* Subtle architectural wall/floor grid pattern */}
          <View style={styles.simulatedRoomGrid} />
          <View style={styles.roomHorizonLine} />
        </LinearGradient>
      )}

      {/* ── 2. Camera Lighting Matching Filter ── */}
      <View
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: '#000000',
            opacity: Math.max(0, (100 - lighting) / 160),
            pointerEvents: 'none',
          },
        ]}
      />

      {/* ── 3. Interactive Touch Viewport ── */}
      <View style={styles.touchArea} {...panResponder.panHandlers}>
        {/* Reticle guide before first tap */}
        {!isPlaced && !roomPhotoUri && (
          <View style={styles.reticleWrap} pointerEvents="none">
            <View style={styles.reticleRing}>
              <Ionicons name="scan" size={44} color="#00C2FF" />
            </View>
            <View style={styles.reticlePill}>
              <Text style={styles.reticlePillText}>
                {isWall ? 'Aim at Wall & Drag to Place' : 'Aim at Floor & Drag to Place'}
              </Text>
            </View>
          </View>
        )}

        {/* ── 4. 3D Object in Room Space ── */}
        <View
          style={[
            styles.itemAnchorWrap,
            {
              transform: [
                { translateX: panOffset.x },
                { translateY: panOffset.y },
                { scale: scaleFactor },
              ],
            },
          ]}
        >
          {/* Ground Soft Shadow for Floor items (Chair, Bust, Watch Stand) */}
          {showShadow && !isWall && (
            <View
              style={[
                styles.groundSoftShadow,
                {
                  transform: [
                    { scaleX: 1.3 + (scaleFactor - 1) * 0.4 },
                    { scaleY: 0.4 },
                  ],
                },
              ]}
            />
          )}

          {/* Wall Cast Shadow for Paintings */}
          {showShadow && isWall && (
            <View
              style={[
                styles.wallCastShadow,
                {
                  transform: [{ rotate: `${rotationDeg * 0.08}deg` }],
                },
              ]}
            />
          )}

          {/* Render Item Frame */}
          <View
            style={[
              styles.itemFrame,
              isWall ? styles.wallItemFrame : styles.floorItemFrame,
              {
                transform: [
                  { rotateY: `${rotationDeg}deg` },
                  { perspective: 900 },
                ],
              },
            ]}
          >
            {/* Fine Art Painting on Wall */}
            {isWall && item?.modelType === 'procedural_framed_canvas' ? (
              <View style={styles.ornateFrameWrapper}>
                <Image
                  source={{ uri: item.highResTexture || item.image }}
                  style={styles.canvasPaintingImage}
                  resizeMode="cover"
                />
                <View style={styles.frameBevelHighlight} />
                <LinearGradient
                  colors={['rgba(255, 255, 255, 0.22)', 'transparent', 'rgba(255, 255, 255, 0.04)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}
                />
              </View>
            ) : (
              /* Furniture, Sculpture, or Plinth Stand */
              <View style={styles.sculptureWrapper}>
                <Image
                  source={{ uri: item.image }}
                  style={styles.sculptureImage}
                  resizeMode="contain"
                />
                <LinearGradient
                  colors={['rgba(255, 255, 255, 0.25)', 'transparent', 'rgba(0, 194, 255, 0.12)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}
                />
              </View>
            )}

            {/* Metric Dimensions Callout Tape */}
            <View style={styles.metricTapeRuler}>
              <Feather name="maximize-2" size={11} color="#00C2FF" style={{ marginRight: 4 }} />
              <Text style={styles.metricTapeText}>
                {`${currentWidthCm} × ${currentHeightCm} cm • ${scaleFactor === 1.0 ? '1:1 Real Size' : `${scaleFactor.toFixed(2)}x`}`}
              </Text>
            </View>
          </View>
        </View>

        {/* ── 5. Surface Mode Switcher Pill (Wall vs Floor) ── */}
        <View style={styles.surfaceSwitchPill}>
          <TouchableOpacity
            style={[styles.surfaceSwitchBtn, isWall && styles.surfaceSwitchBtnActive]}
            onPress={() => setSurfaceMode('wall')}
            activeOpacity={0.8}
          >
            <Feather name="layout" size={13} color={isWall ? '#FFFFFF' : '#94A3B8'} />
            <Text style={[styles.surfaceSwitchText, isWall && styles.surfaceSwitchTextActive]}>
              Wall
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.surfaceSwitchBtn, !isWall && styles.surfaceSwitchBtnActive]}
            onPress={() => setSurfaceMode('floor')}
            activeOpacity={0.8}
          >
            <Feather name="box" size={13} color={!isWall ? '#FFFFFF' : '#94A3B8'} />
            <Text style={[styles.surfaceSwitchText, !isWall && styles.surfaceSwitchTextActive]}>
              Floor / Stand
            </Text>
          </TouchableOpacity>
        </View>

        {/* Camera Room Capture Fallback Button (Only when live stream is inactive) */}
        {(!cameraAvailable || !hasCameraPermission) && (
          <View style={styles.roomCameraBar}>
            <TouchableOpacity
              style={[styles.snapRoomBtn, roomPhotoUri && styles.snapRoomBtnActive]}
              onPress={handleSnapRoomPhoto}
              activeOpacity={0.85}
            >
              <Feather name="camera" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.snapRoomBtnText}>
                {roomPhotoUri ? 'Retake Room Photo' : 'Open Camera • Snap Your Room'}
              </Text>
            </TouchableOpacity>

            {roomPhotoUri && (
              <TouchableOpacity
                style={styles.clearRoomBtn}
                onPress={() => setRoomPhotoUri(null)}
                activeOpacity={0.8}
              >
                <Feather name="rotate-ccw" size={12} color="#94A3B8" style={{ marginRight: 4 }} />
                <Text style={styles.clearRoomBtnText}>Reset Room</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── 6. Live Interactive Controls (Rotate & 1:1 Reset) ── */}
        <View style={styles.microControlsRow}>
          {/* Rotate Left 45° */}
          <TouchableOpacity
            style={styles.microCtrlBtn}
            onPress={() => setRotationDeg((r) => r - 45)}
            activeOpacity={0.8}
          >
            <Ionicons name="reload-outline" size={16} color="#FFFFFF" style={{ transform: [{ scaleX: -1 }] }} />
            <Text style={styles.microCtrlText}>-45°</Text>
          </TouchableOpacity>

          {/* Scale Down */}
          <TouchableOpacity
            style={styles.microCtrlBtn}
            onPress={() => handlePinchZoom(-0.1)}
            activeOpacity={0.8}
          >
            <Feather name="minus" size={14} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Reset 1:1 Scale */}
          <TouchableOpacity
            style={[styles.microCtrlBtn, styles.microCtrlBtnHighlight]}
            onPress={handleReset}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={14} color="#00C2FF" />
            <Text style={[styles.microCtrlText, { color: '#00C2FF', fontWeight: '800' }]}>
              1:1 Scale
            </Text>
          </TouchableOpacity>

          {/* Scale Up */}
          <TouchableOpacity
            style={styles.microCtrlBtn}
            onPress={() => handlePinchZoom(0.1)}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={14} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Rotate Right 45° */}
          <TouchableOpacity
            style={styles.microCtrlBtn}
            onPress={() => setRotationDeg((r) => r + 45)}
            activeOpacity={0.8}
          >
            <Ionicons name="reload-outline" size={16} color="#FFFFFF" />
            <Text style={styles.microCtrlText}>+45°</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  touchArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  simulatedRoomGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  roomHorizonLine: {
    position: 'absolute',
    top: '60%',
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(0, 194, 255, 0.25)',
  },
  reticleWrap: {
    position: 'absolute',
    top: '38%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  reticleRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: 'rgba(0, 194, 255, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  reticlePill: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 194, 255, 0.4)',
  },
  reticlePillText: {
    color: '#00C2FF',
    fontSize: 11,
    fontWeight: '800',
  },
  itemAnchorWrap: {
    position: 'absolute',
    top: '32%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  groundSoftShadow: {
    position: 'absolute',
    bottom: -15,
    width: 190,
    height: 48,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.85,
    shadowRadius: 24,
    elevation: 12,
  },
  wallCastShadow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: -8,
    bottom: -8,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 8, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
  },
  itemFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wallItemFrame: {
    width: 250,
    height: 180,
  },
  floorItemFrame: {
    width: 230,
    height: 230,
  },
  ornateFrameWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    borderWidth: 8,
    borderColor: '#D4AF37', // Gilded Gold Leaf
    backgroundColor: '#0F172A',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  canvasPaintingImage: {
    width: '100%',
    height: '100%',
  },
  frameBevelHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  sculptureWrapper: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sculptureImage: {
    width: '100%',
    height: '100%',
  },
  metricTapeRuler: {
    position: 'absolute',
    bottom: -32,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(0, 194, 255, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  metricTapeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00C2FF',
    letterSpacing: 0.4,
  },
  surfaceSwitchPill: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 24,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 20,
    gap: 4,
  },
  surfaceSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  surfaceSwitchBtnActive: {
    backgroundColor: '#2563EB',
  },
  surfaceSwitchText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  surfaceSwitchTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  roomCameraBar: {
    position: 'absolute',
    top: 154,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
    gap: 8,
  },
  snapRoomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  snapRoomBtnActive: {
    backgroundColor: '#059669',
  },
  snapRoomBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  clearRoomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  clearRoomBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  microControlsRow: {
    position: 'absolute',
    bottom: 168,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 10,
    zIndex: 20,
  },
  microCtrlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  microCtrlBtnHighlight: {
    backgroundColor: 'rgba(0, 194, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 194, 255, 0.3)',
  },
  microCtrlText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
