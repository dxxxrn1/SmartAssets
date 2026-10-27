// ─── InstallMetaMaskModal.js ──────────────────────────────────────────────────
// Friendly, high-conversion modal shown when MetaMask is not detected on the device.
// Replaces generic browser errors with direct links to the App Store and Google Play.

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { openMetaMaskStore } from '../services/mobileWalletService';
import { useTheme } from '../context/ThemeContext';
import { useColors } from '../constants/theme';

export default function InstallMetaMaskModal({
  visible,
  onClose,
  onRetry,
}) {
  const { isDark } = useTheme();
  const c = useColors(isDark);

  const handleInstallPress = async () => {
    await openMetaMaskStore();
  };

  const handleRetryPress = () => {
    if (onRetry) {
      onRetry();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? '#111A2E' : '#FFFFFF',
              borderColor: isDark ? 'rgba(245, 132, 31, 0.35)' : 'rgba(245, 132, 31, 0.45)',
            },
          ]}
        >
          {/* ── Top Fox Badge ── */}
          <View style={styles.iconContainer}>
            <LinearGradient
              colors={['#F6851B', '#E2761B', '#CD6116']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.foxBadge}
            >
              <Ionicons name="wallet" size={32} color="#FFFFFF" />
            </LinearGradient>
          </View>

          {/* ── Heading ── */}
          <Text style={[styles.title, { color: c.warm }]}>
            MetaMask App Required
          </Text>

          <Text style={[styles.description, { color: c.muted }]}>
            To link your settlement wallet, complete your profile, and secure luxury assets on Ethereum Sepolia, you need the MetaMask app on your {Platform.OS === 'ios' ? 'iPhone' : 'Android device'}.
          </Text>

          {/* ── Features List ── */}
          <View
            style={[
              styles.featuresBox,
              {
                backgroundColor: isDark ? 'rgba(245, 132, 31, 0.08)' : '#FFF7ED',
                borderColor: isDark ? 'rgba(245, 132, 31, 0.2)' : '#FED7AA',
              },
            ]}
          >
            <View style={styles.featureItem}>
              <Feather name="shield" size={15} color="#F5841F" style={{ marginTop: 2 }} />
              <Text style={[styles.featureText, { color: isDark ? '#E2E8F0' : '#431407' }]}>
                <Text style={{ fontWeight: '700' }}>Cryptographic Proof:</Text> Proves wallet ownership with zero gas fees.
              </Text>
            </View>

            <View style={styles.featureItem}>
              <Feather name="refresh-cw" size={15} color="#F5841F" style={{ marginTop: 2 }} />
              <Text style={[styles.featureText, { color: isDark ? '#E2E8F0' : '#431407' }]}>
                <Text style={{ fontWeight: '700' }}>Seamless Deep-Link:</Text> Opens MetaMask automatically and returns to SmartAssets.
              </Text>
            </View>

            <View style={styles.featureItem}>
              <Feather name="lock" size={15} color="#F5841F" style={{ marginTop: 2 }} />
              <Text style={[styles.featureText, { color: isDark ? '#E2E8F0' : '#431407' }]}>
                <Text style={{ fontWeight: '700' }}>Escrow Custody:</Text> Your transactions are locked directly in Sepolia smart contracts.
              </Text>
            </View>
          </View>

          {/* ── Install Button ── */}
          <TouchableOpacity
            style={styles.installBtnWrap}
            onPress={handleInstallPress}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['#F6851B', '#E4761B', '#CD6116']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.installBtnGradient}
            >
              <Ionicons name="download-outline" size={19} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.installBtnText}>
                {Platform.OS === 'ios' ? 'Get on App Store' : 'Get on Google Play'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Try Again (if already installed) ── */}
          <TouchableOpacity
            style={[
              styles.retryBtn,
              {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : '#E2E8F0',
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F8FAFC',
              },
            ]}
            onPress={handleRetryPress}
            activeOpacity={0.75}
          >
            <Feather name="check" size={16} color={c.primary} style={{ marginRight: 6 }} />
            <Text style={[styles.retryBtnText, { color: c.warm }]}>
              I’ve Installed It — Connect
            </Text>
          </TouchableOpacity>

          {/* ── Close Button ── */}
          <TouchableOpacity
            onPress={onClose}
            style={styles.cancelBtn}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelText, { color: c.muted }]}>
              Maybe Later
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 22,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 26,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#F5841F',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 10,
  },
  iconContainer: {
    marginBottom: 16,
  },
  foxBadge: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F5841F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  featuresBox: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginBottom: 18,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  installBtnWrap: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
  },
  installBtnGradient: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  installBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  retryBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
