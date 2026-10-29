// ─── BankDetailsScreen.js ───────────────────────────────────────────────────
// "Bank Details" screen (Separate Bank Account Verification for Withdrawals):
// - Form to enter account holder name, bank name, account number, branch/routing code, account type
// - Displays current bank account status: Pending / Approved / Rejected (+ rejection reason)
// - Withdrawals require BOTH a verified account (3 KYC docs approved) AND an approved bank account

import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  getBankAccountApi,
  submitBankAccountApi,
  getVerificationStatusApi,
} from '../services/api';
import { useColors } from '../constants/theme';

const SA_BANKS = [
  { name: 'FNB', branch: '250655' },
  { name: 'Standard Bank', branch: '051001' },
  { name: 'Capitec', branch: '470010' },
  { name: 'Nedbank', branch: '198765' },
  { name: 'Absa', branch: '632005' },
  { name: 'Investec', branch: '580105' },
];

const ACCOUNT_TYPES = ['Cheque / Current', 'Savings', 'Transmission'];

export default function BankDetailsScreen({ navigation }) {
  const { isDark } = useTheme();
  const { user, token, updateProfileData } = useAuth();
  const t = useColors(isDark);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [bankRecord, setBankRecord] = useState(null);
  const [isVerified, setIsVerified] = useState(false);

  const [accountHolder, setAccountHolder] = useState(user?.fullName || '');
  const [bankName, setBankName] = useState('FNB');
  const [accountNumber, setAccountNumber] = useState('');
  const [branchCode, setBranchCode] = useState('250655');
  const [accountType, setAccountType] = useState('Cheque / Current');

  const showAlert = (title, msg) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}\n\n${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  const loadBankDetails = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [bankRes, verifRes] = await Promise.all([
        getBankAccountApi(token).catch(() => null),
        getVerificationStatusApi(token).catch(() => null),
      ]);

      const verified =
        verifRes?.verification_status === 'verified' ||
        verifRes?.kycStatus === 'verified' ||
        verifRes?.overall_status === 'verified' ||
        verifRes?.status === 'verified' ||
        user?.verificationStatus === 'verified' ||
        user?.isVerified === true;
      setIsVerified(Boolean(verified));

      if (bankRes && bankRes.success && bankRes.bank_account) {
        const b = bankRes.bank_account;
        setBankRecord(b);
        setAccountHolder(b.account_holder || user?.fullName || '');
        setBankName(b.bank_name || 'FNB');
        setAccountNumber(b.account_number || '');
        setBranchCode(b.branch_code || '250655');
        setAccountType(b.account_type || 'Cheque / Current');
      }
    } catch (err) {
      console.warn('[BankDetailsScreen] fetch warning:', err.message);
    } finally {
      setLoading(false);
    }
  }, [token, user?.fullName, user?.verificationStatus, user?.isVerified]);

  useFocusEffect(
    useCallback(() => {
      loadBankDetails();
    }, [loadBankDetails])
  );

  const handleSelectBankPreset = (preset) => {
    setBankName(preset.name);
    setBranchCode(preset.branch);
  };

  const handleSubmit = async () => {
    if (!accountHolder.trim()) {
      showAlert('Missing Information', 'Please enter the account holder full name.');
      return;
    }
    if (!bankName.trim()) {
      showAlert('Missing Information', 'Please select or enter your bank name.');
      return;
    }
    const cleanAcc = accountNumber.replace(/\s+/g, '');
    if (cleanAcc.length < 6) {
      showAlert('Invalid Account Number', 'Please enter a valid bank account number (at least 6 digits).');
      return;
    }
    if (!branchCode.trim()) {
      showAlert('Missing Branch Code', 'Please enter your bank branch / routing code.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await submitBankAccountApi(
        {
          accountHolder: accountHolder.trim(),
          bankName: bankName.trim(),
          accountNumber: cleanAcc,
          branchCode: branchCode.trim(),
          accountType,
        },
        token
      );

      if (res && res.success) {
        setBankRecord(res.bank_account);
        if (updateProfileData) {
          await updateProfileData({
            bankAccount: res.bank_account,
            bankStatus: res.bank_account?.status || 'pending',
            bankingDetails: {
              bankName: bankName.trim(),
              accountHolder: accountHolder.trim(),
              accountNumber: cleanAcc,
              branchCode: branchCode.trim(),
              accountType,
            },
          });
        }
        showAlert(
          'Bank Account Submitted',
          res.message || 'Your bank account details have been submitted for admin approval.'
        );
      }
    } catch (err) {
      showAlert('Submission Error', err.message || 'Could not submit bank account details.');
    } finally {
      setSubmitting(false);
    }
  };

  const status = bankRecord?.status || 'not_submitted';

  const renderStatusBanner = () => {
    let colors = ['#4F46E5', '#2563EB'];
    let icon = 'card-outline';
    let title = 'No Bank Account Linked';
    let desc = 'Submit your South African bank account details below. An admin must approve your bank account before you can withdraw funds.';

    if (status === 'approved') {
      colors = ['#059669', '#10B981'];
      icon = 'checkmark-done-circle';
      title = 'Bank Account Approved';
      desc = `Your ${bankRecord.bank_name} account (${bankRecord.account_number_masked || '****' + String(bankRecord.account_number || '').slice(-4)}) is verified and approved for withdrawals.`;
    } else if (status === 'pending') {
      colors = ['#D97706', '#F59E0B'];
      icon = 'time-outline';
      title = 'Pending Admin Approval';
      desc = `Your ${bankRecord.bank_name} account (${bankRecord.account_number_masked || '****' + String(bankRecord.account_number || '').slice(-4)}) is awaiting verification by a SmartAssets administrator.`;
    } else if (status === 'rejected') {
      colors = ['#DC2626', '#EF4444'];
      icon = 'alert-circle-outline';
      title = 'Bank Account Rejected';
      desc = 'Your bank details were rejected by an admin. Please check the reason below and resubmit accurate details.';
    }

    return (
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 20,
          padding: 18,
          marginBottom: 20,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Withdrawal Bank Account Status
            </Text>
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 2 }}>
              {title}
            </Text>
          </View>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 19 }}>
          {desc}
        </Text>
      </LinearGradient>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View
        style={{
          paddingTop: Platform.OS === 'ios' ? 54 : 36,
          paddingBottom: 14,
          paddingHorizontal: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: t.border,
          backgroundColor: t.cardBg,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(124,92,252,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="arrow-back" size={20} color={t.text} />
        </TouchableOpacity>

        <Text style={{ fontSize: 17, fontWeight: '800', color: t.text }}>
          Bank Details
        </Text>

        <TouchableOpacity
          onPress={loadBankDetails}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(124,92,252,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="refresh" size={18} color={t.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {renderStatusBanner()}

        {status === 'rejected' && bankRecord?.rejection_reason ? (
          <View
            style={{
              backgroundColor: 'rgba(239,68,68,0.12)',
              borderWidth: 1,
              borderColor: '#EF4444',
              borderRadius: 14,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <Text style={{ color: '#EF4444', fontWeight: '800', fontSize: 13, marginBottom: 4 }}>
              Admin Rejection Reason:
            </Text>
            <Text style={{ color: isDark ? '#FCA5A5' : '#991B1B', fontSize: 13, lineHeight: 19 }}>
              {bankRecord.rejection_reason}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#7C5CFC" />
          </View>
        ) : (
          <View
            style={{
              backgroundColor: t.cardBg,
              borderRadius: 20,
              padding: 18,
              borderWidth: 1,
              borderColor: t.border,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '800', color: t.text, marginBottom: 14 }}>
              Payout Bank Account Information
            </Text>

            {/* Quick Bank Selector */}
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', marginBottom: 8 }}>
              Quick Select South African Bank
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {SA_BANKS.map((b) => {
                const active = bankName.toLowerCase() === b.name.toLowerCase();
                return (
                  <TouchableOpacity
                    key={b.name}
                    onPress={() => handleSelectBankPreset(b)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 99,
                      borderWidth: 1,
                      borderColor: active ? '#7C5CFC' : t.border,
                      backgroundColor: active ? 'rgba(124,92,252,0.16)' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#7C5CFC' : t.textSecondary }}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Account Holder Name */}
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
              Account Holder Name
            </Text>
            <TextInput
              value={accountHolder}
              onChangeText={setAccountHolder}
              placeholder="e.g. Kgomotso Mabena"
              placeholderTextColor={t.textMuted}
              style={{
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F5FF',
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: t.text,
                marginBottom: 14,
              }}
            />

            {/* Bank Name */}
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
              Bank Name
            </Text>
            <TextInput
              value={bankName}
              onChangeText={setBankName}
              placeholder="e.g. FNB / Standard Bank"
              placeholderTextColor={t.textMuted}
              style={{
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F5FF',
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: t.text,
                marginBottom: 14,
              }}
            />

            {/* Account Number */}
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
              Account Number
            </Text>
            <TextInput
              value={accountNumber}
              onChangeText={setAccountNumber}
              placeholder="Enter 8 to 12 digit account number"
              placeholderTextColor={t.textMuted}
              keyboardType="number-pad"
              style={{
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F5FF',
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: t.text,
                marginBottom: 14,
              }}
            />

            {/* Branch / Routing Code */}
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', marginBottom: 6 }}>
              Branch / Routing Code
            </Text>
            <TextInput
              value={branchCode}
              onChangeText={setBranchCode}
              placeholder="e.g. 250655"
              placeholderTextColor={t.textMuted}
              keyboardType="number-pad"
              style={{
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8F5FF',
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: t.text,
                marginBottom: 14,
              }}
            />

            {/* Account Type */}
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', marginBottom: 8 }}>
              Account Type
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              {ACCOUNT_TYPES.map((type) => {
                const selected = accountType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setAccountType(type)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 11,
                      borderWidth: 1,
                      borderColor: selected ? '#7C5CFC' : t.border,
                      backgroundColor: selected ? 'rgba(124,92,252,0.16)' : 'transparent',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? '#7C5CFC' : t.textSecondary }}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Compliance Info Banner */}
            {!isVerified && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: isDark ? 'rgba(124, 92, 252, 0.12)' : 'rgba(124, 92, 252, 0.08)',
                  borderColor: isDark ? 'rgba(124, 92, 252, 0.35)' : 'rgba(124, 92, 252, 0.25)',
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <Ionicons name="information-circle-outline" size={20} color="#7C5CFC" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#7C5CFC' }}>
                    Compliance & Approval Note
                  </Text>
                  <Text style={{ fontSize: 11.5, color: t.textSecondary, marginTop: 2, lineHeight: 16 }}>
                    You can submit your bank account details now for review. Once both your KYC documents and bank details are approved by an admin, full withdrawals and deposits are enabled.
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              disabled={submitting}
              onPress={handleSubmit}
              style={{
                backgroundColor: '#7C5CFC',
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
              }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={18}
                    color="#FFFFFF"
                  />
                  <Text style={{ color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' }}>
                    {status === 'not_submitted'
                      ? 'Submit Bank Account for Approval'
                      : 'Update & Resubmit Bank Account'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
