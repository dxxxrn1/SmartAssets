// ─── ListAssetScreen ──────────────────────────────────────────────────────────
// List a new luxury asset for sale — unified with the Luminous Purple & Cyan Fintech theme.
// Real photo uploads & provenance history builder with Supabase & blockchain escrow integration.

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
import { SCREENS } from '../constants/navigation';
import { useAuth } from '../context/AuthContext';
import { createAssetApi } from '../services/api';
import { Feather, Ionicons } from '@expo/vector-icons';

const STEPS = ['Details', 'Photos', 'History', 'Pricing'];

const CANVAS_MESH = [
  'rgba(216, 214, 253, 1)',
  '#d5cdffff',
  '#fae3f4ff',
  '#fff0e6ff',
  '#FFF7EF',
];

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
    <View style={styles.container}>
      {/* ── Soft Luminous 6-Stop Mesh Background ── */}
      <LinearGradient
        colors={CANVAS_MESH}
        locations={[0, 0.2, 0.5, 0.8, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* ── Header / Breadcrumb Bar ── */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => (step > 0 ? setStep(step - 1) : navigation.goBack())}
              activeOpacity={0.8}
            >
              <Feather name="arrow-left" size={18} color="#0F172A" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.navTitle}>List New Luxury Asset</Text>
              <Text style={styles.navSubtitle}>TOKENIZE & ESCROW</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* ── Modern Step Progress Pills ── */}
          <View style={styles.stepsRow}>
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
                  {isActive ? (
                    <LinearGradient
                      colors={['#976af0', '#00fbff']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.stepDotActive}
                    >
                      <Text style={styles.stepNumActive}>{i + 1}</Text>
                    </LinearGradient>
                  ) : isCompleted ? (
                    <View style={styles.stepDotCompleted}>
                      <Feather name="check" size={13} color="#FFFFFF" />
                    </View>
                  ) : (
                    <View style={styles.stepDotUpcoming}>
                      <Text style={styles.stepNumUpcoming}>{i + 1}</Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.stepLabel,
                      isActive && styles.stepLabelActive,
                      isCompleted && styles.stepLabelCompleted,
                      !isActive && !isCompleted && styles.stepLabelUpcoming,
                    ]}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Form Body Scroll ── */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Main Form White Card Container ── */}
            <View style={styles.mainCard}>
              {/* ── Step 0: Asset Details ── */}
              {step === 0 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 1 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Asset Details</Text>
                    <Text style={styles.stepDesc}>
                      Provide accurate information for AI appraisal and blockchain verification.
                    </Text>
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>ASSET NAME *</Text>
                    <TextInput
                      value={form.name}
                      onChangeText={(val) => setForm({ ...form, name: val })}
                      placeholder="e.g. Rolex Daytona 116500LN"
                      placeholderTextColor="#94A3B8"
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
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                      />
                    </View>
                    <View style={[styles.fieldWrap, { flex: 1.5 }]}>
                      <Text style={styles.fieldLabel}>CONDITION</Text>
                      <TextInput
                        value={form.condition}
                        onChangeText={(val) => setForm({ ...form, condition: val })}
                        placeholder="Mint / Original Box"
                        placeholderTextColor="#94A3B8"
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
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={4}
                      style={styles.textarea}
                    />
                  </View>
                </View>
              )}

              {/* ── Step 1: Upload Photos ── */}
              {step === 1 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 2 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Upload Asset Photos</Text>
                    <Text style={styles.stepDesc}>
                      Add up to 3 high-resolution photos. The first photo will be the primary spotlight image.
                    </Text>
                  </View>

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
                            colors={['#976af0', '#00fbff']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.primaryBadge}
                          >
                            <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                          </LinearGradient>
                        )}
                      </View>
                    ))}

                    {/* Empty slot */}
                    {form.images.length < 3 && (
                      <TouchableOpacity
                        style={[styles.photoThumb, styles.addPhotoSlot]}
                        onPress={pickImageFromLibrary}
                        activeOpacity={0.8}
                      >
                        <View style={styles.addIconCircle}>
                          <Feather name="plus" size={18} color="#7C3AED" />
                        </View>
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
                      <Feather name="image" size={18} color="#7C3AED" />
                      <Text style={styles.pickerBtnText}>Choose Library</Text>
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
                      <Feather name="camera" size={18} color="#7C3AED" />
                      <Text style={styles.pickerBtnText}>Take Photo</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.fraudGuardNote}>
                    <Ionicons name="shield-checkmark" size={16} color="#7C3AED" style={{ marginTop: 1 }} />
                    <Text style={styles.fraudGuardText}>
                      SmartAssets AI Fraud Guard scans all media automatically to protect collectors against deepfakes and synthetic listings.
                    </Text>
                  </View>
                </View>
              )}

              {/* ── Step 2: Provenance History Builder ── */}
              {step === 2 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 3 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Provenance History</Text>
                    <Text style={styles.stepDesc}>
                      Add chain-of-custody milestones and certificates to prove authenticity on the blockchain.
                    </Text>
                  </View>

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
                        <Feather name="trash-2" size={16} color="#94A3B8" />
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
                          placeholderTextColor="#94A3B8"
                          style={styles.input}
                        />
                      </View>
                      <View style={[styles.fieldWrap, { flex: 1 }]}>
                        <TextInput
                          value={newParty}
                          onChangeText={setNewParty}
                          placeholder="Party / Location"
                          placeholderTextColor="#94A3B8"
                          style={styles.input}
                        />
                      </View>
                    </View>

                    <TextInput
                      value={newEvent}
                      onChangeText={setNewEvent}
                      placeholder="Event description (e.g. Purchased at Sotheby's Auction)"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                    />

                    <TouchableOpacity
                      style={styles.addEventBtn}
                      onPress={addHistoryItem}
                      activeOpacity={0.8}
                    >
                      <Feather name="plus" size={16} color="#7C3AED" />
                      <Text style={styles.addEventBtnText}>Add Provenance Event</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* ── Step 3: Pricing & Review ── */}
              {step === 3 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 4 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Set Asking Price</Text>
                    <Text style={styles.stepDesc}>
                      Set your valuation in British Pounds (£) or Rand (R). SmartAssets generates an escrow-protected listing.
                    </Text>
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>ASKING PRICE (£) *</Text>
                    <View style={styles.priceInputWrap}>
                      <Text style={styles.priceCurrency}>£</Text>
                      <TextInput
                        value={form.askingPrice}
                        onChangeText={(val) => setForm({ ...form, askingPrice: val })}
                        placeholder="34500"
                        keyboardType="decimal-pad"
                        placeholderTextColor="#94A3B8"
                        style={styles.priceInput}
                      />
                    </View>
                  </View>

                  {/* Summary Review Card */}
                  <View style={styles.reviewCard}>
                    <View style={styles.reviewCardHeader}>
                      <Text style={styles.reviewHeading}>LISTING SUMMARY</Text>
                      <View style={styles.reviewVerifiedBadge}>
                        <Text style={styles.reviewVerifiedBadgeText}>PRE-VERIFIED</Text>
                      </View>
                    </View>
                    <Text style={styles.reviewTitle}>{form.name || 'Untitled Asset'}</Text>
                    <Text style={styles.reviewSub}>
                      {form.category} • {form.year} • {historyList.length} History Event{historyList.length !== 1 ? 's' : ''}
                    </Text>
                    {form.askingPrice ? (
                      <Text style={styles.reviewPrice}>
                        £{Number(form.askingPrice).toLocaleString('en-GB')}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.infoBox}>
                    <Ionicons name="shield-checkmark" size={18} color="#7C3AED" style={{ marginTop: 2 }} />
                    <Text style={styles.infoText}>
                      Once submitted, your asset and provenance history are registered with cryptographic ERC-721 token verification and protected by SmartAssets escrow.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          {/* ── Bottom Action Bar (Signature Gradient CTA) ── */}
          <View style={styles.cta}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={step === STEPS.length - 1 ? handleSubmitListing : next}
              activeOpacity={0.88}
              disabled={submitting}
            >
              <LinearGradient
                colors={['#976af0', '#00fbff']}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#d8d6fd',
  },
  safe: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  navSubtitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 1.2,
    marginTop: 2,
  },

  // Steps Progress Pills
  stepsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  stepItem: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  stepDotActive: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#976af0',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  stepDotCompleted: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  stepDotUpcoming: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumActive: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  stepNumUpcoming: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  stepLabelActive: {
    color: '#7C3AED',
    fontWeight: '800',
  },
  stepLabelCompleted: {
    color: '#10B981',
    fontWeight: '700',
  },
  stepLabelUpcoming: {
    color: '#94A3B8',
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },

  // Main Card Wrapper
  mainCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },
  sectionWrap: {
    gap: 16,
  },
  stepHeader: {
    marginBottom: 4,
  },
  stepBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(151, 106, 240, 0.10)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  stepBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 0.8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  stepDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748B',
    marginTop: 4,
  },

  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#7C3AED',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  textarea: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 90,
    textAlignVertical: 'top',
    fontWeight: '600',
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
    borderWidth: 1.5,
  },
  catChipActive: {
    backgroundColor: '#F5F3FF',
    borderColor: '#976af0',
  },
  catChipInactive: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  catChipTextActive: {
    color: '#7C3AED',
  },
  catChipTextInactive: {
    color: '#64748B',
  },

  // Photo Grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoThumb: {
    width: 98,
    height: 98,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
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
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  addPhotoSlot: {
    backgroundColor: '#F8FAFC',
    borderColor: 'rgba(151, 106, 240, 0.4)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoSlotText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7C3AED',
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
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  pickerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  fraudGuardNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: 'rgba(151, 106, 240, 0.25)',
    marginTop: 4,
  },
  fraudGuardText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6D28D9',
    fontWeight: '600',
    flex: 1,
  },

  // History Styles
  historyItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
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
    backgroundColor: '#7C3AED',
  },
  historyYear: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7C3AED',
  },
  historyEvent: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyParty: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  deleteHistoryBtn: {
    padding: 6,
  },
  addHistoryBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
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
    backgroundColor: '#F5F3FF',
    borderWidth: 1.5,
    borderColor: 'rgba(151, 106, 240, 0.35)',
  },
  addEventBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7C3AED',
  },

  // Review & Pricing Styles
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: 'rgba(151, 106, 240, 0.45)',
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  priceCurrency: {
    fontSize: 22,
    fontWeight: '800',
    color: '#7C3AED',
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  reviewCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F5F3FF',
    borderWidth: 1.5,
    borderColor: 'rgba(151, 106, 240, 0.25)',
    gap: 6,
  },
  reviewCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reviewHeading: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#7C3AED',
  },
  reviewVerifiedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reviewVerifiedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#10B981',
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  reviewSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  reviewPrice: {
    fontSize: 22,
    fontWeight: '900',
    color: '#7C3AED',
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
    fontWeight: '600',
    flex: 1,
  },

  // Bottom CTA
  cta: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 96 : 92,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.9)',
  },
  nextBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#976af0',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
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
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
