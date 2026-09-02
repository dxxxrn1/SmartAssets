# SmartAssets Frontend Architecture & Wiring Guide

> **Purpose:** This document explains how the SmartAssets frontend is structured, wired, and rendered. Use this guide to understand the codebase and confidently explain the architecture in walkthroughs and presentations.

---

## 1. High-Level Architecture Overview

The repository contains two connected frontend representations of SmartAssets:
1. **`prototype_src/`**: The original React + Vite + Tailwind prototype built inside Figma Make.
2. **`Public/App/`**: The production-ready **React Native (Expo SDK 54)** mobile application that brings the prototype to iOS, Android, and Web with native performance.

```
SmartAssets/
├── prototype_src/         # Vite + React prototype (Web / Figma Make)
│   └── FRONTEND_ARCHITECTURE.md # (This guide)
└── Public/App/            # Cross-platform Expo / React Native App
    ├── package.json       # Expo SDK 54, React Navigation, @expo/vector-icons
    ├── App.js             # Root application bootstrap (Theme & Navigation Container)
    └── src/
        ├── navigation/    # Screen routing, Tab bar & Stack navigation
        ├── screens/       # Individual application screens
        ├── components/    # Reusable design system primitives (Badges, Buttons, Cards)
        └── constants/     # Colors/theme tokens, navigation keys, and mock data
```

---

## 2. Navigation Architecture (`src/navigation/AppNavigator.js`)

Navigation is built with **React Navigation v7** using a two-tier hierarchy: a **Root Native Stack Navigator** wrapped around a **Bottom Tab Navigator**.

### Hierarchy Diagram:
```
NavigationContainer
 └── Root Stack Navigator
      ├── SplashScreen           (Initial splash / branding)
      ├── OnboardingScreen       (3-step value proposition carousel)
      ├── LoginScreen            (Email/Password + MetaMask wallet connection)
      ├── MainTabs (Bottom Tabs) ─── 5 Tab Screens:
      │    ├── Market (HomeScreen)
      │    ├── Search (SearchScreen)
      │    ├── [+] Center FAB (ListAssetScreen)
      │    ├── Invest (InvestScreen - Fractional co-ownership)
      │    └── Vault (VaultScreen - User portfolio & holdings)
      └── Modal / Detail Stack Screens:
           ├── AssetDetailScreen   (Hero, valuation, overview/cert/history tabs)
           ├── CertificateScreen   (Digital certificate of authenticity + QR)
           ├── ProvenanceScreen    (Chain-of-custody timeline)
           ├── HealthReportScreen  (AI health score & safety metrics)
           ├── CheckoutScreen      (Purchase flow & payment methods)
           └── VerificationScreen  (Appraiser verification tracker)
```

### How Screen Transitions & Parameters Work:
Screens communicate by passing the `asset` object in navigation route params:
- **From Market / Search / Vault to Asset Detail:**
  ```javascript
  navigation.navigate(SCREENS.ASSET_DETAIL, { asset });
  ```
- **From Asset Detail to sub-screens:**
  ```javascript
  navigation.navigate(SCREENS.CERTIFICATE, { asset });
  navigation.navigate(SCREENS.PROVENANCE, { asset });
  navigation.navigate(SCREENS.HEALTH_REPORT, { asset });
  navigation.navigate(SCREENS.CHECKOUT, { asset });
  ```
- **Receiving params in screens:**
  ```javascript
  export default function AssetDetailScreen({ navigation, route, isDark }) {
    const asset = route?.params?.asset ?? {};
    // asset.name, asset.price, asset.badge, asset.cert, etc.
  }
  ```

---

## 3. Clean Vector Icon System (`@expo/vector-icons`)

Previously, placeholder emojis and unicode characters (like 🔔, 🔍, 🛡️, 💳, ✓, ←) were used. These were replaced with **`@expo/vector-icons`** (`Ionicons` and `Feather`):

### Why Vector Icons:
1. **Dynamic Theming:** Icons accept `color={c.primary}` or `color={c.warm}` and automatically update between dark and light modes.
2. **Sharp & Scalable:** Render crisp SVG/glyph strokes at any density, avoiding OS-dependent emoji variations (iOS vs Android).
3. **Consistent Stroke Weights:** Uniform visual language across the luxury aesthetic.

