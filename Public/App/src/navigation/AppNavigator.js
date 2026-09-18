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

// ── Per-tab accent colours & icons ───────────────────────────────────────────
const TAB_CONFIG = {
  [SCREENS.HOME]:       { active: 'grid',             inactive: 'grid-outline',           color: '#38BDF8', label: 'Market'  },
  [SCREENS.SEARCH]:     { active: 'search',            inactive: 'search-outline',         color: '#A78BFA', label: 'Search'  },
  [SCREENS.LIST_ASSET]: { active: 'add',               inactive: 'add',                    color: '#FFFFFF', label: ''        },
  [SCREENS.INVEST]:     { active: 'trending-up',       inactive: 'trending-up-outline',    color: '#FBBF24', label: 'Invest'  },
  [SCREENS.VAULT]:      { active: 'shield-checkmark',  inactive: 'shield-outline',         color: '#34D399', label: 'Vault'   },
};

const TAB_ORDER = [SCREENS.HOME, SCREENS.SEARCH, SCREENS.LIST_ASSET, SCREENS.INVEST, SCREENS.VAULT];

// ── Custom tab bar ─────────────────────────────────────────────────────────────
function CustomTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 12);

  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: '#070B14',
      borderTopWidth: 1,
      borderTopColor: '#192A45',
      paddingBottom: bottomInset,
      paddingTop: 8,
      height: 56 + bottomInset,
    }}>
      {state.routes.map((route, idx) => {
        const cfg = TAB_CONFIG[route.name] || {};
        const focused = state.index === idx;
        const isFAB = route.name === SCREENS.LIST_ASSET;
        const iconName = focused ? cfg.active : cfg.inactive;
        const accentColor = cfg.color;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        if (isFAB) {
          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.85}
            >
              <View style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: '#38BDF8',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
                shadowColor: '#38BDF8',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.45,
                shadowRadius: 8,
                elevation: 6,
              }}>
                <Ionicons name="add" size={26} color="#070B14" />
              </View>
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
            activeOpacity={0.8}
          >
            {/* Coloured pill indicator when active */}
            {focused && (
              <View style={{
                position: 'absolute',
                top: -8,
                width: 28,
                height: 3,
                borderRadius: 2,
                backgroundColor: accentColor,
              }} />
            )}
            <Ionicons
              name={iconName}
              size={22}
              color={focused ? accentColor : '#2E4A6B'}
            />
            <Text style={{
              fontSize: 10,
              fontWeight: '700',
              color: focused ? accentColor : '#2E4A6B',
              letterSpacing: 0.2,
            }}>
              {cfg.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Main tab navigator ─────────────────────────────────────────────────────────
function MainTabs({ isDark }) {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tab.Screen name={SCREENS.HOME}>
        {(props) => <HomeScreen {...props} isDark={isDark} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.SEARCH}>
        {(props) => <SearchScreen {...props} isDark={isDark} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.LIST_ASSET}>
        {(props) => <ListAssetScreen {...props} isDark={isDark} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.INVEST}>
        {(props) => <InvestScreen {...props} isDark={isDark} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.VAULT}>
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
