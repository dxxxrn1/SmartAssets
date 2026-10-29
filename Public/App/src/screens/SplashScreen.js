// ─── SplashScreen / Landing Page ──────────────────────────────────────────────
// SmartAssets Landing Page — Full-screen hero photography with Violet-Indigo
// vignette gradient, diamond brand badge, and signature SmartAssets CTA pill.

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
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function SplashScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Background Hero Image ── */}
      <Image
        source={require('../../assets/landing_hero.png')}
        style={styles.heroBackground}
        resizeMode="cover"
      />

      {/* ── Deep Violet-Indigo Vignette Fade ── */}
      <LinearGradient
        colors={[
          'rgba(46, 16, 101, 0.05)',
          'rgba(46, 16, 101, 0.35)',
          'rgba(46, 16, 101, 0.85)',
          '#1E1B4B',
          '#1E1B4B',
        ]}
        locations={[0, 0.38, 0.62, 0.82, 1]}
        style={styles.vignetteOverlay}
      />

      {/* ── Top Subtle Brand Header ── */}
      <SafeAreaView edges={['top']} style={styles.topSafeArea}>
        <View style={styles.topBrandRow}>
          <View style={styles.brandPill}>
            <Image
              source={require('../../assets/logo-mark.png')}
              style={styles.brandPillLogo}
              resizeMode="contain"
            />
            <Text style={styles.brandPillText}>SMART ASSETS</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Bottom Content & CTA Section ── */}
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.bottomSafeArea}>
        <View style={styles.contentWrap}>
          {/* Official Logo Emblem */}
          <Image
            source={require('../../assets/logo-mark.png')}
            style={styles.logoHeroMark}
            resizeMode="contain"
          />

          {/* Headline */}
          <Text style={styles.headline}>SmartAssets</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Own Today. Grow Tomorrow.
          </Text>

          {/* ── Primary Action: SmartAssets Violet-Cyan Gradient Pill Button ── */}
          <TouchableOpacity
            style={styles.ctaButton}
            activeOpacity={0.88}
            onPress={() => navigation.navigate(SCREENS.ONBOARDING)}
          >
            <LinearGradient
              colors={['#7C3AED', '#5B36F5', '#2563EB']}
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
    backgroundColor: '#1E1B4B',
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
    gap: 8,
    backgroundColor: 'rgba(46, 16, 101, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },

  brandPillLogo: {
    width: 17,
    height: 17,
  },

  brandPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.4,
  },

  logoHeroMark: {
    width: 68,
    height: 68,
    marginBottom: 16,
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
    color: '#E2E8F0',
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
    maxWidth: 460,
    borderRadius: 999,
    shadowColor: '#7C3AED',
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
    color: '#CBD5E1',
    fontWeight: '500',
  },

  signInHighlight: {
    color: '#C084FC',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
