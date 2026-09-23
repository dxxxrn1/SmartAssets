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

const DEFAULT_DEMO_WALLET =
  '0x71C8360f3a14672D62372c388657B43933c039A4';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export default function LoginScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { login, loginWithWallet } = useAuth();

  // Normal login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Wallet modal
  const [walletModalVisible, setWalletModalVisible] = useState(false);
  const [customWalletAddress, setCustomWalletAddress] = useState('');
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletStatus, setWalletStatus] = useState('');

  // Forgot password
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');

  // --------------------------------------------------
  // NORMAL EMAIL/PASSWORD LOGIN
  // --------------------------------------------------

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
      setError(
        err?.message ||
          'Login failed. Please verify your email and password.'
      );
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // FORGOT PASSWORD
  // --------------------------------------------------

  const handleForgotPassword = async () => {
    setForgotError('');

    const cleanEmail = forgotEmail.trim().toLowerCase();

    if (!cleanEmail) {
      setForgotError('Please enter your email address.');
      return;
    }

    if (!API_BASE_URL) {
      setForgotError(
        'API address is not configured. Please check EXPO_PUBLIC_API_BASE_URL.'
      );
      return;
    }

    setForgotLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/forgot-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: cleanEmail,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            'Could not send the reset link. Please try again.'
        );
      }

      setForgotSent(true);
    } catch (err) {
      setForgotError(
        err?.message ||
          'Could not send the reset link. Please try again.'
      );
    } finally {
      setForgotLoading(false);
    }
  };

  const closeForgotModal = () => {
    setForgotModalVisible(false);
    setForgotEmail('');
    setForgotSent(false);
    setForgotError('');
    setForgotLoading(false);
  };

  const openForgotPassword = () => {
    setForgotError('');
    setForgotSent(false);
    setForgotEmail(email);
    setForgotModalVisible(true);
  };

  // --------------------------------------------------
  // METAMASK
  // --------------------------------------------------

  const handleWalletConnectPress = async () => {
    setError('');

    // Web browser with MetaMask installed
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      window.ethereum
    ) {
      setConnectingWallet(true);
      setWalletStatus('Requesting MetaMask permissions...');

      try {
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        });

        if (accounts && accounts[0]) {
          setWalletStatus('Authenticating with Supabase...');

          await loginWithWallet(accounts[0]);

          return;
        }

        throw new Error('No MetaMask account was selected.');
      } catch (err) {
        setError(
          err?.message ||
            'MetaMask connection was cancelled.'
        );
      } finally {
        setConnectingWallet(false);
        setWalletStatus('');
      }

      return;
    }

    // Mobile or browser without MetaMask
    setWalletModalVisible(true);
  };

  const handleDemoWalletLogin = async () => {
    setError('');
    setConnectingWallet(true);
    setWalletStatus('Connecting demo wallet...');

    try {
      await loginWithWallet(DEFAULT_DEMO_WALLET);
    } catch (err) {
      setError(
        err?.message ||
          'Demo wallet login failed.'
      );
    } finally {
      setConnectingWallet(false);
      setWalletStatus('');
      setWalletModalVisible(false);
    }
  };

  const handleCustomWalletLogin = async () => {
    setError('');

    const cleanWallet = customWalletAddress.trim();

    if (!cleanWallet) {
      setError('Please enter a wallet address.');
      return;
    }

    setConnectingWallet(true);
    setWalletStatus('Authenticating wallet...');

    try {
      await loginWithWallet(cleanWallet);
    } catch (err) {
      setError(
        err?.message ||
          'Wallet login failed.'
      );
    } finally {
      setConnectingWallet(false);
      setWalletStatus('');
      setWalletModalVisible(false);
    }
  };

  const openMetaMaskApp = async () => {
    try {
      await Linking.openURL(
        'https://metamask.io/download/'
      );
    } catch (err) {
      Alert.alert(
        'MetaMask',
        'Unable to open the MetaMask download page.'
      );
    }
  };

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: c.background },
      ]}
    >
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}
          <View style={styles.header}>
            <View
              style={[
                styles.logoBox,
                { backgroundColor: c.primary },
              ]}
            >
              <Feather
                name="shield"
                size={26}
                color="#FFFFFF"
              />
            </View>

            <Text
              style={[
                styles.logoText,
                { color: c.warm },
              ]}
            >
              SmartAssets
            </Text>

            <Text
              style={[
                styles.subtitle,
                { color: c.muted },
              ]}
            >
              Smart finance. Smarter future.
            </Text>
          </View>

          {/* LOGIN CARD */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: c.card,
                borderColor: c.border,
              },
            ]}
          >
            <Text
              style={[
                styles.heading,
                { color: c.warm },
              ]}
            >
              Welcome back
            </Text>

            <Text
              style={[
                styles.description,
                { color: c.muted },
              ]}
            >
              Sign in to your SmartAssets account
            </Text>

            {/* EMAIL */}
            <View style={styles.fieldWrap}>
              <Text
                style={[
                  styles.label,
                  { color: c.muted },
                ]}
              >
                EMAIL ADDRESS
              </Text>

              <TextInput
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setError('');
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="you@example.com"
                placeholderTextColor={c.muted}
                style={[
                  styles.input,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    color: c.warm,
                  },
                ]}
              />
            </View>

            {/* PASSWORD */}
            <View style={styles.fieldWrap}>
              <Text
                style={[
                  styles.label,
                  { color: c.muted },
                ]}
              >
                PASSWORD
              </Text>

              <TextInput
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError('');
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="••••••••"
                placeholderTextColor={c.muted}
                style={[
                  styles.input,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    color: c.warm,
                  },
                ]}
              />
            </View>

            {/* FORGOT PASSWORD BUTTON */}
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={openForgotPassword}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.forgotText,
                  { color: c.primary },
                ]}
              >
                Forgot password?
              </Text>
            </TouchableOpacity>

            {/* ERROR */}
            {error ? (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: c.danger
                      ? `${c.danger}15`
                      : '#ff000015',
                    borderColor: c.danger || '#ff4444',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.errorText,
                    {
                      color:
                        c.danger || '#ff4444',
                    },
                  ]}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {/* SIGN IN */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: loading
                    ? c.primaryDim
                    : c.primary,
                },
              ]}
              onPress={handleSignIn}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  Sign In
                </Text>
              )}
            </TouchableOpacity>

            {/* DIVIDER */}
            <View style={styles.dividerRow}>
              <View
                style={[
                  styles.divider,
                  { backgroundColor: c.border },
                ]}
              />

              <Text
                style={[
                  styles.dividerText,
                  { color: c.muted },
                ]}
              >
                or continue with
              </Text>

              <View
                style={[
                  styles.divider,
                  { backgroundColor: c.border },
                ]}
              />
            </View>

            {/* METAMASK */}
            <TouchableOpacity
              style={[
                styles.walletBtn,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
              ]}
              onPress={handleWalletConnectPress}
              activeOpacity={0.8}
              disabled={connectingWallet}
            >
              {connectingWallet ? (
                <ActivityIndicator
                  color={c.primary}
                />
              ) : (
                <>
                  <Ionicons
                    name="wallet-outline"
                    size={20}
                    color={c.primary}
                  />

                  <Text
                    style={[
                      styles.walletBtnText,
                      { color: c.warm },
                    ]}
                  >
                    Connect MetaMask
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {walletStatus ? (
              <Text
                style={[
                  styles.walletStatus,
                  { color: c.muted },
                ]}
              >
                {walletStatus}
              </Text>
            ) : null}

            {/* REGISTER */}
            <View style={styles.registerRow}>
              <Text
                style={[
                  styles.registerText,
                  { color: c.muted },
                ]}
              >
                New to SmartAssets?
              </Text>

              <TouchableOpacity
                onPress={() =>
                  navigation.navigate(
                    SCREENS.REGISTER
                  )
                }
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.registerLink,
                    { color: c.primary },
                  ]}
                >
                  Create account
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* --------------------------------------------------
          FORGOT PASSWORD MODAL
      -------------------------------------------------- */}

      <Modal
        visible={forgotModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeForgotModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: c.card,
                borderColor: c.border,
              },
            ]}
          >
            {!forgotSent ? (
              <>
                <View style={styles.modalHeader}>
                  <View
                    style={[
                      styles.modalIcon,
                      {
                        backgroundColor:
                          c.primary,
                      },
                    ]}
                  >
                    <Feather
                      name="lock"
                      size={22}
                      color="#FFFFFF"
                    />
                  </View>

                  <TouchableOpacity
                    onPress={closeForgotModal}
                    activeOpacity={0.7}
                  >
                    <Feather
                      name="x"
                      size={24}
                      color={c.muted}
                    />
                  </TouchableOpacity>
                </View>

                <Text
                  style={[
                    styles.modalTitle,
                    { color: c.warm },
                  ]}
                >
                  Reset your password
                </Text>

                <Text
                  style={[
                    styles.modalDescription,
                    { color: c.muted },
                  ]}
                >
                  Enter your email address and
                  we will send you a password
                  reset link.
                </Text>

                {/* RESET EMAIL */}
                <Text
                  style={[
                    styles.label,
                    { color: c.muted },
                  ]}
                >
                  EMAIL ADDRESS
                </Text>

                <TextInput
                  value={forgotEmail}
                  onChangeText={(text) => {
                    setForgotEmail(text);
                    setForgotError('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="you@example.com"
                  placeholderTextColor={c.muted}
                  style={[
                    styles.input,
                    {
                      backgroundColor: c.card,
                      borderColor: c.border,
                      color: c.warm,
                    },
                  ]}
                />

                {/* FORGOT ERROR */}
                {forgotError ? (
                  <Text
                    style={[
                      styles.modalError,
                      {
                        color:
                          c.danger ||
                          '#ff4444',
                      },
                    ]}
                  >
                    {forgotError}
                  </Text>
                ) : null}

                {/* SEND BUTTON */}
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor:
                        forgotLoading
                          ? c.primaryDim
                          : c.primary,
                    },
                  ]}
                  onPress={
                    handleForgotPassword
                  }
                  disabled={forgotLoading}
                  activeOpacity={0.85}
                >
                  {forgotLoading ? (
                    <ActivityIndicator
                      color="#FFFFFF"
                    />
                  ) : (
                    <Text
                      style={
                        styles.primaryBtnText
                      }
                    >
                      Send reset link
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={closeForgotModal}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.cancelText,
                      { color: c.muted },
                    ]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* SUCCESS */}
                <View style={styles.successContainer}>
                  <View
                    style={[
                      styles.successIcon,
                      {
                        backgroundColor:
                          c.primary,
                      },
                    ]}
                  >
                    <Feather
                      name="check"
                      size={30}
                      color="#FFFFFF"
                    />
                  </View>

                  <Text
                    style={[
                      styles.modalTitle,
                      { color: c.warm },
                    ]}
                  >
                    Check your email
                  </Text>

                  <Text
                    style={[
                      styles.modalDescription,
                      { color: c.muted },
                    ]}
                  >
                    If an account exists for that
                    email address, a password reset
                    link has been sent.
                  </Text>

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor:
                          c.primary,
                      },
                    ]}
                    onPress={closeForgotModal}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={
                        styles.primaryBtnText
                      }
                    >
                      Done
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* --------------------------------------------------
          WALLET MODAL
      -------------------------------------------------- */}

      <Modal
        visible={walletModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setWalletModalVisible(false)
        }
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: c.card,
                borderColor: c.border,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View
                style={[
                  styles.modalIcon,
                  {
                    backgroundColor:
                      c.primary,
                  },
                ]}
              >
                <Ionicons
                  name="wallet-outline"
                  size={22}
                  color="#FFFFFF"
                />
              </View>

              <TouchableOpacity
                onPress={() =>
                  setWalletModalVisible(false)
                }
                activeOpacity={0.7}
              >
                <Feather
                  name="x"
                  size={24}
                  color={c.muted}
                />
              </TouchableOpacity>
            </View>

            <Text
              style={[
                styles.modalTitle,
                { color: c.warm },
              ]}
            >
              Connect your wallet
            </Text>

            <Text
              style={[
                styles.modalDescription,
                { color: c.muted },
              ]}
            >
              MetaMask was not detected. You
              can use the demo wallet or enter
              a wallet address.
            </Text>

            {/* DEMO WALLET */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor:
                    c.primary,
                },
              ]}
              onPress={handleDemoWalletLogin}
              disabled={connectingWallet}
              activeOpacity={0.85}
            >
              {connectingWallet ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  style={
                    styles.primaryBtnText
                  }
                >
                  Use Demo Wallet
                </Text>
              )}
            </TouchableOpacity>

            {/* CUSTOM WALLET */}
            <Text
              style={[
                styles.label,
                {
                  color: c.muted,
                  marginTop: 18,
                },
              ]}
            >
              WALLET ADDRESS
            </Text>

            <TextInput
              value={customWalletAddress}
              onChangeText={setCustomWalletAddress}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="0x..."
              placeholderTextColor={c.muted}
              style={[
                styles.input,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  color: c.warm,
                },
              ]}
            />

            <TouchableOpacity
              style={[
                styles.walletBtn,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
              ]}
              onPress={handleCustomWalletLogin}
              disabled={connectingWallet}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.walletBtnText,
                  { color: c.warm },
                ]}
              >
                Connect Wallet Address
              </Text>
            </TouchableOpacity>

            {/* METAMASK DOWNLOAD */}
            <TouchableOpacity
              style={styles.metamaskLink}
              onPress={openMetaMaskApp}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.registerLink,
                  { color: c.primary },
                ]}
              >
                Get MetaMask
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() =>
                setWalletModalVisible(false)
              }
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.cancelText,
                  { color: c.muted },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  keyboard: {
    flex: 1,
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 50,
  },

  header: {
    alignItems: 'center',
    marginBottom: 28,
  },

  logoBox: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  logoText: {
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 4,
  },

  subtitle: {
    fontSize: 13,
  },

  card: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
  },

  heading: {
    fontSize: 25,
    fontWeight: '800',
    marginBottom: 7,
  },

  description: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 24,
  },

  fieldWrap: {
    marginBottom: 17,
  },

  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 7,
  },

  input: {
    width: '100%',
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
  },

  // IMPORTANT:
  // This makes the Forgot password button
  // clearly visible and easy to press.
  forgotBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: -5,
    marginBottom: 12,
  },

  forgotText: {
    fontSize: 14,
    fontWeight: '700',
  },

  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },

  errorText: {
    fontSize: 13,
    lineHeight: 19,
  },

  primaryBtn: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 22,
  },

  divider: {
    flex: 1,
    height: 1,
  },

  dividerText: {
    fontSize: 12,
    marginHorizontal: 10,
  },

  walletBtn: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 16,
  },

  walletBtnText: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 9,
  },

  walletStatus: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 10,
  },

  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    flexWrap: 'wrap',
  },

  registerText: {
    fontSize: 13,
  },

  registerLink: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 5,
  },

  // --------------------------------------------------
  // MODALS
  // --------------------------------------------------

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  modalCard: {
    width: '100%',
    maxWidth: 460,
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },

  modalIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },

  modalDescription: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
  },

  modalError: {
    fontSize: 13,
    marginTop: 9,
    marginBottom: 12,
    lineHeight: 19,
  },

  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: 8,
  },

  cancelText: {
    fontSize: 14,
    fontWeight: '600',
  },

  successContainer: {
    alignItems: 'center',
  },

  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  metamaskLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
});