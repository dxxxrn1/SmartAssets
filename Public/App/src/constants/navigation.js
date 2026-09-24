// ─── Navigation Stack Definition ─────────────────────────────────────────────
// All route names used with React Navigation (install @react-navigation/native)

export const SCREENS = {
  // Auth flow
  SPLASH: 'Splash',
  ONBOARDING: 'Onboarding',
  LOGIN: 'Login',
  REGISTER: 'Register',
  RESET_PASSWORD: 'ResetPassword',

  // Main tab shell
  MAIN_TABS: 'MainTabs',

  // Main tabs
  HOME: 'Home',
  SEARCH: 'Search',
  LIST_ASSET: 'ListAsset',
  INVEST: 'Invest',      // Fractional / Invest tab
  VAULT: 'Vault',

  // Detail screens (pushed on top of tabs)
  ASSET_DETAIL: 'AssetDetail',
  CERTIFICATE: 'Certificate',
  PROVENANCE: 'Provenance',
  HEALTH_REPORT: 'HealthReport',
  CHECKOUT: 'Checkout',
  VERIFICATION: 'Verification',
  ESCROW_TRACKER: 'EscrowTracker',
  PROFILE: 'Profile',
};

// Bottom tab config — mirrors BottomNav in prototype
export const TABS = [
  { name: SCREENS.HOME,       label: 'Market',  icon: 'grid' },
  { name: SCREENS.SEARCH,     label: 'Search',  icon: 'search' },
  { name: SCREENS.LIST_ASSET, label: 'List',    icon: 'plus',  isFAB: true },
  { name: SCREENS.INVEST,     label: 'Invest',  icon: 'bar-chart-2' },
  { name: SCREENS.VAULT,      label: 'Vault',   icon: 'shield' },
];