// ─── OnboardingScreen ─────────────────────────────────────────────────────────
// 3-step onboarding carousel — mirrors prototype slides

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
      navigation.navigate(SCREENS.LOGIN);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.obsidian }]}>
      {/* ── Step indicator ── */}
      <View style={styles.header}>
        <Text style={[styles.stepLabel, { color: c.muted }]}>
          Step {step + 1} of {ONBOARDING_SLIDES.length}
        </Text>
      </View>

      <View style={styles.content}>
        {/* ── Hero image ── */}
        <View style={[styles.imageWrap, { backgroundColor: c.card, borderColor: c.border }]}>
          <Image source={{ uri: slide.image }} style={styles.image} resizeMode="cover" />
          {/* Gradient overlay — TODO: use expo-linear-gradient */}
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
          style={[styles.primaryBtn, { backgroundColor: c.primary }]}
          onPress={next}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnLabel}>
            {step < ONBOARDING_SLIDES.length - 1 ? 'Continue' : 'Create Account'}
          </Text>
        </TouchableOpacity>

        {step < ONBOARDING_SLIDES.length - 1 && (
          <TouchableOpacity onPress={() => navigation.navigate(SCREENS.LOGIN)}>
            <Text style={[styles.skipLabel, { color: c.muted }]}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '600',
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
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  sub: {
    fontSize: 13,
    lineHeight: 20,
  },
  ctas: {
    paddingHorizontal: 24,
    paddingBottom: 36,
    gap: 12,
    alignItems: 'center',
  },
  primaryBtn: {
    width: '100%',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  skipLabel: {
    fontSize: 13,
    fontWeight: '500',
    paddingVertical: 4,
  },
});
