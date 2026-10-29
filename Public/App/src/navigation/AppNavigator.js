// ─── Navigation Root ──────────────────────────────────────────────────────────
// Wires all screens together using React Navigation

import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
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
import VerifyAccountScreen from '../screens/VerifyAccountScreen';
import BankDetailsScreen from '../screens/BankDetailsScreen';
import EscrowTrackerScreen from '../screens/EscrowTrackerScreen';
import EscrowOrdersScreen from '../screens/EscrowOrdersScreen';
import ProfileScreen     from '../screens/ProfileScreen';
import ProfileAnalyticsScreen from '../screens/ProfileAnalyticsScreen';
import ARScreen          from '../screens/ARScreen';
import LiveRoomPreview from '../components/liveRoomPreview/LiveRoomPreview';
import ScanAndKnowScreen from '../screens/ScanAndKnowScreen';

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
const ACTIVE_TAB = '#00C2FF';          // Luminous Cyan / Electric Blue
const INACTIVE_TAB = 'rgba(255, 255, 255, 0.65)'; // Translucent White

const TAB_CONFIG = {
  [SCREENS.HOME]:       { active: 'home',             inactive: 'home-outline',           color: '#00C2FF', label: 'Home'    },
  [SCREENS.SEARCH]:     { active: 'grid',             inactive: 'grid-outline',           color: '#00C2FF', label: 'Market'  },
  [SCREENS.LIST_ASSET]: { active: 'add',              inactive: 'add',                    color: '#FFFFFF', label: ''        },
  [SCREENS.INVEST]:     { active: 'trending-up',      inactive: 'trending-up-outline',    color: '#00C2FF', label: 'Invest'  },
  [SCREENS.VAULT]:      { active: 'shield-checkmark', inactive: 'shield-outline',         color: '#00C2FF', label: 'Vault'   },
};

const TAB_ORDER = [SCREENS.HOME, SCREENS.SEARCH, SCREENS.LIST_ASSET, SCREENS.INVEST, SCREENS.VAULT];

// ── Custom floating tab bar ───────────────────────────────────────────────────
function CustomTabBar({ state, navigation, isDark }) {
  const insets = useSafeAreaInsets();
  const bottomMargin = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 14);

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingBottom: bottomMargin,
        paddingHorizontal: 16,
        zIndex: 100,
        pointerEvents: 'box-none',
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 460,
          borderRadius: 32,
          borderWidth: 1.2,
          borderColor: 'rgba(255, 255, 255, 0.22)',
          shadowColor: '#0f45c4ff',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.2,
          shadowRadius: 20,
          elevation: 8,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: 'rgba(15, 21, 45, 0.22)',
          ...(Platform.OS === 'web'
            ? {
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                boxShadow:
                  '0 8px 32px 0 rgba(0, 0, 0, 0.2), inset 0 1px 1px 0 rgba(255, 255, 255, 0.25)',
              }
            : {}),
        }}
      >
        <LinearGradient
          colors={[
            'rgba(255, 255, 255, 0.14)',
            'rgba(20, 30, 60, 0.12)',
            'rgba(10, 16, 35, 0.25)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.4, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}
        />

        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 20,
            right: 20,
            height: 1,
            backgroundColor: 'rgba(255, 255, 255, 0.35)',
            pointerEvents: 'none',
          }}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 8,
            paddingHorizontal: 8,
          }}
        >
          {state.routes.map((route, idx) => {
            const cfg = TAB_CONFIG[route.name] || {};
            const focused = state.index === idx;
            const isFAB = route.name === SCREENS.LIST_ASSET;
            const iconName = focused ? cfg.active : cfg.inactive;
            const tabColor = cfg.color || '#1D4ED8';

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
                    colors={['#38BDF8', '#1D4ED8']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#1D4ED8',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.4,
                      shadowRadius: 10,
                      elevation: 8,
                      borderWidth: focused ? 2.5 : 1.5,
                      borderColor: 'rgba(255, 255, 255, 0.9)',
                    }}
                  >
                    <Ionicons name="add" size={28} color="#FFFFFF" />
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
                      top: 1,
                      width: 18,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: tabColor,
                      shadowColor: tabColor,
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.6,
                      shadowRadius: 3,
                      elevation: 3,
                    }}
                  />
                )}
                <Ionicons
                  name={iconName}
                  size={21}
                  color={focused ? tabColor : 'rgba(255, 255, 255, 0.6)'}
                />
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: focused ? '700' : '600',
                    color: focused ? tabColor : 'rgba(255, 255, 255, 0.6)',
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

function MainTabs({ isDark, toggleTheme }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        unmountOnBlur: true,
        sceneStyle: { backgroundColor: 'transparent' },
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
        {(props) => <HomeScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.SEARCH}>
        {(props) => <SearchScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.LIST_ASSET}>
        {(props) => <ListAssetScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.INVEST}>
        {(props) => <InvestScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
      </Tab.Screen>
      <Tab.Screen name={SCREENS.VAULT}>
        {(props) => <VaultScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ── Root stack ────────────────────────────────────────────────────────────────
export default function Navigation() {
  const { isDark, toggleTheme } = useTheme();
  const { isAuthenticated, sessionRestored } = useAuth();

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

  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: isDark ? '#0F172A' : '#F3EEFF',
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: isDark ? '#0F172A' : '#F3EEFF' },
        }}
      >
        {!isAuthenticated ? (
          <>
            <Stack.Screen name={SCREENS.SPLASH}>
              {(props) => <SplashScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.ONBOARDING}>
              {(props) => <OnboardingScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.LOGIN}>
              {(props) => <LoginScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.REGISTER}>
              {(props) => <RegisterScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.RESET_PASSWORD}>
              {(props) => <ResetPasswordScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.AR_VIEWER} options={{ headerShown: false }}>
              {(props) => <LiveRoomPreview {...props} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.LIVE_ROOM_PREVIEW} options={{ headerShown: false }}>
              {(props) => <LiveRoomPreview {...props} />}
            </Stack.Screen>
          </>
        ) : (
          <>
            <Stack.Screen name={SCREENS.MAIN_TABS}>
              {() => <MainTabs isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.SEARCH}>
              {(props) => <SearchScreen {...props} isDark={isDark} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.LIST_ASSET}>
              {(props) => <ListAssetScreen {...props} isDark={isDark} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.SCAN_AND_KNOW}>
              {(props) => <ScanAndKnowScreen {...props} isDark={isDark} />}
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

            <Stack.Screen name={SCREENS.VERIFY_ACCOUNT}>
              {(props) => <VerifyAccountScreen {...props} isDark={isDark} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.BANK_DETAILS}>
              {(props) => <BankDetailsScreen {...props} isDark={isDark} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.ESCROW_TRACKER}>
              {(props) => <EscrowTrackerScreen {...props} isDark={isDark} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.ESCROW_ORDERS}>
              {(props) => <EscrowOrdersScreen {...props} isDark={isDark} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.PROFILE}>
              {(props) => <ProfileScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.PROFILE_ANALYTICS}>
              {(props) => <ProfileAnalyticsScreen {...props} isDark={isDark} toggleTheme={toggleTheme} />}
            </Stack.Screen>

            <Stack.Screen name={SCREENS.AR_VIEWER} options={{ headerShown: false }}>
              {(props) => <LiveRoomPreview {...props} />}
            </Stack.Screen>
            <Stack.Screen name={SCREENS.LIVE_ROOM_PREVIEW} options={{ headerShown: false }}>
              {(props) => <LiveRoomPreview {...props} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
