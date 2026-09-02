# SmartAssets — React Native Skeleton

Native implementation skeleton ported from the **SmartAssets Figma prototype** (10+ screens).

## Stack

| Package | Version | Purpose |
|---|---|---|
| `expo` | ~54 | Managed workflow |
| `react-native` | 0.81.5 | Core framework |
| `@react-navigation/native` | ^7 | Navigation container |
| `@react-navigation/native-stack` | ^7 | Auth & detail stack |
| `@react-navigation/bottom-tabs` | ^7 | Main tab bar |

## Screens implemented

| Screen | File | Route name |
|---|---|---|
| Splash | `SplashScreen.js` | `Splash` |
| Onboarding (3 slides) | `OnboardingScreen.js` | `Onboarding` |
| Login | `LoginScreen.js` | `Login` |
| Home / Market | `HomeScreen.js` | `Home` (tab) |
| Search / Discover | `SearchScreen.js` | `Search` (tab) |
| List Asset (4-step form) | `ListAssetScreen.js` | `ListAsset` (tab FAB) |
| Invest / Fractional | `InvestScreen.js` | `Invest` (tab) |
| Vault / Portfolio | `VaultScreen.js` | `Vault` (tab) |
| Asset Detail | `AssetDetailScreen.js` | `AssetDetail` |
| Certificate of Authenticity | `CertificateScreen.js` | `Certificate` |
| Provenance Timeline | `ProvenanceScreen.js` | `Provenance` |
| Asset Health Report | `HealthReportScreen.js` | `HealthReport` |
| Checkout | `CheckoutScreen.js` | `Checkout` |
| Verification Status | `VerificationScreen.js` | `Verification` |

## Design tokens

All colours, typography, and spacing mirror the prototype's sky-blue palette.
See `src/constants/theme.js` — full light **and** dark mode support via `useColors(isDark)`.

## Getting started

```bash
# Install dependencies
npm install

# Start Expo dev server
npm start

# Then press 'a' for Android, 'i' for iOS, or 'w' for web
```

## TODO

- [ ] Replace emoji icon fallbacks with `@expo/vector-icons` (Feather / Lucide)
- [ ] Add `expo-linear-gradient` for hero image overlays and gradient buttons
- [ ] Load Google Fonts via `expo-font` (Outfit, Playfair Display, DM Mono)
- [ ] Wire MetaMask / WalletConnect via `@metamask/sdk-react-native`
- [ ] Add photo upload to `ListAssetScreen` via `expo-image-picker`
- [ ] Replace circular SVG score ring in `HealthReportScreen` with `react-native-svg`
- [ ] Connect to Backend API (`d:\Native\SmartAssets\Backend\src`)
- [ ] Add animations via `react-native-reanimated`
