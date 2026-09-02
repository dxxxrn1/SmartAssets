// ─── SplashScreen ─────────────────────────────────────────────────────────────
// First screen: SmartAssets brand + Get Started / Sign In CTAs

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Feather } from '@expo/vector-icons';

export default function SplashScreen({ navigation, isDark }) {
  const c = useColors(isDark);

  const features = [
    { text: 'Blockchain-verified authenticity', icon: 'shield' },
    { text: 'AI-powered appraisal & health check', icon: 'cpu' },
    { text: 'Secure smart contract escrow', icon: 'lock' },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.obsidian }]}>
      {/* ── Brand Icon ── */}
      <View style={styles.center}>
        <View style={[styles.logoWrap, { backgroundColor: c.primary }]}>
          {/* TODO: Replace with actual SmartAssets SVG logo */}
          <Text style={styles.logoText}>SA</Text>
        </View>

        {/* ── Brand Name ── */}
        <Text style={[styles.brandName, { color: c.warm }]}>
          Smart<Text style={{ color: c.primary }}>Assets</Text>
        </Text>
        <Text style={[styles.tagline, { color: c.muted }]}>
          Verified Luxury & Collectibles Marketplace
        </Text>

        {/* ── Feature Pills ── */}
        <View style={styles.features}>
          {features.map((f) => (
            <View
              key={f.text}
              style={[
                styles.featurePill,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <View style={[styles.featureDot, { backgroundColor: c.primaryBg }]}>
                <Feather name={f.icon} size={11} color={c.primary} />
              </View>
              <Text style={[styles.featureText, { color: c.warm }]}>{f.text}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── CTAs ── */}
      <View style={styles.ctas}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.primary }]}
          onPress={() => navigation.navigate(SCREENS.ONBOARDING)}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnLabel}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.ghostBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => navigation.navigate(SCREENS.LOGIN)}
          activeOpacity={0.85}
        >
          <Text style={[styles.ghostBtnLabel, { color: c.primary }]}>Sign In</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    // TODO: add shadow / glow via elevation / shadowColor
  },
  logoText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 26,
  },
  brandName: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 28,
  },
  features: {
    width: '100%',
    gap: 10,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  featureDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureDotText: {
    fontSize: 9,
    fontWeight: '800',
  },
  featureText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  ctas: {
    paddingHorizontal: 24,
    paddingBottom: 36,
    gap: 12,
  },
  primaryBtn: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  ghostBtn: {
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  ghostBtnLabel: {
    fontWeight: '600',
    fontSize: 14,
  },
});
