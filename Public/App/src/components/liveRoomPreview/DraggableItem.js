import React, { useEffect, forwardRef, useImperativeHandle } from 'react';
import { Image, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { MAX_ITEM_SCALE, MIN_ITEM_SCALE } from './constants';

/**
 * Live 2D listing photo overlay with simultaneous pan, pinch, and rotation
 * gestures plus imperative button controls for accessibility.
 */
const DraggableItem = forwardRef(function DraggableItem(
  { imageUri, width, height, gyroOffset = { x: 0, y: 0 } },
  ref,
) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startRotation = useSharedValue(0);

  useEffect(() => {
    x.value = 0;
    y.value = 0;
    scale.value = 1;
    rotation.value = 0;
  }, [imageUri, width, height]);

  useImperativeHandle(
    ref,
    () => ({
      rotateBy(deltaDeg = 45) {
        rotation.value = rotation.value + (deltaDeg * Math.PI) / 180;
      },
      scaleBy(factor = 1.15) {
        const next = Math.max(
          MIN_ITEM_SCALE,
          Math.min(MAX_ITEM_SCALE, scale.value * factor),
        );
        scale.value = next;
      },
      resetTransform() {
        x.value = 0;
        y.value = 0;
        scale.value = 1;
        rotation.value = 0;
      },
    }),
    [],
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(
        MIN_ITEM_SCALE,
        Math.min(MAX_ITEM_SCALE, startScale.value * e.scale),
      );
    });

  const rotate = Gesture.Rotation()
    .onBegin(() => {
      startRotation.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = startRotation.value + e.rotation;
    });

  const gestures = Gesture.Simultaneous(pan, pinch, rotate);

  const animated = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value + (gyroOffset?.x || 0) },
      { translateY: y.value + (gyroOffset?.y || 0) },
      { rotate: `${rotation.value}rad` },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View
        style={[styles.frame, { width, height }, animated]}
        accessible
        accessibilityLabel="2D listing photo overlay. Drag to move, or use the bottom control buttons to rotate, scale, or reset."
      >
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
});

export default DraggableItem;

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
    opacity: 0.96,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.36,
    shadowRadius: 14,
    elevation: 8,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
});
