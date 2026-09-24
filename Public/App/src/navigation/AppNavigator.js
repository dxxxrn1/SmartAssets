// ─── Navigation Root ──────────────────────────────────────────────────────────
// Wires all screens together using React Navigation
//
// Install required packages:
//   npx expo install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
//   npx expo install react-native-screens react-native-safe-area-context

import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SCREENS, TABS } from '../constants/navigation';
import { useColors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

// ─── Screen imports ────────────────────────────────────────────────────────────
import SplashScreen      from '../screens/SplashScreen';
import OnboardingScreen  from '../screens/OnboardingScreen';
import LoginScreen       from '../screens/LoginScreen';
import RegisterScreen    from '../screens/RegisterScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
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
import ProfileScreen     from '../screens/ProfileScreen';

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// Reference used so a deep link can navigate before/after the navigator mounts
const navigationRef = createNavigationContainerRef();

// Supabase appends the recovery token to the redirect URL as a hash
// (smartassets://reset-password#access_token=...&type=recovery) or, on
// some flows, as a query string. This pulls the token out of either.
function extractResetToken(url) {
  if (!url || typeof url !== 'string') return null;

  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');

  let paramsString = '';
  if (hashIndex !== -1) {
    paramsString = url.substring(hashIndex + 1);
  } else if (queryIndex !== -1) {
    paramsString = url.substring(queryIndex + 1);
  }

  if (!paramsString) return null;

  const params = {};
  paramsString.split('&').forEach((pair) => {
    const [key, value] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  });

  if (params.type === 'recovery' && params.access_token) {
    return params.access_token;
  }

  return null;
}

// ── All tabs use unified blue palette ──────────────────────────────────────────
const ACTIVE_BLUE = '#38BDF8';
const INACTIVE_BLUE = '#1E3A5F';

const TAB_CONFIG = {
  [SCREENS.HOME]:       { active: 'grid',             inactive: 'grid-outline',           label: 'Market'  },
  [SCREENS.SEARCH]:     { active: 'search',            inactive: 'search-outline',         label: 'Search'  },
  [SCREENS.LIST_ASSET]: { active: 'add',               inactive: 'add',                    label: ''        },
  [SCREENS.INVEST]:     { active: 'trending-up',       inactive: 'trending-up-outline',    label: 'Invest'  },
  [SCREENS.VAULT]:      { active: 'shield-checkmark',  inactive: 'shield-outline',         label: 'Vault'   },
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
              <LinearGradient
                colors={['#d46bfdff', '#00b2fec1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 4,
                  shadowColor: '#38BDF8',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.5,
                  shadowRadius: 8,
                  elevation: 6,
                }}
              >
                <Ionicons name="add" size={26} color="#FFFFFF" />
              </LinearGradient>
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
            {focused && (
              <View style={{
                position: 'absolute',
                top: -8,
                width: 28,
                height: 3,
                borderRadius: 2,
                backgroundColor: ACTIVE_BLUE,
              }} />
            )}
            <Ionicons
              name={iconName}
              size={22}
              color={focused ? ACTIVE_BLUE : INACTIVE_BLUE}
            />
            <Text style={{
              fontSize: 10,
              fontWeight: '700',
              color: focused ? ACTIVE_BLUE : '#FFFFFF',
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
  const pendingTokenRef = useRef(null);

  useEffect(() => {
    const handleIncomingUrl = (url) => {
      const token = extractResetToken(url);
      if (!token) return;

      if (navigationRef.isReady()) {
        navigationRef.navigate(SCREENS.RESET_PASSWORD, { accessToken: token });
      } else {
        pendingTokenRef.current = token;
      }
    };

    if (Platform.OS !== 'web') {
      Linking.getInitialURL().then((url) => {
        if (url) handleIncomingUrl(url);
      });
      const subscription = Linking.addEventListener('url', ({ url }) => {
        handleIncomingUrl(url);
      });
      return () => subscription.remove();
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      handleIncomingUrl(window.location.href);
    }
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (pendingTokenRef.current) {
          navigationRef.navigate(SCREENS.RESET_PASSWORD, {
            accessToken: pendingTokenRef.current,
          });
          pendingTokenRef.current = null;
        }
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
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
            <Stack.Screen name={SCREENS.RESET_PASSWORD}>
              {(props) => <ResetPasswordScreen {...props} isDark={isDark} />}
            </Stack.Screen>
          </>
        ) : (
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
            <Stack.Screen name={SCREENS.PROFILE}>
              {(props) => <ProfileScreen {...props} isDark={isDark} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}