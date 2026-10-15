// ─── SmartAssets — React Native Entry Point ───────────────────────────────────
// Mounts NetworkProvider, ThemeProvider, AuthProvider, and AppNavigator.

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Feather, Ionicons } from '@expo/vector-icons';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { NetworkProvider } from './src/context/NetworkContext';

export default function App() {
  const [fontsLoaded] = useFonts({
    ...Feather.font,
    ...Ionicons.font,
  });

  return (
    <SafeAreaProvider>
      <NetworkProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppNavigator />
          </AuthProvider>
        </ThemeProvider>
      </NetworkProvider>
    </SafeAreaProvider>
  );
}
