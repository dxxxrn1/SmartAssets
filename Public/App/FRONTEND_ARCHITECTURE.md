# SmartAssets — Frontend Architecture & Wiring Guide

> **Master Architecture Guide:** For full system diagrams and specifications, please refer to the primary documentation in [`docs/FRONTEND_ARCHITECTURE.md`](file:///d:/Native/SmartAssets/docs/FRONTEND_ARCHITECTURE.md) and [`docs/SYSTEM_DIAGRAMS.md`](file:///d:/Native/SmartAssets/docs/SYSTEM_DIAGRAMS.md).

---

## 1. High-Level Architecture Overview

SmartAssets is a production **React Native (Expo SDK 54)** mobile application targeting iOS, Android, and Web with native performance and a luxury design language.

```mermaid
flowchart TD
    APP[Public/App/App.js] --> PROVIDERS[ThemeProvider + AuthProvider + GestureHandlerRootView]
    PROVIDERS --> NAV[src/navigation/AppNavigator.js]
    
    NAV --> AUTH_STACK[Unauthenticated Stack: Splash, Onboarding, Login, Register, ResetPassword]
    NAV --> MAIN_TABS[Authenticated MainTabs: Home, Market, [+] FAB ListAsset, Invest, Vault]
    NAV --> MODAL_STACK[Detail Stack: AssetDetail, Certificate, Provenance, HealthReport, Checkout, EscrowTracker, ScanAndKnow, AR]
```

```
SmartAssets/
└── Public/App/            # Cross-platform Expo / React Native App
    ├── package.json       # Expo SDK 54, React Navigation 7, @expo/vector-icons
    ├── App.js             # Root application bootstrap (Theme & Navigation Container)
    └── src/
        ├── navigation/    # Screen routing, Tab bar & Stack navigation (AppNavigator.js)
        ├── screens/       # 25 production application screens
        ├── components/    # Reusable design primitives & LiveRoomPreview camera module
        ├── constants/     # Colors/theme tokens (theme.js), navigation keys, and mock data
        └── context/       # AuthContext (session, JWT, wallet) & ThemeContext
```

---

## 2. Navigation Architecture (`src/navigation/AppNavigator.js`)

Navigation is built with **React Navigation v7** using a two-tier hierarchy: a **Root Native Stack Navigator** combined with a **Custom Floating Glass Bottom Tab Navigator**.

### Hierarchy Diagram:
```
NavigationContainer
 ├── Root Stack Navigator
 │    ├── SplashScreen           (Obsidian luxury branding)
 │    ├── OnboardingScreen       (3-step value proposition carousel)
 │    ├── LoginScreen            (Email/Password + MetaMask Web3 connection)
 │    ├── RegisterScreen         (Account registration)
 │    ├── ResetPasswordScreen    (Deep link token password reset)
 │    ├── MainTabs (Bottom Tabs) ─── 5 Tab Screens:
 │    │    ├── Home (Market overview & stats)
 │    │    ├── Market (SearchScreen - discovery catalog)
 │    │    ├── [+] Center FAB (ListAssetScreen - 4-step wizard)
 │    │    ├── Invest (InvestScreen - fractional co-ownership)
 │    │    └── Vault (VaultScreen - user portfolio custody)
 │    └── Modal / Detail Stack Screens:
 │         ├── AssetDetailScreen   (Hero, valuation, overview/cert/history tabs)
 │         ├── CertificateScreen   (Digital certificate of authenticity + QR)
 │         ├── ProvenanceScreen    (Chain-of-custody timeline on Sepolia)
 │         ├── HealthReportScreen  (AI health score & safety metrics)
 │         ├── CheckoutScreen      (Purchase flow & payment methods)
 │         ├── EscrowTrackerScreen (9-stage live escrow tracker)
 │         ├── ScanAndKnowScreen   (Camera AI instant valuation)
 │         ├── LiveRoomPreview     (True-scale A4 camera preview overlay)
 │         ├── ARScreen            (3D model inspector)
 │         ├── ProfileScreen       (User settings & wallet linking)
 │         ├── ProfileAnalyticsScreen (Portfolio ROI & performance charts)
 │         ├── VerifyAccountScreen (3-document KYC compliance submission)
 │         ├── BankDetailsScreen   (Bank account verification)
 │         └── VerificationScreen  (Appraiser inspection status tracker)
```

---

## 3. Clean Vector Icon System (`@expo/vector-icons`)

All screens strictly use **`@expo/vector-icons`** (`Ionicons` and `Feather`):

### Why Vector Icons:
1. **Dynamic Theming:** Icons accept `color={c.primary}` or `color={c.warm}` and automatically update between dark and light modes.
2. **Sharp & Scalable:** Render crisp SVG/glyph strokes at any density, avoiding OS-dependent emoji variations (iOS vs Android).
3. **Consistent Stroke Weights:** Uniform visual language across the luxury aesthetic.

### Icon Wiring Map:
| Location | Component / Screen | Icon Component & Name | Purpose |
| :--- | :--- | :--- | :--- |
| **Tab 1: Home** | `AppNavigator.js` | `Ionicons` `home` / `home-outline` | Market overview |
| **Tab 2: Market** | `AppNavigator.js` | `Ionicons` `grid` / `grid-outline` | Discover assets |
| **Tab 3: Add (FAB)** | `AppNavigator.js` | `Ionicons` `add` (size 28) | Center submission action |
| **Tab 4: Invest** | `AppNavigator.js` | `Ionicons` `trending-up` / `trending-up-outline` | Fractional co-ownership |
| **Tab 5: Vault** | `AppNavigator.js` | `Ionicons` `shield-checkmark` / `shield-outline` | Secured custody |
| **Badges** | `components/ui.js` | `Feather` `check` & `clock` | Verified & Pending states |
| **Header Bell** | `HomeScreen.js` | `Feather` `bell` | Notifications trigger |
| **Trending Badge** | `HomeScreen.js` | `Ionicons` `flame` | Trending collectibles |
| **Search Bar** | `SearchScreen.js` | `Feather` `search` & `x` | Search input & clear button |
| **Certificate** | `CertificateScreen.js` | `Ionicons` `shield-checkmark`, `qr-code-outline`, `Feather` `download`, `share-2` | Authenticity & export actions |
| **Checkout** | `CheckoutScreen.js` | `Feather` `credit-card`, `Ionicons` `wallet-outline`, `business-outline`, `checkmark-circle` | Payment methods & confirmation |
| **Escrow Tracker** | `EscrowTrackerScreen.js`| `Ionicons` `cube`, `airplane`, `checkmark-done-circle`, `alert-circle` | Sequential order states |

---

## 4. Theme & Styling System (`src/constants/theme.js`)

All styling uses standard React Native `StyleSheet` combined with dynamic theme tokens from `useColors(isDark)`:

- **Obsidian Dark Mode (`isDark = true`):**
  - Background: `#0B0F19` (Obsidian deep dark)
  - Card background: `#131C2E`
  - Border: `#1F2E47`
  - Text Primary / Warm: `#F8FAFC`
  - Text Muted: `#94A3B8`
- **Royal Light Mode (`isDark = false`):**
  - Background: `#F8FAFC`
  - Card background: `#FFFFFF`
  - Border: `#E2E8F0`
  - Text Primary: `#0F172A`
- **Luxury Gold / Primary Accent:**
  - Primary: `#C9A84C` (Classic warm gold) / `#1D4ED8` (Royal Blue)
  - Accent: `#00C2FF` (Luminous Cyan)
  - Green: `#10B981` (Emerald green for verified badges and health metrics)

---

## 5. Further Architectural Specifications

For exhaustive engineering details on other components, see:
- [Master System Diagrams (Mermaid)](file:///d:/Native/SmartAssets/docs/SYSTEM_DIAGRAMS.md)
- [Complete Frontend Architecture](file:///d:/Native/SmartAssets/docs/FRONTEND_ARCHITECTURE.md)
- [Backend API Guide](file:///d:/Native/SmartAssets/docs/BACKEND_API.md)
- [Blockchain Smart Contracts](file:///d:/Native/SmartAssets/docs/BLOCKCHAIN_SMART_CONTRACTS.md)
