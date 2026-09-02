// ─── RegisterScreen ──────────────────────────────────────────────────────────
// Full registration form — Full Name, Email, Password, Confirm Password
// Matches the app's existing design language (dark theme, sky-blue accents)

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
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Feather } from '@expo/vector-icons';
import { registerUser } from '../services/api';

export default function RegisterScreen({ navigation, isDark }) {
  const c = useColors(isDark);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Client-side validation ─────────────────────────────────────────────────
  const validate = () => {
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return false;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return false;
    }
    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return false;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return false;
    }
    return true;
  };

  // ── Handle registration ────────────────────────────────────────────────────
  const handleRegister = async () => {
    setError('');
    if (!validate()) return;

    setLoading(true);
    try {
      const result = await registerUser({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
      });

      Alert.alert(
        'Account Created! 🎉',
        'Your SmartAssets account has been created. Please sign in.',
        [
          {
            text: 'Sign In',
            onPress: () => navigation.navigate(SCREENS.LOGIN),
          },
        ]
      );
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Back button ── */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => navigation.goBack()}
          >
            <Feather name="arrow-left" size={18} color={c.warm} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Heading ── */}
          <Text style={[styles.heading, { color: c.warm }]}>Create Account</Text>
          <Text style={[styles.sub, { color: c.muted }]}>
            Join SmartAssets — the verified luxury marketplace
          </Text>

          {/* ── Error message ── */}
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: c.redBg }]}>
              <Feather name="alert-circle" size={16} color={c.red} />
              <Text style={[styles.errorText, { color: c.red }]}>{error}</Text>
            </View>
          ) : null}

          {/* ── Full Name field ── */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.muted }]}>FULL NAME</Text>
            <TextInput
              value={fullName}
              onChangeText={(text) => { setFullName(text); setError(''); }}
              autoCapitalize="words"
              placeholder="John Doe"
              style={[
                styles.input,
                { backgroundColor: c.card, borderColor: c.border, color: c.warm },
              ]}
              placeholderTextColor={c.muted}
            />
          </View>

          {/* ── Email field ── */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.muted }]}>EMAIL ADDRESS</Text>
            <TextInput
              value={email}
              onChangeText={(text) => { setEmail(text); setError(''); }}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="you@example.com"
              style={[
                styles.input,
                { backgroundColor: c.card, borderColor: c.border, color: c.warm },
              ]}
              placeholderTextColor={c.muted}
            />
          </View>

          {/* ── Password field ── */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.muted }]}>PASSWORD</Text>
            <TextInput
              value={password}
              onChangeText={(text) => { setPassword(text); setError(''); }}
              secureTextEntry
              placeholder="Min. 6 characters"
              style={[
                styles.input,
                { backgroundColor: c.card, borderColor: c.border, color: c.warm },
              ]}
              placeholderTextColor={c.muted}
            />
          </View>

          {/* ── Confirm Password field ── */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.muted }]}>CONFIRM PASSWORD</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={(text) => { setConfirmPassword(text); setError(''); }}
              secureTextEntry
              placeholder="Re-enter your password"
              style={[
                styles.input,
                { backgroundColor: c.card, borderColor: c.border, color: c.warm },
              ]}
              placeholderTextColor={c.muted}
            />
          </View>

          {/* ── Register button ── */}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { backgroundColor: loading ? c.primaryDim : c.primary },
            ]}
            onPress={handleRegister}
            activeOpacity={0.85}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnLabel}>Create Account</Text>
            )}
          </TouchableOpacity>

          {/* ── Sign in link ── */}
          <Text style={[styles.signInText, { color: c.muted }]}>
            Already have an account?{' '}
            <Text
              style={[styles.signInLink, { color: c.primary }]}
              onPress={() => navigation.navigate(SCREENS.LOGIN)}
            >
              Sign In
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 16,
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: 8,
  },
  sub: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 4,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  fieldWrap: {
    gap: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
  },
  primaryBtn: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  signInText: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 8,
  },
  signInLink: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

