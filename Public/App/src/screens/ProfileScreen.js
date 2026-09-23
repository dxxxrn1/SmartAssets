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
import {
  getUserProfileApi,
  updateUserProfileApi,
  deleteAccountApi,
  lodgeSupportTicketApi,
  getUserSupportTicketsApi,
} from "../services/api";

export default function ProfileScreen({ navigation }) {
  const { user, token, logout, updateUser } = useAuth();

  // State to manage which accordion section is expanded
  const [expandedSection, setExpandedSection] = useState(null);

  // Form & Upload States
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [submittingSupport, setSubmittingSupport] = useState(false);

  const [form, setForm] = useState({
    fullName: user?.fullName || user?.name || "",
    gender: user?.gender || "",
    dob: user?.dob || "",
    email: user?.email || "",
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
  const [supportTickets, setSupportTickets] = useState([]);

  // Delete Account Confirmation
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const toggleSection = (section) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === section ? null : section);
  };

  // Load latest profile & tickets on mount
  useEffect(() => {
    if (token) {
      getUserProfileApi(token)
        .then((res) => {
          if (res?.success && res.profile) {
            const p = res.profile;
            setForm((prev) => ({
              ...prev,
              fullName: p.fullName || prev.fullName,
              gender: p.gender || prev.gender,
              dob: p.dob || prev.dob,
              email: p.email || prev.email,
            }));
            const effectiveAvatar = p.avatarUrl || p.avatar_url;
            if (effectiveAvatar) {
              updateUser({ avatarUrl: effectiveAvatar, avatar_url: effectiveAvatar, fullName: p.fullName });
            }
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
          text: "Take Photo 📸",
          onPress: () => capturePhoto(),
        },
        {
          text: "Choose from Library 🖼️",
          onPress: () => pickFromLibrary(),
        },
      ]);
    }
  };

  const capturePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Camera access is needed to capture a profile photo.");
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
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Photo library access is needed to pick an avatar.");
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
        console.warn("assetToDataUri: blob conversion failed, using raw uri:", err);
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
        throw new Error("Could not process the selected image. Please try again.");
      }

      // Optimistically show the new avatar immediately
      updateUser({ avatarUrl: dataUri, avatar_url: dataUri });

      // Send to backend
      const res = await updateUserProfileApi({ avatarUrl: dataUri }, token);
      if (res?.success) {
        const saved = res?.user?.avatarUrl || res?.user?.avatar_url || dataUri;
        updateUser({ avatarUrl: saved, avatar_url: saved });
        if (Platform.OS === "web") {
          alert("✅ Profile photo saved successfully!");
        } else {
          Alert.alert("Avatar Updated", "Your profile photo has been saved to your account.");
        }
      } else {
        // Server responded but not success — avatar is already showing locally
        console.warn("Server did not confirm avatar save:", res);
      }
    } catch (err) {
      console.error("Avatar upload failed:", err);
      if (Platform.OS === "web") {
        alert("Upload notice: " + (err.message || "Could not save photo to server."));
      } else {
        Alert.alert("Upload Notice", err.message || "Could not save photo to server.");
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
        token
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

  // ── Lodge Support Ticket ──
  const handleLodgeSupport = async () => {
    if (!supportSubject.trim()) {
      Alert.alert("Required", "Please provide a subject for your support inquiry.");
      return;
    }
    if (!supportMessage.trim()) {
      Alert.alert("Required", "Please provide message details for your inquiry.");
      return;
    }

    try {
      setSubmittingSupport(true);
      const res = await lodgeSupportTicketApi(
        {
          category: supportCategory,
          subject: supportSubject.trim(),
          message: supportMessage.trim(),
        },
        token
      );

      if (res?.success && res.ticket) {
        setSupportTickets((prev) => [res.ticket, ...prev]);
        setSupportSubject("");
        setSupportMessage("");
        Alert.alert(
          "Ticket Lodged 🎉",
          `Reference: ${res.ticket.id}\n\nOur concierge desk has received your inquiry and will reply within 2-4 hours.`
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
      Alert.alert("Confirmation Required", 'Please type "DELETE" into the box to authorize account deletion.');
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
                Alert.alert("Account Deleted", "Your account has been deleted.", [
                  { text: "OK", onPress: () => logout() },
                ]);
              } else {
                logout();
              }
            } catch (err) {
              Alert.alert("Delete Error", err.message || "Could not delete account.");
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
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

  // Dynamic values (no hardcoded "Anna Miller" or "anna@profile.com")
  const displayName =
    user?.fullName || user?.name || form.fullName || (user?.email ? user.email.split("@")[0] : "Luxury Collector");
  const displayEmail =
    user?.email ||
    (user?.walletAddress
      ? `🦊 ${user.walletAddress.substring(0, 6)}...${user.walletAddress.slice(-4)}`
      : "Verified Member");
  const avatarUrl = user?.avatarUrl || user?.avatar_url;

  // Menu items with original pastel colors
  const MENU_ITEMS = [
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

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: "#0A1120" }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── User Avatar & Info ── */}
        <View style={styles.userInfoWrap}>
          <TouchableOpacity style={styles.avatarCircle} onPress={handlePickAvatar} activeOpacity={0.85}>
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
                      borderBottomWidth: idx === MENU_ITEMS.length - 1 && !isExpanded ? 0 : 1,
                      borderBottomColor: "#F1F5F9",
                    },
                  ]}
                >
                  <View style={styles.menuItemLeft}>
                    <Feather name={item.icon} size={18} color={item.textColor} />
                    <Text style={[styles.menuItemLabel, { color: "#1E293B" }]}>{item.label}</Text>
                  </View>
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#94A3B8"
                    style={{ opacity: 0.6 }}
                  />
                </TouchableOpacity>

                {/* ── Expanded: Edit Profile ── */}
                {isExpanded && item.id === "edit" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#F8FAFC" }]}>
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>Personal</Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="Full Name"
                      placeholderTextColor="#94A3B8"
                      value={form.fullName}
                      onChangeText={(v) => setForm({ ...form, fullName: v })}
                    />
                    <View style={styles.rowInputs}>
                      <View style={[styles.inputWrap, { flex: 1, marginRight: 8 }]}>
                        <TextInput
                          style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                          placeholder="Gender"
                          placeholderTextColor="#94A3B8"
                          value={form.gender}
                          onChangeText={(v) => setForm({ ...form, gender: v })}
                        />
                        <Feather name="users" size={14} color="#94A3B8" style={styles.inputIcon} />
                      </View>
                      <View style={[styles.inputWrap, { flex: 1, marginLeft: 8 }]}>
                        <TextInput
                          style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor="#94A3B8"
                          value={form.dob}
                          onChangeText={(v) => setForm({ ...form, dob: v })}
                        />
                        <Feather name="calendar" size={14} color="#94A3B8" style={styles.inputIcon} />
                      </View>
                    </View>

                    <Text style={[styles.sectionHeading, { color: "#334155", marginTop: 12 }]}>Email and password</Text>
                    <TextInput
                      style={[styles.input, { color: "#64748B", borderColor: "#E2E8F0", backgroundColor: "#F1F5F9" }]}
                      placeholder="Email"
                      placeholderTextColor="#94A3B8"
                      value={form.email}
                      editable={false}
                      keyboardType="email-address"
                    />
                    <View style={styles.inputWrap}>
                      <TextInput
                        style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                        placeholder="New Password (optional)"
                        placeholderTextColor="#94A3B8"
                        secureTextEntry
                        value={form.password}
                        onChangeText={(v) => setForm({ ...form, password: v })}
                      />
                      <Feather name="eye-off" size={14} color="#94A3B8" style={styles.inputIcon} />
                    </View>

                    <TouchableOpacity
                      style={[styles.saveBtn, { backgroundColor: item.bgColor }]}
                      onPress={handleSaveProfile}
                      disabled={savingProfile}
                    >
                      {savingProfile ? (
                        <ActivityIndicator color={item.textColor} size="small" />
                      ) : (
                        <Text style={[styles.saveBtnText, { color: item.textColor }]}>Save Changes</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* ── Expanded: Notifications ── */}
                {isExpanded && item.id === "notifications" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#F8FAFC" }]}>
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>Notification Preferences</Text>
                    {[
                      { key: "escrowAlerts", title: "Smart Contract Escrow Alerts", sub: "Status updates on courier transit & appraisal" },
                      { key: "priceAlerts", title: "Price Movement & Appraisals", sub: "Valuation adjustments for your vault holdings" },
                      { key: "securityAlerts", title: "Security & Login Alerts", sub: "Notice on new session or wallet authorization" },
                      { key: "marketing", title: "Luxury Offering Drops", sub: "Exclusive invitations to verified asset drops" },
                    ].map((n) => (
                      <View key={n.key} style={styles.prefRow}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: "#1E293B" }}>{n.title}</Text>
                          <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{n.sub}</Text>
                        </View>
                        <Switch
                          value={notifications[n.key]}
                          onValueChange={(val) => setNotifications({ ...notifications, [n.key]: val })}
                          trackColor={{ false: "#CBD5E1", true: "#3B82F6" }}
                          thumbColor="#FFFFFF"
                        />
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Expanded: Terms of Service ── */}
                {isExpanded && item.id === "tos" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#F8FAFC" }]}>
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>Platform Guarantees & Terms</Text>
                    {[
                      { title: "Smart Contract Escrow", text: "100% of purchase payments are secured in SmartAssetEscrow.sol on Ethereum Sepolia until delivery and inspection pass." },
                      { title: "Anti-Self-Dealing Policy", text: "Users cannot purchase, bid on, or fractionally invest in items they listed. Fractional holdings are capped at 25% per investor." },
                      { title: "Appraisal & Inspection", text: "Every asset is inspected by Horological & Gemological institutes with immutable ERC-721 certificates delivered to the buyer." },
                      { title: "100% Buyer Refund Right", text: "If any item fails inspection, 100% of escrow funds are refunded to the buyer on-chain." },
                    ].map((t) => (
                      <View key={t.title} style={styles.tosBox}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#1E293B" }}>{t.title}</Text>
                        <Text style={{ fontSize: 11, color: "#64748B", marginTop: 3, lineHeight: 16 }}>{t.text}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Expanded: Support ── */}
                {isExpanded && item.id === "support" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#F8FAFC" }]}>
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>Lodge a Support Inquiry</Text>
                    <Text style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
                      Our luxury concierge team responds within 2-4 hours.
                    </Text>

                    {/* Category Selection */}
                    <View style={styles.catRow}>
                      {["Escrow & Payments", "Physical Verification", "Vault & Assets", "General"].map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={[
                            styles.catBtn,
                            supportCategory === c ? { backgroundColor: "#BBF7D0", borderColor: "#14532D" } : {},
                          ]}
                          onPress={() => setSupportCategory(c)}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              color: supportCategory === c ? "#14532D" : "#64748B",
                            }}
                          >
                            {c}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
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
                      style={[styles.saveBtn, { backgroundColor: item.bgColor }]}
                      onPress={handleLodgeSupport}
                      disabled={submittingSupport}
                    >
                      {submittingSupport ? (
                        <ActivityIndicator color={item.textColor} size="small" />
                      ) : (
                        <Text style={[styles.saveBtnText, { color: item.textColor }]}>Submit Support Ticket</Text>
                      )}
                    </TouchableOpacity>

                    {/* Active Tickets List */}
                    {supportTickets.length > 0 && (
                      <View style={{ marginTop: 14 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#334155", marginBottom: 6 }}>
                          Your Recent Tickets
                        </Text>
                        {supportTickets.slice(0, 3).map((ticket) => (
                          <View key={ticket.id} style={styles.ticketBox}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                              <Text style={{ fontSize: 12, fontWeight: "700", color: "#1E293B" }}>{ticket.subject}</Text>
                              <Text style={{ fontSize: 10, fontWeight: "700", color: "#10B981" }}>{ticket.status}</Text>
                            </View>
                            <Text style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>
                              {ticket.id} · {ticket.category}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* ── Expanded: Delete Account ── */}
                {isExpanded && item.id === "delete" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#FEF2F2" }]}>
                    <Text style={[styles.sectionHeading, { color: "#991B1B" }]}>Are you sure?</Text>
                    <Text style={{ fontSize: 13, color: "#991B1B", marginBottom: 12, lineHeight: 18 }}>
                      Deleting your account is permanent. All your assets, vault holdings, and escrow history will be lost.
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
                            deleteConfirmText.trim().toUpperCase() === "DELETE" ? "#DC2626" : "#FCA5A5",
                        },
                      ]}
                      onPress={handleDeleteAccount}
                      disabled={deletingAccount || deleteConfirmText.trim().toUpperCase() !== "DELETE"}
                    >
                      {deletingAccount ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={[styles.saveBtnText, { color: "#FFFFFF" }]}>Confirm Deletion</Text>
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
});
