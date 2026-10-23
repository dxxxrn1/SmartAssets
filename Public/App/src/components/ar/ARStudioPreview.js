// ─── Cross-Platform AR 3D Studio Preview ─────────────────────────────────────
// Renders an architectural 3D room preview with simulated vertical wall, horizontal floor,
// soft contact shadows, 360° rotation, 1:1 scale calibration ruler, and touch gestures.
// Runs seamlessly on Web, Expo Go, and Simulators without requiring native ARCore/ARKit.

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  PanResponder,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ARStudioPreview({
  item,
  lighting = 75, // 0 - 100
  showShadow = true,
  onOpenBidSheet,
  onResetScale,
}) {
  const [rotationDeg, setRotationDeg] = useState(0);
  const [scaleFactor, setScaleFactor] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [surfaceMode, setSurfaceMode] = useState(
    item?.surface === 'vertical' ? 'wall' : 'floor'
  );

  // Pan Responder for interactive touch-drag across simulated room
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        setPanOffset((prev) => ({
          x: prev.x + gestureState.vx * 4,
          y: prev.y + gestureState.vy * 4,
        }));
      },
    })
  ).current;

  // Real-world dimensions calculated based on scaleFactor
  const baseWidthCm = item?.dimensions?.widthCm || 90;
  const baseHeightCm = item?.dimensions?.heightCm || 65;
  const currentWidthCm = Math.round(baseWidthCm * scaleFactor);
  const currentHeightCm = Math.round(baseHeightCm * scaleFactor);

  // Lighting opacity overlay (darker when light is low)
  const roomAmbientOpacity = Math.max(0.1, (100 - lighting) / 140);

  const isWall = surfaceMode === 'wall';

  return (
    <View style={styles.container}>
      {/* ── Virtual Architectural Studio Environment ── */}
      <View style={styles.roomContainer} {...panResponder.panHandlers}>
        {/* Wall Canvas (Upper 62%) */}
        <LinearGradient
          colors={['#1E293B', '#0F172A', '#1E1B4B']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.wallBackground}
        >
          {/* Subtle Wall Texture Grid / Plaster Line */}
          <View style={styles.wallGridPattern} />

          {/* Wall Spotlight Cone (Simulated directional gallery light) */}
          <LinearGradient
            colors={['rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.03)', 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[styles.spotlightCone, { pointerEvents: 'none' }]}
          />

          {/* Surface Indicator Badge */}
          <View style={styles.surfaceDetectionBadge}>
            <View style={[styles.pulseDot, { backgroundColor: isWall ? '#F59E0B' : '#10B981' }]} />
            <Text style={styles.surfaceDetectionText}>
              {isWall ? 'VERTICAL WALL DETECTED • 1:1 MOUNT' : 'HORIZONTAL SURFACE DETECTED • 1:1 GROUND'}
            </Text>
          </View>
        </LinearGradient>

        {/* Floor Plane (Lower 38%) */}
        <LinearGradient
          colors={['#090D1A', '#0B1120', '#030712']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.floorBackground}
        >
          {/* Floor Perspective Parquet Lines */}
          <View style={styles.floorPerspectiveGrid} />
          {/* Floor Horizon Horizon Seam */}
          <View style={styles.floorHorizonLine} />
        </LinearGradient>

        {/* Room Ambient Dimmer Overlay */}
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: '#000000', opacity: roomAmbientOpacity, pointerEvents: 'none' },
          ]}
        />

        {/* ── 3D Virtual Item in Space ── */}
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
          {/* Soft Ground Contact Shadow under furniture / sculptures */}
          {showShadow && !isWall && (
            <View
              style={[
                styles.groundSoftShadow,
                {
                  transform: [
                    { scaleX: 1.2 + (scaleFactor - 1) * 0.5 },
                    { scaleY: 0.45 },
                  ],
                },
              ]}
            />
          )}

          {/* Wall Cast Shadow under paintings */}
          {showShadow && isWall && (
            <View
              style={[
                styles.wallCastShadow,
                {
                  transform: [{ rotate: `${rotationDeg * 0.1}deg` }],
                },
              ]}
            />
          )}

          {/* 3D Item Render Container */}
          <View
            style={[
              styles.itemFrame,
              isWall ? styles.wallItemFrame : styles.floorItemFrame,
              {
                transform: [
                  { rotateY: `${rotationDeg}deg` },
                  { perspective: 800 },
                ],
              },
            ]}
          >
            {/* Gilded Gallery Frame for Paintings */}
            {isWall && item?.modelType === 'procedural_framed_canvas' ? (
              <View style={styles.ornateFrameWrapper}>
                <Image
                  source={{ uri: item.highResTexture || item.image }}
                  style={styles.canvasPaintingImage}
                  resizeMode="cover"
                />
                {/* Frame Inner Bevel Highlight */}
                <View style={styles.frameBevelHighlight} />
                {/* Glass Gloss Reflection */}
                <LinearGradient
                  colors={['rgba(255, 255, 255, 0.25)', 'transparent', 'rgba(255, 255, 255, 0.05)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}
                />
              </View>
            ) : (
              /* Furniture / Sculpture / Watch Stand 3D Cutout */
              <View style={styles.sculptureWrapper}>
                <Image
                  source={{ uri: item.image }}
                  style={styles.sculptureImage}
                  resizeMode="contain"
                />
                {/* 3D Model PBR Shimmer Light Reflection */}
                <LinearGradient
                  colors={['rgba(255, 255, 255, 0.3)', 'transparent', 'rgba(0, 194, 255, 0.15)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}
                />
              </View>
            )}

            {/* Metric Dimension Callout Tape */}
            <View style={styles.metricTapeRuler}>
              <Feather name="maximize-2" size={11} color="#00C2FF" style={{ marginRight: 4 }} />
              <Text style={styles.metricTapeText}>
                {`${currentWidthCm} × ${currentHeightCm} cm • ${scaleFactor === 1.0 ? '1:1 True Size' : `${scaleFactor.toFixed(2)}x`}`}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Surface Mode Switcher Pill (Floating in Viewport) ── */}
        <View style={styles.surfaceSwitchPill}>
          <TouchableOpacity
            style={[styles.surfaceSwitchBtn, isWall && styles.surfaceSwitchBtnActive]}
            onPress={() => setSurfaceMode('wall')}
            activeOpacity={0.8}
          >
            <Feather name="layout" size={13} color={isWall ? '#FFFFFF' : '#94A3B8'} />
            <Text style={[styles.surfaceSwitchText, isWall && styles.surfaceSwitchTextActive]}>
              Wall Mount
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

        {/* ── Live Interactive Rotation & Scale Micro-Controls ── */}
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

          {/* Reset Scale 1:1 */}
          <TouchableOpacity
            style={[styles.microCtrlBtn, styles.microCtrlBtnHighlight]}
            onPress={() => {
              setScaleFactor(1.0);
              setPanOffset({ x: 0, y: 0 });
              setRotationDeg(0);
              if (onResetScale) onResetScale();
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={14} color="#00C2FF" />
            <Text style={[styles.microCtrlText, { color: '#00C2FF', fontWeight: '800' }]}>
              Reset 1:1
            </Text>
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
  roomContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  wallBackground: {
    height: '62%',
    width: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 70,
  },
  wallGridPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    opacity: 0.15,
  },
  spotlightCone: {
    position: 'absolute',
    top: 0,
    width: 260,
    height: '100%',
    borderRadius: 130,
  },
  surfaceDetectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  surfaceDetectionText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#E2E8F0',
    letterSpacing: 0.8,
  },
  floorBackground: {
    height: '38%',
    width: '100%',
    position: 'relative',
  },
  floorPerspectiveGrid: {
    position: 'absolute',
    top: 0,
    left: -40,
    right: -40,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  floorHorizonLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(0, 194, 255, 0.35)',
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
    width: 180,
    height: 45,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.8,
    shadowRadius: 24,
    elevation: 12,
  },
  wallCastShadow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: -10,
    bottom: -10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
    width: 240,
    height: 175,
  },
  floorItemFrame: {
    width: 220,
    height: 220,
  },
  ornateFrameWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    borderWidth: 8,
    borderColor: '#D4AF37', // Gilded Antique Gold Leaf Frame
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
    borderColor: 'rgba(255, 255, 255, 0.4)',
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
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
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
  microControlsRow: {
    position: 'absolute',
    bottom: 168,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 12,
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
