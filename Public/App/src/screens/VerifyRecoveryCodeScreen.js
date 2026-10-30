// ─── VerifyRecoveryCodeScreen.js ───────────────────────────────────────────
// Step 2 of Password Recovery flow:
// User enters and verifies the temporary 6-digit Supabase recovery OTP code.
// Upon successful verification, receives a single-use cryptographically bound recoveryToken
// and advances to ResetPasswordScreen to set a new password.

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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { useTheme } from '../context/ThemeContext';
import { useNetwork, OfflineBanner } from '../context/NetworkContext';
import { verifyRecoveryCodeApi, forgotPasswordApi } from '../services/api';

const CODE_LENGTH = 6;
const EXPIRY_SECONDS = 600; // 10 minutes
const RESEND_COOLDOWN_SECONDS = 60; // 60 seconds

export default function VerifyRecoveryCodeScreen({
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

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Timers
  const [expiryLeft, setExpiryLeft] = useState(EXPIRY_SECONDS);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);

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

  // ── Handle digit changes, paste, and focus progression ─────────────────────
  const handleDigitChange = (val, index) => {
    setError('');

    // Handle paste of full code
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

  // ── Submit recovery OTP code ───────────────────────────────────────────────
  const triggerVerification = async (codeToVerify) => {
    const code = codeToVerify || digits.join('');
    if (code.length !== CODE_LENGTH) {
      setError('Please enter the complete 6-digit recovery code.');
      return;
    }

    if (expiryLeft <= 0) {
      setError('This recovery code has expired. Please tap "Resend Code" to request a new one.');
      return;
    }

    setError('');
    const online = await checkConnection();
    if (!online || isOffline || !isConnected) {
      const msg = 'No internet connection. Please connect to the internet to verify your recovery code.';
      setError(msg);
      Alert.alert('No Internet Connection', msg);
      return;
    }

    setLoading(true);

    try {
      const res = await verifyRecoveryCodeApi({
        email: email.trim().toLowerCase(),
        code,
      });

      if (res?.success && res?.recoveryToken) {
        // Advance to Step 3: set new password with single-use recoveryToken
        navigation.navigate(SCREENS.RESET_PASSWORD, {
          email: email.trim().toLowerCase(),
          recoveryToken: res.recoveryToken,
        });
      } else {
        throw new Error(res?.error || res?.message || 'Invalid recovery code.');
      }
    } catch (err) {
      setError(
        err?.message || 'Invalid or expired recovery code. Please check the code or request a new one.'
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Resend Recovery Code Handler ───────────────────────────────────────────
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
      const res = await forgotPasswordApi({
        email: email.trim().toLowerCase(),
      });

      if (res?.success) {
        setExpiryLeft(EXPIRY_SECONDS);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setDigits(Array(CODE_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
        Alert.alert('Code Resent', 'A fresh 6-digit recovery code has been sent to your email.');
      } else {
        throw new Error(res?.error || res?.message || 'Could not resend recovery code.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to resend code. Please wait a moment and try again.');
    } finally {
      setResending(false);
    }
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
            message="You are currently offline. Connect to the internet to verify your recovery code."
            style={{ maxWidth: 480, alignSelf: 'center', width: '100%', marginBottom: 14 }}
          />

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {/* Back button */}
            <TouchableOpacity
              style={[styles.backBtn, { borderColor: c.border }]}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Feather name="arrow-left" size={18} color={c.warm} />
            </TouchableOpacity>

            {/* SmartAssets Logo */}
            <View style={styles.logoContainer}>
              <Image
                source={require('../../assets/logo-mark.png')}
                style={styles.logoImage}
                resizeMode="contain"
                accessibilityLabel="SmartAssets Logo"
              />
            </View>

            <Text style={[styles.title, { color: c.warm }]}>Enter Recovery Code</Text>
            <Text style={[styles.subtitle, { color: c.muted }]}>
              We sent a 6-digit recovery code to
            </Text>
            <Text style={[styles.emailBadge, { color: c.primary, borderColor: c.border }]}>
              {email || 'your email address'}
            </Text>

            {/* Expiry Countdown */}
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
                  accessibilityLabel={`Recovery digit ${idx + 1} of ${CODE_LENGTH}`}
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
              accessibilityLabel="Verify recovery code"
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
                  <Text style={styles.submitBtnText}>Verify Code & Continue</Text>
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
                accessibilityLabel="Resend recovery code"
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
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  logoImage: {
    width: 64,
    height: 64,
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
    marginBottom: 16,
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
});
