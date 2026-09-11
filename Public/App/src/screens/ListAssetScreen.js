// ─── ListAssetScreen ──────────────────────────────────────────────────────────
// List a new asset for sale — with real picture upload & provenance history builder.

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
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { useAuth } from '../context/AuthContext';
import { createAssetApi } from '../services/api';
import { Feather, Ionicons } from '@expo/vector-icons';

const STEPS = ['Details', 'Photos', 'History', 'Pricing'];

export default function ListAssetScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { token } = useAuth();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Asset Form State — clean dynamic inputs
  const [form, setForm] = useState({
    name: '',
    category: 'Luxury Watch',
    year: String(new Date().getFullYear()),
    condition: '',
    description: '',
    askingPrice: '',
    image: '',
  });

  // Provenance History Events State — user creates real events
  const [historyList, setHistoryList] = useState([]);
  const [newYear, setNewYear] = useState('');
  const [newEvent, setNewEvent] = useState('');
  const [newParty, setNewParty] = useState('');

  // ── Image Picker Handlers ──────────────────────────────────────────────────
  const pickImageFromLibrary = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Permission to access your photo library is required.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const selectedAsset = result.assets[0];
        // Use base64 data URI if available for reliable transfer, otherwise uri
        const imageUri = selectedAsset.base64
          ? `data:image/jpeg;base64,${selectedAsset.base64}`
          : selectedAsset.uri;
        setForm({ ...form, image: imageUri });
      }
    } catch (err) {
      Alert.alert('Error', 'Could not open photo library: ' + err.message);
    }
  };

  const takePhotoWithCamera = async () => {
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        Alert.alert('Permission Denied', 'Camera permission is required to take a photo.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const selectedAsset = result.assets[0];
        const imageUri = selectedAsset.base64
          ? `data:image/jpeg;base64,${selectedAsset.base64}`
          : selectedAsset.uri;
        setForm({ ...form, image: imageUri });
      }
    } catch (err) {
      Alert.alert('Error', 'Could not open camera: ' + err.message);
    }
  };

  // ── History Handlers ───────────────────────────────────────────────────────
  const addHistoryItem = () => {
    if (!newYear.trim() || !newEvent.trim()) {
      Alert.alert('Incomplete Event', 'Please enter both the year and description for this history event.');
      return;
    }

    setHistoryList([
      ...historyList,
      {
        id: String(Date.now()),
        year: newYear.trim(),
        event: newEvent.trim(),
        party: newParty.trim() || 'Verified Custodian',
      },
    ]);

    setNewYear('');
    setNewEvent('');
    setNewParty('');
  };

  const removeHistoryItem = (id) => {
    setHistoryList(historyList.filter((item) => item.id !== id));
  };

  // ── Submit Listing ─────────────────────────────────────────────────────────
  const handleSubmitListing = async () => {
    if (!form.name.trim()) {
      Alert.alert('Missing Details', 'Please enter an asset name.');
      setStep(0);
      return;
    }
    if (!form.askingPrice.trim()) {
      Alert.alert('Missing Price', 'Please enter an asking price.');
      setStep(3);
      return;
    }
    if (!form.image) {
      Alert.alert('Photo Required', 'Please select or capture a photo for your asset in Step 2.');
      setStep(1);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        year: parseInt(form.year, 10) || new Date().getFullYear(),
        condition: form.condition.trim() || 'Verified',
        description: form.description.trim(),
        askingPrice: form.askingPrice.trim(),
        image: form.image,
        history: historyList.map(({ year, event, party }) => ({ year, event, party })),
      };

      await createAssetApi(payload, token);

      Alert.alert(
        'Asset Listed! 🎉',
        'Your luxury asset and provenance history have been saved to the database.',
        [
          {
            text: 'View in Market',
            onPress: () => {
              setStep(0);
              setForm({
                name: '',
                category: 'Luxury Watch',
                year: String(new Date().getFullYear()),
                condition: '',
                description: '',
                askingPrice: '',
                image: '',
              });
              setHistoryList([]);
              navigation.navigate(SCREENS.HOME);
            },
          },
        ]
      );
    } catch (err) {
      const errMsg = err.message || '';
      if (errMsg.toLowerCase().includes('ai fraud') || errMsg.toLowerCase().includes('ai-generated') || errMsg.toLowerCase().includes('synthetic')) {
        Alert.alert(
          '🚫 AI Fraud Guard Alert',
          `${errMsg}\n\nPlease take or upload an authentic, unedited photograph of your physical collectible to proceed.`,
          [
            {
              text: 'Change Photo',
              onPress: () => setStep(1),
            },
          ]
        );
      } else {
        Alert.alert('Listing Error', errMsg || 'Failed to list asset.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (step === 0 && !form.name.trim()) {
      Alert.alert('Required Field', 'Please enter a name for the asset.');
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Nav Bar ── */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => (step > 0 ? setStep(step - 1) : navigation.goBack())}
          >
            <Feather name="arrow-left" size={18} color={c.warm} />
          </TouchableOpacity>
          <Text style={[styles.navTitle, { color: c.warm }]}>List New Luxury Asset</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* ── Step Indicators ── */}
        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <TouchableOpacity
              key={s}
              style={styles.stepItem}
              onPress={() => setStep(i)}
            >
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
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Step 0: Asset Details ── */}
          {step === 0 && (
            <View style={styles.formSection}>
              <Text style={[styles.sectionTitle, { color: c.warm }]}>Asset Details</Text>
              <Text style={[styles.stepDesc, { color: c.muted }]}>
                Provide accurate information for AI appraisal and verification.
              </Text>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>ASSET NAME *</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(val) => setForm({ ...form, name: val })}
                  placeholder="e.g. Patek Philippe Nautilus 5711"
                  placeholderTextColor={c.muted}
                  style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.warm }]}
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>CATEGORY</Text>
                <View style={styles.categoryChips}>
                  {['Luxury Watch', 'Fine Art', 'Classic Car', 'Fine Wine'].map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: form.category === cat ? c.primary : c.card,
                          borderColor: form.category === cat ? c.primary : c.border,
                        },
                      ]}
                      onPress={() => setForm({ ...form, category: cat })}
                    >
                      <Text style={{ color: form.category === cat ? '#FFFFFF' : c.warm, fontSize: 12, fontWeight: '600' }}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.rowFields}>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <Text style={[styles.fieldLabel, { color: c.muted }]}>YEAR</Text>
                  <TextInput
                    value={form.year}
                    onChangeText={(val) => setForm({ ...form, year: val })}
                    placeholder="2023"
                    keyboardType="number-pad"
                    placeholderTextColor={c.muted}
                    style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.warm }]}
                  />
                </View>
                <View style={[styles.fieldWrap, { flex: 1.5 }]}>
                  <Text style={[styles.fieldLabel, { color: c.muted }]}>CONDITION</Text>
                  <TextInput
                    value={form.condition}
                    onChangeText={(val) => setForm({ ...form, condition: val })}
                    placeholder="Mint / Original Box"
                    placeholderTextColor={c.muted}
                    style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.warm }]}
                  />
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>DESCRIPTION</Text>
                <TextInput
                  value={form.description}
                  onChangeText={(val) => setForm({ ...form, description: val })}
                  placeholder="Describe the asset, its features, and documentation…"
                  placeholderTextColor={c.muted}
                  multiline
                  numberOfLines={4}
                  style={[styles.textarea, { backgroundColor: c.card, borderColor: c.border, color: c.warm }]}
                />
              </View>
            </View>
          )}

          {/* ── Step 1: Upload Photos ── */}
          {step === 1 && (
            <View style={styles.formSection}>
              <Text style={[styles.sectionTitle, { color: c.warm }]}>Upload Asset Photo</Text>
              <Text style={[styles.stepDesc, { color: c.muted }]}>
                Add a high-resolution photo from your phone camera, gallery, or choose a preset.
              </Text>

              {/* Photo Preview */}
              {form.image ? (
                <View style={[styles.previewWrap, { borderColor: c.primary }]}>
                  <Image source={{ uri: form.image }} style={styles.previewImage} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => setForm({ ...form, image: '' })}
                  >
                    <Feather name="trash-2" size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[styles.photoPlaceholder, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="image" size={40} color={c.primary} />
                  <Text style={[styles.photoPlaceholderText, { color: c.muted }]}>No photo selected yet</Text>
                </View>
              )}

              {/* Upload Buttons */}
              <View style={styles.uploadBtnRow}>
                <TouchableOpacity
                  style={[styles.pickerBtn, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={pickImageFromLibrary}
                >
                  <Feather name="image" size={18} color={c.primary} />
                  <Text style={[styles.pickerBtnText, { color: c.warm }]}>Choose from Library</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pickerBtn, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={takePhotoWithCamera}
                >
                  <Feather name="camera" size={18} color={c.primary} />
                  <Text style={[styles.pickerBtnText, { color: c.warm }]}>Take Photo</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Step 2: Provenance History Builder ── */}
          {step === 2 && (
            <View style={styles.formSection}>
              <Text style={[styles.sectionTitle, { color: c.warm }]}>Provenance History</Text>
              <Text style={[styles.stepDesc, { color: c.muted }]}>
                Add chain-of-custody milestones and certificates to prove authenticity on the blockchain.
              </Text>

              {/* Existing History Events List */}
              {historyList.map((item, index) => (
                <View
                  key={item.id}
                  style={[styles.historyItemCard, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <View style={styles.historyItemLeft}>
                    <View style={[styles.historyDot, { backgroundColor: c.primary }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.historyYear, { color: c.primary }]}>{item.year}</Text>
                      <Text style={[styles.historyEvent, { color: c.warm }]}>{item.event}</Text>
                      <Text style={[styles.historyParty, { color: c.muted }]}>📍 {item.party}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeHistoryItem(item.id)}
                    style={styles.deleteHistoryBtn}
                  >
                    <Feather name="x" size={16} color={c.muted} />
                  </TouchableOpacity>
                </View>
              ))}

              {/* Add New History Event Form */}
              <View style={[styles.addHistoryBox, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.fieldLabel, { color: c.primary }]}>+ ADD MILESTONE EVENT</Text>

                <View style={styles.rowFields}>
                  <View style={[styles.fieldWrap, { width: 90 }]}>
                    <TextInput
                      value={newYear}
                      onChangeText={setNewYear}
                      placeholder="Year"
                      keyboardType="number-pad"
                      placeholderTextColor={c.muted}
                      style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                    />
                  </View>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <TextInput
                      value={newParty}
                      onChangeText={setNewParty}
                      placeholder="Party / Location / Auction"
                      placeholderTextColor={c.muted}
                      style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                    />
                  </View>
                </View>

                <TextInput
                  value={newEvent}
                  onChangeText={setNewEvent}
                  placeholder="Event description (e.g. Purchased at Sotheby's Auction)"
                  placeholderTextColor={c.muted}
                  style={[styles.input, { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm }]}
                />

                <TouchableOpacity
                  style={[styles.addEventBtn, { backgroundColor: c.primaryBg, borderColor: c.primary }]}
                  onPress={addHistoryItem}
                >
                  <Feather name="plus" size={16} color={c.primary} />
                  <Text style={[styles.addEventBtnText, { color: c.primary }]}>Add Provenance Event</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Step 3: Pricing & Review ── */}
          {step === 3 && (
            <View style={styles.formSection}>
              <Text style={[styles.sectionTitle, { color: c.warm }]}>Set Asking Price</Text>
              <Text style={[styles.stepDesc, { color: c.muted }]}>
                Set your valuation in South African Rand (R). SmartAssets will generate an authenticity certificate.
              </Text>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, { color: c.muted }]}>ASKING PRICE (R) *</Text>
                <TextInput
                  value={form.askingPrice}
                  onChangeText={(val) => setForm({ ...form, askingPrice: val })}
                  placeholder="e.g. 250000"
                  keyboardType="decimal-pad"
                  placeholderTextColor={c.muted}
                  style={[
                    styles.input,
                    { backgroundColor: c.card, borderColor: c.border, color: c.warm, fontSize: 20, fontWeight: '700' },
                  ]}
                />
              </View>

              {/* Summary Review Card */}
              <View style={[styles.reviewCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.fieldLabel, { color: c.primary }]}>LISTING SUMMARY</Text>
                <Text style={[styles.reviewTitle, { color: c.warm }]}>{form.name || 'Untitled Asset'}</Text>
                <Text style={[styles.reviewSub, { color: c.muted }]}>
                  {form.category} • {form.year} • {historyList.length} History Events
                </Text>
              </View>

              <View style={[styles.infoBox, { backgroundColor: c.primaryBg, borderColor: c.primary }]}>
                <Text style={[styles.infoText, { color: c.primary }]}>
                  ◆ Once submitted, your asset and provenance history are registered in Supabase and verified on the blockchain.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* ── Bottom CTA ── */}
        <View style={[styles.cta, { backgroundColor: c.vault, borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[
              styles.nextBtn,
              { backgroundColor: submitting ? c.primaryDim : c.primary },
            ]}
            onPress={step === STEPS.length - 1 ? handleSubmitListing : next}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.nextBtnLabel}>
                {step === STEPS.length - 1 ? 'Submit & Publish Listing' : 'Continue'}
              </Text>
            )}
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
  navTitle: { fontSize: 16, fontWeight: '700' },
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  stepLabel: { fontSize: 10, fontWeight: '600' },
  scroll: { paddingHorizontal: 20, paddingBottom: 28 },
  formSection: { gap: 14 },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  stepDesc: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  input: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14,
  },
  textarea: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, minHeight: 90, textAlignVertical: 'top',
  },
  rowFields: { flexDirection: 'row', gap: 10 },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },

  // Photo Styles
  previewWrap: {
    height: 180, borderRadius: 18, overflow: 'hidden', borderWidth: 2,
    position: 'relative',
  },
  previewImage: { width: '100%', height: '100%' },
  removeImageBtn: {
    position: 'absolute', top: 10, right: 10,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoPlaceholder: {
    height: 140, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  photoPlaceholderText: { fontSize: 13, fontWeight: '500' },
  uploadBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  pickerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
  },
  pickerBtnText: { fontSize: 12, fontWeight: '600' },
  presetsRow: { gap: 10, paddingTop: 4 },
  presetCard: {
    width: 100, padding: 8, borderRadius: 14, borderWidth: 1, alignItems: 'center', gap: 6,
  },
  presetThumb: { width: 84, height: 60, borderRadius: 8 },
  presetText: { fontSize: 10, fontWeight: '600' },

  // History Styles
  historyItemCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, borderRadius: 14, borderWidth: 1,
  },
  historyItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  historyDot: { width: 10, height: 10, borderRadius: 5 },
  historyYear: { fontSize: 12, fontWeight: '700' },
  historyEvent: { fontSize: 13, fontWeight: '600' },
  historyParty: { fontSize: 11 },
  deleteHistoryBtn: { padding: 6 },
  addHistoryBox: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 10, marginTop: 4 },
  addEventBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
  },
  addEventBtnText: { fontSize: 12, fontWeight: '700' },

  // Review & Pricing Styles
  reviewCard: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 4 },
  reviewTitle: { fontSize: 16, fontWeight: '700' },
  reviewSub: { fontSize: 12 },
  infoBox: { padding: 12, borderRadius: 14, borderWidth: 1 },
  infoText: { fontSize: 12, lineHeight: 18 },
  cta: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1 },
  nextBtn: { borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  nextBtnLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
