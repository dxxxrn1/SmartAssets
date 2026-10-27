// ─── OnboardingScreen ─────────────────────────────────────────────────────────
// 3-step onboarding carousel — SmartAssets Luminous Lavender & Violet Theme

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { ONBOARDING_SLIDES } from '../constants/data';

export default function OnboardingScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const [step, setStep] = useState(0);
  const slide = ONBOARDING_SLIDES[step];

  const next = () => {
    if (step < ONBOARDING_SLIDES.length - 1) {
      setStep(step + 1);
    } else {
      navigation.navigate(SCREENS.REGISTER);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.obsidian }]}>
      <LinearGradient
        colors={
          isDark
            ? ['#0F172A', '#131A2F', '#1E1B4B', '#0A0E1A']
            : ['#e4e0ffff', '#e0daffff', '#f5dfefff', '#fff5efff', '#ffffffff']
        }
        locations={isDark ? [0, 0.35, 0.7, 1] : [0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}
      />

      <View style={styles.innerWrap}>
        {/* ── Step indicator ── */}
        <View style={styles.header}>
          <Text style={[styles.stepLabel, { color: c.muted }]}>
            Step {step + 1} of {ONBOARDING_SLIDES.length}
          </Text>
        </View>

        <View style={styles.content}>
          {/* ── Hero image ── */}
          <View style={[styles.imageWrap, { backgroundColor: c.card, borderColor: c.border }]}>
            <Image
              source={typeof slide.image === 'string' ? { uri: slide.image } : slide.image}
              style={styles.image}
              resizeMode="cover"
            />
          </View>

          {/* ── Progress dots ── */}
          <View style={styles.dots}>
            {ONBOARDING_SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === step ? c.primary : c.border,
                    flex: i === step ? 2.5 : 1,
                  },
                ]}
              />
            ))}
          </View>

          {/* ── Copy ── */}
          <Text style={[styles.title, { color: c.warm }]}>{slide.title}</Text>
          <Text style={[styles.sub, { color: c.muted }]}>{slide.sub}</Text>
        </View>

        {/* ── CTAs ── */}
        <View style={styles.ctas}>
          <TouchableOpacity
            style={styles.primaryBtnWrap}
            onPress={next}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['#7C3AED', '#5B36F5', '#2563EB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnLabel}>
                {step < ONBOARDING_SLIDES.length - 1 ? 'Continue' : 'Create Account'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {step < ONBOARDING_SLIDES.length - 1 && (
            <TouchableOpacity onPress={() => navigation.navigate(SCREENS.LOGIN)}>
              <Text style={[styles.skipLabel, { color: c.muted }]}>Skip to Sign In</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  innerWrap: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  imageWrap: {
    borderRadius: 24,
    overflow: 'hidden',
    height: 240,
    borderWidth: 1,
    marginBottom: 16,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    lineHeight: 21,
  },
  ctas: {
    paddingHorizontal: 24,
    paddingBottom: 36,
    gap: 12,
    alignItems: 'center',
  },
  primaryBtnWrap: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  primaryBtn: {
    width: '100%',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  skipLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    paddingVertical: 4,
  },
});
