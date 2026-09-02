// ─── Shared UI Components ─────────────────────────────────────────────────────
// Badge, StatusBar shim, and bottom-nav pill — used across multiple screens

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '../constants/theme';

// ── Badge ────────────────────────────────────────────────────────────────────
// variant: 'verified' | 'pending' | 'blue' | 'accent'
export function Badge({ text, variant = 'verified', isDark = false }) {
  const c = useColors(isDark);

  const variantStyles = {
    verified: { bg: c.greenBg, color: c.green, border: 'rgba(16,185,129,0.3)' },
    pending:  { bg: c.amberBg, color: c.amber,  border: 'rgba(245,158,11,0.3)' },
    blue:     { bg: c.primaryBg, color: c.primary, border: 'rgba(56,189,248,0.3)' },
    accent:   { bg: c.primaryBg, color: c.primaryLight, border: 'rgba(14,165,233,0.35)' },
  };

  const vs = variantStyles[variant] ?? variantStyles.verified;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: vs.bg, borderColor: vs.border },
      ]}
    >
      {text === 'Verified' && (
        <Feather name="check" size={11} color={vs.color} style={{ marginRight: 3 }} />
      )}
      {text === 'Pending' && (
        <Feather name="clock" size={11} color={vs.color} style={{ marginRight: 3 }} />
      )}
      <Text style={[styles.badgeText, { color: vs.color }]}>
        {text}
      </Text>
    </View>
  );
}

// ── SectionLabel ─────────────────────────────────────────────────────────────
// Small uppercase tracking label
export function SectionLabel({ text, isDark = false, style }) {
  const c = useColors(isDark);
  return (
    <Text style={[styles.sectionLabel, { color: c.muted }, style]}>
      {text.toUpperCase()}
    </Text>
  );
}

// ── Divider ──────────────────────────────────────────────────────────────────
export function Divider({ isDark = false, style }) {
  const c = useColors(isDark);
  return <View style={[{ height: 1, backgroundColor: c.border }, style]} />;
}

// ── PrimaryButton ─────────────────────────────────────────────────────────────
export function PrimaryButton({ label, onPress, isDark = false, style }) {
  const c = useColors(isDark);
  return (
    <View
      style={[
        styles.primaryBtn,
        { backgroundColor: c.primary },
        style,
      ]}
    >
      <Text style={styles.primaryBtnLabel} onPress={onPress}>
        {label}
      </Text>
    </View>
  );
}

// ── GhostButton ───────────────────────────────────────────────────────────────
export function GhostButton({ label, onPress, isDark = false, style }) {
  const c = useColors(isDark);
  return (
    <View
      style={[
        styles.ghostBtn,
        { backgroundColor: c.card, borderColor: c.border },
        style,
      ]}
    >
      <Text style={[styles.ghostBtnLabel, { color: c.warm }]} onPress={onPress}>
        {label}
      </Text>
    </View>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, isDark = false, style }) {
  const c = useColors(isDark);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  ghostBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  ghostBtnLabel: {
    fontWeight: '600',
    fontSize: 14,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
