import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useColors } from "../constants/theme";


export default function ProfileScreen({ navigation, isDark }) {
  const c = useColors(isDark);
  const { user, logout } = useAuth();

  // State to manage which accordion section is expanded
  const [expandedSection, setExpandedSection] = useState(null);

  const toggleSection = (section) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () => {
          logout();
        },
      },
    ]);
  };

  // Menu items with their distinct pastel colors (adapted for dark theme context)
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
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 24 }} />{/* placeholder for balance */}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── User Avatar & Info ── */}
        <View style={styles.userInfoWrap}>
          <View style={styles.avatarCircle}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            ) : (
              <Feather name="user" size={32} color="#FFFFFF" />
            )}
            <View style={styles.avatarCameraBadge}>
              <Feather name="camera" size={12} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.userName}>{user?.name || "Anna Miller"}</Text>
          <Text style={styles.userEmail}>
            {user?.email || "anna@profile.com"}
          </Text>
        </View>

        {/* ── Menu List ── */}
        <View style={styles.menuContainer}>
          {MENU_ITEMS.map((item, idx) => {
            const isExpanded = expandedSection === item.id;
            return (
              <View key={item.id} style={styles.menuItemWrap}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    // For now, only Edit Profile slides down with content
                    if (item.id === "edit") {
                      toggleSection(item.id);
                    } else if (item.id === "delete") {
                      toggleSection(item.id);
                    } else {
                      // Do nothing or handle navigation for others
                    }
                  }}
                  style={[
                    styles.menuItem,
                    {
                      backgroundColor: "transparent",
                      borderBottomWidth: idx === MENU_ITEMS.length - 1 ? 0 : 1,
                      borderBottomColor: "#F1F5F9",
                    }
                  ]}
                >
                  <View style={styles.menuItemLeft}>
                    <Feather name={item.icon} size={18} color={item.textColor} />
                    <Text
                      style={[styles.menuItemLabel, { color: "#1E293B" }]}
                    >
                      {item.label}
                    </Text>
                  </View>
                  {/* Decorative icon on the right (like the image) */}
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#94A3B8"
                    style={{ opacity: 0.6 }}
                  />
                </TouchableOpacity>

                {/* ── Expanded Content Area ── */}
                {isExpanded && item.id === "edit" && (
                  <View style={[styles.expandedContent, { backgroundColor: "#F8FAFC" }]}>
                    <Text style={[styles.sectionHeading, { color: "#334155" }]}>Personal</Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="Full Name"
                      placeholderTextColor={item.textColor + "80"}
                      defaultValue={user?.name || "Anna Miller"}
                    />
                    <View style={styles.rowInputs}>
                      <View style={[styles.inputWrap, { flex: 1, marginRight: 8 }]}>
                        <TextInput
                          style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                          placeholder="Gender"
                          placeholderTextColor="#94A3B8"
                        />
                        <Feather name="users" size={14} color="#94A3B8" style={styles.inputIcon} />
                      </View>
                      <View style={[styles.inputWrap, { flex: 1, marginLeft: 8 }]}>
                        <TextInput
                          style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                          placeholder="07/05/2001"
                          placeholderTextColor="#94A3B8"
                        />
                        <Feather name="calendar" size={14} color="#94A3B8" style={styles.inputIcon} />
                      </View>
                    </View>

                    <Text style={[styles.sectionHeading, { color: "#334155", marginTop: 12 }]}>Email and password</Text>
                    <TextInput
                      style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                      placeholder="Email"
                      placeholderTextColor="#94A3B8"
                      defaultValue={user?.email || "anna@profile.com"}
                      keyboardType="email-address"
                    />
                    <View style={styles.inputWrap}>
                      <TextInput
                        style={[styles.input, { color: "#0F172A", borderColor: "#E2E8F0", backgroundColor: "#FFFFFF" }]}
                        placeholder="Password"
                        placeholderTextColor="#94A3B8"
                        secureTextEntry
                        defaultValue="********"
                      />
                      <Feather name="eye-off" size={14} color="#94A3B8" style={styles.inputIcon} />
                    </View>
                    
                    <TouchableOpacity style={[styles.saveBtn, { backgroundColor: item.bgColor }]}>
                      <Text style={[styles.saveBtnText, { color: item.textColor }]}>Save Changes</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Expanded content for Delete Account */}
                {isExpanded && item.id === "delete" && (
                   <View style={[styles.expandedContent, { backgroundColor: "#FEF2F2" }]}>
                      <Text style={[styles.sectionHeading, { color: "#991B1B" }]}>Are you sure?</Text>
                      <Text style={{ fontSize: 13, color: "#991B1B", marginBottom: 16 }}>
                        Deleting your account is permanent. All your assets and history will be lost.
                      </Text>
                      <TouchableOpacity style={[styles.saveBtn, { backgroundColor: "#DC2626" }]}>
                        <Text style={[styles.saveBtnText, { color: "#FFFFFF" }]}>Confirm Deletion</Text>
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
  menuItemWrap: {
    // Wrap styles handled by container now
  },
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
    backgroundColor: "rgba(255,255,255,0.4)",
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
