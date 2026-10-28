# SmartAssets — Cross-Platform Mobile Application

> **Environment:** React Native 0.81.5 / Expo SDK 54  
> **Platforms:** iOS, Android, and Web  
> **Navigation:** React Navigation v7 (Root Stack + Floating Glass Bottom Tabs)  
> **Aesthetic:** Obsidian Dark & Royal Light Luxury UI System  
> **Icons:** 100% `@expo/vector-icons` (`Ionicons` + `Feather`)  
> **Location:** `Public/App/`

---

## 📱 Navigation & Screen Architecture

```mermaid
flowchart TD
    ROOT[AppNavigator.js] --> AUTH_GATE{Authenticated?}

    subgraph AUTH_FLOW ["Unauthenticated Stack"]
        AUTH_GATE -->|No| SPLASH[SplashScreen]
        SPLASH --> ONBOARD[OnboardingScreen]
        ONBOARD --> LOGIN[LoginScreen (Password & MetaMask)]
        LOGIN -.-> REGISTER[RegisterScreen]
        LOGIN -.-> RESET[ResetPasswordScreen]
    end

    subgraph MAIN_APP ["Authenticated Application"]
        AUTH_GATE -->|Yes| TABS[Floating Glass Bottom Tabs]
        
        subgraph TAB_BAR ["5 Bottom Tabs"]
            TAB_HOME["Home (Marketplace Overview)"]
            TAB_SEARCH["Search (Market Discovery & Filters)"]
            TAB_FAB["[+] Center FAB (ListAssetScreen Wizard)"]
            TAB_INVEST["Invest (Fractional Co-Ownership)"]
            TAB_VAULT["Vault (Portfolio Holdings & Custody)"]
        end

        TABS --> TAB_HOME
        TABS --> TAB_SEARCH
        TABS --> TAB_FAB
        TABS --> TAB_INVEST
        TABS --> TAB_VAULT

        subgraph DETAIL_STACK ["Detail & Inspection Modals"]
            ASSET_DETAIL["AssetDetailScreen"]
            CERTIFICATE["CertificateScreen"]
            PROVENANCE["ProvenanceScreen"]
            HEALTH_REPORT["HealthReportScreen"]
            CHECKOUT["CheckoutScreen"]
            ESCROW_TRACKER["EscrowTrackerScreen"]
            SCAN_KNOW["ScanAndKnowScreen"]
            LIVE_ROOM["LiveRoomPreview (AR Camera)"]
            PROFILE["ProfileScreen"]
            ANALYTICS["ProfileAnalyticsScreen"]
            VERIFY_ACC["VerifyAccountScreen (KYC)"]
            BANK_DETAILS["BankDetailsScreen"]
            VERIFICATION["VerificationScreen"]
        end

        TABS --> ASSET_DETAIL
        ASSET_DETAIL --> CERTIFICATE
        ASSET_DETAIL --> PROVENANCE
        ASSET_DETAIL --> HEALTH_REPORT
        ASSET_DETAIL --> CHECKOUT
        ASSET_DETAIL --> LIVE_ROOM
        CHECKOUT --> ESCROW_TRACKER
        TAB_HOME --> SCAN_KNOW
        TAB_HOME --> PROFILE
        PROFILE --> ANALYTICS
        PROFILE --> VERIFY_ACC
        PROFILE --> BANK_DETAILS
    end
```

---

## 📋 Comprehensive Screen Registry (25 Screens)

