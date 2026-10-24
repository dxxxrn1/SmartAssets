// ─── VerifyAccountScreen.js ─────────────────────────────────────────────────
// "Verify Your Account" screen (3-Document KYC Verification):
// - Shows overall verification status banner at top (unverified / pending / verified / rejected)
// - 3 document slots: ID Document, Tax Document, Proof of Residence
// - Each slot displays status: Not uploaded / Pending review / Approved / Rejected (+ rejection reason)
// - Upload from Camera or Gallery (Image or PDF), and re-upload when rejected

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import {
  getVerificationStatusApi,
  uploadVerificationDocApi,
  resolveImageUrl,
} from '../services/api';
import { SCREENS } from '../constants/navigation';
import { getTheme } from '../constants/theme';

const DOC_SLOTS = [
  {
    key: 'id',
    number: '1',
    title: 'ID Document',
    subtitle: 'South African Smart ID Card, Green ID Book, or Valid Passport',
    icon: 'id-card-outline',
    metaPlaceholder: 'Optional: Enter SA ID / Passport Number',
  },
  {
    key: 'tax',
    number: '2',
    title: 'Tax Document',
    subtitle: 'SARS Tax Notice of Registration (IT150) or Tax Clearance Certificate',
    icon: 'document-text-outline',
    metaPlaceholder: 'Optional: Enter 10-digit SARS Tax Reference',
  },
  {
    key: 'proof_of_residence',
    number: '3',
    title: 'Proof of Residence',
    subtitle: 'Utility Bill, Municipal Account, or Bank Statement (< 3 months old)',
    icon: 'home-outline',
    metaPlaceholder: 'Optional: Enter Street Address & Postal Code',
  },
];

