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
  uploadVerificationDocApi,
  getVerificationStatusApi,
  getNotificationPreferencesApi,
  updateNotificationPreferencesApi,
} from "../services/api";
import useLinkedWallet from "../hooks/useLinkedWallet";
import InstallMetaMaskModal from "../components/InstallMetaMaskModal";
import CrossPlatformDialog from "../components/CrossPlatformDialog";
import storage, { STORAGE_KEYS } from "../utils/storage";
import { SCREENS } from "../constants/navigation";

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
  const { user, token, logout, updateUser } = useAuth();
  const { isDark, toggleTheme, setIsDark } = themeContext;

  // When navigated with makeDark or user requests dark mode on entering profile
  useEffect(() => {
    if (route?.params?.makeDark) {
      setIsDark?.(true);
      navigation?.setParams?.({ makeDark: undefined });
    }
  }, [route?.params?.makeDark, setIsDark, navigation]);

  // Web3 Linked Wallet Hook
  const {
    linkedWallet,
    activeMetaMaskAccount,
    isMismatch,
    isSepolia,
    loading: walletActionLoading,
    installModalVisible,
    setInstallModalVisible,
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

  // ── Cross-Platform Confirmation & Feedback Dialog State ────────────────────
  const [dialog, setDialog] = useState({
    visible: false,
    title: "",
    message: "",
    type: "default",
    isConfirm: false,
    confirmText: "Confirm",
    cancelText: "Cancel",
    isDestructive: false,
    loading: false,
    onConfirm: null,
    onCancel: null,
    children: null,
  });

  const showAlert = ({ title, message, type = "info", onDismiss }) => {
    setDialog({
      visible: true,
      title,
      message,
      type,
      isConfirm: false,
      confirmText: "OK",
      cancelText: "Cancel",
      isDestructive: false,
      loading: false,
      onConfirm: () => {
        setDialog((d) => ({ ...d, visible: false }));
        if (onDismiss) onDismiss();
      },
      onCancel: () => {
        setDialog((d) => ({ ...d, visible: false }));
        if (onDismiss) onDismiss();
      },
      children: null,
    });
  };

  const showConfirm = ({
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDestructive = false,
    onConfirm,
    onCancel,
    children = null,
  }) => {
    setDialog({
      visible: true,
      title,
      message,
      type: isDestructive ? "error" : "default",
      isConfirm: true,
      confirmText,
      cancelText,
      isDestructive,
      loading: false,
      onConfirm,
      onCancel: onCancel || (() => setDialog((d) => ({ ...d, visible: false }))),
      children,
    });
  };

  const [loggingOut, setLoggingOut] = useState(false);
  const [uploadingDocSlot, setUploadingDocSlot] = useState(null);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [savingNotifKey, setSavingNotifKey] = useState(null);

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

  // Load and synchronize notification preferences from local storage and backend
  useEffect(() => {
    async function loadNotificationPrefs() {
      try {
        setLoadingNotifs(true);
        const cached = await storage.getJSON(STORAGE_KEYS.NOTIFICATION_PREFERENCES);
        if (cached && typeof cached === "object") {
          setNotifications((prev) => ({ ...prev, ...cached }));
        }

        if (token) {
          const res = await getNotificationPreferencesApi(token);
          if (res?.success && res.preferences) {
            setNotifications(res.preferences);
            await storage.setJSON(STORAGE_KEYS.NOTIFICATION_PREFERENCES, res.preferences);
          }
        }
      } catch (e) {
        console.warn("[ProfileScreen] Error loading notification preferences:", e.message);
      } finally {
        setLoadingNotifs(false);
      }
    }
    loadNotificationPrefs();
  }, [token]);

  // ── Back Navigation Handler ──
  const handleBack = () => {
    if (navigation && typeof navigation.canGoBack === "function" && navigation.canGoBack()) {
      navigation.goBack();
    } else if (navigation) {
      navigation.navigate(SCREENS.HOME);
    }
  };

  // ── Photo / Avatar Upload Handler ──
  const handlePickAvatar = () => {
    if (Platform.OS === "web") {
      pickFromLibrary();
    } else {
      showConfirm({
        title: "Profile Photo",
        message: "Choose how you want to update your profile photo:",
        confirmText: "Choose from Library",
        cancelText: "Take Photo",
        onConfirm: () => {
          setDialog((d) => ({ ...d, visible: false }));
          pickFromLibrary();
        },
        onCancel: () => {
          setDialog((d) => ({ ...d, visible: false }));
          capturePhoto();
        },
      });
    }
  };

  const capturePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        showAlert({
          title: "Permission Required",
          message: "Camera access is needed to capture a profile photo.",
          type: "warning",
        });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        await uploadAvatar(result.assets[0]);
      }
    } catch (err) {
      showAlert({
        title: "Camera Error",
        message: err.message || "Could not launch camera.",
        type: "error",
      });
    }
  };

  const pickFromLibrary = async () => {
    try {
      if (Platform.OS !== "web") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          showAlert({
            title: "Permission Required",
            message: "Photo library access is needed to pick an avatar.",
            type: "warning",
          });
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        await uploadAvatar(result.assets[0]);
      }
    } catch (err) {
      console.error("pickFromLibrary error:", err);
      showAlert({
        title: "Library Error",
        message: err.message || "Could not select photo.",
        type: "error",
      });
    }
  };

  /**
   * Converts an ImagePicker asset to a data:image URI string.
   */
  const assetToDataUri = async (asset) => {
    if (asset.base64) {
      if (asset.base64.startsWith("data:")) {
        return asset.base64;
      }
      return `data:image/jpeg;base64,${asset.base64}`;
    }

    if (asset.uri && asset.uri.startsWith("data:")) {
      return asset.uri;
    }

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
        console.warn("assetToDataUri fallback failed:", err);
        return asset.uri;
      }
    }

    return null;
  };

  const uploadAvatar = async (asset) => {
    const previousAvatar = user?.avatarUrl || user?.avatar_url || null;
    try {
      setUploadingAvatar(true);

      const dataUri = await assetToDataUri(asset);
      if (!dataUri) {
        throw new Error("Could not process the selected image. Please try again.");
      }

      // Validate image size (max 5 MB)
      const base64Part = dataUri.split(",")[1] || "";
      const approxBytes = base64Part.length * 0.75;
      if (approxBytes > 5 * 1024 * 1024) {
        throw new Error("Avatar image size must be under 5 MB.");
      }

      // Optimistically show the new avatar
      updateUser({ avatarUrl: dataUri, avatar_url: dataUri });

      // Send to backend
      const res = await updateUserProfileApi({ avatarUrl: dataUri }, token);
      if (res?.success) {
        const saved = res?.user?.avatarUrl || res?.user?.avatar_url || dataUri;
        updateUser({ avatarUrl: saved, avatar_url: saved });
        showAlert({
          title: "Avatar Updated",
          message: "Your profile photo has been saved to your account.",
          type: "success",
        });
      } else {
        // Roll back on failure
        updateUser({ avatarUrl: previousAvatar, avatar_url: previousAvatar });
        showAlert({
          title: "Upload Failed",
          message: res?.error || "Could not save photo to server. Your previous photo was restored.",
          type: "error",
        });
      }
    } catch (err) {
      console.error("Avatar upload failed:", err);
      updateUser({ avatarUrl: previousAvatar, avatar_url: previousAvatar });
      showAlert({
        title: "Upload Notice",
        message: err.message || "Could not save photo to server. Your previous photo was restored.",
        type: "error",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ── Save Profile Details ──
  const handleSaveProfile = async () => {
    if (savingProfile) return;
    if (!form.fullName.trim()) {
      showAlert({
        title: "Validation",
        message: "Please enter your full name.",
        type: "warning",
      });
      return;
    }

    try {
      setSavingProfile(true);
      const res = await updateUserProfileApi(
        {
          fullName: form.fullName.trim(),
          gender: form.gender.trim(),
          dob: form.dob.trim(),
          phone: form.phone.trim(),
          password: form.password ? form.password : undefined,
        },
        token,
      );

      if (res?.success) {
        updateUser({
          fullName: form.fullName.trim(),
          gender: form.gender.trim(),
          dob: form.dob.trim(),
          phone: form.phone.trim(),
        });
        setForm((prev) => ({ ...prev, password: "" }));
        showAlert({
          title: "Success",
          message: "Your profile details have been saved.",
          type: "success",
        });
        toggleSection(null);
      } else {
        showAlert({
          title: "Error",
          message: res?.error || "Could not update profile.",
          type: "error",
        });
      }
    } catch (err) {
      showAlert({
        title: "Error",
        message: err.message || "Failed to update profile.",
        type: "error",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  // ── SmartAssets FICA / KYC Document Picker & Server-Side Upload ──
  const pickKycDocument = async (field, docType, label) => {
    if (uploadingDocSlot) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const dataUri = await assetToDataUri(asset);
        if (!dataUri) {
          throw new Error("Could not process the selected document file.");
        }

        // Validate size (max 10MB)
        const base64Part = dataUri.split(",")[1] || "";
        const sizeBytes = base64Part.length * 0.75;
        if (sizeBytes > 10 * 1024 * 1024) {
          throw new Error("Document file exceeds the maximum size limit of 10 MB.");
        }

        // Validate MIME type
        const mimeMatch = dataUri.match(/^data:([\w/+.-]+);base64,/);
        const mime = mimeMatch ? mimeMatch[1].toLowerCase() : "";
        const validMimes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
          "application/pdf",
        ];
        if (mime && !validMimes.includes(mime)) {
          throw new Error("Invalid file format. Please upload a genuine JPG, PNG, WEBP, or PDF file.");
        }

        setUploadingDocSlot(docType);

        // Upload through protected verification endpoint
        const uploadRes = await uploadVerificationDocApi(
          {
            docType,
            fileData: dataUri,
            fileName: asset.fileName || `${docType}_document.jpg`,
            mimeType: mime || "image/jpeg",
          },
          token,
        );

        if (uploadRes?.success) {
          const docRecord = uploadRes.document || {};
          const durableRef =
            docRecord.file_path || docRecord.storage_bucket_path || docRecord.id || `${docType}_uploaded`;
          setKycForm((prev) => ({
            ...prev,
            [field]: durableRef,
            [`${docType}Attached`]: true,
            [`${docType}Name`]: asset.fileName || `${label} Uploaded`,
          }));
          showAlert({
            title: "Document Uploaded",
            message: `${label} uploaded and registered with the compliance review desk.`,
            type: "success",
          });
        } else {
          throw new Error(uploadRes?.error || "Failed to upload verification document.");
        }
      }
    } catch (err) {
      showAlert({
        title: "Document Upload Error",
        message: err.message || "Could not upload document.",
        type: "error",
      });
    } finally {
      setUploadingDocSlot(null);
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
    if (submittingKyc) return;
    if (!kycForm.idNumber.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please provide your SA ID or Passport Number.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.idDocumentUrl) {
      showAlert({
        title: "Required Document",
        message: "Please upload your Government ID or Passport photo/scan.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.taxNumber.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please provide your SARS Tax Reference Number.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.taxDocumentUrl) {
      showAlert({
        title: "Required Document",
        message: "Please upload your SARS Notice or Tax Certificate.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.residentialAddress.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please provide your Physical Residential Address.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.proofOfResidenceUrl) {
      showAlert({
        title: "Required Document",
        message: "Please upload your Utility Bill or Bank Statement as Proof of Residence.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.bankName) {
      showAlert({
        title: "Required Field",
        message: "Please select your South African bank.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.accountHolder.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please enter your Account Holder Name.",
        type: "warning",
      });
      return;
    }
    const cleanKycAcc = (kycForm.accountNumber || "").replace(/\s+/g, "");
    if (!/^\d{8,12}$/.test(cleanKycAcc)) {
      showAlert({
        title: "Invalid Account Number",
        message: "Bank account number must be between 8 and 12 digits.",
        type: "warning",
      });
      return;
    }
    if (!kycForm.branchCode.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please enter the Branch Code.",
        type: "warning",
      });
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
        // Fetch fresh authoritative status from server
        let freshStatus = "pending";
        try {
          const fresh = await getVerificationStatusApi(token);
          if (fresh?.verification_status) {
            freshStatus = fresh.verification_status;
          }
        } catch (_) {}

        setKycStatus(freshStatus);
        updateUser({
          kycStatus: freshStatus,
          verification_status: freshStatus,
          bankingDetails: payload.bankingDetails,
        });

        showAlert({
          title: "Compliance Pack Submitted",
          message: "Your FICA identity documents and verified banking details are in the Admin Operations review queue. You will be cleared to transact upon approval.",
          type: "success",
        });
      } else {
        showAlert({
          title: "Submission Notice",
          message: res?.error || "KYC submission failed. Please verify your details.",
          type: "error",
        });
      }
    } catch (err) {
      showAlert({
        title: "Submission Error",
        message: err.message || "Failed to submit KYC compliance pack.",
        type: "error",
      });
    } finally {
      setSubmittingKyc(false);
    }
  };

  // ── Toggle Notification Preference Handler ──
  const handleToggleNotification = async (key, val) => {
    const prev = { ...notifications };
    const next = { ...notifications, [key]: val };
    setNotifications(next);
    setSavingNotifKey(key);

    try {
      await storage.setJSON(STORAGE_KEYS.NOTIFICATION_PREFERENCES, next);
      if (token) {
        const res = await updateNotificationPreferencesApi(next, token);
        if (!res?.success) {
          throw new Error(res?.error || "Failed to save preference.");
        }
      }
    } catch (err) {
      // Rollback
      setNotifications(prev);
      await storage.setJSON(STORAGE_KEYS.NOTIFICATION_PREFERENCES, prev);
      showAlert({
        title: "Save Failed",
        message: "Could not save notification preference to server. Reverted.",
        type: "error",
      });
    } finally {
      setSavingNotifKey(null);
    }
  };

  // ── Lodge Support Ticket ──
  const handleLodgeSupport = async () => {
    if (submittingSupport) return;
    if (!supportSubject.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please provide a subject for your support inquiry.",
        type: "warning",
      });
      return;
    }
    if (!supportMessage.trim()) {
      showAlert({
        title: "Required Field",
        message: "Please provide message details for your inquiry.",
        type: "warning",
      });
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
        showAlert({
          title: "Ticket Lodged",
          message: `Reference: ${res.ticket.id}\n\nOur concierge desk has received your inquiry and will reply within 2-4 hours.`,
          type: "success",
        });
      } else {
        showAlert({
          title: "Support Notice",
          message: res?.error || "Could not lodge support inquiry.",
          type: "error",
        });
      }
    } catch (err) {
      showAlert({
        title: "Support Error",
        message: err.message || "Failed to lodge support ticket.",
        type: "error",
      });
    } finally {
      setSubmittingSupport(false);
    }
  };

  // ── Delete Account ──
  const handleDeleteAccount = () => {
    if (deletingAccount) return;
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      showAlert({
        title: "Confirmation Required",
        message: 'Please type "DELETE" into the box to authorize account deletion.',
        type: "warning",
      });
      return;
    }

    showConfirm({
      title: "Confirm Account Deletion",
      message: "Are you absolutely sure? All your assets, vault holdings, and account history will be permanently deleted.",
      confirmText: "Yes, Delete Account",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          setDialog((d) => ({ ...d, loading: true }));
          setDeletingAccount(true);
          const res = await deleteAccountApi(token);
          if (res?.success) {
            setDialog((d) => ({ ...d, visible: false, loading: false }));
            showAlert({
              title: "Account Deleted",
              message: "Your account and personal data have been permanently removed.",
              type: "success",
              onDismiss: () => logout(),
            });
          } else {
            // NEVER log out if deletion was unsuccessful! Keep the user signed in and explain failure.
            setDialog((d) => ({ ...d, visible: false, loading: false }));
            showAlert({
              title: "Delete Error",
              message: res?.error || "Could not delete account. Please contact compliance support.",
              type: "error",
            });
          }
        } catch (err) {
          setDialog((d) => ({ ...d, visible: false, loading: false }));
          showAlert({
            title: "Delete Error",
            message: err.message || "Could not delete account.",
            type: "error",
          });
        } finally {
          setDeletingAccount(false);
        }
      },
    });
  };

  const handleLogout = () => {
    if (loggingOut) return;
    showConfirm({
      title: "Log Out",
      message: "Are you sure you want to log out of your SmartAssets account?",
      confirmText: "Log Out",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          setDialog((d) => ({ ...d, loading: true }));
          setLoggingOut(true);
          await logout();
          setDialog((d) => ({ ...d, visible: false, loading: false }));
        } catch (err) {
          setDialog((d) => ({ ...d, visible: false, loading: false }));
          showAlert({
            title: "Logout Error",
            message: err?.message || "Failed to log out. Please try again.",
            type: "error",
          });
        } finally {
          setLoggingOut(false);
        }
      },
    });
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
    } catch (_) {
      showAlert({
        title: "Wallet Address",
        message: linkedWallet,
        type: "info",
      });
    }
  };

  const handleDisconnectWallet = () => {
    if (walletActionLoading) return;
    showConfirm({
      title: "Disconnect Wallet",
      message: "Are you sure you want to unlink this wallet from your profile? You will need to link a wallet again to sign smart contract transactions.",
      confirmText: "Disconnect",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        try {
          setDialog((d) => ({ ...d, loading: true }));
          await unlinkWallet({ silent: true });
          setDialog((d) => ({ ...d, visible: false, loading: false }));
          showAlert({
            title: "Wallet Disconnected",
            message: "Your Web3 wallet has been unlinked from your profile.",
            type: "success",
          });
        } catch (err) {
          setDialog((d) => ({ ...d, visible: false, loading: false }));
          showAlert({
            title: "Error Disconnecting",
            message: err.message || "Failed to unlink wallet.",
            type: "error",
          });
        }
      },
    });
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
      id: "delete",
      label: "Delete Account",
      icon: "trash-2",
      bgColor: "#FECACA",
      textColor: "#7F1D1D",
    },
  ];

  const cardBg = isDark ? "#131A2F" : "#FFFFFF";
  const itemBorder = isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0";
  const textPrimary = isDark ? "#F8FAFC" : "#0F172A";
  const textSecondary = isDark ? "#94A3B8" : "#64748B";
  const textHeading = isDark ? "#93C5FD" : "#334155";
  const expandedBg = isDark ? "#0B1120" : "#F8FAFC";
  const inputBg = isDark ? "#1E293B" : "#FFFFFF";
  const inputBorder = isDark ? "rgba(255,255,255,0.12)" : "#E2E8F0";
  const inputTextColor = isDark ? "#F8FAFC" : "#0F172A";
  const placeholderColor = isDark ? "#64748B" : "#94A3B8";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: isDark ? "#0A0E1A" : "#F8FAFC" }]}>
      {/* ── Header with Title & Theme Toggle ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
        >
          <Feather
            name="chevron-left"
            size={24}
            color={isDark ? "#FFFFFF" : "#0F172A"}
          />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: isDark ? "#FFFFFF" : "#0F172A" }]}>Profile</Text>
        <TouchableOpacity
          onPress={toggleTheme}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.06)",
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(15,23,42,0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
          activeOpacity={0.8}
        >
          <Feather name={isDark ? "sun" : "moon"} size={18} color={isDark ? "#FBBF24" : "#475569"} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── User Avatar & Info ── */}
        <View style={styles.userInfoWrap}>
          <TouchableOpacity
            style={[
              styles.avatarCircle,
              {
                backgroundColor: isDark ? "#1E293B" : "#F1F5F9",
                borderColor: isDark ? "rgba(0,194,255,0.4)" : "#E2E8F0",
                borderWidth: 2,
              },
            ]}
            onPress={handlePickAvatar}
            activeOpacity={0.85}
          >
            {uploadingAvatar ? (
              <ActivityIndicator color="#3B82F6" size="small" />
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <Feather
                name="user"
                size={32}
                color={isDark ? "#00C2FF" : "#475569"}
              />
            )}
            <View style={styles.avatarCameraBadge}>
              <Feather name="camera" size={12} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.userName, { color: isDark ? "#FFFFFF" : "#0F172A" }]}>{displayName}</Text>
          <Text style={[styles.userEmail, { color: isDark ? "#94A3B8" : "#64748B" }]}>{displayEmail}</Text>
        </View>

        {/* ── OFFLINE BANNER ── */}
        <OfflineBanner
          isDark={isDark}
          message="Offline Mode — Showing saved profile data."
          style={{ marginBottom: 16, marginHorizontal: 20 }}
        />

        {/* ── Persistent Account Verification & Bank Approval Hub ── */}
        <View
          style={{
            backgroundColor: isDark ? "#131A2F" : "#FFFFFF",
            borderRadius: 20,
            padding: 16,
            marginBottom: 16,
            marginHorizontal: 20,
            borderWidth: 1.2,
            borderColor:
              kycStatus === "verified"
                ? "rgba(16, 185, 129, 0.4)"
                : "rgba(124, 92, 252, 0.45)",
            shadowColor: "#312E81",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.08,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  backgroundColor:
                    kycStatus === "verified"
                      ? "rgba(16, 185, 129, 0.15)"
                      : "rgba(124, 92, 252, 0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={kycStatus === "verified" ? "checkmark-done-circle" : "shield-checkmark-outline"}
                  size={20}
                  color={kycStatus === "verified" ? "#10B981" : "#7C5CFC"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: isDark ? "#F8FAFC" : "#0F172A" }}>
                  {kycStatus === "verified" ? "Account Verified (3/3 Docs)" : "Complete your verification"}
                </Text>
                <Text style={{ fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
                  {kycStatus === "verified"
                    ? "Authorized to list items and deposit funds"
                    : "Required to list items, deposit, or withdraw funds"}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <TouchableOpacity
              onPress={() => navigation?.navigate?.(SCREENS.VERIFY_ACCOUNT)}
              style={{
                flex: 1,
                backgroundColor: "#7C5CFC",
                paddingVertical: 11,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 6,
              }}
            >
              <Ionicons name="document-attach-outline" size={16} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: "800" }}>
                Verify Account (3 Docs)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation?.navigate?.(SCREENS.BANK_DETAILS)}
              style={{
                flex: 1,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#EDE9FE",
                paddingVertical: 11,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 6,
              }}
            >
              <Ionicons name="card-outline" size={16} color="#7C5CFC" />
              <Text style={{ color: "#7C5CFC", fontSize: 12.5, fontWeight: "800" }}>
                Bank Details
              </Text>
            </TouchableOpacity>
          </View>
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

        {/* ── Menu List ── */}
        <View
          style={[
            styles.menuContainer,
            {
              backgroundColor: isDark ? "#131A2F" : "#FFFFFF",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0",
            },
          ]}
        >
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
                      borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "#F1F5F9",
                    },
                  ]}
                >
                  <View style={styles.menuItemLeft}>
                    <Feather
                      name={item.icon}
                      size={18}
                      color={isDark ? (item.id === "delete" ? "#F87171" : "#38BDF8") : item.textColor}
                    />
                    <Text style={[styles.menuItemLabel, { color: isDark ? "#F8FAFC" : "#1E293B" }]}>
                      {item.label}
                    </Text>
                  </View>
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={isDark ? "#94A3B8" : "#94A3B8"}
                    style={{ opacity: 0.6 }}
                  />
                </TouchableOpacity>

                {/* ── Expanded: FICA / KYC & Banking Verification ── */}
                {isExpanded && item.id === "kyc" && (
                  <View style={[styles.expandedContent, { backgroundColor: isDark ? "#0B1120" : "#F8FAFC" }]}>
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
                            ? "FICA Verified Investor"
                            : kycStatus === "pending"
                            ? "Pending Admin Compliance Review"
                            : kycStatus === "rejected"
                            ? "Compliance Dossier Rejected"
                            : "Unverified Investor Account"}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: textSecondary, lineHeight: 18 }}>
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
                    <Text style={[styles.sectionHeading, { color: textHeading }]}>
                      1. Required FICA Identity Documents
                    </Text>

                    {/* SA ID / Passport */}
                    <Text style={{ fontSize: 12, fontWeight: "700", color: textSecondary, marginBottom: 6 }}>
                      Government ID / Passport Number (Required)
                    </Text>
                    <TextInput
                      style={[styles.input, { color: inputTextColor, borderColor: inputBorder, backgroundColor: inputBg }]}
                      placeholder="e.g. 9001015009087 or ZA Passport"
                      placeholderTextColor={placeholderColor}
                      value={kycForm.idNumber}
                      onChangeText={(v) => setKycForm({ ...kycForm, idNumber: v })}
                    />
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => pickKycDocument("idDocumentUrl", "id", "ID Document")}
                      disabled={uploadingDocSlot === "id"}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        backgroundColor: inputBg,
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: kycForm.idDocumentUrl ? "#10B981" : inputBorder,
                        borderStyle: kycForm.idDocumentUrl ? "solid" : "dashed",
                        marginBottom: 14,
                      }}
                    >
                      {uploadingDocSlot === "id" ? (
                        <>
                          <ActivityIndicator size="small" color="#2563EB" />
                          <Text style={{ fontSize: 12, fontWeight: "600", color: "#2563EB" }}>
                            Uploading and verifying ID Document...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Feather name={kycForm.idDocumentUrl ? "check-circle" : "upload"} size={16} color={kycForm.idDocumentUrl ? "#10B981" : (isDark ? "#60A5FA" : "#2563EB")} />
                          <Text style={{ fontSize: 12, fontWeight: "600", color: kycForm.idDocumentUrl ? "#10B981" : (isDark ? "#60A5FA" : "#2563EB") }}>
                            {kycForm.idDocumentUrl ? "ID Document Attached (Server Verified — Tap to replace)" : "Upload ID Document Photo / Scan (Required)"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* SARS Tax Reference */}
                    <Text style={{ fontSize: 12, fontWeight: "700", color: textSecondary, marginBottom: 6 }}>
                      SARS Tax Reference Number (Required)
                    </Text>
                    <TextInput
                      style={[styles.input, { color: inputTextColor, borderColor: inputBorder, backgroundColor: inputBg }]}
                      placeholder="e.g. 9123456789"
                      placeholderTextColor={placeholderColor}
                      value={kycForm.taxNumber}
                      onChangeText={(v) => setKycForm({ ...kycForm, taxNumber: v })}
                    />
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => pickKycDocument("taxDocumentUrl", "tax", "SARS Tax Notice")}
                      disabled={uploadingDocSlot === "tax"}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        backgroundColor: inputBg,
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: kycForm.taxDocumentUrl ? "#10B981" : inputBorder,
                        borderStyle: kycForm.taxDocumentUrl ? "solid" : "dashed",
                        marginBottom: 14,
                      }}
                    >
                      {uploadingDocSlot === "tax" ? (
                        <>
                          <ActivityIndicator size="small" color="#2563EB" />
                          <Text style={{ fontSize: 12, fontWeight: "600", color: "#2563EB" }}>
                            Uploading and verifying SARS Tax Notice...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Feather name={kycForm.taxDocumentUrl ? "check-circle" : "upload"} size={16} color={kycForm.taxDocumentUrl ? "#10B981" : (isDark ? "#60A5FA" : "#2563EB")} />
                          <Text style={{ fontSize: 12, fontWeight: "600", color: kycForm.taxDocumentUrl ? "#10B981" : (isDark ? "#60A5FA" : "#2563EB") }}>
                            {kycForm.taxDocumentUrl ? "Tax Notice Attached (Server Verified — Tap to replace)" : "Upload SARS Notice / Certificate (Required)"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* Proof of Residence */}
                    <Text style={{ fontSize: 12, fontWeight: "700", color: textSecondary, marginBottom: 6 }}>
                      Physical Residential Address (Required)
                    </Text>
                    <TextInput
                      style={[styles.input, { color: inputTextColor, borderColor: inputBorder, backgroundColor: inputBg }]}
                      placeholder="Street address, suburb, city, postal code"
                      placeholderTextColor={placeholderColor}
                      value={kycForm.residentialAddress}
                      onChangeText={(v) => setKycForm({ ...kycForm, residentialAddress: v })}
                    />
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => pickKycDocument("proofOfResidenceUrl", "proof_of_residence", "Utility Bill / Statement")}
                      disabled={uploadingDocSlot === "proof_of_residence"}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        backgroundColor: inputBg,
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: kycForm.proofOfResidenceUrl ? "#10B981" : inputBorder,
                        borderStyle: kycForm.proofOfResidenceUrl ? "solid" : "dashed",
                        marginBottom: 20,
                      }}
                    >
                      {uploadingDocSlot === "proof_of_residence" ? (
                        <>
                          <ActivityIndicator size="small" color="#2563EB" />
                          <Text style={{ fontSize: 12, fontWeight: "600", color: "#2563EB" }}>
                            Uploading and verifying Proof of Residence...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Feather name={kycForm.proofOfResidenceUrl ? "check-circle" : "upload"} size={16} color={kycForm.proofOfResidenceUrl ? "#10B981" : (isDark ? "#60A5FA" : "#2563EB")} />
                          <Text style={{ fontSize: 12, fontWeight: "600", color: kycForm.proofOfResidenceUrl ? "#10B981" : (isDark ? "#60A5FA" : "#2563EB") }}>
                            {kycForm.proofOfResidenceUrl ? "Utility Bill Attached (Server Verified — Tap to replace)" : "Upload Utility Bill / Bank Statement (< 3 months) (Required)"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* Section 2: Verified Banking Details */}
                    <Text style={[styles.sectionHeading, { color: textHeading }]}>
                      2. Verified South African Banking Details
                    </Text>
                    <Text style={{ fontSize: 12, color: textSecondary, marginBottom: 10 }}>
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
                              backgroundColor: isSelected ? "#2563EB" : inputBg,
                              borderWidth: 1,
                              borderColor: isSelected ? "#2563EB" : inputBorder,
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "700", color: isSelected ? "#FFFFFF" : textPrimary }}>
                              {bank.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={{ fontSize: 12, fontWeight: "700", color: textSecondary, marginBottom: 6 }}>
                      Account Holder Name
                    </Text>
                    <TextInput
                      style={[styles.input, { color: inputTextColor, borderColor: inputBorder, backgroundColor: inputBg }]}
                      placeholder="Account Holder Full Name"
                      placeholderTextColor={placeholderColor}
                      value={kycForm.accountHolder}
                      onChangeText={(v) => setKycForm({ ...kycForm, accountHolder: v })}
                    />

                    <View style={styles.rowInputs}>
                      <View style={[styles.inputWrap, { flex: 2, marginRight: 8 }]}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: textSecondary, marginBottom: 6 }}>
                          Account Number
                        </Text>
                        <TextInput
                          style={[styles.input, { color: inputTextColor, borderColor: inputBorder, backgroundColor: inputBg }]}
                          placeholder="e.g. 62819203918"
                          placeholderTextColor={placeholderColor}
                          keyboardType="number-pad"
                          maxLength={12}
                          value={kycForm.accountNumber}
                          onChangeText={(v) => setKycForm({ ...kycForm, accountNumber: v.replace(/[^0-9]/g, "") })}
                        />
                      </View>
                      <View style={[styles.inputWrap, { flex: 1 }]}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: textSecondary, marginBottom: 6 }}>
                          Branch Code
                        </Text>
                        <TextInput
                          style={[styles.input, { color: inputTextColor, borderColor: inputBorder, backgroundColor: inputBg }]}
                          placeholder="250655"
                          placeholderTextColor={placeholderColor}
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
                      { backgroundColor: expandedBg },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: textHeading }]}>
                      Personal
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: inputTextColor,
                          borderColor: inputBorder,
                          backgroundColor: inputBg,
                        },
                      ]}
                      placeholder="Full Name"
                      placeholderTextColor={placeholderColor}
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
                              color: inputTextColor,
                              borderColor: inputBorder,
                              backgroundColor: inputBg,
                            },
                          ]}
                          placeholder="Gender"
                          placeholderTextColor={placeholderColor}
                          value={form.gender}
                          onChangeText={(v) => setForm({ ...form, gender: v })}
                        />
                        <Feather
                          name="users"
                          size={14}
                          color={placeholderColor}
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
                              color: inputTextColor,
                              borderColor: inputBorder,
                              backgroundColor: inputBg,
                            },
                          ]}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={placeholderColor}
                          value={form.dob}
                          onChangeText={(v) => setForm({ ...form, dob: v })}
                        />
                        <Feather
                          name="calendar"
                          size={14}
                          color={placeholderColor}
                          style={styles.inputIcon}
                        />
                      </View>
                    </View>

                    <Text
                      style={[
                        styles.sectionHeading,
                        { color: textHeading, marginTop: 12 },
                      ]}
                    >
                      Email and password
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: textSecondary,
                          borderColor: inputBorder,
                          backgroundColor: isDark ? "#0F172A" : "#F1F5F9",
                        },
                      ]}
                      placeholder="Email"
                      placeholderTextColor={placeholderColor}
                      value={form.email}
                      editable={false}
                      keyboardType="email-address"
                    />
                    <View style={styles.inputWrap}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            color: inputTextColor,
                            borderColor: inputBorder,
                            backgroundColor: inputBg,
                          },
                        ]}
                        placeholder="New Password (optional)"
                        placeholderTextColor={placeholderColor}
                        secureTextEntry
                        value={form.password}
                        onChangeText={(v) => setForm({ ...form, password: v })}
                      />
                      <Feather
                        name="eye-off"
                        size={14}
                        color={placeholderColor}
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
                      { backgroundColor: expandedBg },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={[styles.sectionHeading, { color: textHeading, marginBottom: 0 }]}>
                        Notification Preferences
                      </Text>
                      {loadingNotifs && <ActivityIndicator size="small" color="#3B82F6" />}
                    </View>
                    <Text style={{ fontSize: 11.5, color: textSecondary, marginBottom: 14 }}>
                      Preferences are synchronized to your account and active across all your devices.
                    </Text>
                    {[
                      {
                        key: "escrowAlerts",
                        title: "Smart Contract Escrow Alerts",
                        sub: "Real-time updates on courier transit, appraisal, and fund release",
                      },
                      {
                        key: "priceAlerts",
                        title: "Price Movement & Appraisals",
                        sub: "Valuation adjustments for your vault holdings and watchlists",
                      },
                      {
                        key: "securityAlerts",
                        title: "Security & Login Alerts",
                        sub: "Notices on new session, password change, or wallet authorization",
                      },
                      {
                        key: "marketing",
                        title: "Luxury Offering Drops",
                        sub: "Invitations when rare verified assets are minted or listed",
                      },
                    ].map((n) => (
                      <View key={n.key} style={[styles.prefRow, { borderBottomColor: itemBorder }]}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "700",
                              color: textPrimary,
                            }}
                          >
                            {n.title}
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: textSecondary,
                              marginTop: 2,
                            }}
                          >
                            {n.sub}
                          </Text>
                        </View>
                        {savingNotifKey === n.key ? (
                          <ActivityIndicator size="small" color="#3B82F6" />
                        ) : (
                          <Switch
                            value={Boolean(notifications[n.key])}
                            onValueChange={(val) => handleToggleNotification(n.key, val)}
                            trackColor={{ false: "#CBD5E1", true: "#3B82F6" }}
                            thumbColor="#FFFFFF"
                          />
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Expanded: Terms of Service ── */}
                {isExpanded && item.id === "tos" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: expandedBg },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: textHeading }]}>
                      Terms of Service & Platform Policies (Informational)
                    </Text>
                    <Text style={{ fontSize: 12, color: textSecondary, marginBottom: 12, lineHeight: 18 }}>
                      The following operational policies govern escrow custody, anti-fraud rules, certified appraisals, and buyer rights on the SmartAssets network.
                    </Text>
                    {[
                      {
                        title: "Smart Contract Escrow",
                        text: "100% of purchase payments are held in escrow on Ethereum Sepolia until delivery and inspection pass verification.",
                      },
                      {
                        title: "Anti-Self-Dealing Policy",
                        text: "Users cannot purchase, bid on, or fractionally invest in items they listed. Fractional holdings are capped at 25% per investor.",
                      },
                      {
                        title: "Appraisal & Inspection Standards",
                        text: "Physical assets undergo appraisal by verified partner institutes with verifiable certificates issued upon delivery.",
                      },
                      {
                        title: "Buyer Refund Protection",
                        text: "If an item fails inspection or condition checks during transit, escrow funds are returned to the buyer according to platform resolution rules.",
                      },
                    ].map((t) => (
                      <View key={t.title} style={[styles.tosBox, { backgroundColor: inputBg, borderColor: itemBorder }]}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: textPrimary,
                          }}
                        >
                          {t.title}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            color: textSecondary,
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
                      { backgroundColor: expandedBg },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: textHeading }]}>
                      Lodge a Support Inquiry
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: textSecondary,
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
                            {
                              backgroundColor:
                                supportCategory === c
                                  ? isDark
                                    ? "#14532D"
                                    : "#BBF7D0"
                                  : inputBg,
                              borderColor:
                                supportCategory === c
                                  ? isDark
                                    ? "#22C55E"
                                    : "#14532D"
                                  : inputBorder,
                            },
                          ]}
                          onPress={() => setSupportCategory(c)}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              color:
                                supportCategory === c
                                  ? isDark
                                    ? "#86EFAC"
                                    : "#14532D"
                                  : textSecondary,
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
                          color: inputTextColor,
                          borderColor: inputBorder,
                          backgroundColor: inputBg,
                        },
                      ]}
                      placeholder="Subject (e.g. Escrow Inquiry #ORD-8921)"
                      placeholderTextColor={placeholderColor}
                      value={supportSubject}
                      onChangeText={setSupportSubject}
                    />

                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: inputTextColor,
                          borderColor: inputBorder,
                          backgroundColor: inputBg,
                          height: 72,
                          textAlignVertical: "top",
                        },
                      ]}
                      placeholder="Please describe your issue or question..."
                      placeholderTextColor={placeholderColor}
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
                            color: textHeading,
                            marginBottom: 6,
                          }}
                        >
                          Your Recent Tickets
                        </Text>
                        {supportTickets.slice(0, 3).map((ticket) => (
                          <View key={ticket.id} style={[styles.ticketBox, { backgroundColor: inputBg, borderColor: itemBorder }]}>
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
                                  color: textPrimary,
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
                                color: textSecondary,
                                marginTop: 2,
                              }}
                            >
                              {ticket.id} · {ticket.category} · Priority: {ticket.priority || 'Normal'}
                            </Text>
                            {(ticket.resolutionNote || ticket.adminResponse) && (
                              <View style={{ marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: isDark ? '#064E3B' : '#DCFCE7', borderWidth: 1, borderColor: isDark ? '#059669' : '#86EFAC' }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#6EE7B7' : '#15803D', marginBottom: 2 }}>
                                  Admin Resolution:
                                </Text>
                                <Text style={{ fontSize: 11, color: isDark ? '#A7F3D0' : '#166534', lineHeight: 16 }}>
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

                {/* ── Expanded: Delete Account ── */}
                {isExpanded && item.id === "delete" && (
                  <View
                    style={[
                      styles.expandedContent,
                      { backgroundColor: isDark ? "#2A0E0E" : "#FEF2F2" },
                    ]}
                  >
                    <Text style={[styles.sectionHeading, { color: isDark ? "#F87171" : "#991B1B" }]}>
                      Are you sure?
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: isDark ? "#FCA5A5" : "#991B1B",
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
                          color: "#EF4444",
                          borderColor: isDark ? "#7F1D1D" : "#FCA5A5",
                          backgroundColor: isDark ? "#1C0A0A" : "#FFFFFF",
                          fontWeight: "700",
                        },
                      ]}
                      placeholder='Type "DELETE" to confirm'
                      placeholderTextColor={isDark ? "#991B1B" : "#F87171"}
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
          <TouchableOpacity
            style={[styles.logoutBtn, loggingOut && { opacity: 0.6 }]}
            onPress={handleLogout}
            disabled={loggingOut}
            activeOpacity={0.8}
          >
            {loggingOut ? (
              <ActivityIndicator size="small" color="#10B981" />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={20} color="#10B981" />
                <Text style={styles.logoutText}>Log out</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Install MetaMask Modal (Friendly Mobile Install Screen) ── */}
      <InstallMetaMaskModal
        visible={installModalVisible}
        onClose={() => setInstallModalVisible(false)}
        onRetry={() => {
          setInstallModalVisible(false);
          linkWallet();
        }}
      />

      {/* ── Cross-Platform Confirmation & Feedback Dialog ── */}
      <CrossPlatformDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        isConfirm={dialog.isConfirm}
        confirmText={dialog.confirmText}
        cancelText={dialog.cancelText}
        isDestructive={dialog.isDestructive}
        loading={dialog.loading}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      >
        {dialog.children}
      </CrossPlatformDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0A0E1A",
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
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#312E81",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
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
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#312E81",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
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
