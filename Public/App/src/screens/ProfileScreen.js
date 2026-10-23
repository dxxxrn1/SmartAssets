import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  LayoutAnimation,
  Alert,
  Image,
  ActivityIndicator,
  Switch,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { OfflineBanner } from "../context/NetworkContext";
import {
  getUserProfileApi,
  updateUserProfileApi,
  deleteAccountApi,
  lodgeSupportTicketApi,
  getUserSupportTicketsApi,
  submitKycApi,
  getKycStatusApi,
} from "../services/api";
import useLinkedWallet from "../hooks/useLinkedWallet";

// Helper to filter out synthetic MetaMask strings and raw hex addresses from user name fields
const isWalletOrMetaMaskString = (str) => {
  if (!str || typeof str !== "string") return true;
  const trimmed = str.trim().toLowerCase();
  return (
    trimmed.startsWith("metamask") ||
    /^0x[a-f0-9]{4,}/i.test(trimmed) ||
    trimmed.includes("@metamask.smartassets.io")
  );
};

export default function ProfileScreen({ navigation, route, isDark: propIsDark, toggleTheme: propToggleTheme }) {
  const themeContext = useTheme();
  // const isDark = propIsDark !== undefined ? propIsDark : themeContext.isDark;
  // const toggleTheme = propToggleTheme || themeContext.toggleTheme;
  const setIsDark = themeContext.setIsDark;
  const { user, token, logout, updateUser } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  // Web3 Linked Wallet Hook
  const {
    linkedWallet,
    activeMetaMaskAccount,
    isMismatch,
    isSepolia,
    loading: walletActionLoading,
    linkWallet,
    unlinkWallet,
  } = useLinkedWallet();

  const [copiedWallet, setCopiedWallet] = useState(false);

  // State to manage which accordion section is expanded
  const [expandedSection, setExpandedSection] = useState(null);

  // Form & Upload States
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [submittingSupport, setSubmittingSupport] = useState(false);

  const initialRawName = user?.fullName || user?.name || "";
  const initialCleanName = !isWalletOrMetaMaskString(initialRawName) ? initialRawName : "";
  const initialRawEmail = user?.email || "";
  const initialCleanEmail = !isWalletOrMetaMaskString(initialRawEmail) ? initialRawEmail : "";

  // ── SmartAssets FICA / KYC & Banking State ───────────────────────────────
  const SA_BANKS = [
    { name: 'FNB', code: '250655' },
    { name: 'Standard Bank', code: '051001' },
    { name: 'Capitec', code: '470010' },
    { name: 'Absa', code: '632005' },
    { name: 'Nedbank', code: '198765' },
    { name: 'TymeBank', code: '678910' },
  ];

  const [kycStatus, setKycStatus] = useState(user?.kycStatus || "unverified");
  const [rejectionReason, setRejectionReason] = useState(null);
  const [submittingKyc, setSubmittingKyc] = useState(false);
  const [supportModalVisible, setSupportModalVisible] = useState(false);

  const [kycForm, setKycForm] = useState({
    idNumber: "",
    idDocumentUrl: null,
    taxNumber: "",
    taxDocumentUrl: null,
    residentialAddress: "",
    proofOfResidenceUrl: null,
    bankName: "FNB",
    accountHolder: initialCleanName || user?.fullName || "",
    accountNumber: "",
    branchCode: "250655",
  });

  const [form, setForm] = useState({
    fullName: initialCleanName,
    gender: user?.gender || "",
    dob: user?.dob || "",
    email: initialCleanEmail,
    password: "",
  });

  // Notifications State
  const [notifications, setNotifications] = useState({
    escrowAlerts: true,
    priceAlerts: true,
    securityAlerts: true,
    marketing: false,
  });

  // Support Form State
  const [supportCategory, setSupportCategory] = useState("Escrow & Payments");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportPriority, setSupportPriority] = useState("normal");
  const [supportTickets, setSupportTickets] = useState([]);

  // Delete Account Confirmation
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const toggleSection = (section) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === section ? null : section);
  };

  // Listen for navigation route params (e.g. from gatekeeper modal)
  useEffect(() => {
    if (route?.params?.openKyc) {
      setExpandedSection("kyc");
    } else if (route?.params?.openSupport) {
      setExpandedSection("support");
    }
  }, [route?.params]);

  // Load latest profile, tickets & KYC status on mount
  useEffect(() => {
    if (token) {
      getKycStatusApi(token)
        .then((res) => {
          if (res?.compliance) {
            setKycStatus(res.compliance.kycStatus || "unverified");
            setRejectionReason(res.compliance.rejectionReason || null);
            if (res.compliance.bankingDetails) {
              setKycForm((prev) => ({
                ...prev,
                bankName: res.compliance.bankingDetails.bankName || prev.bankName,
                accountHolder: res.compliance.bankingDetails.accountHolder || prev.accountHolder,
                accountNumber: res.compliance.bankingDetails.accountNumber || prev.accountNumber,
                branchCode: res.compliance.bankingDetails.branchCode || prev.branchCode,
              }));
            }
          }
        })
        .catch(() => {});
    }
  }, [token]);

  // Load latest profile & tickets on mount
  useEffect(() => {
    if (token) {
      getUserProfileApi(token)
        .then((res) => {
          if (res?.success && res.profile) {
            const p = res.profile;
            const cleanPFullName = (!isWalletOrMetaMaskString(p.fullName) && p.fullName) ? p.fullName : "";
            const cleanPEmail = (!isWalletOrMetaMaskString(p.email) && p.email) ? p.email : "";
            setForm((prev) => ({
              ...prev,
              fullName: cleanPFullName || prev.fullName,
              gender: p.gender || prev.gender,
              dob: p.dob || prev.dob,
              email: cleanPEmail || prev.email,
            }));
            const effectiveAvatar = p.avatarUrl || p.avatar_url;
            const effectiveWallet = p.wallet_address || p.walletAddress;
            updateUser({
              ...(effectiveAvatar ? { avatarUrl: effectiveAvatar, avatar_url: effectiveAvatar } : {}),
              ...(cleanPFullName ? { fullName: cleanPFullName } : {}),
              ...(effectiveWallet ? { walletAddress: effectiveWallet, wallet_address: effectiveWallet } : {}),
            });
          }
        })
        .catch(() => {});

      getUserSupportTicketsApi(token)
        .then((res) => {
          if (res?.success && res.tickets) {
            setSupportTickets(res.tickets);
          }
        })
        .catch(() => {});
    }
  }, [token]);

  // ── Photo / Avatar Upload Handler ──
  // On web, Alert.alert is a no-op, so we skip the prompt and go straight to library picker.
  const handlePickAvatar = () => {
    if (Platform.OS === "web") {
      // On web, go directly to the file picker (camera not available)
      pickFromLibrary();
    } else {
      Alert.alert("Profile Photo", "Upload or take a new profile photo:", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Take Photo",
          onPress: () => capturePhoto(),
        },
        {
          text: "Choose from Library",
          onPress: () => pickFromLibrary(),
        },
      ]);
    }
  };

  const capturePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Camera access is needed to capture a profile photo.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        await uploadAvatar(result.assets[0]);
      }
    } catch (err) {
      Alert.alert("Camera Error", err.message || "Could not launch camera.");
    }
  };

  const pickFromLibrary = async () => {
    try {
      // On web, permission is always granted, but we still call it for mobile
      if (Platform.OS !== "web") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permission Required",
            "Photo library access is needed to pick an avatar.",
          );
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        await uploadAvatar(result.assets[0]);
      }
    } catch (err) {
      console.error("pickFromLibrary error:", err);
      if (Platform.OS === "web") {
        alert("Could not select photo: " + (err.message || "Unknown error"));
      } else {
        Alert.alert("Library Error", err.message || "Could not select photo.");
      }
    }
  };

  /**
   * Converts an ImagePicker asset to a data:image URI string.
   * Handles all platforms:
   *   - Mobile: asset.base64 is populated → prefix with data:image/jpeg;base64,
   *   - Web: asset.base64 is often null, but asset.uri is already a data: URI
   *   - Web fallback: asset.uri is a blob: URL → fetch + FileReader to convert
   */
  const assetToDataUri = async (asset) => {
    // 1. asset.base64 is available (typical on mobile)
    if (asset.base64) {
      if (asset.base64.startsWith("data:")) {
        return asset.base64;
      }
      return `data:image/jpeg;base64,${asset.base64}`;
    }

    // 2. asset.uri is already a data: URI (typical on Expo Web)
    if (asset.uri && asset.uri.startsWith("data:")) {
      return asset.uri;
    }

    // 3. asset.uri is a blob: or file: URL → convert via fetch + FileReader
    if (asset.uri) {
      try {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("FileReader failed"));
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn(
          "assetToDataUri: blob conversion failed, using raw uri:",
          err,
        );
        return asset.uri;
      }
    }

    return null;
  };

  const uploadAvatar = async (asset) => {
    try {
      setUploadingAvatar(true);

      const dataUri = await assetToDataUri(asset);
      if (!dataUri) {
        throw new Error(
          "Could not process the selected image. Please try again.",
        );
      }

      // Optimistically show the new avatar immediately
      updateUser({ avatarUrl: dataUri, avatar_url: dataUri });

      // Send to backend
      const res = await updateUserProfileApi({ avatarUrl: dataUri }, token);
      if (res?.success) {
        const saved = res?.user?.avatarUrl || res?.user?.avatar_url || dataUri;
        updateUser({ avatarUrl: saved, avatar_url: saved });
        if (Platform.OS === "web") {
          alert("Profile photo saved successfully!");
        } else {
          Alert.alert(
            "Avatar Updated",
            "Your profile photo has been saved to your account.",
          );
        }
      } else {
        // Server responded but not success — avatar is already showing locally
        console.warn("Server did not confirm avatar save:", res);
      }
    } catch (err) {
      console.error("Avatar upload failed:", err);
      if (Platform.OS === "web") {
        alert(
          "Upload notice: " +
            (err.message || "Could not save photo to server."),
        );
      } else {
        Alert.alert(
          "Upload Notice",
          err.message || "Could not save photo to server.",
        );
      }
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ── Save Profile Details ──
  const handleSaveProfile = async () => {
    if (!form.fullName.trim()) {
      Alert.alert("Validation", "Please enter your full name.");
      return;
    }

    try {
      setSavingProfile(true);
      const res = await updateUserProfileApi(
        {
          fullName: form.fullName.trim(),
          gender: form.gender.trim(),
          dob: form.dob.trim(),
          password: form.password ? form.password : undefined,
        },
        token,
      );

      if (res?.success) {
        updateUser({
          fullName: form.fullName.trim(),
          gender: form.gender.trim(),
          dob: form.dob.trim(),
        });
        setForm((prev) => ({ ...prev, password: "" }));
        Alert.alert("Success", "Your profile details have been saved.");
        toggleSection(null);
      } else {
        Alert.alert("Error", res?.error || "Could not update profile.");
      }
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── SmartAssets FICA / KYC Document Picker ──
  const pickKycDocument = async (field) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const dataUri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setKycForm((prev) => ({ ...prev, [field]: dataUri }));
      }
    } catch (err) {
      Alert.alert("File Selection Error", err.message || "Could not select document.");
    }
  };

  const handleSelectBank = (bank) => {
    setKycForm((prev) => ({
      ...prev,
      bankName: bank.name,
      branchCode: bank.code,
    }));
  };

  const handleSubmitKyc = async () => {
    if (!kycForm.idNumber.trim()) {
      Alert.alert("Required", "Please provide your SA ID or Passport Number.");
      return;
    }
    if (!kycForm.taxNumber.trim()) {
      Alert.alert("Required", "Please provide your SARS Tax Reference Number.");
      return;
    }
    if (!kycForm.residentialAddress.trim()) {
      Alert.alert("Required", "Please provide your Physical Residential Address.");
      return;
    }
    if (!kycForm.accountNumber.trim()) {
      Alert.alert("Required", "Please enter your Bank Account Number for payouts.");
      return;
    }

    setSubmittingKyc(true);
    try {
      const payload = {
        fullName: user?.fullName || kycForm.accountHolder,
        idNumber: kycForm.idNumber.trim(),
        idDocumentUrl: kycForm.idDocumentUrl,
        taxNumber: kycForm.taxNumber.trim(),
        taxDocumentUrl: kycForm.taxDocumentUrl,
        residentialAddress: kycForm.residentialAddress.trim(),
        proofOfResidenceUrl: kycForm.proofOfResidenceUrl,
        bankingDetails: {
          bankName: kycForm.bankName,
          accountHolder: kycForm.accountHolder || user?.fullName,
          accountNumber: kycForm.accountNumber.trim(),
          branchCode: kycForm.branchCode,
        },
      };

      const res = await submitKycApi(payload, token);
      if (res?.success) {
        setKycStatus("pending");
        updateUser({
          kycStatus: "pending",
          bankingDetails: payload.bankingDetails,
        });
        Alert.alert(
          "✅ Compliance Pack Submitted!",
          "Your FICA identity documents and verified banking details are now in the Admin Operations review queue. You will be cleared to transact upon approval."
        );
      } else {
        Alert.alert("Notice", res?.error || "KYC submission failed.");
      }
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to submit KYC compliance pack.");
    } finally {
      setSubmittingKyc(false);
    }
  };

  // ── Lodge Support Ticket ──
  const handleLodgeSupport = async () => {
    if (!supportSubject.trim()) {
      Alert.alert(
        "Required",
        "Please provide a subject for your support inquiry.",
      );
      return;
    }
    if (!supportMessage.trim()) {
      Alert.alert(
        "Required",
        "Please provide message details for your inquiry.",
      );
      return;
    }

    try {
      setSubmittingSupport(true);
      const res = await lodgeSupportTicketApi(
        {
          category: supportCategory,
          subject: supportSubject.trim(),
          message: supportMessage.trim(),
          priority: supportPriority,
        },
        token,
      );

      if (res?.success && res.ticket) {
        setSupportTickets((prev) => [res.ticket, ...prev]);
        setSupportSubject("");
        setSupportMessage("");
        Alert.alert(
          "Ticket Lodged",
          `Reference: ${res.ticket.id}\n\nOur concierge desk has received your inquiry and will reply within 2-4 hours.`,
        );
      } else {
        Alert.alert("Notice", res?.error || "Support inquiry submitted.");
      }
    } catch (err) {
      Alert.alert("Error", err.message || "Failed to lodge support ticket.");
    } finally {
      setSubmittingSupport(false);
    }
  };

  // ── Delete Account ──
  const handleDeleteAccount = () => {
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      Alert.alert(
        "Confirmation Required",
        'Please type "DELETE" into the box to authorize account deletion.',
      );
      return;
    }

    Alert.alert(
      "Confirm Account Deletion",
      "Are you absolutely sure? All your assets, vault holdings, and account history will be permanently deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Delete Account",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingAccount(true);
              const res = await deleteAccountApi(token);
              if (res?.success) {
                Alert.alert(
                  "Account Deleted",
                  "Your account has been deleted.",
                  [{ text: "OK", onPress: () => logout() }],
                );
              } else {
                logout();
              }
            } catch (err) {
              Alert.alert(
                "Delete Error",
                err.message || "Could not delete account.",
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () => logout(),
      },
    ]);
  };

  // Dynamic values: strictly display real user details (never "MetaMask" or placeholder email)
  const rawFullName = user?.fullName || user?.name || form.fullName || "";
  const cleanFullName = !isWalletOrMetaMaskString(rawFullName) ? rawFullName.trim() : "";
  const rawEmail = user?.email || form.email || "";
  const cleanEmail = !isWalletOrMetaMaskString(rawEmail) ? rawEmail.trim() : "";

  const displayName =
    cleanFullName ||
    (cleanEmail ? cleanEmail.split("@")[0] : "") ||
    "Luxury Collector";

  const displayEmail =
    cleanEmail ||
    (linkedWallet
      ? `Wallet linked (${linkedWallet.substring(0, 6)}...${linkedWallet.slice(-4)})`
      : "Verified Member");

  const avatarUrl = user?.avatarUrl || user?.avatar_url;

  const handleCopyWallet = async () => {
    if (!linkedWallet) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(linkedWallet);
      }
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2000);
      if (Platform.OS !== "web") {
        Alert.alert("Wallet Address", linkedWallet);
      }
    } catch (_) {
      Alert.alert("Wallet Address", linkedWallet);
    }
  };

  const handleDisconnectWallet = () => {
    Alert.alert(
      "Disconnect Wallet",
      "Are you sure you want to unlink this wallet from your profile? You will need to link a wallet again to sign smart contract transactions.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            try {
              await unlinkWallet();
            } catch (err) {
              Alert.alert("Error", err.message || "Failed to unlink wallet.");
            }
          },
        },
      ]
    );
  };

  const handleConnectWallet = async () => {
    try {
      await linkWallet();
    } catch (_) {
      // Error handled within hook alerts
    }
  };

  // Menu items with original pastel colors
  const MENU_ITEMS = [
    {
      id: "kyc",
      label: "FICA / KYC & Banking Verification",
      icon: "shield",
      bgColor: "#DCFCE7",
      textColor: "#15803D",
    },
    {
      id: "edit",
      label: "Edit Profile",
      icon: "edit-3",
      bgColor: "#BFDBFE",
      textColor: "#1E3A8A",
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: "bell",
      bgColor: "#FEF08A",
      textColor: "#713F12",
    },
    {
      id: "tos",
      label: "Terms of Service (TOS)",
      icon: "file-text",
      bgColor: "#E5E7EB",
      textColor: "#1F2937",
    },
    {
      id: "support",
      label: "Support",
      icon: "headphones",
      bgColor: "#BBF7D0",
      textColor: "#14532D",
    },
    {
      id: "theme",
      label: "Theme & Appearance",
      icon: "moon",
      bgColor: "#E0E7FF",
      textColor: "#3730A3",
    },
    {
      id: "delete",
      label: "Delete Account",
      icon: "trash-2",
      bgColor: "#FECACA",
      textColor: "#7F1D1D",
    },
  ];

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: "#0A1120" }]}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Feather name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── User Avatar & Info ── */}
        <View style={styles.userInfoWrap}>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={handlePickAvatar}
            activeOpacity={0.85}
          >
            {uploadingAvatar ? (
              <ActivityIndicator color="#3B82F6" size="small" />
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <Feather name="user" size={32} color="#FFFFFF" />
            )}
            <View style={styles.avatarCameraBadge}>
              <Feather name="camera" size={12} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userEmail}>{displayEmail}</Text>
        </View>

        {/* ── Web3 Settlement Wallet Card ── */}
        <View
          style={[
            styles.walletCard,
            {
              backgroundColor: isDark ? "#131A2F" : "#FFFFFF",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0",
            },
          ]}
        >
          <View style={styles.walletHeaderRow}>
            <View style={styles.walletTitleGroup}>
              <View style={styles.walletIconCircle}>
                <Ionicons name="wallet-outline" size={18} color="#00FBFF" />
              </View>
              <View>
                <Text
                  style={[
                    styles.walletCardTitle,
                    { color: isDark ? "#F8FAFC" : "#0F172A" },
                  ]}
                >
                  Web3 Settlement Wallet
                </Text>
                <Text style={styles.walletCardSubtitle}>
                  {linkedWallet
                    ? "Linked for purchases, escrows & auctions"
                    : "Connect MetaMask on Sepolia to authorize transactions"}
                </Text>
              </View>
            </View>
            {linkedWallet && (
              <View style={styles.networkBadge}>
                <View style={styles.networkPulseDot} />
                <Text style={styles.networkBadgeText}>Sepolia</Text>
              </View>
            )}
          </View>

          {linkedWallet ? (
            <View style={styles.walletConnectedContent}>
              <View
                style={[
                  styles.addressDisplayRow,
                  {
                    backgroundColor: isDark ? "rgba(15, 23, 42, 0.6)" : "#F8FAFC",
                    borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.addressMonoText,
                    { color: isDark ? "#F8FAFC" : "#1E293B" },
                  ]}
                >
                  {`${linkedWallet.substring(0, 8)}...${linkedWallet.slice(-6)}`}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.copyBtn,
                    {
                      backgroundColor: isDark
                        ? "rgba(255, 255, 255, 0.08)"
                        : "#EEF2F6",
                    },
                  ]}
                  onPress={handleCopyWallet}
                  activeOpacity={0.7}
                >
                  <Feather
                    name={copiedWallet ? "check" : "copy"}
                    size={14}
                    color={copiedWallet ? "#10B981" : isDark ? "#94A3B8" : "#64748B"}
                  />
                  <Text
                    style={[
                      styles.copyBtnText,
                      { color: copiedWallet ? "#10B981" : isDark ? "#94A3B8" : "#64748B" },
                    ]}
                  >
                    {copiedWallet ? "Copied" : "Copy"}
                  </Text>
                </TouchableOpacity>
              </View>

              {isMismatch && (
                <View style={styles.walletWarningBanner}>
                  <Ionicons name="warning-outline" size={16} color="#FBBF24" />
                  <Text style={styles.walletWarningText}>
                    MetaMask is active with account (
                    {activeMetaMaskAccount
                      ? `${activeMetaMaskAccount.substring(0, 6)}...${activeMetaMaskAccount.slice(-4)}`
                      : "unknown"}
                    ). Switch MetaMask to your linked wallet to sign transactions.
                  </Text>
                </View>
              )}

              <View style={styles.walletActionRow}>
                <TouchableOpacity
                  style={styles.unlinkBtn}
                  onPress={handleDisconnectWallet}
                  disabled={walletActionLoading}
                  activeOpacity={0.8}
                >
                  {walletActionLoading ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <>
                      <Feather name="link-2" size={14} color="#EF4444" />
                      <Text style={styles.unlinkBtnText}>Disconnect</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.walletUnconnectedContent}>
              <Text style={styles.walletEmptyDesc}>
                No wallet linked to your account. Connect your MetaMask wallet on Ethereum Sepolia to securely verify asset ownership and execute smart contracts.
              </Text>
              <TouchableOpacity
                style={styles.connectWalletBtn}
                onPress={handleConnectWallet}
                disabled={walletActionLoading}
                activeOpacity={0.85}
              >
                {walletActionLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="wallet-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.connectWalletBtnText}>Connect MetaMask</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── OFFLINE BANNER ── */}
        <OfflineBanner
          isDark={isDark}
          message="⚡ Offline Mode — Showing saved profile data."
          style={{ marginBottom: 16 }}
        />

        {/* ── Theme & Appearance Toggle Card ── */}
        <View
          style={{
            backgroundColor: isDark ? "#131A2F" : "#FFFFFF",
            borderRadius: 14,
            padding: 16,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: isDark ? "rgba(251, 191, 36, 0.15)" : "rgba(30, 41, 59, 0.08)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name={isDark ? "moon" : "sun"} size={19} color={isDark ? "#FBBF24" : "#1E293B"} />
            </View>
            <View>
              <Text style={{ fontSize: 15, fontWeight: "700", color: isDark ? "#F8FAFC" : "#0F172A" }}>
                Dark Mode
              </Text>
              <Text style={{ fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
                {isDark ? "Dark theme active" : "Light theme active"}
              </Text>
            </View>
          </View>
          <Switch
            value={isDark}
            onValueChange={(val) => setIsDark(val)}
            trackColor={{ false: "#CBD5E1", true: "#3B82F6" }}
            thumbColor={isDark ? "#FFFFFF" : "#F8FAFC"}
          />
        </View>

        {/* ── Menu List ── */}
        <View style={styles.menuContainer}>
          {MENU_ITEMS.map((item, idx) => {
            const isExpanded = expandedSection === item.id;
            return (
              <View key={item.id} style={styles.menuItemWrap}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => toggleSection(item.id)}
                  style={[
                    styles.menuItem,
                    {
                      backgroundColor: "transparent",
                      borderBottomWidth:
                        idx === MENU_ITEMS.length - 1 && !isExpanded ? 0 : 1,
                      borderBottomColor: "#F1F5F9",
                    },
                  ]}
                >
                  <View style={styles.menuItemLeft}>
                    <Feather
                      name={item.icon}
                      size={18}
                      color={item.textColor}
                    />
                    <Text style={[styles.menuItemLabel, { color: "#1E293B" }]}>
                      {item.label}
                    </Text>
                  </View>
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#94A3B8"
                    style={{ opacity: 0.6 }}
                  />
                </TouchableOpacity>

                {/* ── Expanded: FICA / KYC & Banking Verification ── */}
                {isExpanded && item.id === "kyc" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#F8FAFC" }]}>
                    {/* Status Card */}
                    <View
                      style={{
                        padding: 14,
                        borderRadius: 12,
                        marginBottom: 16,
                        backgroundColor:
                          kycStatus === "verified"
                            ? "#DCFCE7"
                            : kycStatus === "pending"
                            ? "#DBEAFE"
                            : kycStatus === "rejected"
                            ? "#FEE2E2"
                            : "#FEF3C7",
                        borderWidth: 1,
                        borderColor:
                          kycStatus === "verified"
                            ? "#86EFAC"
                            : kycStatus === "pending"
                            ? "#93C5FD"
                            : kycStatus === "rejected"
                            ? "#FCA5A5"
                            : "#FDE68A",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Feather
                          name={
                            kycStatus === "verified"
                              ? "check-circle"
                              : kycStatus === "pending"
                              ? "clock"
                              : kycStatus === "rejected"
                              ? "alert-circle"
                              : "alert-triangle"
                          }
                          size={18}
                          color={
                            kycStatus === "verified"
                              ? "#15803D"
                              : kycStatus === "pending"
                              ? "#1D4ED8"
                              : kycStatus === "rejected"
                              ? "#B91C1C"
                              : "#B45309"
                          }
                        />
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "800",
                            color:
                              kycStatus === "verified"
                                ? "#15803D"
                                : kycStatus === "pending"
                                ? "#1D4ED8"
                                : kycStatus === "rejected"
                                ? "#B91C1C"
                                : "#B45309",
                          }}
                        >
                          {kycStatus === "verified"
                            ? "✅ FICA Verified Investor"
                            : kycStatus === "pending"
                            ? "⏳ Pending Admin Compliance Review"
                            : kycStatus === "rejected"
                            ? "❌ Compliance Dossier Rejected"
                            : "⚠️ Unverified Investor Account"}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: "#334155", lineHeight: 18 }}>
                        {kycStatus === "verified"
                          ? "Your FICA compliance pack is fully approved. You are cleared for all marketplace listings, fractional trading tranches, and vault cash movements."
                          : kycStatus === "pending"
                          ? "Your submitted documents are currently undergoing administrative compliance review. The Admin Portal will approve your account shortly."
                          : kycStatus === "rejected"
                          ? `Rejection Reason: ${rejectionReason || "Documentation did not meet compliance criteria. Please resubmit clear photos."}`
                          : "Financial regulations require submission of your SA ID/Passport, SARS Tax Reference, Proof of Residence, and Bank Details before you can list assets or transact."}
                      </Text>
                    </View>

                    {/* Section 1: Required Document Uploads */}
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      1. Required FICA Identity Documents
                    </Text>

                    {/* SA ID / Passport */}
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", marginBottom: 6 }}>
                      Government ID / Passport Number
                    </Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="e.g. 9001015009087 or ZA Passport"
                      placeholderTextColor="#94A3B8"
                      value={kycForm.idNumber}
                      onChangeText={(v) => setKycForm({ ...kycForm, idNumber: v })}
                    />
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => pickKycDocument("idDocumentUrl")}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        backgroundColor: "#FFFFFF",
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: "#CBD5E1",
                        borderStyle: "dashed",
                        marginBottom: 14,
                      }}
                    >
                      <Feather name="upload" size={16} color="#2563EB" />
                      <Text style={{ fontSize: 12, fontWeight: "600", color: "#2563EB" }}>
                        {kycForm.idDocumentUrl ? "✅ ID Document Attached (Tap to replace)" : "Upload ID Document Photo / Scan"}
                      </Text>
                    </TouchableOpacity>

                    {/* SARS Tax Reference */}
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", marginBottom: 6 }}>
                      SARS Tax Reference Number
                    </Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="e.g. 9123456789"
                      placeholderTextColor="#94A3B8"
                      value={kycForm.taxNumber}
                      onChangeText={(v) => setKycForm({ ...kycForm, taxNumber: v })}
                    />
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => pickKycDocument("taxDocumentUrl")}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        backgroundColor: "#FFFFFF",
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: "#CBD5E1",
                        borderStyle: "dashed",
                        marginBottom: 14,
                      }}
                    >
                      <Feather name="upload" size={16} color="#2563EB" />
                      <Text style={{ fontSize: 12, fontWeight: "600", color: "#2563EB" }}>
                        {kycForm.taxDocumentUrl ? "✅ Tax Notice Attached (Tap to replace)" : "Upload SARS Notice / Certificate"}
                      </Text>
                    </TouchableOpacity>

                    {/* Proof of Residence */}
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", marginBottom: 6 }}>
                      Physical Residential Address
                    </Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="Street address, suburb, city, postal code"
                      placeholderTextColor="#94A3B8"
                      value={kycForm.residentialAddress}
                      onChangeText={(v) => setKycForm({ ...kycForm, residentialAddress: v })}
                    />
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => pickKycDocument("proofOfResidenceUrl")}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        backgroundColor: "#FFFFFF",
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: "#CBD5E1",
                        borderStyle: "dashed",
                        marginBottom: 20,
                      }}
                    >
                      <Feather name="upload" size={16} color="#2563EB" />
                      <Text style={{ fontSize: 12, fontWeight: "600", color: "#2563EB" }}>
                        {kycForm.proofOfResidenceUrl ? "✅ Utility Bill Attached (Tap to replace)" : "Upload Utility Bill / Bank Statement (< 3 months)"}
                      </Text>
                    </TouchableOpacity>

                    {/* Section 2: Verified Banking Details */}
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      2. Verified South African Banking Details
                    </Text>
                    <Text style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
                      Required for instant ZAR escrow payouts, dividends, and vault withdrawals.
                    </Text>

                    {/* Bank Selector Chips */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                      {SA_BANKS.map((bank) => {
                        const isSelected = kycForm.bankName === bank.name;
                        return (
                          <TouchableOpacity
                            key={bank.name}
                            activeOpacity={0.8}
                            onPress={() => handleSelectBank(bank)}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 8,
                              backgroundColor: isSelected ? "#2563EB" : "#FFFFFF",
                              borderWidth: 1,
                              borderColor: isSelected ? "#2563EB" : "#CBD5E1",
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "700", color: isSelected ? "#FFFFFF" : "#334155" }}>
                              {bank.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", marginBottom: 6 }}>
                      Account Holder Name
                    </Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="Account Holder Full Name"
                      placeholderTextColor="#94A3B8"
                      value={kycForm.accountHolder}
                      onChangeText={(v) => setKycForm({ ...kycForm, accountHolder: v })}
                    />

                    <View style={styles.rowInputs}>
                      <View style={[styles.inputWrap, { flex: 2, marginRight: 8 }]}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", marginBottom: 6 }}>
                          Account Number
                        </Text>
                        <TextInput
                          style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                          placeholder="e.g. 62819203918"
                          placeholderTextColor="#94A3B8"
                          keyboardType="numeric"
                          value={kycForm.accountNumber}
                          onChangeText={(v) => setKycForm({ ...kycForm, accountNumber: v })}
                        />
                      </View>
                      <View style={[styles.inputWrap, { flex: 1 }]}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", marginBottom: 6 }}>
                          Branch Code
                        </Text>
                        <TextInput
                          style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                          placeholder="250655"
                          placeholderTextColor="#94A3B8"
                          keyboardType="numeric"
                          value={kycForm.branchCode}
                          onChangeText={(v) => setKycForm({ ...kycForm, branchCode: v })}
                        />
                      </View>
                    </View>

                    {/* Submit Button */}
                    <TouchableOpacity
                      activeOpacity={0.88}
                      onPress={handleSubmitKyc}
                      disabled={submittingKyc}
                      style={[
                        styles.saveBtn,
                        {
                          backgroundColor: "#15803D",
                          marginTop: 14,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                        },
                      ]}
                    >
                      {submittingKyc ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <Feather name="shield" size={16} color="#FFFFFF" />
                          <Text style={[styles.saveBtnText, { color: "#FFFFFF" }]}>
                            {kycStatus === "verified" ? "Update Compliance Details" : "Submit Compliance Pack for Approval"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* ── Expanded: Edit Profile ── */}
                {isExpanded && item.id === "edit" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: "#F8FAFC" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      Personal
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: "#0F172A",
                          borderColor: "#E2E8F0",
                          backgroundColor: "#FFFFFF",
                        },
                      ]}
                      placeholder="Full Name"
                      placeholderTextColor="#94A3B8"
                      value={form.fullName}
                      onChangeText={(v) => setForm({ ...form, fullName: v })}
                    />
                    <View style={styles.rowInputs}>
                      <View
                        style={[styles.inputWrap, { flex: 1, marginRight: 8 }]}
                      >
                        <TextInput
                          style={[
                            styles.input,
                            {
                              color: "#0F172A",
                              borderColor: "#E2E8F0",
                              backgroundColor: "#FFFFFF",
                            },
                          ]}
                          placeholder="Gender"
                          placeholderTextColor="#94A3B8"
                          value={form.gender}
                          onChangeText={(v) => setForm({ ...form, gender: v })}
                        />
                        <Feather
                          name="users"
                          size={14}
                          color="#94A3B8"
                          style={styles.inputIcon}
                        />
                      </View>
                      <View
                        style={[styles.inputWrap, { flex: 1, marginLeft: 8 }]}
                      >
                        <TextInput
                          style={[
                            styles.input,
                            {
                              color: "#0F172A",
                              borderColor: "#E2E8F0",
                              backgroundColor: "#FFFFFF",
                            },
                          ]}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor="#94A3B8"
                          value={form.dob}
                          onChangeText={(v) => setForm({ ...form, dob: v })}
                        />
                        <Feather
                          name="calendar"
                          size={14}
                          color="#94A3B8"
                          style={styles.inputIcon}
                        />
                      </View>
                    </View>

                    <Text
                      style={[
                        styles.sectionHeading,
                        { color: "#334155", marginTop: 12 },
                      ]}
                    >
                      Email and password
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: "#64748B",
                          borderColor: "#E2E8F0",
                          backgroundColor: "#F1F5F9",
                        },
                      ]}
                      placeholder="Email"
                      placeholderTextColor="#94A3B8"
                      value={form.email}
                      editable={false}
                      keyboardType="email-address"
                    />
                    <View style={styles.inputWrap}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            color: "#0F172A",
                            borderColor: "#E2E8F0",
                            backgroundColor: "#FFFFFF",
                          },
                        ]}
                        placeholder="New Password (optional)"
                        placeholderTextColor="#94A3B8"
                        secureTextEntry
                        value={form.password}
                        onChangeText={(v) => setForm({ ...form, password: v })}
                      />
                      <Feather
                        name="eye-off"
                        size={14}
                        color="#94A3B8"
                        style={styles.inputIcon}
                      />
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.saveBtn,
                        { backgroundColor: item.bgColor },
                      ]}
                      onPress={handleSaveProfile}
                      disabled={savingProfile}
                    >
                      {savingProfile ? (
                        <ActivityIndicator
                          color={item.textColor}
                          size="small"
                        />
                      ) : (
                        <Text
                          style={[
                            styles.saveBtnText,
                            { color: item.textColor },
                          ]}
                        >
                          Save Changes
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* ── Expanded: Notifications ── */}
                {isExpanded && item.id === "notifications" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: "#F8FAFC" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      Notification Preferences
                    </Text>
                    {[
                      {
                        key: "escrowAlerts",
                        title: "Smart Contract Escrow Alerts",
                        sub: "Status updates on courier transit & appraisal",
                      },
                      {
                        key: "priceAlerts",
                        title: "Price Movement & Appraisals",
                        sub: "Valuation adjustments for your vault holdings",
                      },
                      {
                        key: "securityAlerts",
                        title: "Security & Login Alerts",
                        sub: "Notice on new session or wallet authorization",
                      },
                      {
                        key: "marketing",
                        title: "Luxury Offering Drops",
                        sub: "Exclusive invitations to verified asset drops",
                      },
                    ].map((n) => (
                      <View key={n.key} style={styles.prefRow}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: "#1E293B",
                            }}
                          >
                            {n.title}
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: "#64748B",
                              marginTop: 2,
                            }}
                          >
                            {n.sub}
                          </Text>
                        </View>
                        <Switch
                          value={notifications[n.key]}
                          onValueChange={(val) =>
                            setNotifications({ ...notifications, [n.key]: val })
                          }
                          trackColor={{ false: "#CBD5E1", true: "#3B82F6" }}
                          thumbColor="#FFFFFF"
                        />
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Expanded: Terms of Service ── */}
                {isExpanded && item.id === "tos" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: "#F8FAFC" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      Platform Guarantees & Terms
                    </Text>
                    {[
                      {
                        title: "Smart Contract Escrow",
                        text: "100% of purchase payments are secured in SmartAssetEscrow.sol on Ethereum Sepolia until delivery and inspection pass.",
                      },
                      {
                        title: "Anti-Self-Dealing Policy",
                        text: "Users cannot purchase, bid on, or fractionally invest in items they listed. Fractional holdings are capped at 25% per investor.",
                      },
                      {
                        title: "Appraisal & Inspection",
                        text: "Every asset is inspected by Horological & Gemological institutes with immutable ERC-721 certificates delivered to the buyer.",
                      },
                      {
                        title: "100% Buyer Refund Right",
                        text: "If any item fails inspection, 100% of escrow funds are refunded to the buyer on-chain.",
                      },
                    ].map((t) => (
                      <View key={t.title} style={styles.tosBox}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: "#1E293B",
                          }}
                        >
                          {t.title}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            color: "#64748B",
                            marginTop: 3,
                            lineHeight: 16,
                          }}
                        >
                          {t.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Expanded: Support ── */}
                {isExpanded && item.id === "support" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: "#F8FAFC" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      Lodge a Support Inquiry
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#64748B",
                        marginBottom: 10,
                      }}
                    >
                      Our luxury concierge team responds within 2-4 hours.
                    </Text>

                    {/* Category Selection */}
                    <View style={styles.catRow}>
                      {[
                        "Escrow & Payments",
                        "Physical Verification",
                        "Vault & Assets",
                        "General",
                      ].map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={[
                            styles.catBtn,
                            supportCategory === c
                              ? {
                                  backgroundColor: "#BBF7D0",
                                  borderColor: "#14532D",
                                }
                              : {},
                          ]}
                          onPress={() => setSupportCategory(c)}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              color:
                                supportCategory === c ? "#14532D" : "#64748B",
                            }}
                          >
                            {c}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: "#0F172A",
                          borderColor: "#E2E8F0",
                          backgroundColor: "#FFFFFF",
                        },
                      ]}
                      placeholder="Subject (e.g. Escrow Inquiry #ORD-8921)"
                      placeholderTextColor="#94A3B8"
                      value={supportSubject}
                      onChangeText={setSupportSubject}
                    />

                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: "#0F172A",
                          borderColor: "#E2E8F0",
                          backgroundColor: "#FFFFFF",
                          height: 72,
                          textAlignVertical: "top",
                        },
                      ]}
                      placeholder="Please describe your issue or question..."
                      placeholderTextColor="#94A3B8"
                      multiline
                      value={supportMessage}
                      onChangeText={setSupportMessage}
                    />

                    <TouchableOpacity
                      style={[
                        styles.saveBtn,
                        { backgroundColor: item.bgColor },
                      ]}
                      onPress={handleLodgeSupport}
                      disabled={submittingSupport}
                    >
                      {submittingSupport ? (
                        <ActivityIndicator
                          color={item.textColor}
                          size="small"
                        />
                      ) : (
                        <Text
                          style={[
                            styles.saveBtnText,
                            { color: item.textColor },
                          ]}
                        >
                          Submit Support Ticket
                        </Text>
                      )}
                    </TouchableOpacity>

                    {/* Active Tickets List */}
                    {supportTickets.length > 0 && (
                      <View style={{ marginTop: 14 }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: "#334155",
                            marginBottom: 6,
                          }}
                        >
                          Your Recent Tickets
                        </Text>
                        {supportTickets.slice(0, 3).map((ticket) => (
                          <View key={ticket.id} style={styles.ticketBox}>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: "700",
                                  color: "#1E293B",
                                }}
                              >
                                {ticket.subject}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 10,
                                  fontWeight: "700",
                                  color: "#10B981",
                                }}
                              >
                                {ticket.status}
                              </Text>
                            </View>
                            <Text
                              style={{
                                fontSize: 10,
                                color: "#94A3B8",
                                marginTop: 2,
                              }}
                            >
                              {ticket.id} · {ticket.category} · Priority: {ticket.priority || 'Normal'}
                            </Text>
                            {(ticket.resolutionNote || ticket.adminResponse) && (
                              <View style={{ marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#86EFAC' }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#15803D', marginBottom: 2 }}>
                                  Admin Resolution:
                                </Text>
                                <Text style={{ fontSize: 11, color: '#166534', lineHeight: 16 }}>
                                  {ticket.resolutionNote || ticket.adminResponse}
                                </Text>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* ── Expanded: Theme & Appearance ── */}
                {isExpanded && item.id === "theme" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: "#F8FAFC" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>
                      Theme & Appearance
                    </Text>
                    <View style={styles.prefRow}>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: "#1E293B",
                          }}
                        >
                          Dark Mode
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            color: "#64748B",
                            marginTop: 2,
                          }}
                        >
                          {isDark
                            ? "Dark theme active (persisted offline)"
                            : "Light theme active (persisted offline)"}
                        </Text>
                      </View>
                      <Switch
                        value={isDark}
                        onValueChange={toggleTheme}
                        trackColor={{ false: "#CBD5E1", true: "#3B82F6" }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                  </View>
                )}

                {/* ── Expanded: Delete Account ── */}
                {isExpanded && item.id === "delete" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: "#FEF2F2" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: "#991B1B" }]}>
                      Are you sure?
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: "#991B1B",
                        marginBottom: 12,
                        lineHeight: 18,
                      }}
                    >
                      Deleting your account is permanent. All your assets, vault
                      holdings, and escrow history will be lost.
                    </Text>

                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: "#7F1D1D",
                          borderColor: "#FCA5A5",
                          backgroundColor: "#FFFFFF",
                          fontWeight: "700",
                        },
                      ]}
                      placeholder='Type "DELETE" to confirm'
                      placeholderTextColor="#F87171"
                      autoCapitalize="characters"
                      value={deleteConfirmText}
                      onChangeText={setDeleteConfirmText}
                    />

                    <TouchableOpacity
                      style={[
                        styles.saveBtn,
                        {
                          backgroundColor:
                            deleteConfirmText.trim().toUpperCase() === "DELETE"
                              ? "#DC2626"
                              : "#FCA5A5",
                        },
                      ]}
                      onPress={handleDeleteAccount}
                      disabled={
                        deletingAccount ||
                        deleteConfirmText.trim().toUpperCase() !== "DELETE"
                      }
                    >
                      {deletingAccount ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text
                          style={[styles.saveBtnText, { color: "#FFFFFF" }]}
                        >
                          Confirm Deletion
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          {/* ── Log Out Button ── */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#10B981" />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  scroll: {
    paddingBottom: 40,
  },
  userInfoWrap: {
    alignItems: "center",
    marginBottom: 32,
    marginTop: 18,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#1E293B",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    position: "relative",
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 40,
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#3B82F6",
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#0A1120",
  },
  userName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 13,
    color: "#94A3B8",
  },
  menuContainer: {
    marginHorizontal: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
  },
  menuItemWrap: {},
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  menuItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuItemLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingTop: 4,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 10,
    marginTop: 8,
  },
  inputWrap: {
    position: "relative",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 12,
  },
  inputIcon: {
    position: "absolute",
    right: 14,
    top: 14,
  },
  rowInputs: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  saveBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  tosBox: {
    backgroundColor: "#FFFFFF",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 8,
  },
  catRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  catBtn: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  ticketBox: {
    backgroundColor: "#FFFFFF",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 6,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginTop: 8,
    gap: 12,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#10B981",
  },
  walletCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  walletHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  walletTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  walletIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0, 251, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  walletCardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  walletCardSubtitle: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 2,
  },
  networkBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  networkPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
  },
  networkBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#10B981",
  },
  walletConnectedContent: {
    marginTop: 4,
  },
  addressDisplayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  addressMonoText: {
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontSize: 13,
    fontWeight: "600",
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  walletWarningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.25)",
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  walletWarningText: {
    fontSize: 12,
    color: "#FCD34D",
    flex: 1,
    lineHeight: 16,
  },
  walletActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  unlinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  unlinkBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#EF4444",
  },
  walletUnconnectedContent: {
    marginTop: 6,
  },
  walletEmptyDesc: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 18,
    marginBottom: 12,
  },
  connectWalletBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    borderRadius: 10,
  },
  connectWalletBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