export default function VerifyAccountScreen({ navigation, isDark }) {
  const { user, token, updateProfileData } = useAuth();
  const t = getTheme(isDark);

  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const [overallStatus, setOverallStatus] = useState(
    user?.verification_status || user?.kycStatus || 'unverified'
  );
  const [documents, setDocuments] = useState({
    id: { doc_type: 'id', status: 'not_uploaded', rejection_reason: null, preview_url: null },
    tax: { doc_type: 'tax', status: 'not_uploaded', rejection_reason: null, preview_url: null },
    proof_of_residence: {
      doc_type: 'proof_of_residence',
      status: 'not_uploaded',
      rejection_reason: null,
      preview_url: null,
    },
  });
  const [bankStatus, setBankStatus] = useState('not_submitted');
  const [metaInputs, setMetaInputs] = useState({
    id: '',
    tax: '',
    proof_of_residence: '',
  });

  const showAlert = (title, msg) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}\n\n${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  const fetchStatus = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await getVerificationStatusApi(token);
      if (data && data.success) {
        const nextStatus = data.verification_status || 'unverified';
        setOverallStatus(nextStatus);
        if (data.documents) {
          setDocuments((prev) => ({
            id: data.documents.id || prev.id,
            tax: data.documents.tax || prev.tax,
            proof_of_residence: data.documents.proof_of_residence || prev.proof_of_residence,
          }));
        }
        if (data.bank_account) {
          setBankStatus(data.bank_account.status || 'pending');
        }
        if (updateProfileData) {
          updateProfileData({
            kycStatus: nextStatus,
            verification_status: nextStatus,
            bankStatus: data.bank_account?.status || 'not_submitted',
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[VerifyAccountScreen] status fetch warning:', err.message);
    } finally {
      setLoading(false);
    }
  }, [token, updateProfileData]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleUploadFileData = async (docType, base64Uri, fileName, mimeType) => {
    if (!token) {
      showAlert('Authentication Required', 'Please sign in to upload verification documents.');
      return;
    }
    try {
      setUploadingSlot(docType);
      const res = await uploadVerificationDocApi(
        {
          docType,
          fileData: base64Uri,
          fileName: fileName || `${docType}_${Date.now()}.jpg`,
          mimeType: mimeType || 'image/jpeg',
          metaValue: metaInputs[docType] || undefined,
        },
        token
      );

      if (res && res.success) {
        const nextStatus = res.verification_status || 'pending';
        setOverallStatus(nextStatus);
        if (res.documents) {
          setDocuments((prev) => ({
            id: res.documents.id || prev.id,
            tax: res.documents.tax || prev.tax,
            proof_of_residence: res.documents.proof_of_residence || prev.proof_of_residence,
          }));
        }
        if (updateProfileData) {
          await updateProfileData({
            kycStatus: nextStatus,
            verification_status: nextStatus,
          });
        }
        showAlert('Document Uploaded', res.message || 'Your document has been submitted for admin review.');
      }
    } catch (err) {
      showAlert('Upload Failed', err.message || 'Could not upload document. Ensure it is a JPG, PNG, or PDF under 10 MB.');
    } finally {
      setUploadingSlot(null);
    }
  };

  // Pick from gallery (image or PDF on Web)
  const handlePickGalleryOrFile = async (docType) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,application/pdf';
      input.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          showAlert('File Too Large', 'Maximum file size is 10 MB.');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          handleUploadFileData(docType, reader.result, file.name, file.type);
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }

    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert('Permission Required', 'Please grant photo library access to upload your document.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const mime = asset.mimeType || 'image/jpeg';
        const dataUri = asset.base64 ? `data:${mime};base64,${asset.base64}` : asset.uri;
        await handleUploadFileData(docType, dataUri, asset.fileName || `${docType}.jpg`, mime);
      }
    } catch (err) {
      showAlert('Gallery Error', err.message || 'Could not select image from gallery.');
    }
  };

  // Capture directly from Camera
  const handleCaptureCamera = async (docType) => {
    if (Platform.OS === 'web') {
      return handlePickGalleryOrFile(docType);
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showAlert('Camera Permission Required', 'Please allow camera access to photograph your document.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const mime = asset.mimeType || 'image/jpeg';
        const dataUri = asset.base64 ? `data:${mime};base64,${asset.base64}` : asset.uri;
        await handleUploadFileData(docType, dataUri, `${docType}_camera.jpg`, mime);
      }
    } catch (err) {
      showAlert('Camera Error', err.message || 'Could not capture photo.');
    }
  };

  const renderOverallBanner = () => {
    const approvedCount = Object.values(documents).filter((d) => d?.status === 'approved').length;

    let bannerColors = ['#4F46E5', '#7C3AED'];
    let icon = 'shield-outline';
    let title = 'Verification Incomplete';
    let desc = `Upload all 3 required documents below (${approvedCount}/3 approved). An admin must approve all 3 documents to unlock listing, deposits, and withdrawals.`;

    if (overallStatus === 'verified') {
      bannerColors = ['#059669', '#10B981'];
      icon = 'checkmark-done-circle';
      title = 'Account Verified (3/3 Approved)';
      desc = 'All 3 verification documents have been approved by an administrator. You can now list items and deposit funds!';
    } else if (overallStatus === 'pending') {
      bannerColors = ['#D97706', '#F59E0B'];
      icon = 'time-outline';
      title = `Pending Admin Review (${approvedCount}/3 Approved)`;
      desc = 'Your uploaded documents are in the compliance review queue. You will be unlocked automatically once all 3 are approved.';
    } else if (overallStatus === 'rejected') {
      bannerColors = ['#DC2626', '#EF4444'];
      icon = 'alert-circle-outline';
      title = 'Action Required: Document Rejected';
      desc = 'One or more of your documents were rejected by an admin. Review the rejection reason below and re-upload a clear copy.';
    }

    return (
      <LinearGradient
        colors={bannerColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 20,
          padding: 18,
          marginBottom: 20,
          shadowColor: bannerColors[0],
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 16,
          elevation: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Overall Verification Status
            </Text>
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 2 }}>
              {title}
            </Text>
          </View>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 19 }}>
          {desc}
        </Text>
      </LinearGradient>
    );
  };

  const renderSlotBadge = (status) => {
    if (status === 'approved') {
      return (
        <View style={{ backgroundColor: 'rgba(16,185,129,0.16)', borderColor: '#10B981', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}>
          <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '800' }}>✅ Approved</Text>
        </View>
      );
    }
    if (status === 'pending') {
      return (
        <View style={{ backgroundColor: 'rgba(245,158,11,0.16)', borderColor: '#F59E0B', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}>
          <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '800' }}>⏳ Pending review</Text>
        </View>
      );
    }
    if (status === 'rejected') {
      return (
        <View style={{ backgroundColor: 'rgba(239,68,68,0.16)', borderColor: '#EF4444', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}>
          <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '800' }}>❌ Rejected</Text>
        </View>
      );
    }
    return (
      <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}>
        <Text style={{ color: t.textSecondary, fontSize: 11, fontWeight: '700' }}>Not uploaded</Text>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: Platform.OS === 'ios' ? 54 : 36,
          paddingBottom: 14,
          paddingHorizontal: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: t.border,
          backgroundColor: t.cardBg,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(124,92,252,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="arrow-back" size={20} color={t.text} />
        </TouchableOpacity>

        <Text style={{ fontSize: 17, fontWeight: '800', color: t.text }}>
          Verify Your Account
        </Text>

        <TouchableOpacity
          onPress={fetchStatus}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(124,92,252,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="refresh" size={18} color={t.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {renderOverallBanner()}

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#7C5CFC" />
            <Text style={{ color: t.textSecondary, marginTop: 10, fontSize: 13 }}>
              Loading your verification status...
            </Text>
          </View>
        ) : (
          DOC_SLOTS.map((slot) => {
            const doc = documents[slot.key] || { status: 'not_uploaded' };
            const status = doc.status || 'not_uploaded';
            const isUploading = uploadingSlot === slot.key;
            const canUpload = status !== 'approved';
            const previewUri = doc.preview_url ? resolveImageUrl(doc.preview_url, null) : null;

            return (
              <View
                key={slot.key}
                style={{
                  backgroundColor: t.cardBg,
                  borderRadius: 18,
                  padding: 16,
                  marginBottom: 16,
                  borderWidth: 1.2,
                  borderColor:
                    status === 'rejected'
                      ? '#EF4444'
                      : status === 'approved'
                      ? '#10B981'
                      : t.border,
                }}
              >
                {/* Slot Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 8 }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: 'rgba(124,92,252,0.14)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name={slot.icon} size={20} color="#7C5CFC" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>
                        {slot.number}. {slot.title}
                      </Text>
                      <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>
                        {slot.subtitle}
                      </Text>
                    </View>
                  </View>
                  {renderSlotBadge(status)}
                </View>

                {/* Rejection Reason Box */}
                {status === 'rejected' && doc.rejection_reason ? (
                  <View
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(239,68,68,0.35)',
                      borderRadius: 12,
                      padding: 12,
                      marginVertical: 8,
                    }}
                  >
                    <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '800', marginBottom: 2 }}>
                      Admin Rejection Reason:
                    </Text>
                    <Text style={{ color: isDark ? '#FCA5A5' : '#B91C1C', fontSize: 12.5, lineHeight: 18 }}>
                      {doc.rejection_reason}
                    </Text>
                  </View>
                ) : null}

                {/* Document Preview Thumbnail if uploaded */}
                {previewUri && status !== 'not_uploaded' ? (
                  <View
                    style={{
                      marginVertical: 10,
                      borderRadius: 12,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: t.border,
                      backgroundColor: '#0F172A',
                      height: 125,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Image
                      source={{ uri: previewUri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                    />
                  </View>
                ) : null}

                {/* Optional Reference Input */}
                {canUpload && (
                  <TextInput
                    value={metaInputs[slot.key]}
                    onChangeText={(txt) => setMetaInputs((prev) => ({ ...prev, [slot.key]: txt }))}
                    placeholder={slot.metaPlaceholder}
                    placeholderTextColor={t.textMuted}
                    style={{
                      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F5FF',
                      borderWidth: 1,
                      borderColor: t.border,
                      borderRadius: 11,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      fontSize: 12.5,
                      color: t.text,
                      marginTop: 6,
                      marginBottom: 10,
                    }}
                  />
                )}

                {/* Upload / Re-upload Buttons */}
                {canUpload ? (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                    <TouchableOpacity
                      disabled={isUploading}
                      onPress={() => handleCaptureCamera(slot.key)}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        paddingVertical: 11,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#7C5CFC',
                        backgroundColor: 'rgba(124,92,252,0.1)',
                      }}
                    >
                      <Ionicons name="camera-outline" size={17} color="#7C5CFC" />
                      <Text style={{ color: '#7C5CFC', fontSize: 12.5, fontWeight: '700' }}>
                        {status === 'rejected' ? 'Retake Photo' : 'Camera'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      disabled={isUploading}
                      onPress={() => handlePickGalleryOrFile(slot.key)}
                      style={{
                        flex: 1.3,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        paddingVertical: 11,
                        borderRadius: 12,
                        backgroundColor: '#7C5CFC',
                      }}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="cloud-upload-outline" size={17} color="#FFFFFF" />
                          <Text style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' }}>
                            {status === 'rejected'
                              ? 'Re-upload Document'
                              : status === 'pending'
                              ? 'Replace File (JPG/PDF)'
                              : 'Upload Gallery / PDF'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                    <Text style={{ color: '#10B981', fontSize: 12, fontWeight: '700' }}>
                      Verified and locked by Compliance Officer
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* Separate Bank Account Verification Card */}
        <View
          style={{
            backgroundColor: t.cardBg,
            borderRadius: 18,
            padding: 18,
            marginTop: 6,
            borderWidth: 1.2,
            borderColor: t.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  backgroundColor: 'rgba(56,189,248,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="business-outline" size={20} color="#0284C7" />
              </View>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>
                  Withdrawal Bank Account
                </Text>
                <Text style={{ fontSize: 12, color: t.textSecondary }}>
                  Separate admin approval required for payouts
                </Text>
              </View>
            </View>
            {renderSlotBadge(bankStatus === 'not_submitted' ? 'not_uploaded' : bankStatus)}
          </View>

          <Text style={{ fontSize: 12.5, color: t.textSecondary, lineHeight: 18, marginBottom: 14 }}>
            To withdraw funds to a bank account, your bank details must be submitted and approved by an admin.
          </Text>

          <TouchableOpacity
            onPress={() => navigation.navigate(SCREENS.BANK_DETAILS)}
            style={{
              backgroundColor: isDark ? '#1E293B' : '#EDE9FE',
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="card-outline" size={18} color="#7C5CFC" />
            <Text style={{ color: '#7C5CFC', fontWeight: '800', fontSize: 13.5 }}>
              Manage Bank Account Details &rarr;
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
