// ─── SmartAssets — React Native Entry Point ───────────────────────────────────
// Mounts the full navigation tree (all 13 screens from the Figma prototype)
//
// Required packages (run once):
//   npx expo install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
//   npx expo install react-native-screens react-native-safe-area-context

import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
