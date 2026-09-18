// ─── SmartAssets — React Native Entry Point ───────────────────────────────────
// Mounts AuthProvider, full navigation tree, and SafeAreaProvider

import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Feather, Ionicons } from '@expo/vector-icons';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';

export default function App() {
  const [fontsLoaded] = useFonts({
    ...Feather.font,
    ...Ionicons.font,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