| Screen Name | File | Route Identifier | Primary Functionality |
| :--- | :--- | :--- | :--- |
| **Splash** | `SplashScreen.js` | `Splash` | Luxury obsidian branding and animated logo entrance. |
| **Onboarding** | `OnboardingScreen.js` | `Onboarding` | 3-step value proposition carousel with smooth slide transitions. |
| **Login** | `LoginScreen.js` | `Login` | Dual login: Email/password and MetaMask Web3 wallet connection. |
| **Register** | `RegisterScreen.js` | `Register` | New collector registration with password validation. |
| **Reset Password** | `ResetPasswordScreen.js` | `ResetPassword` | Deep-link token recovery flow (`#access_token=...`). |
| **Home / Market** | `HomeScreen.js` | `Home` (Tab) | Market overview, hero carousels, category pills, portfolio preview. |
| **Search / Discover** | `SearchScreen.js` | `Search` (Tab) | Real-time text search, category filters, and price ranges. |
| **List Asset (FAB)** | `ListAssetScreen.js` | `ListAsset` (Tab) | 4-step seller wizard integrated with AI Vision Gatekeeper. |
| **Invest / Shares** | `InvestScreen.js` | `Invest` (Tab) | Fractional co-ownership market with shares progress and payouts. |
| **Vault / Portfolio**| `VaultScreen.js` | `Vault` (Tab) | Custody portfolio, asset breakdown, deposits, and withdrawals. |
| **Asset Detail** | `AssetDetailScreen.js` | `AssetDetail` | High-res imagery, AI valuation bands, action buttons, 3 tabs. |
| **Certificate** | `CertificateScreen.js` | `Certificate` | Digital Certificate of Authenticity, ERC-721 token ID, QR code. |
| **Provenance** | `ProvenanceScreen.js` | `Provenance` | Chain-of-custody chronological milestones on Ethereum. |
| **Health Report** | `HealthReportScreen.js` | `HealthReport` | AI condition grade, authenticity score, and fraud risk audit. |
| **Checkout** | `CheckoutScreen.js` | `Checkout` | Multi-rail payment (Stripe Card, Sepolia ETH, Wire transfer). |
| **Escrow Tracker** | `EscrowTrackerScreen.js` | `EscrowTracker` | Live 9-stage escrow tracker with courier tracking and disputes. |
| **Scan & Know** | `ScanAndKnowScreen.js` | `ScanAndKnow` | Instant AI camera inspection, ZAR market appraisal, cert matching. |
| **Live Room Preview**| `components/liveRoomPreview/` | `LiveRoomPreview` | Real camera feed, A4 true-scale calibration, pan/pinch/rotate. |
| **3D AR Viewer** | `ARScreen.js` | `ARViewer` | Interactive Three.js/GL 3D model inspector for decimated meshes. |
| **Profile** | `ProfileScreen.js` | `Profile` | User account settings, avatar upload, security, and wallet linking. |
| **Profile Analytics**| `ProfileAnalyticsScreen.js` | `ProfileAnalytics` | Portfolio performance charts, asset allocation, and ROI yields. |
| **Verify Account** | `VerifyAccountScreen.js` | `VerifyAccount` | 3-document institutional KYC submission (ID, Tax, Residence). |
| **Bank Details** | `BankDetailsScreen.js` | `BankDetails` | Bank account linking and verification for verified payouts. |
| **Verification Status**| `VerificationScreen.js`| `Verification` | Seller appraisal status tracker for senior appraiser review. |

---

## 🎨 Design Tokens & Theming (`src/constants/theme.js`)

The app features dynamic runtime theme switching via `useColors(isDark)`:
- **Obsidian Dark Mode (`isDark = true`):** `#0B0F19` canvas, `#131C2E` card surfaces, `#1F2E47` borders, and `#F8FAFC` warm text.
- **Royal Light Mode (`isDark = false`):** `#F8FAFC` canvas, `#FFFFFF` crisp cards, `#E2E8F0` soft borders, and `#0F172A` obsidian typography.
- **Accent Highlighting:** `#00C2FF` (Luminous Cyan) and `#C9A84C` (Classic Gold).

---

## 📷 Live Room Preview & Real-World Calibration

The Live Room Preview (`src/components/liveRoomPreview/LiveRoomPreview.js`) renders artwork over real-time camera feeds without ARKit/ARCore dependencies:
1. **Camera Calibration:** Calibrates against a standard A4 reference sheet (21.0cm × 29.7cm) to derive physical pixels-per-centimeter ratios.
2. **Gesture Controls:** Multi-touch gesture handlers (`react-native-gesture-handler`) for pinch-to-zoom, drag-to-position, and two-finger twist rotation.
3. **Motion Offset:** Sensor orientation (`expo-sensors`) provides smooth parallax motion offsets.

---

## 🚀 Getting Started

```bash
# 1. Install dependencies
cd d:\Native\SmartAssets\Public\App
npm install

# 2. Start Expo server
npm start

# 3. Choose platform:
# - Press 'a' for Android emulator
# - Press 'i' for iOS simulator
# - Press 'w' for Web browser
# - Scan terminal QR code with Expo Go on your mobile device
```

---

## 📚 Related Documentation
- [Frontend Mobile Architecture Guide](../../docs/FRONTEND_ARCHITECTURE.md)
- [Master System Diagrams](../../docs/SYSTEM_DIAGRAMS.md)
- [Backend API Specification](../../docs/BACKEND_API.md)
- [Root Documentation Hub](../../docs/README.md)
