import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { A4_HEIGHT_CM, A4_WIDTH_CM, DEFAULT_PX_PER_CM } from './constants';

const MIN_A4_PX = 55;
const MAX_A4_PX = 145;
const STEP_A4_PX = 8;
const INITIAL_WIDTH_PX = Math.round(A4_WIDTH_CM * DEFAULT_PX_PER_CM); // ~79 px

/**
 * A4 Calibration Modal Popup.
 * Centered modal dialog with live pinch & button scaling to calibrate real-world AR metric scale.
 * @param {{ onLock: (measuredPxPerCm: number) => void, onSkip: () => void }} props
 */
export default function ScaleLock({ onLock, onSkip }) {
  const width = useSharedValue(INITIAL_WIDTH_PX);
  const startWidth = useSharedValue(INITIAL_WIDTH_PX);
  const [displayWidthPx, setDisplayWidthPx] = useState(INITIAL_WIDTH_PX);

  const clampWidth = (val) => Math.max(MIN_A4_PX, Math.min(MAX_A4_PX, val));

  const adjustWidthBy = (delta) => {
    const next = clampWidth(width.value + delta);
    width.value = next;
    setDisplayWidthPx(Math.round(next));
  };

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          startWidth.value = width.value;
        })
        .onUpdate((e) => {
          const next = Math.max(MIN_A4_PX, Math.min(MAX_A4_PX, startWidth.value * e.scale));
          width.value = next;
          runOnJS(setDisplayWidthPx)(Math.round(next));
        }),
    [],
  );

  const paperStyle = useAnimatedStyle(() => ({
    width: width.value,
    height: (width.value * A4_HEIGHT_CM) / A4_WIDTH_CM,
  }));

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onSkip}
      statusBarTranslucent
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          {/* Header row with badge & close button */}
          <View style={styles.headerRow}>
            <View style={styles.kickerBadge}>
              <Ionicons name="resize" size={13} color="#22D3EE" />
              <Text style={styles.kicker} maxFontSizeMultiplier={1.2}>
                OPTIONAL SCALE CALIBRATION
              </Text>
            </View>
            <Pressable
              onPress={onSkip}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Close calibration dialog"
            >
              <Ionicons name="close" size={20} color="#94A3B8" />
            </Pressable>
          </View>

          <Text style={styles.title} maxFontSizeMultiplier={1.3}>
            Match an A4 Sheet Size
          </Text>

          <Text style={styles.instructions} maxFontSizeMultiplier={1.2}>
            Hold a real A4 paper in your space. Adjust with − / + or pinch the white guide below to match its size in your room.
          </Text>

          {/* Stepper Controls */}
          <View style={styles.stepRow}>
            <Pressable
              style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
              onPress={() => adjustWidthBy(-STEP_A4_PX)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Shrink A4 calibration guide"
              accessibilityHint="Decreases reference rectangle width"
            >
              <Ionicons name="remove" size={18} color="#FFFFFF" />
              <Text style={styles.stepBtnText} maxFontSizeMultiplier={1.2}>
                Smaller
              </Text>
            </Pressable>

            <View style={styles.readoutBadge}>
              <Text style={styles.pxReadout} maxFontSizeMultiplier={1.2}>
                {`${(displayWidthPx / A4_WIDTH_CM).toFixed(1)} px/cm`}
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
              onPress={() => adjustWidthBy(STEP_A4_PX)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Enlarge A4 calibration guide"
              accessibilityHint="Increases reference rectangle width"
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.stepBtnText} maxFontSizeMultiplier={1.2}>
                Larger
              </Text>
            </Pressable>
          </View>

          {/* Scalable A4 paper sheet preview */}
          <View style={styles.paperStage}>
            <GestureDetector gesture={pinch}>
              <Animated.View style={[styles.paper, paperStyle]}>
                <Text style={styles.paperText} maxFontSizeMultiplier={1.2}>
                  A4 · 21 × 29.7 cm
                </Text>
              </Animated.View>
            </GestureDetector>
          </View>

          {/* Action Buttons - Always visible and accessible */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.btnPressed]}
              onPress={() => onLock(width.value / A4_WIDTH_CM)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Lock calibrated scale"
              accessibilityHint="Applies measured pixels per centimetre scale to the 3D room preview"
            >
              <Ionicons name="lock-closed" size={16} color="#041019" />
              <Text style={styles.primaryText} maxFontSizeMultiplier={1.2}>
                Lock Scale
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.btnPressed]}
              onPress={onSkip}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Skip scale calibration and use approximate scale"
              accessibilityHint="Closes calibration guide and uses default approximate scale"
            >
              <Text style={styles.secondaryText} maxFontSizeMultiplier={1.2}>
                Skip (Approximate)
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  card: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: '#0A0F1D',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(34, 211, 238, 0.45)',
    alignItems: 'center',
    elevation: 25,
    shadowColor: '#22D3EE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  kickerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  kicker: {
    color: '#22D3EE',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 999,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 2,
  },
  instructions: {
    color: '#94A3B8',
    fontSize: 11.5,
    textAlign: 'center',
    lineHeight: 16,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
    marginTop: 2,
  },
  stepBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  stepBtnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
  stepBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  readoutBadge: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(8, 145, 178, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  pxReadout: {
    color: '#22D3EE',
    fontSize: 12,
    fontWeight: '800',
  },
  paperStage: {
    height: 120,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  paper: {
    backgroundColor: '#F8FAFC',
    borderColor: '#22D3EE',
    borderWidth: 2.5,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22D3EE',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  paperText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginTop: 4,
  },
  primary: {
    flex: 1.2,
    minHeight: 48,
    backgroundColor: '#22D3EE',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryText: {
    color: '#041019',
    fontWeight: '800',
    fontSize: 13,
  },
  secondary: {
    flex: 0.8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: '#CBD5E1',
    fontWeight: '700',
    fontSize: 12.5,
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
});
