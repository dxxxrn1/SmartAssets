import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { A4_HEIGHT_CM, A4_WIDTH_CM } from './constants';

/** A4 calibration overlay. onLock receives measured pixels per centimetre. */
export default function ScaleLock({ onLock, onSkip }) {
  const width = useSharedValue(180);
  const startWidth = useSharedValue(180);
  const pinch = useMemo(() => Gesture.Pinch().onBegin(() => { startWidth.value = width.value; }).onUpdate((e) => { width.value = Math.max(105, Math.min(330, startWidth.value * e.scale)); }), []);
  const paperStyle = useAnimatedStyle(() => ({ width: width.value, height: width.value * A4_HEIGHT_CM / A4_WIDTH_CM }));
  return <View style={styles.overlay}>
    <Text style={styles.title}>Match the real size</Text>
    <Text style={styles.instructions}>Tape an A4 sheet to the wall. Pinch to match the rectangle to the sheet, then tap Lock.</Text>
    <GestureDetector gesture={pinch}><Animated.View style={[styles.paper, paperStyle]}><Text style={styles.paperText}>A4 · 21 × 29.7 cm</Text></Animated.View></GestureDetector>
    <View style={styles.actions}><Pressable style={styles.primary} onPress={() => onLock(width.value / A4_WIDTH_CM)}><Text style={styles.primaryText}>Lock</Text></Pressable><Pressable style={styles.secondary} onPress={onSkip}><Text style={styles.secondaryText}>Skip</Text></Pressable></View>
  </View>;
}
const styles = StyleSheet.create({ overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,10,22,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 4 }, title: { color: 'white', fontSize: 24, fontWeight: '800', marginBottom: 10 }, instructions: { color: '#D5DEEF', textAlign: 'center', lineHeight: 22, marginBottom: 24 }, paper: { backgroundColor: '#F8FAFC', borderColor: '#22D3EE', borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }, paperText: { color: '#263244', fontWeight: '700' }, actions: { flexDirection: 'row', gap: 12, marginTop: 24 }, primary: { backgroundColor: '#0891B2', paddingHorizontal: 34, paddingVertical: 13, borderRadius: 24 }, primaryText: { color: 'white', fontWeight: '800' }, secondary: { paddingHorizontal: 28, paddingVertical: 13 }, secondaryText: { color: '#E2E8F0', fontWeight: '700' } });
