// ─── ListAssetScreen ──────────────────────────────────────────────────────────
// List a new asset for sale — styled with the Royal Indigo & Electric Blue Market theme.
// Real photo uploads & provenance history builder with zero blinding white or clashing purple.

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
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { ALIM } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { useAuth } from '../context/AuthContext';
import { createAssetApi } from '../services/api';
import { Feather, Ionicons } from '@expo/vector-icons';

const STEPS = ['Details', 'Photos', 'History', 'Pricing'];

// Market screen color palette constants
const PALETTE = {
  bgGradient: ['#1E2768', '#253488', '#141C48'],
  cardBg: 'rgba(255, 255, 255, 0.08)',
  cardBorder: 'rgba(255, 255, 255, 0.16)',
  cardLightBg: 'rgba(255, 255, 255, 0.05)',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  placeholder: 'rgba(255, 255, 255, 0.40)',
  electricBlue: '#3666DD',
  electricBlueLight: '#60A5FA',
  blueGradient: ['#3B82F6', '#3666DD', '#2563EB'],
  emerald: '#10B981',
  emeraldLight: '#34D399',
  bottomBarBg: '#141C48',
  bottomBarBorder: 'rgba(255, 255, 255, 0.12)',
};

export default function ListAssetScreen({ navigation }) {
  const { token } = useAuth();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Asset Form State
  const [form, setForm] = useState({
    name: '',
    category: 'Luxury Watch',
    year: String(new Date().getFullYear()),
    condition: '',
    description: '',
    askingPrice: '',
    images: [], // up to 3 photos
  });

  // Provenance History Events State
  const [historyList, setHistoryList] = useState([]);
  const [newYear, setNewYear] = useState('');
  const [newEvent, setNewEvent] = useState('');
  const [newParty, setNewParty] = useState('');

  // ── Image Picker Handlers ──────────────────────────────────────────────────
  const pickImageFromLibrary = async () => {
    if (form.images.length >= 3) {
      Alert.alert('Limit Reached', 'You can add up to 3 photos. Remove one to add another.');
      return;
    }
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Permission to access your photo library is required.');
        return;
      }

      const remaining = 3 - form.images.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: remaining === 1,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets?.length) {
        const newImages = result.assets.map((a) =>
          a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri
        );
        setForm((prev) => ({
          ...prev,
          images: [...prev.images, ...newImages].slice(0, 3),
        }));
      }
    } catch (err) {
      Alert.alert('Error', 'Could not open photo library: ' + err.message);
    }
  };

  const takePhotoWithCamera = async () => {
    if (form.images.length >= 3) {
      Alert.alert('Limit Reached', 'You can add up to 3 photos. Remove one to add another.');
      return;
    }
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

      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        const imageUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
        setForm((prev) => ({
          ...prev,
          images: [...prev.images, imageUri].slice(0, 3),
        }));
      }
    } catch (err) {
      Alert.alert('Error', 'Could not open camera: ' + err.message);
    }
  };

  const removeImage = (index) => {
    setForm((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
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
    if (!form.images.length) {
      Alert.alert('Photo Required', 'Please select or capture at least one photo for your asset in Step 2.');
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
        image: form.images[0],
        history: historyList.map(({ year, event, party }) => ({ year, event, party })),
      };

      await createAssetApi(payload, token);

      Alert.alert(
        'Asset Listed! 🎉',
        'Your luxury asset and provenance history have been saved to the marketplace.',
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
                images: [],
              });
              setHistoryList([]);
              navigation.navigate(SCREENS.HOME);
            },
          },
        ]
      );
    } catch (err) {
      const errMsg = err.message || '';
      if (
        errMsg.toLowerCase().includes('ai fraud') ||
        errMsg.toLowerCase().includes('ai-generated') ||
        errMsg.toLowerCase().includes('synthetic')
      ) {
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
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <LinearGradient colors={PALETTE.bgGradient} style={StyleSheet.absoluteFillObject} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Nav Bar ── */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => (step > 0 ? setStep(step - 1) : navigation.goBack())}
            activeOpacity={0.8}
          >
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.navTitle}>List New Luxury Asset</Text>
            <Text style={styles.navSubtitle}>CURATED MARKETPLACE</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {/* ── Step Indicators ── */}
        <View style={styles.steps}>
          {STEPS.map((s, i) => {
            const isCompleted = i < step;
            const isActive = i === step;

            return (
              <TouchableOpacity
                key={s}
                style={styles.stepItem}
                onPress={() => setStep(i)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.stepDot,
                    isCompleted && styles.stepDotCompleted,
                    isActive && styles.stepDotActive,
                    !isCompleted && !isActive && styles.stepDotUpcoming,
                  ]}
                >
                  {isCompleted ? (
                    <Feather name="check" size={12} color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.stepNum,
                        isActive ? styles.stepNumActive : styles.stepNumUpcoming,
                      ]}
                    >
                      {String(i + 1)}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    isCompleted && { color: PALETTE.emeraldLight },
                    isActive && { color: PALETTE.electricBlueLight, fontWeight: '700' },
                    !isCompleted && !isActive && { color: 'rgba(255, 255, 255, 0.45)' },
                  ]}
                >
                  {s}
                </Text>
              </TouchableOpacity>
            );
          })}
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
              <Text style={styles.sectionTitle}>Asset Details</Text>
              <Text style={styles.stepDesc}>
                Provide accurate information for AI appraisal and verification.
              </Text>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>ASSET NAME *</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(val) => setForm({ ...form, name: val })}
                  placeholder="e.g. Patek Philippe Nautilus 5711"
                  placeholderTextColor={PALETTE.placeholder}
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>CATEGORY</Text>
                <View style={styles.categoryChips}>
                  {['Luxury Watch', 'Fine Art', 'Classic Car', 'Fine Wine', 'Real Estate', 'Collectibles'].map((cat) => {
                    const isSelected = form.category === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[
                          styles.catChip,
                          isSelected ? styles.catChipActive : styles.catChipInactive,
                        ]}
                        onPress={() => setForm({ ...form, category: cat })}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.catChipText,
                            isSelected ? styles.catChipTextActive : styles.catChipTextInactive,
                          ]}
                        >
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.rowFields}>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>YEAR</Text>
                  <TextInput
                    value={form.year}
                    onChangeText={(val) => setForm({ ...form, year: val })}
                    placeholder="2023"
                    keyboardType="number-pad"
                    placeholderTextColor={PALETTE.placeholder}
                    style={styles.input}
                  />
                </View>
                <View style={[styles.fieldWrap, { flex: 1.5 }]}>
                  <Text style={styles.fieldLabel}>CONDITION</Text>
                  <TextInput
                    value={form.condition}
                    onChangeText={(val) => setForm({ ...form, condition: val })}
                    placeholder="Mint / Original Box"
                    placeholderTextColor={PALETTE.placeholder}
                    style={styles.input}
                  />
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>DESCRIPTION</Text>
                <TextInput
                  value={form.description}
                  onChangeText={(val) => setForm({ ...form, description: val })}
                  placeholder="Describe the asset, its provenance, unique features, and documentation…"
                  placeholderTextColor={PALETTE.placeholder}
                  multiline
                  numberOfLines={4}
                  style={styles.textarea}
                />
              </View>
            </View>
          )}

          {/* ── Step 1: Upload Photos ── */}
          {step === 1 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Upload Asset Photos</Text>
              <Text style={styles.stepDesc}>
                Add up to 3 high-resolution photos. The first photo will be the primary marketplace image.
              </Text>

              {/* Photo Grid */}
              <View style={styles.photoGrid}>
                {form.images.map((uri, index) => (
                  <View key={index} style={styles.photoThumb}>
                    <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.removeThumbBtn}
                      onPress={() => removeImage(index)}
                      activeOpacity={0.8}
                    >
                      <Feather name="x" size={12} color="#FFFFFF" />
                    </TouchableOpacity>
                    {index === 0 && (
                      <LinearGradient
                        colors={['rgba(59, 130, 246, 0.95)', 'rgba(37, 99, 235, 0.95)']}
                        style={styles.primaryBadge}
                      >
                        <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                      </LinearGradient>
                    )}
                  </View>
                ))}

                {/* Empty slots */}
                {form.images.length < 3 && (
                  <TouchableOpacity
                    style={[styles.photoThumb, styles.addPhotoSlot]}
                    onPress={pickImageFromLibrary}
                    activeOpacity={0.8}
                  >
                    <Feather name="plus-circle" size={24} color={PALETTE.electricBlueLight} />
                    <Text style={styles.addPhotoSlotText}>
                      {form.images.length === 0 ? 'Add Photo' : `${3 - form.images.length} more`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Upload Action Buttons */}
              <View style={styles.uploadBtnRow}>
                <TouchableOpacity
                  style={[
                    styles.pickerBtn,
                    form.images.length >= 3 && { opacity: 0.45 },
                  ]}
                  onPress={pickImageFromLibrary}
                  disabled={form.images.length >= 3}
                  activeOpacity={0.8}
                >
                  <Feather name="image" size={18} color={PALETTE.electricBlueLight} />
                  <Text style={styles.pickerBtnText}>Choose from Library</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pickerBtn,
                    form.images.length >= 3 && { opacity: 0.45 },
                  ]}
                  onPress={takePhotoWithCamera}
                  disabled={form.images.length >= 3}
                  activeOpacity={0.8}
                >
                  <Feather name="camera" size={18} color={PALETTE.electricBlueLight} />
                  <Text style={styles.pickerBtnText}>Take Photo</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.photoHint}>
                {form.images.length}/3 photos added
              </Text>
            </View>
          )}

          {/* ── Step 2: Provenance History Builder ── */}
          {step === 2 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Provenance History</Text>
              <Text style={styles.stepDesc}>
                Add chain-of-custody milestones and certificates to prove authenticity on the blockchain.
              </Text>

              {/* Existing History Events List */}
              {historyList.map((item) => (
                <View key={item.id} style={styles.historyItemCard}>
                  <View style={styles.historyItemLeft}>
                    <View style={styles.historyDot} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.historyYear}>{item.year}</Text>
                      <Text style={styles.historyEvent}>{item.event}</Text>
                      <Text style={styles.historyParty}>📍 {item.party}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeHistoryItem(item.id)}
                    style={styles.deleteHistoryBtn}
                    activeOpacity={0.7}
                  >
                    <Feather name="trash-2" size={15} color={PALETTE.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}

              {/* Add New History Event Box */}
              <View style={styles.addHistoryBox}>
                <Text style={styles.fieldLabel}>+ ADD MILESTONE EVENT</Text>

                <View style={styles.rowFields}>
                  <View style={[styles.fieldWrap, { width: 95 }]}>
                    <TextInput
                      value={newYear}
                      onChangeText={setNewYear}
                      placeholder="Year"
                      keyboardType="number-pad"
                      placeholderTextColor={PALETTE.placeholder}
                      style={styles.input}
                    />
                  </View>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <TextInput
                      value={newParty}
                      onChangeText={setNewParty}
                      placeholder="Party / Location / Auction"
                      placeholderTextColor={PALETTE.placeholder}
                      style={styles.input}
                    />
                  </View>
                </View>

                <TextInput
                  value={newEvent}
                  onChangeText={setNewEvent}
                  placeholder="Event description (e.g. Purchased at Sotheby's Auction)"
                  placeholderTextColor={PALETTE.placeholder}
                  style={styles.input}
                />

                <TouchableOpacity
                  style={styles.addEventBtn}
                  onPress={addHistoryItem}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={16} color={PALETTE.electricBlueLight} />
                  <Text style={styles.addEventBtnText}>Add Provenance Event</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Step 3: Pricing & Review ── */}
          {step === 3 && (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Set Asking Price</Text>
              <Text style={styles.stepDesc}>
                Set your valuation in South African Rand (R). SmartAssets generates an escrow-protected listing.
              </Text>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>ASKING PRICE (R) *</Text>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceCurrency}>R</Text>
                  <TextInput
                    value={form.askingPrice}
                    onChangeText={(val) => setForm({ ...form, askingPrice: val })}
                    placeholder="250000"
                    keyboardType="decimal-pad"
                    placeholderTextColor={PALETTE.placeholder}
                    style={styles.priceInput}
                  />
                </View>
              </View>

              {/* Summary Review Card */}
              <View style={styles.reviewCard}>
                <Text style={styles.reviewHeading}>LISTING SUMMARY</Text>
                <Text style={styles.reviewTitle}>{form.name || 'Untitled Asset'}</Text>
                <Text style={styles.reviewSub}>
                  {form.category} • {form.year} • {historyList.length} History Event{historyList.length !== 1 ? 's' : ''}
                </Text>
                {form.askingPrice ? (
                  <Text style={styles.reviewPrice}>
                    R {Number(form.askingPrice).toLocaleString()}
                  </Text>
                ) : null}
              </View>

              <View style={styles.infoBox}>
                <Ionicons name="shield-checkmark" size={18} color={PALETTE.electricBlueLight} style={{ marginTop: 2 }} />
                <Text style={styles.infoText}>
                  Once submitted, your asset and provenance history are registered in Supabase and verified on the blockchain with Escrow Protection.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* ── Bottom Action Bar (Market Blue Gradient) ── */}
        <View style={styles.cta}>
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={step === STEPS.length - 1 ? handleSubmitListing : next}
            activeOpacity={0.88}
            disabled={submitting}
          >
            <LinearGradient
              colors={PALETTE.blueGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.nextBtnGradient}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <View style={styles.nextBtnContent}>
                  <Text style={styles.nextBtnLabel}>
                    {step === STEPS.length - 1 ? 'Submit & Publish Listing' : 'Continue'}
                  </Text>
                  <Feather
                    name={step === STEPS.length - 1 ? 'check-circle' : 'arrow-right'}
                    size={18}
                    color="#FFFFFF"
                  />
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#1E2768',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  navSubtitle: {
    fontSize: 9,
    fontWeight: '700',
    color: '#60A5FA',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  stepItem: {
    alignItems: 'center',
    gap: 5,
  },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotCompleted: {
    backgroundColor: '#10B981',
  },
  stepDotActive: {
    backgroundColor: '#3666DD',
    borderWidth: 2,
    borderColor: '#60A5FA',
  },
  stepDotUpcoming: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  stepNum: {
    fontSize: 11,
    fontWeight: '700',
  },
  stepNumActive: {
    color: '#FFFFFF',
  },
  stepNumUpcoming: {
    color: 'rgba(255, 255, 255, 0.45)',
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  formSection: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  stepDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: '#CBD5E1',
    marginBottom: 4,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#60A5FA',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
  },
  textarea: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#FFFFFF',
    minHeight: 90,
    textAlignVertical: 'top',
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  categoryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  catChipActive: {
    backgroundColor: '#3666DD',
    borderColor: '#60A5FA',
  },
  catChipInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  catChipTextActive: {
    color: '#FFFFFF',
  },
  catChipTextInactive: {
    color: '#CBD5E1',
  },

  // Photo Grid Styles
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoThumb: {
    width: 100,
    height: 100,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  removeThumbBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: 'center',
  },
  primaryBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  addPhotoSlot: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(96, 165, 250, 0.35)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addPhotoSlotText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#60A5FA',
  },
  photoHint: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
  },
  uploadBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  pickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  pickerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // History Styles
  historyItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  historyItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  historyYear: {
    fontSize: 12,
    fontWeight: '700',
    color: '#60A5FA',
  },
  historyEvent: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  historyParty: {
    fontSize: 11,
    color: '#CBD5E1',
  },
  deleteHistoryBtn: {
    padding: 6,
  },
  addHistoryBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    gap: 10,
    marginTop: 4,
  },
  addEventBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(54, 102, 221, 0.20)',
    borderWidth: 1,
    borderColor: '#3666DD',
  },
  addEventBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#60A5FA',
  },

  // Review & Pricing Styles
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(54, 102, 221, 0.45)',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  priceCurrency: {
    fontSize: 20,
    fontWeight: '700',
    color: '#60A5FA',
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reviewCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    gap: 6,
  },
  reviewHeading: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#60A5FA',
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reviewSub: {
    fontSize: 13,
    color: '#CBD5E1',
  },
  reviewPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: '#34D399',
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(54, 102, 221, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(54, 102, 221, 0.35)',
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#93C5FD',
    flex: 1,
  },

  // CTA
  cta: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
    backgroundColor: '#141C48',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  nextBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  nextBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
