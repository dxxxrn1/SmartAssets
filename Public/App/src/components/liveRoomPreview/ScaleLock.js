import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { A4_HEIGHT_CM, A4_WIDTH_CM } from './constants';

const MIN_A4_PX = 105;
const MAX_A4_PX = 330;
const STEP_A4_PX = 15;

/** A4 calibration overlay. onLock receives measured pixels per centimetre. */
export default function ScaleLock({ onLock, onSkip }) {
  const width = useSharedValue(180);
  const startWidth = useSharedValue(180);
  const [displayWidthPx, setDisplayWidthPx] = useState(180);

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
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.card}>
        <Text style={styles.kicker} maxFontSizeMultiplier={1.2}>
          OPTIONAL SCALE CALIBRATION
        </Text>
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>
          Match an A4 sheet size
        </Text>
        <Text style={styles.instructions} maxFontSizeMultiplier={1.3}>
          Hold or tape an A4 sheet at the item distance. Pinch the rectangle or use the − / + buttons to match the sheet, then tap Lock Scale.
        </Text>

        <View style={styles.stepRow}>
          <Pressable
            style={styles.stepBtn}
            onPress={() => adjustWidthBy(-STEP_A4_PX)}
            accessibilityRole="button"
            accessibilityLabel="Shrink A4 calibration guide"
            accessibilityHint="Decreases the reference rectangle width"
          >
            <Ionicons name="remove" size={20} color="#FFFFFF" />
            <Text style={styles.stepBtnText} maxFontSizeMultiplier={1.2}>
              Smaller
            </Text>
          </Pressable>

          <Text style={styles.pxReadout} maxFontSizeMultiplier={1.2}>
            {`${(displayWidthPx / A4_WIDTH_CM).toFixed(1)} px/cm`}
          </Text>

          <Pressable
            style={styles.stepBtn}
            onPress={() => adjustWidthBy(STEP_A4_PX)}
            accessibilityRole="button"
            accessibilityLabel="Enlarge A4 calibration guide"
            accessibilityHint="Increases the reference rectangle width"
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.stepBtnText} maxFontSizeMultiplier={1.2}>
              Larger
            </Text>
          </Pressable>
        </View>
      </View>

      <GestureDetector gesture={pinch}>
        <Animated.View style={[styles.paper, paperStyle]}>
          <Text style={styles.paperText} maxFontSizeMultiplier={1.2}>
            A4 · 21 × 29.7 cm
          </Text>
        </Animated.View>
      </GestureDetector>

      <View style={styles.actions}>
        <Pressable
          style={styles.primary}
          onPress={() => onLock(width.value / A4_WIDTH_CM)}
          accessibilityRole="button"
          accessibilityLabel="Lock calibrated scale"
          accessibilityHint="Applies the calibrated pixels per centimetre scale to the room preview"
        >
          <Ionicons name="lock-closed-outline" size={16} color="#FFFFFF" />
          <Text style={styles.primaryText} maxFontSizeMultiplier={1.2}>
            Lock Scale
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondary}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip scale calibration and use approximate scale"
          accessibilityHint="Closes the calibration guide and uses default approximate dimensions"
        >
          <Text style={styles.secondaryText} maxFontSizeMultiplier={1.2}>
            Skip (Approximate)
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4,10,22,0.90)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 32,
    zIndex: 30,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)',
    alignItems: 'center',
  },
  kicker: {
    color: '#22D3EE',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  instructions: {
    color: '#CBD5E1',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 10,
  },
  stepBtn: {
    minHeight: 48,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stepBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  pxReadout: {
    color: '#22D3EE',
    fontSize: 13,
    fontWeight: '800',
  },
  paper: {
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
    borderColor: '#22D3EE',
    borderWidth: 2.5,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paperText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
  primary: {
    minHeight: 48,
    minWidth: 150,
    backgroundColor: '#0891B2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  secondary: {
    minHeight: 48,
    minWidth: 150,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 14,
  },
});
