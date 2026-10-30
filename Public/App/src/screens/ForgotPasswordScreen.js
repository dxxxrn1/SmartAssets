// ─── ForgotPasswordScreen.js ────────────────────────────────────────────────
// Step 1 of Password Recovery flow:
// User enters account email to request a temporary 6-digit Supabase recovery OTP.
// Preserves account-enumeration protection, provides offline & loading states,
// and navigates to VerifyRecoveryCodeScreen upon submission.

import React, { useState } from 'react';
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
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { useTheme } from '../context/ThemeContext';
import { useNetwork, OfflineBanner } from '../context/NetworkContext';
import { forgotPasswordApi } from '../services/api';

export default function ForgotPasswordScreen({
  navigation,
  route,
  isDark: propIsDark,
  toggleTheme: propToggleTheme,
}) {
  const themeContext = useTheme();
  const isDark = propIsDark !== undefined ? propIsDark : themeContext.isDark;
  const c = useColors(isDark);
  const { isConnected, isOffline, checkConnection } = useNetwork();

  const initialEmail = route?.params?.email || '';
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRequestCode = async () => {
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    const online = await checkConnection();
    if (!online || isOffline || !isConnected) {
      const msg = 'No internet connection. Please connect to the internet to request a reset code.';
      setError(msg);
      Alert.alert('No Internet Connection', msg);
      return;
    }

    setLoading(true);

    try {
      const redirectTo =
        Platform.OS === 'web'
          ? (typeof window !== 'undefined' ? window.location.origin : 'https://smartassets.onrender.com')
          : 'smartassets://reset-password';

      const res = await forgotPasswordApi({
        email: cleanEmail,
        redirectTo,
      });

      if (res?.success) {
        // Navigate to Step 2: enter recovery code
        navigation.navigate(SCREENS.VERIFY_RECOVERY_CODE, {
          email: cleanEmail,
        });
      } else {
        throw new Error(res?.error || res?.message || 'Could not send recovery code.');
      }
    } catch (err) {
      setError(err?.message || 'Could not send recovery code. Please try again.');
    } finally {
      setLoading(false);
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
            message="You are currently offline. Connect to the internet to reset your password."
            style={{ maxWidth: 480, alignSelf: 'center', width: '100%', marginBottom: 14 }}
          />

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {/* Back button */}
            <TouchableOpacity
              style={[styles.backBtn, { borderColor: c.border }]}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Go back to Login"
              accessibilityRole="button"
            >
              <Feather name="arrow-left" size={18} color={c.warm} />
            </TouchableOpacity>

            {/* Icon Badge */}
            <View style={[styles.iconBadge, { backgroundColor: isDark ? 'rgba(37, 99, 235, 0.15)' : '#EFF6FF', borderColor: c.primary }]}>
              <Feather name="key" size={28} color={c.primary} />
            </View>

            <Text style={[styles.title, { color: c.warm }]}>Reset Password</Text>
            <Text style={[styles.subtitle, { color: c.muted }]}>
              Enter your registered email address and we'll send you a temporary 6-digit recovery code.
            </Text>

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: c.muted }]}>Email Address</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: isDark ? '#0F172A' : '#F8FAFC',
                    borderColor: c.border,
                  },
                ]}
              >
                <Feather name="mail" size={18} color={c.muted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: c.warm }]}
                  placeholder="name@example.com"
                  placeholderTextColor={c.muted}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (error) setError('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  accessibilityLabel="Email Address input"
                />
              </View>
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

            {/* SUBMIT BUTTON */}
            <TouchableOpacity
              style={[styles.submitBtnWrap, loading && { opacity: 0.7 }]}
              onPress={handleRequestCode}
              disabled={loading}
              accessibilityLabel="Send recovery code"
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
                  <Text style={styles.submitBtnText}>Send Recovery Code</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Back to sign in */}
            <TouchableOpacity
              style={styles.backLink}
              onPress={() => navigation.navigate(SCREENS.LOGIN)}
              accessibilityLabel="Remembered password? Sign In"
              accessibilityRole="button"
            >
              <Text style={[styles.backLinkText, { color: c.primary }]}>
                Remember your password? Sign in
              </Text>
            </TouchableOpacity>
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
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
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
  backLink: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
