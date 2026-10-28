
import React, { useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { registerUser, getWalletNonceApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork, OfflineBanner } from "../context/NetworkContext";
import CompleteProfileModal from "../components/CompleteProfileModal";
import InstallMetaMaskModal from "../components/InstallMetaMaskModal";
import {
  isMetaMaskAppInstalled,
  connectMobileWallet,
  signPersonalMessage,
} from "../services/mobileWalletService";

export default function RegisterScreen({
  navigation,
  isDark: propIsDark,
  toggleTheme: propToggleTheme,
}) {
  const themeContext = useTheme();
  const isDark = propIsDark !== undefined ? propIsDark : themeContext.isDark;
  const toggleTheme = propToggleTheme || themeContext.toggleTheme;
  const c = useColors(isDark);
  const { isConnected, isOffline } = useNetwork();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Client-side validation ─────────────────────────────────────────────────
  const validate = () => {
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return false;
    }
    if (!email.trim()) {
      setError("Please enter your email address.");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return false;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return false;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return false;
    }
    return true;
  };

  // ── Handle registration ────────────────────────────────────────────────────
  const handleRegister = async () => {
    setError("");
    if (!validate()) return;

    setLoading(true);
    try {
      await registerUser({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
      });

      if (Platform.OS === "web") {
        window.alert(
          "Account Created — FICA Notice\n\nYour SmartAssets account has been created! To list assets, trade fractional shares, and deposit funds, please submit your FICA compliance pack in your Profile upon signing in."
        );
        navigation.navigate(SCREENS.LOGIN);
      } else {
        Alert.alert(
          "Account Created — FICA Notice",
          "Your SmartAssets account has been created! To list assets, trade fractional shares, and deposit funds, please submit your FICA compliance pack (ID, Tax Number, Proof of Residence, and Banking details) in your Profile upon signing in.",
          [
            {
              text: "Continue to Sign In",
              onPress: () => navigation.navigate(SCREENS.LOGIN),
            },
          ]
        );
      }
    } catch (err) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Web3 MetaMask Registration Flow ──
  const { loginWithWallet } = useAuth();
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletStatus, setWalletStatus] = useState('');
  const [completeProfileVisible, setCompleteProfileVisible] = useState(false);
  const [pendingWalletAddress, setPendingWalletAddress] = useState('');
  const [pendingVerificationToken, setPendingVerificationToken] = useState('');
  const [installModalVisible, setInstallModalVisible] = useState(false);

  const handleContinueWithMetaMask = async () => {
    setError('');

    // Check if MetaMask mobile app or browser extension is installed
    const isInstalled = await isMetaMaskAppInstalled();
    if (!isInstalled && Platform.OS !== 'web') {
      setInstallModalVisible(true);
      return;
    }

    setConnectingWallet(true);
    setWalletStatus('Connecting to MetaMask...');

    try {
      const targetAddress = await connectMobileWallet();
      if (!targetAddress) {
        throw new Error('No account selected in MetaMask.');
      }

      // 1. Fetch challenge nonce from backend
      setWalletStatus('Requesting challenge nonce...');
      const challenge = await getWalletNonceApi(targetAddress);
      if (!challenge?.success || !challenge?.message || !challenge?.nonce) {
        throw new Error(challenge?.error || 'Could not retrieve wallet challenge.');
      }

      // 2. Request cryptographic signature from user via MetaMask personal_sign (opens app via deep link)
      setWalletStatus('Please sign verification message in MetaMask...');
      const signature = await signPersonalMessage(challenge.message, targetAddress);

      // 3. Verify signature and check if wallet already linked
      setWalletStatus('Verifying wallet signature...');
      const res = await loginWithWallet({
        walletAddress: targetAddress,
        signature,
        nonce: challenge.nonce,
      });

      // If wallet is not linked yet, backend returns needsProfile: true with verificationToken
      if (res?.needsProfile || res?.needsAccount) {
        setPendingWalletAddress(targetAddress);
        setPendingVerificationToken(res.verificationToken || '');
        setCompleteProfileVisible(true);
        return;
      }

      // Wallet was already linked to an existing account: user is now logged in!
    } catch (err) {
      if (err?.message === 'METAMASK_NOT_INSTALLED') {
        setInstallModalVisible(true);
      } else if (err?.code === 4001 || err?.message?.toLowerCase().includes('reject') || err?.message?.toLowerCase().includes('cancel')) {
        setError('MetaMask signature was cancelled.');
      } else {
        setError(err?.message || 'MetaMask sign-up failed.');
      }
    } finally {
      setConnectingWallet(false);
      setWalletStatus('');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: isDark ? "#0F172A" : "#F3EEFF" }]}>
      {/* ── SmartAssets Mesh Gradient Background ── */}
      <LinearGradient
        colors={
          isDark
            ? ["#0F172A", "#131A2F", "#1E1B4B", "#0A0E1A"]
            : ["#e4e0ffff", "#e0daffff", "#f5dfefff", "#fff5efff", "#ffffffff"]
        }
        locations={isDark ? [0, 0.35, 0.7, 1] : [0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[StyleSheet.absoluteFillObject, { pointerEvents: "none" }]}
      />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* ── Top Bar: Back Button + Brand Badge + Theme Toggle ── */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={[
                styles.backBtn,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#FFFFFF",
                  borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(151, 106, 240, 0.22)",
                },
              ]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.8}
            >
              <Feather name="arrow-left" size={18} color={c.warm} />
            </TouchableOpacity>

            <View style={styles.brandRow}>
              <LinearGradient
                colors={["#976af0", "#00fbff"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.brandLogoBadge}
              >
                <Ionicons name="diamond" size={16} color="#FFFFFF" />
              </LinearGradient>
              <Text style={[styles.brandTitle, { color: c.warm }]}>SmartAssets</Text>
            </View>

            <TouchableOpacity
              onPress={toggleTheme}
              activeOpacity={0.75}
              style={[
                styles.themePill,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.85)",
                  borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(151, 106, 240, 0.22)",
                },
              ]}
            >
              <Feather
                name={isDark ? "sun" : "moon"}
                size={15}
                color={isDark ? "#F59E0B" : "#7C3AED"}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* OFFLINE BANNER */}
            <OfflineBanner
              isDark={isDark}
              message="You are currently offline. Connect to the internet to register."
              style={{ maxWidth: 480, alignSelf: "center", width: "100%", marginBottom: 14 }}
            />

            {/* ── Frosted Glass Form Card ── */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: isDark ? "rgba(24, 33, 56, 0.92)" : "rgba(255, 255, 255, 0.92)",
                  borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(151, 106, 240, 0.2)",
                },
              ]}
            >
              {/* ── Heading ── */}
              <Text style={[styles.heading, { color: c.warm }]}>Create Account</Text>
              <Text style={[styles.sub, { color: c.muted }]}>
                Join SmartAssets — the verified luxury & fractional asset marketplace
              </Text>

              {/* ── Error message ── */}
              {error ? (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: "rgba(239, 68, 68, 0.12)",
                      borderColor: "rgba(239, 68, 68, 0.35)",
                    },
                  ]}
                >
                  <Feather name="alert-circle" size={16} color="#EF4444" />
                  <Text style={[styles.errorText, { color: "#EF4444" }]}>{error}</Text>
                </View>
              ) : null}

              {/* ── Full Name field ── */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.muted }]}>FULL NAME</Text>
                <TextInput
                  value={fullName}
                  onChangeText={(text) => {
                    setFullName(text);
                    setError("");
                  }}
                  autoCapitalize="words"
                  placeholder="John Doe"
                  style={[
                    styles.input,
                    {
                      backgroundColor: isDark ? "#131A2F" : "#F8FAFC",
                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#E2E8F0",
                      color: c.warm,
                    },
                  ]}
                  placeholderTextColor={c.muted}
                />
              </View>

              {/* ── Email field ── */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.muted }]}>EMAIL ADDRESS</Text>
                <TextInput
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError("");
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="you@example.com"
                  style={[
                    styles.input,
                    {
                      backgroundColor: isDark ? "#131A2F" : "#F8FAFC",
                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#E2E8F0",
                      color: c.warm,
                    },
                  ]}
                  placeholderTextColor={c.muted}
                />
              </View>

              {/* ── Password field ── */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.muted }]}>PASSWORD</Text>
                <View
                  style={[
                    styles.passwordRow,
                    {
                      backgroundColor: isDark ? "#131A2F" : "#F8FAFC",
                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#E2E8F0",
                    },
                  ]}
                >
                  <TextInput
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      setError("");
                    }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    placeholder="Min. 6 characters"
                    style={[styles.passwordInput, { color: c.warm }]}
                    placeholderTextColor={c.muted}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    activeOpacity={0.7}
                    style={styles.eyeBtn}
                  >
                    <Feather
                      name={showPassword ? "eye-off" : "eye"}
                      size={18}
                      color={c.muted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Confirm Password field ── */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, { color: c.muted }]}>CONFIRM PASSWORD</Text>
                <View
                  style={[
                    styles.passwordRow,
                    {
                      backgroundColor: isDark ? "#131A2F" : "#F8FAFC",
                      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#E2E8F0",
                    },
                  ]}
                >
                  <TextInput
                    value={confirmPassword}
                    onChangeText={(text) => {
                      setConfirmPassword(text);
                      setError("");
                    }}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    placeholder="Re-enter your password"
                    style={[styles.passwordInput, { color: c.warm }]}
                    placeholderTextColor={c.muted}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword((v) => !v)}
                    activeOpacity={0.7}
                    style={styles.eyeBtn}
                  >
                    <Feather
                      name={showConfirmPassword ? "eye-off" : "eye"}
                      size={18}
                      color={c.muted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Register button (SmartAssets Signature Gradient) ── */}
              <TouchableOpacity
                style={styles.primaryBtnWrap}
                onPress={handleRegister}
                activeOpacity={0.88}
                disabled={loading}
              >
                <LinearGradient
                  colors={["#7C3AED", "#5B36F5", "#2563EB"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGradient}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnLabel}>Create Account</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {/* ── Divider ── */}
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(151,106,240,0.18)" }]} />
                <Text style={[styles.dividerText, { color: c.muted }]}>or continue with</Text>
                <View style={[styles.dividerLine, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(151,106,240,0.18)" }]} />
              </View>

              {/* ── Continue with MetaMask Button ── */}
              <TouchableOpacity
                style={[
                  styles.walletBtn,
                  {
                    backgroundColor: isDark ? "#131A2F" : "#FFFFFF",
                    borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(151, 106, 240, 0.28)",
                  },
                ]}
                onPress={handleContinueWithMetaMask}
                activeOpacity={0.8}
                disabled={connectingWallet}
              >
                {connectingWallet ? (
                  <ActivityIndicator color={c.primary} size="small" />
                ) : (
                  <View style={styles.walletBtnContent}>
                    <Ionicons name="wallet-outline" size={19} color="#F5841F" />
                    <Text style={[styles.walletBtnText, { color: c.warm }]}>
                      Continue with MetaMask
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              {walletStatus ? (
                <Text style={[styles.walletStatusText, { color: c.muted }]}>
                  {walletStatus}
                </Text>
              ) : null}

              {/* ── Sign in link ── */}
              <View style={styles.signInRow}>
                <Text style={[styles.signInText, { color: c.muted }]}>
                  Already have an account?{" "}
                </Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate(SCREENS.LOGIN)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.signInLink, { color: c.primary }]}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── Complete Profile Modal for Web3 Registrations ── */}
      <CompleteProfileModal
        visible={completeProfileVisible}
        onClose={() => setCompleteProfileVisible(false)}
        walletAddress={pendingWalletAddress}
        verificationToken={pendingVerificationToken}
      />

      {/* ── Install MetaMask Modal (Friendly Mobile Install Screen) ── */}
      <InstallMetaMaskModal
        visible={installModalVisible}
        onClose={() => setInstallModalVisible(false)}
        onRetry={() => {
          setInstallModalVisible(false);
          handleContinueWithMetaMask();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  navBar: {
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandLogoBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  themePill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderRadius: 24,
    borderWidth: 1,
    padding: 26,
    gap: 16,
    shadowColor: "#5B36F5",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: -6,
    marginBottom: 4,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  fieldWrap: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.9,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
  },
  eyeBtn: {
    paddingLeft: 10,
    paddingVertical: 8,
  },
  primaryBtnWrap: {
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 6,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  primaryBtnGradient: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnLabel: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15.5,
    letterSpacing: 0.2,
  },
  signInRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 6,
  },
  signInText: {
    fontSize: 13.5,
  },
  signInLink: {
    fontSize: 13.5,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 14,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  walletBtn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  walletBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  walletBtnText: {
    fontSize: 14.5,
    fontWeight: "700",
  },
  walletStatusText: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 6,
    fontStyle: "italic",
  },
});