### Icon Wiring Map:
| Location | Component / Screen | Icon Component & Name | Purpose |
| :--- | :--- | :--- | :--- |
| **Tab 1: Market** | `AppNavigator.js` | `Ionicons` `grid` / `grid-outline` | Market overview |
| **Tab 2: Search** | `AppNavigator.js` | `Ionicons` `search` / `search-outline` | Discover assets |
| **Tab 3: Add (FAB)** | `AppNavigator.js` | `Ionicons` `add` (size 26) | Center submission action |
| **Tab 4: Invest** | `AppNavigator.js` | `Ionicons` `trending-up` / `trending-up-outline` | Fractional co-ownership |
| **Tab 5: Vault** | `AppNavigator.js` | `Ionicons` `shield-checkmark` / `shield-outline` | Secured custody |
| **Badges** | `components/ui.js` | `Feather` `check` & `clock` | Verified & Pending states |
| **Header Bell** | `HomeScreen.js` | `Feather` `bell` | Notifications trigger |
| **Trending Badge** | `HomeScreen.js` | `Ionicons` `flame` | Trending collectibles |
| **Search Bar** | `SearchScreen.js` | `Feather` `search` & `x` | Search input & clear button |
| **Upload Placeholders**| `ListAssetScreen.js` | `Feather` `camera` & `file-text` | Photo & certificate uploads |
| **Navigation Headers** | All stack screens | `Feather` `arrow-left` | Back button |
| **Certificate** | `CertificateScreen.js` | `Ionicons` `shield-checkmark`, `qr-code-outline`, `Feather` `download`, `share-2` | Authenticity & export actions |
| **Checkout** | `CheckoutScreen.js` | `Feather` `credit-card`, `Ionicons` `wallet-outline`, `business-outline`, `checkmark-circle` | Payment methods & confirmation |

---

## 4. Theme & Styling System (`src/constants/theme.js`)

All styling uses standard React Native `StyleSheet` combined with dynamic theme tokens from `useColors(isDark)`:

- **Obsidian Dark Mode (`isDark = true`):**
  - Background: `#0B0F19` (Obsidian deep dark)
  - Card background: `#131C2E`
  - Border: `#1F2E47`
  - Text Primary / Warm: `#F8FAFC`
  - Text Muted: `#94A3B8`
- **Luxury Gold / Primary Accent:**
  - Primary: `#C9A84C` (Classic warm gold)
  - Primary Background: `rgba(201, 168, 76, 0.12)`
- **Verification Green:**
  - Green: `#10B981` (Emerald green for verified badges and health metrics)

---

## 5. Screen-by-Screen User Flows (Quick Presentation Script)

When explaining how the app works, follow this logical progression:

1. **Onboarding & Entry (`SplashScreen` -> `OnboardingScreen` -> `LoginScreen`):**
   - Splash screen establishes luxury positioning.
   - Onboarding carousel educates user on verification, blockchain certs, and fractional investing.
   - Login supports standard authentication and **MetaMask Web3 wallet connection**.
2. **Marketplace Discovery (`HomeScreen` & `SearchScreen`):**
   - Displays portfolio total, category chips (Watches, Art, Cars, Wine), and featured listings.
   - Search offers real-time filtering across categories, price, and year.
3. **Asset Due Diligence (`AssetDetailScreen`):**
   - Combines high-resolution photography with AI valuation bands.
   - 3 interactive tabs: **Overview** (specifications), **Certificate** (blockchain record), and **Provenance** (full chain-of-custody history).
4. **Trust Engine (`CertificateScreen` & `HealthReportScreen`):**
   - Certificate shows cryptographic hash, QR placeholder, and appraiser signature.
   - Health report gives a breakdown of authenticity score, condition grade, and fraud risk.
5. **Acquisition & Co-ownership (`InvestScreen` & `CheckoutScreen`):**
   - Invest screen shows fractional listings where users can buy shares in multi-million-pound assets.
   - Checkout calculates fees and supports Card, MetaMask Crypto, or Bank Wire.
6. **Seller Workflow (`ListAssetScreen` & `VerificationScreen`):**
   - 4-step listing wizard (Details, Photos, Docs, Price).
   - Verification tracker shows real-time inspection progress by senior appraisers.
