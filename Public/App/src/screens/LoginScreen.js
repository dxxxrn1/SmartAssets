// ─── LoginScreen ──────────────────────────────────────────────────────────────
// Email/password + MetaMask wallet connect

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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Feather, Ionicons } from '@expo/vector-icons';

export default function LoginScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const [email, setEmail] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [connectingWallet, setConnectingWallet] = useState(false);

  const handleSignIn = () => {
    // Navigates directly into the main app (Market tab)
    navigation.reset({
      index: 0,
      routes: [{ name: SCREENS.MAIN_TABS }],
    });
  };

  const handleWalletConnect = () => {
    setConnectingWallet(true);
    setTimeout(() => {
      navigation.reset({
        index: 0,
        routes: [{ name: SCREENS.MAIN_TABS }],
      });
    }, 900);
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
          <Text style={[styles.heading, { color: c.warm }]}>Welcome back</Text>
          <Text style={[styles.sub, { color: c.muted }]}>
            Sign in to your SmartAssets account
          </Text>

          {/* ── Email field ── */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: c.muted }]}>EMAIL ADDRESS</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
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
              onChangeText={setPassword}
              secureTextEntry
              style={[
                styles.input,
                { backgroundColor: c.card, borderColor: c.border, color: c.warm },
              ]}
              placeholder="••••••••"
              placeholderTextColor={c.muted}
            />
          </View>

          {/* ── Sign In button ── */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: c.primary }]}
            onPress={handleSignIn}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnLabel}>Sign In</Text>
          </TouchableOpacity>

          {/* ── Divider ── */}
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
            <Text style={[styles.dividerText, { color: c.muted }]}>or continue with</Text>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          </View>

          {/* ── MetaMask button ── */}
          <TouchableOpacity
            style={[
              styles.walletBtn,
              {
                backgroundColor: connectingWallet ? c.primaryBg : c.card,
                borderColor: connectingWallet ? c.primary : c.border,
              },
            ]}
            onPress={handleWalletConnect}
            activeOpacity={0.85}
          >
            <Ionicons name="wallet-outline" size={20} color={c.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.walletLabel, { color: connectingWallet ? c.primary : c.warm }]}>
              {connectingWallet ? 'Connecting MetaMask…' : 'Connect MetaMask Wallet'}
            </Text>
          </TouchableOpacity>

          {/* ── Create account link ── */}
          <Text style={[styles.createAcct, { color: c.muted }]}>
            New to SmartAssets?{' '}
            <Text
              style={[styles.createAcctLink, { color: c.primary }]}
              onPress={() => navigation.navigate(SCREENS.ONBOARDING)}
            >
              Create account
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
  backArrow: {
    fontSize: 18,
    fontWeight: '600',
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  walletBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  walletIcon: {
    fontSize: 20,
  },
  walletLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  createAcct: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 8,
  },
  createAcctLink: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
