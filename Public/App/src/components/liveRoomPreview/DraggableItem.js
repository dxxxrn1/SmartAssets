import React, { useEffect } from 'react';
import { Image, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { MAX_ITEM_SCALE, MIN_ITEM_SCALE } from './constants';

/** Live image overlay with simultaneous pan, pinch, and rotation gestures. */
export default function DraggableItem({ imageUri, width, height, gyroOffset }) {
  const x = useSharedValue(0); const y = useSharedValue(0); const scale = useSharedValue(1); const rotation = useSharedValue(0);
  const startX = useSharedValue(0); const startY = useSharedValue(0); const startScale = useSharedValue(1); const startRotation = useSharedValue(0);
  useEffect(() => { x.value = 0; y.value = 0; scale.value = 1; rotation.value = 0; }, [imageUri, width, height]);
  const pan = Gesture.Pan().onBegin(() => { startX.value = x.value; startY.value = y.value; }).onUpdate((e) => { x.value = startX.value + e.translationX; y.value = startY.value + e.translationY; });
  const pinch = Gesture.Pinch().onBegin(() => { startScale.value = scale.value; }).onUpdate((e) => { scale.value = Math.max(MIN_ITEM_SCALE, Math.min(MAX_ITEM_SCALE, startScale.value * e.scale)); });
  const rotate = Gesture.Rotation().onBegin(() => { startRotation.value = rotation.value; }).onUpdate((e) => { rotation.value = startRotation.value + e.rotation; });
  const gestures = Gesture.Simultaneous(pan, pinch, rotate);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + gyroOffset.x }, { translateY: y.value + gyroOffset.y }, { rotate: `${rotation.value}rad` }, { scale: scale.value }] }));
  return <GestureDetector gesture={gestures}><Animated.View style={[styles.frame, { width, height }, animated]}><Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" /></Animated.View></GestureDetector>;
}
const styles = StyleSheet.create({ frame: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(255,255,255,0.06)', opacity: 0.95, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.32, shadowRadius: 12, elevation: 8 }, image: { width: '100%', height: '100%' } });
