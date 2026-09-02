// ─── ListAssetScreen ──────────────────────────────────────────────────────────
// List a new asset for sale — multi-step form skeleton

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { Feather } from '@expo/vector-icons';

const STEPS = ['Details', 'Photos', 'Verification', 'Pricing'];

export default function ListAssetScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '',
    category: '',
    year: '',
    condition: '',
    description: '',
    askingPrice: '',
  });

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Nav ── */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={18} color={c.warm} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: c.warm }]}>List an Asset</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* ── Step indicators ── */}
      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                {
                  backgroundColor:
                    i < step ? c.primary : i === step ? c.primaryLight : c.border,
                },
              ]}
            >
              {i < step ? (
                <Feather name="check" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.stepNum}>{String(i + 1)}</Text>
              )}
            </View>
            <Text
              style={[
                styles.stepLabel,
                { color: i <= step ? c.primary : c.muted },
              ]}
            >
              {s}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Step 0: Details ── */}
        {step === 0 && (
          <View style={styles.formSection}>
            <Text style={[styles.sectionTitle, { color: c.warm }]}>Asset Details</Text>

            {[
              ['Asset Name', 'name', 'e.g. Rolex Daytona 116500LN'],
              ['Category', 'category', 'e.g. Luxury Watch'],
              ['Year', 'year', 'e.g. 2019'],
              ['Condition', 'condition', 'e.g. Excellent, Museum Grade…'],
            ].map(([label, key, placeholder]) => (
              <View key={key} style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>{label.toUpperCase()}</Text>
                <TextInput
                  value={form[key]}
                  onChangeText={(val) => setForm({ ...form, [key]: val })}
                  placeholder={placeholder}
                  placeholderTextColor={c.muted}
                  style={[
                    styles.input,
                    { backgroundColor: c.card, borderColor: c.border, color: c.warm },
                  ]}
                />
              </View>
            ))}

            <View style={styles.fieldWrap}>
              <Text style={[styles.fieldLabel, { color: c.muted }]}>DESCRIPTION</Text>
              <TextInput
                value={form.description}
                onChangeText={(val) => setForm({ ...form, description: val })}
                placeholder="Describe the asset, its history, and notable features…"
                placeholderTextColor={c.muted}
                multiline
                numberOfLines={4}
                style={[
                  styles.textarea,
                  { backgroundColor: c.card, borderColor: c.border, color: c.warm },
                ]}
              />
            </View>
          </View>
        )}

        {/* ── Step 1: Photos ── */}
        {step === 1 && (
          <View style={styles.formSection}>
            <Text style={[styles.sectionTitle, { color: c.warm }]}>Upload Photos</Text>
            <Text style={[styles.stepDesc, { color: c.muted }]}>
              Add high-quality photos from all angles. A minimum of 4 photos is required.
            </Text>
            {/* TODO: implement photo picker with expo-image-picker */}
            <View style={[styles.photoPlaceholder, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="camera" size={32} color={c.primary} />
              <Text style={[styles.photoPlaceholderText, { color: c.muted, marginTop: 8 }]}>
                Tap to upload photos
              </Text>
            </View>
          </View>
        )}

        {/* ── Step 2: Verification ── */}
        {step === 2 && (
          <View style={styles.formSection}>
            <Text style={[styles.sectionTitle, { color: c.warm }]}>Verification Request</Text>
            <Text style={[styles.stepDesc, { color: c.muted }]}>
              Our certified appraisers will inspect your asset. Upload any existing certificates
              or documentation.
            </Text>
            {/* TODO: document upload */}
            <View style={[styles.photoPlaceholder, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="file-text" size={32} color={c.primary} />
              <Text style={[styles.photoPlaceholderText, { color: c.muted, marginTop: 8 }]}>
                Upload certificates / provenance docs
              </Text>
            </View>
          </View>
        )}

        {/* ── Step 3: Pricing ── */}
        {step === 3 && (
          <View style={styles.formSection}>
            <Text style={[styles.sectionTitle, { color: c.warm }]}>Set Asking Price</Text>
            <View style={styles.fieldWrap}>
              <Text style={[styles.fieldLabel, { color: c.muted }]}>ASKING PRICE (£)</Text>
              <TextInput
                value={form.askingPrice}
                onChangeText={(val) => setForm({ ...form, askingPrice: val })}
                placeholder="0.00"
                keyboardType="decimal-pad"
                placeholderTextColor={c.muted}
                style={[
                  styles.input,
                  { backgroundColor: c.card, borderColor: c.border, color: c.warm },
                ]}
              />
            </View>
            <View style={[styles.infoBox, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
              <Text style={[styles.infoText, { color: c.primary }]}>
                ◆ SmartAssets will provide an AI valuation estimate after your asset is verified.
                You can adjust the price before it goes live.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Bottom CTA ── */}
      <View style={[styles.cta, { backgroundColor: c.vault, borderTopColor: c.border }]}>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={step === STEPS.length - 1 ? () => navigation.goBack() : next}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnLabel}>
            {step === STEPS.length - 1 ? 'Submit Listing' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { fontSize: 18, fontWeight: '600' },
  navTitle: { fontSize: 16, fontWeight: '700' },
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  stepLabel: { fontSize: 10, fontWeight: '600' },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  formSection: { gap: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  stepDesc: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  input: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14 },
  textarea: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 14, minHeight: 100, textAlignVertical: 'top',
  },
  photoPlaceholder: {
    height: 160, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  photoPlaceholderText: { fontSize: 13, fontWeight: '500' },
  infoBox: { padding: 14, borderRadius: 14, borderWidth: 1 },
  infoText: { fontSize: 12, lineHeight: 18 },
  cta: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1 },
  nextBtn: { borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  nextBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
