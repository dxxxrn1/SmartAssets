// ─── Financial Security Inactivity Watcher & Warning Banner ───────────────────
// Captures user gestures to reset the 5-minute inactivity timer without blocking touches,
// and presents a 30-second warning banner before automatic session termination.

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PanResponder,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function InactivityWatcher({ children }) {
  const { isAuthenticated, inactivityWarning, secondsRemaining, recordActivity } = useAuth();
  const { isDark } = useTheme();

  // Mutable ref always holding the latest auth and watcher state
  // to prevent stale closures in long-lived PanResponder and DOM callbacks
  const stateRef = useRef({ isAuthenticated, recordActivity, inactivityWarning });
  stateRef.current = { isAuthenticated, recordActivity, inactivityWarning };

  const lastRecordedRef = useRef(0);

  // Active interaction handler that resets the inactivity timer
  const handleInteraction = useCallback(() => {
    const { isAuthenticated: authed, recordActivity: record, inactivityWarning: warningActive } = stateRef.current;
    if (!authed || typeof record !== 'function') return;

    const now = Date.now();
    // If warning banner is actively shown, dismiss immediately with 0ms delay.
    // Otherwise throttle to at most once per 500ms to avoid excessive churn during 60fps gestures.
    if (warningActive || now - lastRecordedRef.current >= 500) {
      lastRecordedRef.current = now;
      record();
    }
  }, []);

  // Passive PanResponder that registers gestures in capture phase
  // and returns FALSE so child touchables, buttons, inputs, and scroll views function normally.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        handleInteraction();
        return false;
      },
      onMoveShouldSetPanResponderCapture: () => {
        handleInteraction();
        return false;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  // React Native Web global activity listeners (pointer clicks, typing, trackpad wheel, scrolling)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const onWebActivity = () => {
      handleInteraction();
    };

    window.addEventListener('pointerdown', onWebActivity, { capture: true, passive: true });
    window.addEventListener('keydown', onWebActivity, { capture: true, passive: true });
    window.addEventListener('wheel', onWebActivity, { capture: true, passive: true });
    window.addEventListener('scroll', onWebActivity, { capture: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', onWebActivity, { capture: true });
      window.removeEventListener('keydown', onWebActivity, { capture: true });
      window.removeEventListener('wheel', onWebActivity, { capture: true });
      window.removeEventListener('scroll', onWebActivity, { capture: true });
    };
  }, [handleInteraction]);

  return (
    <View style={styles.rootContainer} {...panResponder.panHandlers}>
      {children}

      {/* Floating 30-Second Inactivity Warning Toast / Banner */}
      {isAuthenticated && inactivityWarning && (
        <View
          style={[
            styles.warningFloatingContainer,
            {
              backgroundColor: isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.98)',
              borderColor: '#F59E0B',
            },
          ]}
        >
          <View style={styles.warningRow}>
            <View style={styles.warningIconBadge}>
              <Ionicons name="time" size={20} color="#F59E0B" />
            </View>

            <View style={styles.warningTextCol}>
              <Text
                style={[
                  styles.warningTitle,
                  { color: isDark ? '#F1F5F9' : '#0F172A' },
                ]}
              >
                Inactivity Security Timeout
              </Text>
              <Text
                style={[
                  styles.warningSub,
                  { color: isDark ? '#94A3B8' : '#64748B' },
                ]}
              >
                Session locks in{' '}
                <Text style={styles.warningHighlight}>{secondsRemaining}s</Text> to protect your financial assets.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.keepActiveBtn}
              onPress={recordActivity}
              activeOpacity={0.8}
            >
              <Text style={styles.keepActiveBtnText}>Stay Signed In</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
  },
  warningFloatingContainer: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 20 : 50,
    left: 16,
    right: 16,
    zIndex: 9999,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  warningIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningTextCol: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  warningSub: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 14,
  },
  warningHighlight: {
    color: '#F59E0B',
    fontWeight: '800',
  },
  keepActiveBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepActiveBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
