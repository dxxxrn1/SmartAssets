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
| Live Room Preview | `src/components/liveRoomPreview/LiveRoomPreview.js` | `LiveRoomPreview` |
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

### Live Room Preview

The Live Room Preview uses the Expo Go camera preview with a 2D artwork overlay. It does not use ARCore, ARKit, Viro, or native AR. From `Public/App`, install the SDK-matched packages:

```bash
npx expo install expo-camera expo-sensors expo-screen-orientation react-native-gesture-handler react-native-reanimated
```

Then start the app with `npx expo start` and open it on a physical Android or iOS device. `CameraView` is device-only; simulators do not provide a useful live camera feed. `app.json` already contains the camera and motion permission descriptions, and the application root is wrapped in `GestureHandlerRootView`.

Register `LiveRoomPreview` from any existing screen using the route constant and listing data:

```js
import { SCREENS } from '../constants/navigation';

navigation.navigate(SCREENS.LIVE_ROOM_PREVIEW, {
  imageUri: 'https://example.com/listing-artwork.jpg',
  widthCm: 60,
  heightCm: 80,
  title: 'Abstract Study, 1987',
  listingId: 'listing-123',
  onBid: (listingId) => navigation.navigate(SCREENS.CHECKOUT, { listingId }),
});
```

The screen asks for camera access, calibrates against an A4 sheet, and supports a clearly marked approximate-size skip. Drag, pinch, and rotate the overlay over the uninterrupted live feed. Device motion gently offsets the image when available; unsupported sensors leave manual placement available. Camera and motion updates pause when the app is backgrounded or the route loses focus. For bids, prefer a serializable listing action in your app rather than passing callbacks in route params if your navigation setup enforces serializable state.

## TODO

- [ ] Replace emoji icon fallbacks with `@expo/vector-icons` (Feather / Lucide)
- [ ] Add `expo-linear-gradient` for hero image overlays and gradient buttons
- [ ] Load Google Fonts via `expo-font` (Outfit, Playfair Display, DM Mono)
- [ ] Wire MetaMask / WalletConnect via `@metamask/sdk-react-native`
- [ ] Add photo upload to `ListAssetScreen` via `expo-image-picker`
- [ ] Replace circular SVG score ring in `HealthReportScreen` with `react-native-svg`
- [ ] Connect to Backend API (`d:\Native\SmartAssets\Backend\src`)
- [ ] Add animations via `react-native-reanimated`
