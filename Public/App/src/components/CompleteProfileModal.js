// ─── CompleteProfileModal.js ──────────────────────────────────────────────────
// Displayed when a user connects an unlinked MetaMask wallet via "Continue with MetaMask".
// Enforces that real accounts require real identity details (Full Name, Email)
// linked to the cryptographically verified wallet address (via 10-minute verificationToken).

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useColors } from '../constants/theme';

export default function CompleteProfileModal({
  visible,
  onClose,
  walletAddress = '',
  verificationToken = '',
  onSuccess,
}) {
  const { registerWithWallet } = useAuth();
  const { isDark } = useTheme();
  const c = useColors(isDark);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const shortAddress = walletAddress
    ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`
    : '0x...';

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    if (onClose) onClose();
  };

  const handleSubmit = async () => {
    setError('');

    const cleanFullName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanFullName) {
      setError('Please enter your full name.');
      return;
    }

    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (password && password.length < 6) {
      setError('Password must be at least 6 characters (or leave empty for wallet-only login).');
      return;
    }

    setLoading(true);

    try {
      const res = await registerWithWallet({
        verificationToken,
        walletAddress,
        email: cleanEmail,
        fullName: cleanFullName,
        password: password || undefined,
      });

      if (res?.success) {
        resetForm();
        if (onSuccess) onSuccess(res);
        if (onClose) onClose();
      } else {
        setError(res?.message || 'Could not complete registration. Please try again.');
      }
    } catch (err) {
      const errMsg =
        err?.message ||
        'Failed to link wallet and create account. Please check your details.';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: isDark ? '#111A2E' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(151, 106, 240, 0.22)',
              },
            ]}
          >
            {/* ── Top Header / Close ── */}
            <View style={styles.headerRow}>
              <View style={styles.brandBadge}>
                <LinearGradient
                  colors={['#7C3AED', '#06B6D4']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.logoBadge}
                >
                  <Ionicons name="wallet-outline" size={18} color="#FFFFFF" />
                </LinearGradient>
                <View>
                  <Text style={[styles.title, { color: c.warm }]}>Complete Your Profile</Text>
                  <Text style={[styles.subtitle, { color: c.muted }]}>
                    Link your verified MetaMask wallet
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={handleClose}
                style={[
                  styles.closeBtn,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9' },
                ]}
                activeOpacity={0.7}
              >
                <Feather name="x" size={16} color={c.warm} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 10 }}
            >
              {/* ── Verified Wallet Badge ── */}
              <View
                style={[
                  styles.verifiedWalletBox,
                  {
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : '#ECFDF5',
                    borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : '#A7F3D0',
                  },
                ]}
              >
                <View style={styles.verifiedRow}>
                  <View style={styles.checkIcon}>
                    <Feather name="check" size={13} color="#10B981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.verifiedLabel, { color: isDark ? '#34D399' : '#065F46' }]}>
                      CRYPTOGRAPHICALLY VERIFIED WALLET
                    </Text>
                    <Text style={[styles.verifiedAddress, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                      {shortAddress}
                    </Text>
                  </View>
                  <View style={styles.sepoliaPill}>
                    <Text style={styles.sepoliaText}>Sepolia</Text>
                  </View>
                </View>
                <Text style={[styles.verifiedNote, { color: isDark ? '#94A3B8' : '#047857' }]}>
                  This wallet will be linked to your primary account and used for all asset settlements, auctions, and fractional transactions.
                </Text>
              </View>

              {/* ── Error Banner ── */}
              {error ? (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                      borderColor: 'rgba(239, 68, 68, 0.35)',
                    },
                  ]}
                >
                  <Feather name="alert-circle" size={16} color="#EF4444" style={{ marginTop: 2 }} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* ── Full Name Field ── */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.muted }]}>FULL NAME *</Text>
                <TextInput
                  value={fullName}
                  onChangeText={(t) => {
                    setFullName(t);
                    setError('');
                  }}
                  placeholder="e.g. Satoshi Nakamoto"
                  placeholderTextColor={c.muted}
                  autoCapitalize="words"
                  style={[
                    styles.input,
                    {
                      backgroundColor: isDark ? '#131A2F' : '#F8FAFC',
                      borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                      color: c.warm,
                    },
                  ]}
                />
              </View>

              {/* ── Email Field ── */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.muted }]}>EMAIL ADDRESS *</Text>
                <TextInput
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setError('');
                  }}
                  placeholder="you@domain.com"
                  placeholderTextColor={c.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    {
                      backgroundColor: isDark ? '#131A2F' : '#F8FAFC',
                      borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                      color: c.warm,
                    },
                  ]}
                />
              </View>

              {/* ── Optional Password Field ── */}
              <View style={styles.fieldWrap}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[styles.label, { color: c.muted }]}>PASSWORD (OPTIONAL)</Text>
                  <Text style={[styles.optionalTag, { color: c.muted }]}>Enables email sign-in</Text>
                </View>
                <View
                  style={[
                    styles.passwordRow,
                    {
                      backgroundColor: isDark ? '#131A2F' : '#F8FAFC',
                      borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0',
                    },
                  ]}
                >
                  <TextInput
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      setError('');
                    }}
                    placeholder="Min. 6 chars (optional)"
                    placeholderTextColor={c.muted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    style={[styles.passwordInput, { color: c.warm }]}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeBtn}
                    activeOpacity={0.7}
                  >
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={17}
                      color={c.muted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Submit Button ── */}
              <TouchableOpacity
                style={styles.submitBtnWrap}
                onPress={handleSubmit}
                activeOpacity={0.88}
                disabled={loading}
              >
                <LinearGradient
                  colors={['#7C3AED', '#5B36F5', '#2563EB']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.submitGradient}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <View style={styles.btnContent}>
                      <Ionicons name="link-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.submitBtnText}>Create Account & Link Wallet</Text>
                    </View>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleClose}
                style={styles.cancelBtn}
                activeOpacity={0.75}
              >
                <Text style={[styles.cancelText, { color: c.muted }]}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  keyboardWrap: {
    width: '100%',
    maxWidth: 460,
  },
  card: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    maxHeight: '90%',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedWalletBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
    gap: 6,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  verifiedAddress: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 1,
  },
  sepoliaPill: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  sepoliaText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  verifiedNote: {
    fontSize: 11,
    lineHeight: 15,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    color: '#EF4444',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  fieldWrap: {
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  optionalTag: {
    fontSize: 10,
    fontStyle: 'italic',
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  passwordRow: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    fontSize: 14,
  },
  eyeBtn: {
    padding: 6,
  },
  submitBtnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
  },
  submitGradient: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
