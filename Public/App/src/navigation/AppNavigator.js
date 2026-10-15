// ─── Navigation Root ──────────────────────────────────────────────────────────
// Wires all screens together using React Navigation

import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, Platform, Linking, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SCREENS, TABS } from '../constants/navigation';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ActivityIndicator } from 'react-native';

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

// ── Modern Floating Tab Bar Palette ──────────────────────────────────────────
// Selection color matches the user's signature purple (#976af0)
const ACTIVE_TAB = '#976af0';          // Brand Purple
const INACTIVE_TAB = '#94A3B8';        // Muted Slate

const TAB_CONFIG = {
  [SCREENS.HOME]:       { active: 'home',             inactive: 'home-outline',           label: 'Home'    },
  [SCREENS.SEARCH]:     { active: 'grid',             inactive: 'grid-outline',           label: 'Market'  },
  [SCREENS.LIST_ASSET]: { active: 'add',               inactive: 'add',                    label: ''        },
  [SCREENS.INVEST]:     { active: 'trending-up',       inactive: 'trending-up-outline',    label: 'Invest'  },
  [SCREENS.VAULT]:      { active: 'shield-checkmark',  inactive: 'shield-outline',         label: 'Vault'   },
};

const TAB_ORDER = [SCREENS.HOME, SCREENS.SEARCH, SCREENS.LIST_ASSET, SCREENS.INVEST, SCREENS.VAULT];

// ── Custom floating tab bar ───────────────────────────────────────────────────
function CustomTabBar({ state, navigation, isDark }) {
  const insets = useSafeAreaInsets();
  // Safe bottom offset ensuring floating pill sits gracefully above home indicator / navigation bar
  const bottomMargin = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 14);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingBottom: bottomMargin,
        paddingHorizontal: 16,
        zIndex: 100,
      }}
    >
      <View
        pointerEvents="auto"
        style={{
          width: '100%',
          maxWidth: 460,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.75)',
          shadowColor: isDark ? '#000000' : '#1E2768',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: isDark ? 0.45 : 0.14,
          shadowRadius: 24,
          elevation: 12,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: isDark ? 'rgba(21, 29, 66, 0.72)' : 'rgba(255, 255, 255, 0.75)',
          ...(Platform.OS === 'web'
            ? {
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                boxShadow: isDark
                  ? '0 16px 36px -4px rgba(0, 0, 0, 0.55), 0 8px 16px -6px rgba(0, 0, 0, 0.35)'
                  : '0 16px 36px -4px rgba(30, 39, 104, 0.16), 0 8px 16px -6px rgba(30, 39, 104, 0.08)',
              }
            : {}),
        }}
      >
        {/* Background-only glass gradient sheen */}
        <LinearGradient
          colors={
            isDark
              ? ['rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.02)', 'rgba(0, 0, 0, 0.2)']
              : ['rgba(255, 255, 255, 0.85)', 'rgba(255, 255, 255, 0.55)', 'rgba(240, 246, 255, 0.45)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Top edge light-reflection line for frosted glass realism */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 24,
            right: 24,
            height: 1,
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.95)',
          }}
        />

        {/* Content Row: tabs, icons, labels, FAB stay completely sharp and unaffected */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 7,
            paddingHorizontal: 8,
          }}
        >
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
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#976af0', '#00fbff']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#976af0',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.38,
                      shadowRadius: 10,
                      elevation: 7,
                      borderWidth: focused ? 2.5 : 0,
                      borderColor: '#FFFFFF',
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
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 6,
                  paddingHorizontal: 2,
                  borderRadius: 20,
                  backgroundColor: 'transparent',
                  gap: 3,
                  position: 'relative',
                }}
                activeOpacity={0.75}
              >
                {focused && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 2,
                      width: 14,
                      height: 2.5,
                      borderRadius: 2,
                      backgroundColor: ACTIVE_TAB,
                    }}
                  />
                )}
                <Ionicons
                  name={iconName}
                  size={21}
                  color={focused ? ACTIVE_TAB : (isDark ? '#94A3B8' : '#64748B')}
                />
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: focused ? '700' : '600',
                    color: focused ? ACTIVE_TAB : (isDark ? '#94A3B8' : '#64748B'),
                    letterSpacing: 0.1,
                  }}
                >
                  {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
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
      screenOptions={{
        headerShown: false,
        unmountOnBlur: true,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
      tabBar={(props) => <CustomTabBar {...props} isDark={isDark} />}
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
  const { isDark } = useTheme();
  const { isAuthenticated, sessionRestored } = useAuth();

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

  if (!sessionRestored) {
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? '#0F172A' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

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
