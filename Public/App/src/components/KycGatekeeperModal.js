// ─── SmartAssets KYC Gatekeeper Modal ─────────────────────────────────────────
// Clean, high-conversion compliance interceptor modal that prevents unverified
// or suspended users from listing assets, buying/selling shares, or moving funds.

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/theme';
import { SCREENS } from '../constants/navigation';

export default function KycGatekeeperModal({
  visible,
  onClose,
  navigation,
  isSuspended = false,
  suspensionReason = null,
  kycStatus = 'unverified',
  actionTitle = 'Perform This Action',
}) {
  const c = useColors(true); // Default dark theme compliance palette

  const handleCompleteVerification = () => {
    if (onClose) onClose();
    if (navigation) {
      // Navigate straight to Profile with auto-expansion of KYC module
      navigation.navigate(SCREENS.PROFILE, { openKyc: true });
    }
  };

  const isPending = kycStatus === 'pending';
  const isRejected = kycStatus === 'rejected';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: '#111A2E', borderColor: isSuspended ? '#EF4444' : 'rgba(59, 130, 246, 0.4)' }]}>
          {/* Header Icon */}
          <View style={[styles.iconCircle, { backgroundColor: isSuspended ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)' }]}>
            <Ionicons
              name={isSuspended ? 'shield-half' : 'shield-checkmark'}
              size={36}
              color={isSuspended ? '#EF4444' : '#3B82F6'}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>
            {isSuspended
              ? '🚫 Account Suspended by Compliance'
              : isPending
              ? '⏳ KYC Verification In Review'
              : '🔒 FICA / KYC Verification Required'}
          </Text>

          {/* Subtitle / Explanation */}
          <Text style={styles.message}>
            {isSuspended
              ? (suspensionReason || 'Your SmartAssets account is currently under administrative suspension. Transactions and listings are restricted. Please lodge an inquiry with our support desk.')
              : isPending
              ? 'Your FICA identity, tax documents, and banking details were submitted and are currently in the compliance review queue. You will be cleared to transact as soon as an Admin approves your dossier.'
              : 'To keep SmartAssets secure and comply with regulatory financial standards, you must submit your ID, Tax Number, Proof of Residence, and Banking Details and be approved by an Admin before listing assets or making transactions.'}
          </Text>

          {/* Checklist of required items (if unverified or rejected) */}
          {!isSuspended && (
            <View style={styles.checklist}>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>SA Government ID / Passport Document</Text>
              </View>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>SARS Tax Reference Number & Certificate</Text>
              </View>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>Proof of Residence (Utility Bill &lt; 3 months)</Text>
              </View>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>Verified SA Bank Account (FNB, Standard, etc.)</Text>
              </View>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelBtnText}>Dismiss</Text>
            </TouchableOpacity>

            {!isSuspended && !isPending && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleCompleteVerification}
                activeOpacity={0.8}
              >
                <Text style={styles.actionBtnText}>
                  {isRejected ? 'Resubmit Verification →' : 'Complete Verification Now →'}
                </Text>
              </TouchableOpacity>
            )}

            {isPending && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#3B82F6' }]}
                onPress={handleCompleteVerification}
                activeOpacity={0.8}
              >
                <Text style={styles.actionBtnText}>View Compliance Status →</Text>
              </TouchableOpacity>
            )}

            {isSuspended && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#EF4444' }]}
                onPress={() => {
                  if (onClose) onClose();
                  if (navigation) navigation.navigate(SCREENS.PROFILE, { openSupport: true });
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.actionBtnText}>Contact Support Desk →</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 16, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 18,
      },
      android: { elevation: 12 },
      web: { boxShadow: '0 20px 50px rgba(0,0,0,0.6)' },
    }),
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  checklist: {
    width: '100%',
    backgroundColor: '#0B0F19',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 8,
    marginBottom: 20,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '500',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  actionBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
