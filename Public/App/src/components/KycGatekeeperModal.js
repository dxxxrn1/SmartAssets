// ─── SmartAssets KYC & Bank Account Gatekeeper Modal ──────────────────────────
// Compliance interceptor modal that blocks unverified users from:
// a) listing an item for sale
// b) depositing funds
// c) withdrawing funds (which requires BOTH 3-doc KYC verification AND an approved bank account)
// and provides a direct button to VerifyAccountScreen or BankDetailsScreen.

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
import { SCREENS } from '../constants/navigation';

export default function KycGatekeeperModal({
  visible,
  onClose,
  navigation,
  isSuspended = false,
  suspensionReason = null,
  kycStatus = 'unverified',
  bankStatus = 'not_submitted',
  requireBankOnly = false,
  actionTitle = 'Perform This Action',
}) {
  const isVerified = kycStatus === 'verified';
  const needsBankApproval = requireBankOnly || (isVerified && bankStatus !== 'approved');
  const isPending = needsBankApproval ? bankStatus === 'pending' : kycStatus === 'pending';
  const isRejected = needsBankApproval ? bankStatus === 'rejected' : kycStatus === 'rejected';

  const handlePrimaryNavigation = () => {
    if (onClose) onClose();
    if (!navigation) return;
    if (needsBankApproval) {
      navigation.navigate(SCREENS.BANK_DETAILS);
    } else {
      navigation.navigate(SCREENS.VERIFY_ACCOUNT);
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
              backgroundColor: '#111A2E',
              borderColor: isSuspended ? '#EF4444' : 'rgba(124, 92, 252, 0.45)',
            },
          ]}
        >
          {/* Header Icon */}
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: isSuspended
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(124, 92, 252, 0.16)',
              },
            ]}
          >
            <Ionicons
              name={
                isSuspended
                  ? 'shield-half'
                  : needsBankApproval
                  ? 'card-outline'
                  : 'shield-checkmark'
              }
              size={36}
              color={isSuspended ? '#EF4444' : '#A78BFA'}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>
            {isSuspended
              ? '🚫 Account Suspended by Compliance'
              : needsBankApproval
              ? isPending
                ? '⏳ Bank Account Approval Pending'
                : '🏦 Approved Bank Account Required'
              : isPending
              ? '⏳ Account Verification In Review'
              : `🔒 Verify Your Account to ${actionTitle}`}
          </Text>

          {/* Subtitle / Explanation */}
          <Text style={styles.message}>
            {isSuspended
              ? suspensionReason ||
                'Your SmartAssets account is currently under administrative suspension. Transactions and listings are restricted.'
              : needsBankApproval
              ? isPending
                ? 'Your bank account details have been submitted and are awaiting admin approval. Withdrawals are only allowed to an admin-approved bank account.'
                : 'Withdrawals require BOTH a verified account (3 approved KYC documents) and an admin-approved bank account. Please enter your bank details for admin approval.'
              : isPending
              ? 'Your uploaded KYC documents are currently awaiting admin review. Your account becomes verified once all 3 documents (ID, Tax, and Proof of Residence) are approved.'
              : 'Until your account is verified, you cannot list an item for sale, deposit funds, or withdraw funds. Upload and get all 3 documents approved by an admin to unlock this feature.'}
          </Text>

          {/* Checklist of required items */}
          {!isSuspended && !needsBankApproval && (
            <View style={styles.checklist}>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>1. ID Document (SA Smart ID or Passport)</Text>
              </View>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>2. Tax Document (SARS Tax Certificate)</Text>
              </View>
              <View style={styles.checkItem}>
                <Feather name="check-circle" size={14} color="#10B981" />
                <Text style={styles.checkText}>3. Proof of Residence (Utility Bill &lt; 3 months)</Text>
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

            {!isSuspended ? (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handlePrimaryNavigation}
                activeOpacity={0.8}
              >
                <Text style={styles.actionBtnText}>
                  {needsBankApproval
                    ? isRejected
                      ? 'Resubmit Bank Details →'
                      : isPending
                      ? 'View Bank Status →'
                      : 'Enter Bank Details →'
                    : isRejected
                    ? 'Re-upload Rejected Doc →'
                    : isPending
                    ? 'View Verification Status →'
                    : 'Verify Your Account →'}
                </Text>
              </TouchableOpacity>
            ) : (
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
    backgroundColor: '#7C5CFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
