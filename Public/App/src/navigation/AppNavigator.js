// ─── Navigation Root ──────────────────────────────────────────────────────────
// Wires all screens together using React Navigation

import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SCREENS, TABS } from '../constants/navigation';
import { ALIM, useColors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

// ── Screen imports ────────────────────────────────────────────────────────────
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
import ProfileAnalyticsScreen from '../screens/ProfileAnalyticsScreen';

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// Reference used so a deep link can navigate before/after the navigator mounts
const navigationRef = createNavigationContainerRef();

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

// ── Modern AlimBank Emerald Tab Bar Palette ───────────────────────────────────
const ACTIVE_TAB = '#333D9B';          // Royal Indigo
const INACTIVE_TAB = '#94A3B8';        // Muted Slate

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
      backgroundColor: '#FFFFFF',
      borderTopWidth: 1,
      borderTopColor: '#EDE9E1',
      paddingBottom: bottomInset,
      paddingTop: 8,
      height: 56 + bottomInset,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 6,
    }}>
      {state.routes.map((route, idx) => {
        const cfg = TAB_CONFIG[route.name] || {};
        const focused = state.index === idx;
        const isFAB = route.name === SCREENS.LIST_ASSET;
        const iconName = focused ? cfg.active : cfg.inactive;

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
                colors={['#3B82F6', '#2563EB', '#1E2768']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 4,
                  shadowColor: '#2563EB',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.35,
                  shadowRadius: 10,
                  elevation: 7,
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
                backgroundColor: ACTIVE_TAB,
              }} />
            )}
            <Ionicons
              name={iconName}
              size={22}
              color={focused ? ACTIVE_TAB : INACTIVE_TAB}
            />
            <Text style={{
              fontSize: 10,
              fontWeight: '700',
              color: focused ? ACTIVE_TAB : INACTIVE_TAB,
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
      // unmountOnBlur: true prevents inactive tab screens from rendering on web,
      // which fixes the duplicate floating settings gear icon (Bug #5).
      // On native, React Navigation already suspends inactive tabs visually.
      screenOptions={{ headerShown: false, unmountOnBlur: true }}
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

  // Listen for Supabase password-recovery deep link
  useEffect(() => {
    async function handleUrl(rawUrl) {
      const token = extractResetToken(rawUrl);
      if (token) {
        let attempts = 0;
        while (!navigationRef.isReady() && attempts < 20) {
          await new Promise((r) => setTimeout(r, 100));
          attempts++;
        }
        if (navigationRef.isReady()) {
          navigationRef.navigate(SCREENS.RESET_PASSWORD, { token });
        }
      }
    }

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const subscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
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
              {() => <MainTabs isDark={isDark} />}
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

            <Stack.Screen name={SCREENS.PROFILE_ANALYTICS}>
              {(props) => <ProfileAnalyticsScreen {...props} isDark={isDark} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
