// ─── SmartAssets — React Native Entry Point ───────────────────────────────────
// Mounts ThemeProvider, AuthProvider, ActivityTracker (5-min inactivity timer),
// full navigation tree, and SafeAreaProvider.

import React, { useRef, useEffect } from "react";
import { View, PanResponder, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
import { Feather, Ionicons } from "@expo/vector-icons";
import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { ThemeProvider } from "./src/context/ThemeContext";
import { NetworkProvider } from "./src/context/NetworkContext";

function ActivityTracker({ children }) {
  const { resetInactivityTimer } = useAuth();

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        if (typeof resetInactivityTimer === "function") {
          resetInactivityTimer();
        }
        return false; // Do not intercept touches; allow children to handle normally
      },
      onMoveShouldSetPanResponderCapture: () => {
        if (typeof resetInactivityTimer === "function") {
          resetInactivityTimer();
        }
        return false;
      },
    })
  ).current;

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleActivity = () => {
        if (typeof resetInactivityTimer === "function") {
          resetInactivityTimer();
        }
      };
      window.addEventListener("mousedown", handleActivity, { passive: true });
      window.addEventListener("keydown", handleActivity, { passive: true });
      window.addEventListener("touchstart", handleActivity, { passive: true });
      return () => {
        window.removeEventListener("mousedown", handleActivity);
        window.removeEventListener("keydown", handleActivity);
        window.removeEventListener("touchstart", handleActivity);
      };
    }
  }, [resetInactivityTimer]);

  return (
    <View style={{ flex: 1, width: "100%", height: "100%" }} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}

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
              <ActivityTracker>
                <AppNavigator />
              </ActivityTracker>
            </AuthProvider>
          </NetworkProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
