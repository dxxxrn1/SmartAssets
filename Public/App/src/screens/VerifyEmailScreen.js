// ─── VerifyEmailScreen.js ───────────────────────────────────────────────────
// Dedicated email verification screen for 6-digit OTP code entry.
// Supports signup confirmation and wallet-registration email verification.
// Features: focus progression, paste support, resend cooldown, expiry countdown,
// accessible inputs, offline banners, and clean styling matching SmartAssets design system.

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { useTheme } from '../context/ThemeContext';
import { useNetwork, OfflineBanner } from '../context/NetworkContext';
import { verifyEmailApi, resendVerificationCodeApi } from '../services/api';

const CODE_LENGTH = 6;
const EXPIRY_SECONDS = 600; // 10 minutes
const RESEND_COOLDOWN_SECONDS = 60; // 60 seconds

export default function VerifyEmailScreen({
  navigation,
  route,
  isDark: propIsDark,
  toggleTheme: propToggleTheme,
}) {
  const themeContext = useTheme();
  const isDark = propIsDark !== undefined ? propIsDark : themeContext.isDark;
  const c = useColors(isDark);
  const { isConnected, isOffline, checkConnection } = useNetwork();

  const email = route?.params?.email || '';
  const fullName = route?.params?.fullName || '';
  const isWallet = !!route?.params?.isWallet;
  const walletAddress = route?.params?.walletAddress || '';
  const verificationToken = route?.params?.verificationToken || '';

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Timers
  const [expiryLeft, setExpiryLeft] = useState(EXPIRY_SECONDS);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);

  // References for focus progression
  const inputRefs = useRef([]);

  // Expiry countdown timer
  useEffect(() => {
    if (expiryLeft <= 0) return;
    const timer = setInterval(() => {
      setExpiryLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiryLeft]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Handle digit input and focus progression ───────────────────────────────
  const handleDigitChange = (val, index) => {
    setError('');

    // Handle paste: if user pastes full 6-digit code into any box
    if (val && val.length > 1) {
      const cleanVal = val.replace(/\D/g, '').slice(0, CODE_LENGTH);
      if (cleanVal.length > 0) {
        const nextDigits = [...digits];
        for (let i = 0; i < cleanVal.length; i++) {
          nextDigits[i] = cleanVal[i];
        }
        setDigits(nextDigits);

        const nextFocusIndex = Math.min(cleanVal.length, CODE_LENGTH - 1);
        inputRefs.current[nextFocusIndex]?.focus();

        if (cleanVal.length === CODE_LENGTH) {
          triggerVerification(cleanVal);
        }
        return;
      }
    }

    const cleanChar = val.replace(/\D/g, '');
    const nextDigits = [...digits];
    nextDigits[index] = cleanChar;
    setDigits(nextDigits);

    if (cleanChar && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify if all 6 digits are entered
    const fullCode = nextDigits.join('');
    if (fullCode.length === CODE_LENGTH) {
      triggerVerification(fullCode);
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // ── Submit verification code ───────────────────────────────────────────────
  const triggerVerification = async (codeToVerify) => {
    const code = codeToVerify || digits.join('');
    if (code.length !== CODE_LENGTH) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    if (expiryLeft <= 0) {
      setError('This verification code has expired. Please tap "Resend Code" below to request a new one.');
      return;
    }

    setError('');
    const online = await checkConnection();
    if (!online || isOffline || !isConnected) {
      const msg = 'No internet connection. Please connect to the internet to verify your email.';
      setError(msg);
      Alert.alert('No Internet Connection', msg);
      return;
    }

    setLoading(true);

    try {
      const res = await verifyEmailApi({
        email: email.trim().toLowerCase(),
        code,
        type: 'signup',
        verificationToken: verificationToken || undefined,
      });

      if (res?.success) {
        setSuccess(true);
        setSuccessMsg(
          res.message || 'Email verified successfully! You can now sign in to your SmartAssets account.'
        );
      } else {
        throw new Error(res?.error || res?.message || 'Verification failed. Please check the code.');
      }
    } catch (err) {
      setError(
        err?.message || 'Invalid or expired verification code. Please check the code or request a new one.'
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Resend Code Handler ────────────────────────────────────────────────────
  const handleResendCode = async () => {
    if (resendCooldown > 0 || resending) return;

    setError('');
    const online = await checkConnection();
    if (!online || isOffline || !isConnected) {
      setError('No internet connection. Please connect to the internet to request a code.');
      return;
    }

    setResending(true);

    try {
      const res = await resendVerificationCodeApi({
        email: email.trim().toLowerCase(),
        type: 'signup',
      });

      if (res?.success) {
        setExpiryLeft(EXPIRY_SECONDS);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setDigits(Array(CODE_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
        Alert.alert('Code Resent', 'A fresh 6-digit verification code has been sent to your email.');
      } else {
        throw new Error(res?.error || res?.message || 'Could not resend code. Please try again.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to resend code. Please wait a moment and try again.');
    } finally {
      setResending(false);
    }
  };

  const handleContinueToLogin = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: SCREENS.LOGIN }],
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.canvas || (isDark ? '#0F172A' : '#FFFFFF') }]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* OFFLINE BANNER */}
          <OfflineBanner
            isDark={isDark}
            message="You are currently offline. Connect to the internet to verify your email."
            style={{ maxWidth: 480, alignSelf: 'center', width: '100%', marginBottom: 14 }}
          />

          {/* CARD CONTAINER */}
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {/* Top Navigation */}
            <TouchableOpacity
              style={[styles.backBtn, { borderColor: c.border }]}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Feather name="arrow-left" size={18} color={c.warm} />
            </TouchableOpacity>

            {!success ? (
              <>
                {/* Clean Header Icon Badge */}
                <View style={[styles.iconBadge, { backgroundColor: isDark ? 'rgba(37, 99, 235, 0.15)' : '#EFF6FF', borderColor: c.primary }]}>
                  <Feather name="mail" size={28} color={c.primary} />
                </View>

                <Text style={[styles.title, { color: c.warm }]}>Verify Your Email</Text>

                <Text style={[styles.subtitle, { color: c.muted }]}>
                  We sent a 6-digit verification code to
                </Text>
                <Text style={[styles.emailBadge, { color: c.primary, borderColor: c.border }]}>
                  {email || 'your email address'}
                </Text>

                {isWallet && (
                  <View style={[styles.walletNotice, { backgroundColor: isDark ? '#1E293B' : '#F8FAFC', borderColor: c.border }]}>
                    <Feather name="shield" size={14} color={c.primary} style={{ marginRight: 6 }} />
                    <Text style={[styles.walletNoticeText, { color: c.muted }]}>
                      Wallet: {walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}` : 'Verified Wallet'}
                    </Text>
                  </View>
                )}

                {/* Expiry Status */}
                <View style={styles.expiryRow}>
                  <Feather
                    name="clock"
                    size={14}
                    color={expiryLeft <= 60 ? (c.danger || '#EF4444') : c.muted}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.expiryText,
                      { color: expiryLeft <= 60 ? (c.danger || '#EF4444') : c.muted },
                    ]}
                  >
                    {expiryLeft > 0 ? `Code expires in ${formatTimer(expiryLeft)}` : 'Code expired'}
                  </Text>
                </View>

                {/* 6-Box OTP Inputs */}
                <View style={styles.otpContainer}>
                  {digits.map((digit, idx) => (
                    <TextInput
                      key={idx}
                      ref={(el) => (inputRefs.current[idx] = el)}
                      style={[
                        styles.otpBox,
                        {
                          backgroundColor: isDark ? '#0F172A' : '#F8FAFC',
                          borderColor: digit ? c.primary : c.border,
                          color: c.warm,
                        },
                      ]}
                      value={digit}
                      onChangeText={(val) => handleDigitChange(val, idx)}
                      onKeyPress={(e) => handleKeyPress(e, idx)}
                      keyboardType="number-pad"
                      maxLength={idx === 0 ? 6 : 1}
                      selectTextOnFocus
                      accessible
                      accessibilityLabel={`Digit ${idx + 1} of ${CODE_LENGTH}`}
                      editable={!loading && expiryLeft > 0}
                    />
                  ))}
                </View>

                {/* ERROR BANNER */}
                {error ? (
                  <View
                    style={[
                      styles.errorBox,
                      { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#FEE2E2', borderColor: c.danger || '#EF4444' },
                    ]}
                  >
                    <Feather name="alert-circle" size={16} color={c.danger || '#EF4444'} style={{ marginRight: 8 }} />
                    <Text style={[styles.errorText, { color: c.danger || '#EF4444' }]}>{error}</Text>
                  </View>
                ) : null}

                {/* VERIFY BUTTON */}
                <TouchableOpacity
                  style={[styles.submitBtnWrap, (loading || digits.join('').length !== CODE_LENGTH) && { opacity: 0.6 }]}
                  onPress={() => triggerVerification()}
                  disabled={loading || digits.join('').length !== CODE_LENGTH}
                  accessibilityLabel="Verify code"
                  accessibilityRole="button"
                >
                  <LinearGradient
                    colors={['#2563EB', '#1D4ED8']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.submitBtn}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.submitBtnText}>Verify Account</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                {/* RESEND SECTION */}
                <View style={styles.resendContainer}>
                  <Text style={[styles.resendPrompt, { color: c.muted }]}>
                    Didn't receive the code?
                  </Text>
                  <TouchableOpacity
                    onPress={handleResendCode}
                    disabled={resendCooldown > 0 || resending}
                    accessibilityLabel="Resend code"
                    accessibilityRole="button"
                    style={styles.resendBtn}
                  >
                    {resending ? (
                      <ActivityIndicator size="small" color={c.primary} />
                    ) : (
                      <Text
                        style={[
                          styles.resendBtnText,
                          { color: resendCooldown > 0 ? c.muted : c.primary },
                        ]}
                      >
                        {resendCooldown > 0
                          ? `Resend in ${resendCooldown}s`
                          : 'Resend Code'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* SUCCESS STATE */
              <View style={styles.successContainer}>
                <View style={[styles.successBadge, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5', borderColor: '#10B981' }]}>
                  <Feather name="check-circle" size={36} color="#10B981" />
                </View>

                <Text style={[styles.successTitle, { color: c.warm }]}>Email Verified!</Text>
                <Text style={[styles.successDesc, { color: c.muted }]}>
                  {successMsg || 'Your email address has been successfully confirmed. Your account is ready.'}
                </Text>

                <TouchableOpacity
                  style={styles.submitBtnWrap}
                  onPress={handleContinueToLogin}
                  accessibilityLabel="Continue to Sign In"
                  accessibilityRole="button"
                >
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.submitBtn}
                  >
                    <Text style={styles.submitBtnText}>Continue to Sign In</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
  emailBadge: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
  },
  walletNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'center',
    marginBottom: 14,
  },
  walletNoticeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  expiryText: {
    fontSize: 13,
    fontWeight: '500',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  submitBtnWrap: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 16,
  },
  submitBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    gap: 6,
  },
  resendPrompt: {
    fontSize: 13,
  },
  resendBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  resendBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  successBadge: {
    width: 72,
    height: 72,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  successDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 12,
  },
});
