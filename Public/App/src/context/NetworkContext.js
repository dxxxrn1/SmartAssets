// ─── Network & Offline Status Context ──────────────────────────────────────────
// Detects network availability across Mobile and Web, provides online/offline status,
// and exports a reusable OfflineBanner component.

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Animated, TouchableOpacity } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Feather } from '@expo/vector-icons';

const NetworkContext = createContext({
  isConnected: true,
  isOffline: false,
  checkConnection: async () => true,
});

export function NetworkProvider({ children }) {
  const [isConnected, setIsConnected] = useState(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      return navigator.onLine ?? true;
    }
    return true;
  });

  const checkConnection = useCallback(async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
        const onLine = navigator.onLine;
        setIsConnected(onLine);
        return onLine;
      }
      const state = await NetInfo.fetch();
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsConnected(online);
      return online;
    } catch (err) {
      console.warn('[Network] Check connection error:', err);
      return isConnected;
    }
  }, [isConnected]);

  useEffect(() => {
    // 1. Mobile & Web NetInfo listener
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsConnected(online);
    });

    // 2. Extra Web listeners for instant browser online/offline response
    let handleWebOnline, handleWebOffline;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      handleWebOnline = () => setIsConnected(true);
      handleWebOffline = () => setIsConnected(false);

      window.addEventListener('online', handleWebOnline);
      window.addEventListener('offline', handleWebOffline);
    }

    // Initial check
    checkConnection();

    return () => {
      unsubscribeNetInfo();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (handleWebOnline) window.removeEventListener('online', handleWebOnline);
        if (handleWebOffline) window.removeEventListener('offline', handleWebOffline);
      }
    };
  }, [checkConnection]);

  return (
    <NetworkContext.Provider
      value={{
        isConnected,
        isOffline: !isConnected,
        checkConnection,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    return { isConnected: true, isOffline: false, checkConnection: async () => true };
  }
  return context;
}

/**
 * Visual Banner shown when user is offline to explain that cached data is being displayed
 */
export function OfflineBanner({ message, style, isDark = false }) {
  const { isOffline } = useNetwork();

  if (!isOffline) return null;

  const defaultMsg = "Offline Mode — Showing cached data. Connect to the internet for live updates.";

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: isDark ? '#3E1F1A' : '#FEF2F2',
          borderColor: isDark ? '#7F1D1D' : '#FCA5A5',
        },
        style,
      ]}
    >
      <Feather name="wifi-off" size={15} color={isDark ? '#FCA5A5' : '#DC2626'} style={styles.icon} />
      <Text
        style={[
          styles.text,
          { color: isDark ? '#FEE2E2' : '#991B1B' },
        ]}
      >
        {message || defaultMsg}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: {
    marginRight: 9,
  },
  text: {
    fontSize: 12.5,
    fontWeight: '600',
    flex: 1,
    lineHeight: 17,
  },
});
