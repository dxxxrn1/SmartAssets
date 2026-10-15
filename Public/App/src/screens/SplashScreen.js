// ─── SplashScreen / Landing Page ──────────────────────────────────────────────
// Modern high-converting fintech landing page inspired by the reference design:
// Full-screen lifestyle hero photography with golden spiral & sparkle accents,
// smooth dark vignette gradient, clean bold typography, and a luminous mint CTA pill.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { SCREENS } from '../constants/navigation';
import { ALIM } from '../constants/theme';
import { Feather, Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function SplashScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Background Hero Image (Lifestyle Photography with Golden Spiral) ── */}
      <Image
        source={require('../../assets/landing_hero.png')}
        style={styles.heroBackground}
        resizeMode="cover"
      />

      {/* ── Deep Vignette Fade (Darkens bottom half for high text readability) ── */}
      <LinearGradient
        colors={[
          'rgba(30, 39, 104, 0.05)',
          'rgba(30, 39, 104, 0.35)',
          'rgba(30, 39, 104, 0.85)',
          '#1E2768',
          '#1E2768',
        ]}
        locations={[0, 0.38, 0.62, 0.82, 1]}
        style={styles.vignetteOverlay}
      />

      {/* ── Top Subtle Brand Header ── */}
      <SafeAreaView edges={['top']} style={styles.topSafeArea}>
        <View style={styles.topBrandRow}>
          <View style={styles.brandPill}>
            <Ionicons name="shield-checkmark" size={14} color="#F59E0B" />
            <Text style={styles.brandPillText}>SMARTASSETS</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Bottom Content & CTA Section (Matching Mockup) ── */}
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.bottomSafeArea}>
        <View style={styles.contentWrap}>
          {/* Headline */}
          <Text style={styles.headline}>SmartAssets</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            One-stop solution to verified luxury assets & fractional investments
          </Text>

          {/* ── Primary Action: Vibrant Luminous Mint Pill Button ── */}
          <TouchableOpacity
            style={styles.ctaButton}
            activeOpacity={0.88}
            onPress={() => navigation.navigate(SCREENS.ONBOARDING)}
          >
            <LinearGradient
              colors={['#3B82F6', '#2563EB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <Text style={styles.ctaText}>Get Started</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Secondary Action: Sign In Link ── */}
          <TouchableOpacity
            style={styles.signInTouch}
            activeOpacity={0.75}
            onPress={() => navigation.navigate(SCREENS.LOGIN)}
          >
            <Text style={styles.signInPrompt}>
              Already have an account?{' '}
              <Text style={styles.signInHighlight}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E2768',
  },

  heroBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },

  vignetteOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT * 0.72,
  },

  topSafeArea: {
    zIndex: 10,
  },

  topBrandRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 12,
  },

  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30, 39, 104, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },

  brandPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.4,
  },

  bottomSafeArea: {
    marginTop: 'auto',
    zIndex: 10,
  },

  contentWrap: {
    paddingHorizontal: 28,
    paddingBottom: 24,
    alignItems: 'center',
  },

  headline: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    textAlign: 'center',
    marginBottom: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#CBD5E1',
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  ctaButton: {
    width: '100%',
    borderRadius: 999,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 18,
  },

  ctaGradient: {
    paddingVertical: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ctaText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  signInTouch: {
    paddingVertical: 8,
  },

  signInPrompt: {
    fontSize: 13.5,
    color: '#94A3B8',
    fontWeight: '500',
  },

  signInHighlight: {
    color: '#60A5FA',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
