// ─── LoginScreen ──────────────────────────────────────────────────────────────
// Email/password login + Native MetaMask Web3 wallet authentication via Supabase

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
  Modal,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

const DEFAULT_DEMO_WALLET = '0x71C8360f3a14672D62372c388657B43933c039A4';

export default function LoginScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { login, loginWithWallet } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // MetaMask modal state
  const [walletModalVisible, setWalletModalVisible] = useState(false);
  const [customWalletAddress, setCustomWalletAddress] = useState('');
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletStatus, setWalletStatus] = useState('');

  // ── Standard Email/Password Sign-In ─────────────────────────────────────────
  const handleSignIn = async () => {
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(err.message || 'Login failed. Please verify your email and password.');
    } finally {
      setLoading(false);
    }
  };

  // ── MetaMask Connect Trigger ────────────────────────────────────────────────
  const handleWalletConnectPress = async () => {
    setError('');

    // If running in browser with MetaMask extension installed
    if (typeof window !== 'undefined' && window.ethereum) {
      setConnectingWallet(true);
      setWalletStatus('Requesting MetaMask permissions…');
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          setWalletStatus('Authenticating with Supabase…');
          await loginWithWallet(accounts[0]);
          return;
        }
      } catch (e) {
        setError(e.message || 'MetaMask connection was cancelled.');
      } finally {
        setConnectingWallet(false);
        setWalletStatus('');
      }
      return;
    }

    // On mobile: open the interactive MetaMask connection sheet
    setWalletModalVisible(true);
  };

  // ── Authenticate Wallet Address with Backend ────────────────────────────────
  const processWalletLogin = async (address) => {
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      Alert.alert('Invalid Address', 'Please provide a valid 42-character Ethereum address starting with 0x.');
      return;
    }

    setConnectingWallet(true);
    setWalletStatus('Connecting to Supabase Web3…');
    try {
      await loginWithWallet(address);
      setWalletModalVisible(false);
    } catch (err) {
      Alert.alert('Wallet Login Error', err.message || 'Could not authenticate with MetaMask.');
    } finally {
      setConnectingWallet(false);
      setWalletStatus('');
    }
  };

  // ── Launch MetaMask Mobile App ──────────────────────────────────────────────
  const openMetaMaskApp = async () => {
    const metamaskDeepLink = 'metamask://';
    try {
      const canOpen = await Linking.canOpenURL(metamaskDeepLink);
      if (canOpen) {
        await Linking.openURL(metamaskDeepLink);
      } else {
        // If app is not installed, open download link
        await Linking.openURL('https://metamask.io/download/');
      }
    } catch (err) {
      Alert.alert('MetaMask', 'Could not open MetaMask app. You can use the Quick Connect button below.');
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
          <Text style={[styles.heading, { color: c.warm }]}>Welcome back</Text>
          <Text style={[styles.sub, { color: c.muted }]}>
            Sign in to your SmartAssets account
          </Text>

          {/* ── Error message ── */}
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: c.redBg }]}>
              <Feather name="alert-circle" size={16} color={c.red} />
              <Text style={[styles.errorText, { color: c.red }]}>{error}</Text>
            </View>
          ) : null}

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
            style={[
              styles.primaryBtn,
              { backgroundColor: loading ? c.primaryDim : c.primary },
            ]}
            onPress={handleSignIn}
            activeOpacity={0.85}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnLabel}>Sign In</Text>
            )}
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
            onPress={handleWalletConnectPress}
            activeOpacity={0.85}
            disabled={connectingWallet}
          >
            <Ionicons name="wallet-outline" size={20} color={c.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.walletLabel, { color: c.primary }]}>
              {connectingWallet ? (walletStatus || 'Connecting MetaMask…') : 'Connect MetaMask Wallet'}
            </Text>
          </TouchableOpacity>

          {/* ── Create account link ── */}
          <Text style={[styles.createAcct, { color: c.muted }]}>
            New to SmartAssets?{' '}
            <Text
              style={[styles.createAcctLink, { color: c.primary }]}
              onPress={() => navigation.navigate(SCREENS.REGISTER)}
            >
              Create account
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── MetaMask Connection Modal ── */}
      <Modal
        visible={walletModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setWalletModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.card, borderColor: c.border }]}>

            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={[styles.walletIconCircle, { backgroundColor: c.primaryBg }]}>
                <Ionicons name="wallet" size={26} color={c.primary} />
              </View>
              <TouchableOpacity
                style={[styles.closeBtn, { backgroundColor: c.cardLight }]}
                onPress={() => setWalletModalVisible(false)}
              >
                <Feather name="x" size={18} color={c.warm} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalTitle, { color: c.warm }]}>Connect MetaMask</Text>
            <Text style={[styles.modalSubtitle, { color: c.muted }]}>
              Sign in with your Web3 Ethereum wallet to access verified luxury assets.
            </Text>

            {connectingWallet ? (
              <View style={styles.modalLoadingBox}>
                <ActivityIndicator size="large" color={c.primary} />
                <Text style={[styles.modalLoadingText, { color: c.primary }]}>
                  {walletStatus || 'Authenticating with Supabase…'}
                </Text>
              </View>
            ) : (
              <View style={styles.modalOptions}>
                {/* Option 1: Quick Connect Demo / Active Address */}
                <TouchableOpacity
                  style={[styles.modalOptionBtn, { backgroundColor: c.primary }]}
                  onPress={() => processWalletLogin(DEFAULT_DEMO_WALLET)}
                >
                  <Ionicons name="flash" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.modalOptionBtnText}>Quick Connect ({DEFAULT_DEMO_WALLET.slice(0, 6)}...{DEFAULT_DEMO_WALLET.slice(-4)})</Text>
                </TouchableOpacity>

                {/* Option 2: Open MetaMask App */}
                <TouchableOpacity
                  style={[styles.modalOutlineBtn, { borderColor: c.border }]}
                  onPress={openMetaMaskApp}
                >
                  <Ionicons name="open-outline" size={18} color={c.primary} style={{ marginRight: 6 }} />
                  <Text style={[styles.modalOutlineBtnText, { color: c.warm }]}>Launch MetaMask Mobile App</Text>
                </TouchableOpacity>

                {/* Option 3: Enter Custom Wallet Address */}
                <View style={styles.customAddressBox}>
                  <Text style={[styles.customLabel, { color: c.muted }]}>OR ENTER YOUR ETHEREUM ADDRESS</Text>
                  <TextInput
                    value={customWalletAddress}
                    onChangeText={setCustomWalletAddress}
                    autoCapitalize="none"
                    placeholder="0x..."
                    placeholderTextColor={c.muted}
                    style={[
                      styles.customInput,
                      { backgroundColor: c.cardLight, borderColor: c.border, color: c.warm },
                    ]}
                  />
                  <TouchableOpacity
                    style={[
                      styles.customSubmitBtn,
                      { backgroundColor: customWalletAddress.trim() ? c.primary : c.border },
                    ]}
                    disabled={!customWalletAddress.trim()}
                    onPress={() => processWalletLogin(customWalletAddress.trim())}
                  >
                    <Text style={styles.customSubmitText}>Sign In with Address</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
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

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 28,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  walletIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  modalLoadingBox: {
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  modalLoadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalOptions: {
    gap: 10,
  },
  modalOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
  modalOptionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  modalOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalOutlineBtnText: {
    fontWeight: '600',
    fontSize: 13,
  },
  customAddressBox: {
    marginTop: 8,
    gap: 6,
  },
  customLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  customInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  customSubmitBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  customSubmitText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
