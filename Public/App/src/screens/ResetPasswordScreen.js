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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { resetPasswordApi } from '../services/api';

export default function ResetPasswordScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const accessToken = route?.params?.accessToken || null;

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async () => {
    setError('');

    if (!accessToken) {
      setError('This reset link is invalid or has expired. Please request a new one.');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await resetPasswordApi({ accessToken, newPassword });
      setSuccess(true);
    } catch (err) {
      setError(err?.message || 'Could not reset your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const goToLogin = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: SCREENS.LOGIN }],
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {!success ? (
              <>
                <View style={[styles.iconBox, { backgroundColor: c.primary }]}>
                  <Feather name="lock" size={26} color="#FFFFFF" />
                </View>

                <Text style={[styles.heading, { color: c.warm }]}>Set a new password</Text>
                <Text style={[styles.description, { color: c.muted }]}>
                  Choose a new password for your SmartAssets account.
                </Text>

                {!accessToken ? (
                  <View style={[styles.errorBox, { backgroundColor: '#ff000015', borderColor: c.danger || '#ff4444' }]}>
                    <Text style={[styles.errorText, { color: c.danger || '#ff4444' }]}>
                      This reset link is invalid or has expired. Please go back and request a new one.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.fieldWrap}>
                      <Text style={[styles.label, { color: c.muted }]}>NEW PASSWORD</Text>
                      <View style={[styles.passwordRow, { backgroundColor: c.card, borderColor: c.border }]}>
                        <TextInput
                          value={newPassword}
                          onChangeText={(text) => {
                            setNewPassword(text);
                            setError('');
                          }}
                          secureTextEntry={!showNewPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                          placeholder="••••••••"
                          placeholderTextColor={c.muted}
                          style={[styles.passwordInput, { color: c.warm }]}
                        />
                        <TouchableOpacity
                          onPress={() => setShowNewPassword((v) => !v)}
                          activeOpacity={0.7}
                          style={styles.eyeBtn}
                        >
                          <Feather
                            name={showNewPassword ? 'eye-off' : 'eye'}
                            size={19}
                            color={c.muted}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.fieldWrap}>
                      <Text style={[styles.label, { color: c.muted }]}>CONFIRM NEW PASSWORD</Text>
                      <View style={[styles.passwordRow, { backgroundColor: c.card, borderColor: c.border }]}>
                        <TextInput
                          value={confirmPassword}
                          onChangeText={(text) => {
                            setConfirmPassword(text);
                            setError('');
                          }}
                          secureTextEntry={!showConfirmPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                          placeholder="••••••••"
                          placeholderTextColor={c.muted}
                          style={[styles.passwordInput, { color: c.warm }]}
                        />
                        <TouchableOpacity
                          onPress={() => setShowConfirmPassword((v) => !v)}
                          activeOpacity={0.7}
                          style={styles.eyeBtn}
                        >
                          <Feather
                            name={showConfirmPassword ? 'eye-off' : 'eye'}
                            size={19}
                            color={c.muted}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {error ? (
                      <View style={[styles.errorBox, { backgroundColor: '#ff000015', borderColor: c.danger || '#ff4444' }]}>
                        <Text style={[styles.errorText, { color: c.danger || '#ff4444' }]}>{error}</Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={[styles.primaryBtn, { backgroundColor: loading ? c.primaryDim : c.primary }]}
                      onPress={handleResetPassword}
                      activeOpacity={0.85}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Reset Password</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={styles.backBtn} onPress={goToLogin} activeOpacity={0.7}>
                  <Text style={[styles.backText, { color: c.primary }]}>Back to Sign In</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.successContainer}>
                <View style={[styles.successIcon, { backgroundColor: c.primary }]}>
                  <Feather name="check" size={30} color="#FFFFFF" />
                </View>
                <Text style={[styles.heading, { color: c.warm }]}>Password updated</Text>
                <Text style={[styles.description, { color: c.muted }]}>
                  Your password has been reset successfully. You can now sign in with your new password.
                </Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: c.primary }]}
                  onPress={goToLogin}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>Go to Sign In</Text>
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
  safeArea: { flex: 1 },
  keyboard: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 50, justifyContent: 'center' },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', borderWidth: 1, borderRadius: 20, padding: 24 },
  iconBox: { width: 54, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 16, alignSelf: 'center' },
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 7, textAlign: 'center' },
  description: { fontSize: 14, lineHeight: 21, marginBottom: 22, textAlign: 'center' },
  fieldWrap: { marginBottom: 17 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 7 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 14 },
  passwordInput: { flex: 1, minHeight: 48, fontSize: 15 },
  eyeBtn: { paddingLeft: 10, paddingVertical: 10 },
  errorBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText: { fontSize: 13, lineHeight: 19 },
  primaryBtn: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 6 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  backBtn: { alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  backText: { fontSize: 14, fontWeight: '700' },
  successContainer: { alignItems: 'center' },
  successIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
});