// ─── CrossPlatformDialog ──────────────────────────────────────────────────
// A glassmorphism modal dialog that provides consistent confirmation and alert
// behavior across iOS, Android, and Web without relying on Alert.alert.

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

export default function CrossPlatformDialog({
  visible,
  title,
  message,
  type = 'default', // 'default' | 'success' | 'error' | 'warning' | 'info'
  isConfirm = false,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
}) {
  if (!visible) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return (
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Ionicons name="checkmark-circle" size={28} color="#10B981" />
          </View>
        );
      case 'error':
        return (
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            <Ionicons name="alert-circle" size={28} color="#EF4444" />
          </View>
        );
      case 'warning':
        return (
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
            <Ionicons name="warning" size={28} color="#F59E0B" />
          </View>
        );
      case 'info':
        return (
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Ionicons name="information-circle" size={28} color="#3B82F6" />
          </View>
        );
      default:
        if (isDestructive) {
          return (
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Feather name="alert-triangle" size={26} color="#EF4444" />
            </View>
          );
        }
        return null;
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={loading ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialogCard}>
          {getIcon()}

          {Boolean(title) && <Text style={styles.dialogTitle}>{title}</Text>}

          {Boolean(message) && <Text style={styles.dialogMessage}>{message}</Text>}

          {children && <View style={styles.childrenContainer}>{children}</View>}

          <View style={styles.buttonRow}>
            {isConfirm && (
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={onCancel}
                disabled={loading}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelBtnText}>{cancelText}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.btn,
                isConfirm ? styles.confirmBtn : styles.singleBtn,
                isDestructive && styles.destructiveBtn,
                loading && styles.disabledBtn,
              ]}
              onPress={onConfirm || onCancel}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmBtnText}>{confirmText}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 14, 26, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    ...(Platform.OS === 'web'
      ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
        }
      : {}),
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#131A2F',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  dialogMessage: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
  },
  childrenContainer: {
    width: '100%',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  cancelBtnText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#7C5CFC',
  },
  singleBtn: {
    flex: 1,
    backgroundColor: '#7C5CFC',
  },
  destructiveBtn: {
    backgroundColor: '#EF4444',
  },
  disabledBtn: {
    opacity: 0.7,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
