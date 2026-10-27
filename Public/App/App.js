// ─── SmartAssets — React Native Entry Point ───────────────────────────────────
// Mounts ThemeProvider, NetworkProvider, AuthProvider, InactivityWatcher
// (5-min inactivity timer & 30s warning toast), full navigation tree, and SafeAreaProvider.

import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
import { Feather, Ionicons } from "@expo/vector-icons";
import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import { ThemeProvider } from "./src/context/ThemeContext";
import { NetworkProvider } from "./src/context/NetworkContext";
import InactivityWatcher from "./src/components/InactivityWatcher";

export default function App() {
  const [fontsLoaded] = useFonts({
    ...Feather.font,
    ...Ionicons.font,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <ThemeProvider>
          <NetworkProvider>
            <AuthProvider>
              <InactivityWatcher>
                <AppNavigator />
              </InactivityWatcher>
            </AuthProvider>
          </NetworkProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
