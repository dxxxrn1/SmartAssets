// ─── Navigation Root ──────────────────────────────────────────────────────────
// Wires all screens together using React Navigation
//
// Install required packages:
//   npx expo install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
//   npx expo install react-native-screens react-native-safe-area-context

import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SCREENS, TABS } from '../constants/navigation';
import { useColors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

// ─── Screen imports ────────────────────────────────────────────────────────────
import SplashScreen      from '../screens/SplashScreen';
import OnboardingScreen  from '../screens/OnboardingScreen';
import LoginScreen       from '../screens/LoginScreen';
import RegisterScreen    from '../screens/RegisterScreen';
import HomeScreen        from '../screens/HomeScreen';
import SearchScreen      from '../screens/SearchScreen';
import ListAssetScreen   from '../screens/ListAssetScreen';
import InvestScreen      from '../screens/InvestScreen';
import VaultScreen       from '../screens/VaultScreen';
import AssetDetailScreen from '../screens/AssetDetailScreen';
import CertificateScreen from '../screens/CertificateScreen';
import ProvenanceScreen  from '../screens/ProvenanceScreen';
import HealthReportScreen from '../screens/HealthReportScreen';
import CheckoutScreen    from '../screens/CheckoutScreen';
import VerificationScreen from '../screens/VerificationScreen';
import EscrowTrackerScreen from '../screens/EscrowTrackerScreen';

import { Ionicons } from '@expo/vector-icons';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ── Tab bar icon map (clean vector icons via @expo/vector-icons) ─────────────
const TAB_ICONS = {
  [SCREENS.HOME]:       { active: 'grid', inactive: 'grid-outline' },
  [SCREENS.SEARCH]:     { active: 'search', inactive: 'search-outline' },
  [SCREENS.LIST_ASSET]: { active: 'add', inactive: 'add' },
  [SCREENS.INVEST]:     { active: 'trending-up', inactive: 'trending-up-outline' },
  [SCREENS.VAULT]:      { active: 'shield-checkmark', inactive: 'shield-outline' },
};

// ── Main tab navigator ─────────────────────────────────────────────────────────
function MainTabs({ isDark }) {
  const c = useColors(isDark);
  const insets = useSafeAreaInsets();
  // Ensure enough clearance for Android 3-button nav or gesture indicator
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 12);
  const barHeight = 56 + bottomInset;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.vault,
          borderTopColor: c.border,
          borderTopWidth: 1,
          height: barHeight,
          paddingBottom: bottomInset,
          paddingTop: 8,
        },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarIcon: ({ focused, color }) => {
          const icons = TAB_ICONS[route.name];
          // FAB-style centre button for List Asset
          if (route.name === SCREENS.LIST_ASSET) {
            return (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: c.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 6,
                  shadowColor: c.primary,
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.35,
                  shadowRadius: 5,
                  elevation: 4,
                }}
              >
                <Ionicons name="add" size={26} color="#FFFFFF" />
              </View>
            );
          }
          const iconName = focused ? icons?.active : icons?.inactive;
          return <Ionicons name={iconName} size={21} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name={SCREENS.HOME}
        options={{ tabBarLabel: 'Market' }}
      >
        {(props) => <HomeScreen {...props} isDark={isDark} />}
      </Tab.Screen>

      <Tab.Screen
        name={SCREENS.SEARCH}
        options={{ tabBarLabel: 'Search' }}
      >
        {(props) => <SearchScreen {...props} isDark={isDark} />}
      </Tab.Screen>

      <Tab.Screen
        name={SCREENS.LIST_ASSET}
        options={{ tabBarLabel: '' }}
      >
        {(props) => <ListAssetScreen {...props} isDark={isDark} />}
      </Tab.Screen>

      <Tab.Screen
        name={SCREENS.INVEST}
        options={{ tabBarLabel: 'Invest' }}
      >
        {(props) => <InvestScreen {...props} isDark={isDark} />}
      </Tab.Screen>

      <Tab.Screen
        name={SCREENS.VAULT}
        options={{ tabBarLabel: 'Vault' }}
      >
        {(props) => <VaultScreen {...props} isDark={isDark} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ── Root stack ────────────────────────────────────────────────────────────────
export default function Navigation() {
  const [isDark, setIsDark] = useState(false);
  const { isAuthenticated } = useAuth();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          // ── Auth screens: Only accessible before login ──
          <>
            <Stack.Screen name={SCREENS.SPLASH}>
              {(props) => <SplashScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.ONBOARDING}>
              {(props) => <OnboardingScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.LOGIN}>
              {(props) => <LoginScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.REGISTER}>
              {(props) => <RegisterScreen {...props} isDark={isDark} />}
            </Stack.Screen>
          </>
        ) : (
          // ── App screens: Strictly accessible ONLY to authenticated registered users ──
          <>
            <Stack.Screen name={SCREENS.MAIN_TABS}>
              {(props) => <MainTabs {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.ASSET_DETAIL}>
              {(props) => <AssetDetailScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.CERTIFICATE}>
              {(props) => <CertificateScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.PROVENANCE}>
              {(props) => <ProvenanceScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.HEALTH_REPORT}>
              {(props) => <HealthReportScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.CHECKOUT}>
              {(props) => <CheckoutScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.VERIFICATION}>
              {(props) => <VerificationScreen {...props} isDark={isDark} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.ESCROW_TRACKER}>
              {(props) => <EscrowTrackerScreen {...props} isDark={isDark} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
