# SmartAssets — Master System Diagrams & Visual Architecture Guide

> **Scope:** This document is the visual blueprint for SmartAssets, containing production-accurate Mermaid diagrams for every subsystem: overall multi-tier architecture, escrow state machine, AI Vision Gatekeeper pipeline, mobile navigation topology, Web3 SIWE authentication, fractional co-ownership investment lifecycle, 3D glTF optimization, financial session inactivity lifecycle, portfolio snapshot time-series engine, and the Supabase PostgreSQL entity relationship diagram (ERD).

---

## 1. End-to-End System Architecture

The following diagram illustrates the interaction between the **Client Tier** (React Native Expo App), the **Backend API & Gateway Tier** (Express.js, Security, Rate Limiter, Inactivity Heartbeat, WebSockets), the **Intelligence & Services Tier** (Gemini AI Vision, Compliance/KYC, Market Oracle, Escrow Manager, Portfolio Snapshot Service), the **Storage & Database Tier** (Supabase PostgreSQL with RLS, Cloudinary, Local/Signed KYC Storage), and the **Decentralized Settlement Tier** (Ethereum Sepolia, Hardhat, ERC-721 Certificates, Escrow Smart Contract).

```mermaid
flowchart TB
    %% Client Tier
    subgraph CLIENT_TIER ["Client Tier (Mobile, Web & Sensor Systems)"]
        direction TB
        RN["React Native Expo SDK 54 App<br/>(iOS / Android / Web)"]
        WATCHER["InactivityWatcher & CrossPlatformDialog<br/>(Passive PanResponder Gesture Capture)"]
        CAM["Live Room Preview & AR<br/>(Expo Camera & Device Motion)"]
        WALLET["Web3 Wallets<br/>(MetaMask / Injected EIP-1193)"]
        RN --- WATCHER
        RN --- CAM
    end

    %% Security & API Gateway
    subgraph API_GATEWAY ["API Gateway & Security Layer (Express.js :5000)"]
        direction TB
        HELMET["Helmet & Strict Security Headers"]
        RATELIMIT["Rate Limiter (Auth & Uploads)"]
        SQL_GUARD["SQL Injection Sanitizer"]
        AUTH_MW["Auth & KYC Middleware<br/>(requireAuth, requireVerified, requireApprovedBank)"]
    end

    %% Core Services Tier
    subgraph SERVICES_TIER ["Backend Domain Services Tier"]
        direction TB
        AI_GATEKEEPER["AI Vision Gatekeeper Service<br/>(Gemini Flash Multimodal CV)"]
        COMPLIANCE["Compliance & KYC Engine<br/>(ID, Tax, Bank Acc, Proof of Residence)"]
        ORACLE["Live Market Oracle<br/>(ZAR Valuation Bands, Historical Volatility)"]
        ESCROW_SRV["Escrow Service & State Manager<br/>(Durable Lifecycle & Dispute Engine)"]
        PORTFOLIO_SRV["Portfolio Snapshot Service<br/>(Dated Valuation History & Time-Series)"]
        INVESTMENT_SRV["Investment Position Service<br/>(Fractional Ownership, Co-ownership Units)"]
        MODEL_SRV["3D Pipeline & glTF Transform<br/>(Tripo AI + Meshoptimizer Decimation)"]
        WEB3_SRV["Web3 Integration Service<br/>(Ethers.js v6, Nonce, SIWE EIP-4361)"]
        STRIPE_SRV["Stripe Checkout Service<br/>(Card & Bank Transfers)"]
        PRESENCE_SRV["WebSocket Presence & Inactivity Heartbeat"]
    end

    %% Data & Storage Tier
    subgraph DATA_TIER ["Data & Persistence Tier"]
        direction TB
        SUPA_DB[("Supabase PostgreSQL DB<br/>Row-Level Security (RLS)")]
        SUPA_AUTH["Supabase Auth Service<br/>(JWT, Sessions, Passwords)"]
        SECURE_STORE[("Gated KYC Storage<br/>(Private Signed URLs)")]
        PUBLIC_CDN[("Cloudinary & Public Assets CDN<br/>(Avatars, Listing Photos, glTF Models)")]
    end

    %% Blockchain Tier
    subgraph BLOCKCHAIN_TIER ["Decentralized Settlement Tier (Ethereum Sepolia)"]
        direction TB
        SMART_CERT["SmartAssetCertificate.sol<br/>(ERC-721 + On-Chain Provenance Milestones)"]
        SMART_ESCROW["SmartAssetEscrow.sol<br/>(ReentrancyGuard, 9-State Escrow Contract)"]
    end

    %% Flow Connections
    RN <-->|REST API JSON & File Uploads| HELMET
    RN <-->|Heartbeat & Presence Sockets| PRESENCE_SRV
    RN <-->|Web3 Signing| WALLET
    WALLET <-->|EIP-4361 Signatures| WEB3_SRV

    HELMET --> RATELIMIT --> SQL_GUARD --> AUTH_MW

    AUTH_MW --> AI_GATEKEEPER
    AUTH_MW --> COMPLIANCE
    AUTH_MW --> ORACLE
    AUTH_MW --> ESCROW_SRV
    AUTH_MW --> PORTFOLIO_SRV
    AUTH_MW --> INVESTMENT_SRV
    AUTH_MW --> MODEL_SRV
    AUTH_MW --> STRIPE_SRV

    AI_GATEKEEPER <-->|Vision Analysis API| GOOGLE_GEMINI["Google Gemini Vision API"]
    MODEL_SRV <-->|Mesh Tasks| TRIPO_API["Tripo 3D AI Engine"]

    COMPLIANCE <--> SECURE_STORE
    COMPLIANCE <--> SUPA_DB
    ESCROW_SRV <--> SUPA_DB
    ESCROW_SRV <--> SMART_ESCROW
    PORTFOLIO_SRV <--> SUPA_DB
    INVESTMENT_SRV <--> SUPA_DB
    ORACLE <--> SUPA_DB
    AUTH_MW <--> SUPA_AUTH

    WEB3_SRV <--> SMART_CERT
    WEB3_SRV <--> SMART_ESCROW
    MODEL_SRV --> PUBLIC_CDN
```

---

## 2. Escrow Sequential Lifecycle & Dual-Ledger State Machine

SmartAssets enforces an airtight sequential progression. An order initializes as `pending_payment` during transaction settlement, advances to `payment_secured` upon verified funds capture, flows through physical authentication, and transitions asset ownership directly to the buyer's vault holdings upon final release:

```mermaid
stateDiagram-v2
    [*] --> None : Order Created

    None --> PendingPayment : Buyer Initiates Checkout
    note right of PendingPayment
      Awaiting independent payment/fiat verification
      before funds are locked in custody.
    end note

    PendingPayment --> PaymentLocked : Settlement Verified (ETH Locked in Smart Contract)
    note right of PaymentLocked
      Funds secured in Escrow Contract.
      Asset status flagged as in_escrow.
      Seller is instructed to dispatch collectible.
    end note

    PaymentLocked --> InTransit : Seller Dispatches Asset (Armored Courier + Tracking Hash)
    note right of InTransit
      Insured transport in progress.
      Tracking hash logged on-chain.
    end note

    InTransit --> InInspection : Delivered to Physical Custody Center
    note right of InInspection
      Senior Horologists & Gemologists inspect
      hallmarks, movement serials, and condition.
    end note

    InInspection --> Delivered : Authentication Passed, Courier Delivers to Buyer
    Delivered --> Accepted : Buyer Receives Asset & Confirms Condition

    Accepted --> ReleasedToSeller : Escrow Unlocks & Payout Dispatched
    note right of ReleasedToSeller
      1. Settlement complete; platform fee deducted.
      2. Funds transferred to seller.
      3. Ownership transferred: Asset inserted into buyer user_holdings.
      4. ERC-721 Certificate updated with final custody milestone.
    end note

    ReleasedToSeller --> [*]

    %% Dispute Branch
    PaymentLocked --> Disputed : Buyer/Seller Files Dispute
    InTransit --> Disputed : Shipment Lost / Delayed
    InInspection --> Disputed : Failed Authentication / Fake Detected
    Delivered --> Disputed : Condition Discrepancy / Damage in Transit

    state Disputed {
        [*] --> EvidenceReview
        EvidenceReview --> ArbitratorResolution
    }

    Disputed --> RefundedToBuyer : Arbitrator Decides in Buyer Favor
    Disputed --> ReleasedToSeller : Arbitrator Decides in Seller Favor

    RefundedToBuyer --> [*]
```

---

## 3. Financial Inactivity Watcher & Session Security Lifecycle

High-value financial assets require defense against unattended session hijacking. The `InactivityWatcher` wraps the application in a transparent `PanResponder` that intercepts all gestures without touch-blocking, resetting a 5-minute inactivity counter and presenting a 30-second warning countdown before automated logout:

```mermaid
stateDiagram-v2
    [*] --> ActiveSession : User Authenticates & Interacts
    
    ActiveSession --> ActiveSession : User Touches/Scrolls/Types (Resets timer, throttled 500ms)
    ActiveSession --> InactivityWarning : 4 Minutes 30 Seconds Elapsed with No Gesture
    
    state InactivityWarning {
        [*] --> CountdownBanner : Display 30-Second Warning Toast
        CountdownBanner --> CountdownBanner : 1s Interval Decrement (29s... 28s...)
    }

    InactivityWarning --> ActiveSession : User Taps "Keep Active" / Touches Screen (Instant Dismiss)
    InactivityWarning --> Terminated : Timer Reaches 0 Seconds

    state Terminated {
        [*] --> ClearStorage : Wipe Auth Tokens & State
        ClearStorage --> ModalAlert : CrossPlatformDialog "Session Expired"
        ModalAlert --> RedirectLogin : User Directed to LoginScreen
    }

    Terminated --> [*]
```

---

## 4. Portfolio Snapshot & Time-Series Valuation Engine

To provide reliable portfolio analytics without recalculating historical values on the fly, the `portfolioSnapshotService` persists daily snapshot records in `public.portfolio_snapshots`:

```mermaid
flowchart TD
    EVENT[Trigger: Vault Deposit, Holding Purchase, Escrow Release, or Daily Cron] --> CALC[Calculate User Portfolio Snapshot]
    
    subgraph CALCULATION ["Valuation Matrix"]
        CALC --> SUM_HOLDINGS[Sum User Whole & Fractional Holdings Value]
        CALC --> CASH_BAL[Fetch Available Cash Balance]
        CALC --> ESCROW_BAL[Fetch Pending Escrow Inflow/Outflow]
        SUM_HOLDINGS & CASH_BAL & ESCROW_BAL --> TOTAL[Combined Net Worth]
    end

    TOTAL --> UPSERT[Upsert public.portfolio_snapshots<br/>UNIQUE constraint: (user_id, snapshot_date)]
    UPSERT --> SYNC_CACHE[Sync In-Memory Runtime Cache snapshotsMap]

    subgraph CLIENT_QUERY ["Client Analytics Request (/api/user/analytics)"]
        REQ[ProfileAnalyticsScreen Requests Period: 24h, 7d, 30d, 1y] --> QUERY_DB[Query Ordered Snapshots ASC]
        QUERY_DB --> DERIVE[Derive Metrics: MTD Change, ROI Yield %, Performance Trendline]
        DERIVE --> RENDER[Render Smooth Interactive Chart in Mobile App]
    end

    SYNC_CACHE -.-> QUERY_DB
```

---

## 5. AI Vision Multi-Tier Gatekeeper Pipeline

The AI Vision Gatekeeper (`aiVisionGatekeeper.js`) screens collectible listings before they can be submitted or verified on the marketplace. It evaluates image clarity, checks for synthetic AI generation, detects category mismatches, and fetches live appraisal valuation bands.

```mermaid
flowchart TD
    START([User Uploads Asset Photo / Scan & Know]) --> TIER1{Tier 1: Pre-flight & Dimensions}

    TIER1 -->|Corrupt / Resolution < 300px| REJECT_T1[Block: Image Too Small or Corrupted]
    TIER1 -->|Buffer Valid & Dimensions OK| TIER2{Tier 2: AI Synthetic & Deepfake Detection}

    TIER2 -->|Probability > 0.82 Synthetic| REJECT_T2[Block: Synthetic / Midjourney / DALL-E Fake Detected]
    TIER2 -->|Authentic Real-World Photo| TIER3[Tier 3: Multimodal Gemini Vision Inspection]

    subgraph GEMINI_VISION ["Gemini Flash Multimodal CV Analysis"]
        TIER3 --> EXTRACT_NAME[Canonical Brand, Model & Reference]
        TIER3 --> DETECT_CAT[Visual Category Classification]
        TIER3 --> COND_GRADE[Visual Condition Assessment: Mint / Fine / Fair]
        TIER3 --> FRAUD_CHECK[Hallmark, Serial & Logo Tampering Check]
    end

    DETECT_CAT --> MATCH_CAT{Matches Declared Category?}
    MATCH_CAT -->|No: Mismatch e.g. Sneaker listed as Watch| REJECT_T3[Block: Category Mismatch]
    MATCH_CAT -->|Yes: Verified| TIER4[Tier 4: Live Market Oracle Valuation]

    TIER4 --> CALC_BANDS[Calculate Floor, Median & Fair Market Value Bands]
    CALC_BANDS --> VAULT_LOOKUP{Existing Sepolia Certificate Found?}

    VAULT_LOOKUP -->|Yes| MATCH_CERT[Link On-Chain ERC-721 Certificate & Provenance]
    VAULT_LOOKUP -->|No| NEW_DRAFT[Create Verified Listing Draft]

    MATCH_CERT --> FINAL_OK([Gatekeeper Approved: Authenticity Score Calculated])
    NEW_DRAFT --> FINAL_OK
```

---

## 6. Mobile Navigation Topology & Screen Hierarchy

The mobile application (`Public/App`) is built on **React Navigation v7**, using a unified root stack with nested bottom tabs and contextual modal detail screens:

```mermaid
flowchart TD
    subgraph ROOT_NAV ["NavigationContainer (AppNavigator.js)"]
        direction TB

        subgraph AUTH_STACK ["Unauthenticated Stack"]
            SPLASH[SplashScreen<br/>Obsidian Brand Visual]
            ONBOARDING[OnboardingScreen<br/>3-Step Value Proposition Carousel]
            LOGIN[LoginScreen<br/>Email/Password & MetaMask Web3]
            REGISTER[RegisterScreen<br/>New Account Registration]
            RESET_PW[ResetPasswordScreen<br/>Deep Link Password Recovery]
        end

        subgraph MAIN_TABS ["Authenticated Bottom Tabs (Custom Floating Glass Bar)"]
            TAB_HOME["1. Home (MarketOverview)<br/>Market stats, featured, trending"]
            TAB_SEARCH["2. Search (MarketDiscovery)<br/>Multi-facet category & price filters"]
            TAB_FAB["3. [+] Center FAB (ListAssetScreen)<br/>4-Step Seller Wizard + AI Vision Gatekeeper"]
            TAB_INVEST["4. Invest (InvestScreen)<br/>Fractional Co-Ownership & Share Purchases"]
            TAB_VAULT["5. Vault (VaultScreen)<br/>Portfolio Holdings, Custody & Valuation"]
        end

        subgraph STACK_MODALS ["Detail & Modal Stack Screens"]
            ASSET_DETAIL["AssetDetailScreen<br/>(Tabs: Overview, Certificate, Provenance)"]
            SCAN_KNOW["ScanAndKnowScreen<br/>(Camera Instant Valuation & Cert Matching)"]
            AR_ROOM["LiveRoomPreview / ARScreen<br/>(Camera Feed + Calibrated Overlay)"]
            CERT_SCR["CertificateScreen<br/>(ERC-721 Authenticity & QR Exporter)"]
            PROV_SCR["ProvenanceScreen<br/>(Chain-of-Custody Timeline)"]
            HEALTH_SCR["HealthReportScreen<br/>(AI Authenticity & Condition Breakdown)"]
            CHECKOUT_SCR["CheckoutScreen<br/>(Card, Web3 Sepolia ETH, Wire)"]
            ESCROW_SCR["EscrowTrackerScreen<br/>(Live Order Progress & Tracking)"]
            PROFILE_SCR["ProfileScreen<br/>(Account Settings, Security, Avatar)"]
            ANALYTICS_SCR["ProfileAnalyticsScreen<br/>(Portfolio PnL, Snapshots & Allocation)"]
            VERIFY_SCR["VerificationScreen<br/>(Appraiser Status Tracker)"]
            VERIFY_ACC["VerifyAccountScreen<br/>(KYC 3-Doc Upload: ID, Tax, Residence)"]
            BANK_SCR["BankDetailsScreen<br/>(Bank Account Verification)"]
        end
    end

    %% Screen Navigation Flows
    SPLASH --> ONBOARDING --> LOGIN --> MAIN_TABS
    LOGIN -.-> REGISTER
    LOGIN -.-> RESET_PW

    TAB_HOME --> ASSET_DETAIL
    TAB_SEARCH --> ASSET_DETAIL
    TAB_INVEST --> ASSET_DETAIL
    TAB_VAULT --> ASSET_DETAIL

    ASSET_DETAIL --> CERT_SCR
    ASSET_DETAIL --> PROV_SCR
    ASSET_DETAIL --> HEALTH_SCR
    ASSET_DETAIL --> CHECKOUT_SCR
    ASSET_DETAIL --> AR_ROOM

    CHECKOUT_SCR --> ESCROW_SCR
    TAB_HOME --> SCAN_KNOW
    TAB_HOME --> PROFILE_SCR
    PROFILE_SCR --> ANALYTICS_SCR
    PROFILE_SCR --> VERIFY_ACC
    PROFILE_SCR --> BANK_SCR
```

---

## 7. Web3 Signature Authentication & Session Flow (SIWE / EIP-4361)

Sign-In With Ethereum allows users to securely log into SmartAssets with MetaMask or any EVM wallet without requiring a password:

```mermaid
sequenceDiagram
    autonumber
    actor User as User (MetaMask / Mobile)
    participant App as React Native App
    participant API as Express API (/api/auth)
    participant Web3 as web3Service.js
    participant Supa as Supabase Auth & Profiles
    participant Eth as Ethereum RPC / Ethers

    User->>App: Clicks "Connect MetaMask"
    App->>API: GET /api/auth/nonce?address=0xUser...
    API->>Web3: Generate cryptographically secure nonce
    Web3-->>API: Nonce + Expiry (5 minutes)
    API-->>App: { nonce: "sa_nonce_7f2b9a..." }

    App->>User: Prompts EIP-4361 standard message to sign
    User->>App: Approves & signs with private key
    App->>API: POST /api/auth/wallet-login { address, signature, message }

    API->>Web3: verifyMessage(message, signature)
    Web3->>Eth: Recovers signer address from ECDSA signature
    Web3-->>API: Recovered address matches claimed address

    API->>Supa: Query public.profiles where wallet_address = 0xUser...
    alt Profile Exists
        Supa-->>API: User profile & Supabase user ID
    else Profile Does Not Exist
        API->>Supa: Create synthetic user & link wallet_address in public.profiles
        Supa-->>API: New user record created
    end

    API->>Supa: Issue authenticated session JWT
    API-->>App: { success: true, token, user, profile }
    App->>App: Store JWT in secure storage; transition to Authenticated MainTabs
```

---

## 8. Fractional Co-Ownership & Investment Order Execution

When a user purchases shares in a high-value collectible, the transaction updates the marketplace asset and creates an isolated investment position in the user's vault:

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    participant App as Mobile App (InvestScreen / Checkout)
    participant API as Backend (/api/payments/checkout)
    participant InvestSrv as investmentPositionService.js
    participant EscrowSrv as escrowService.js
    participant DB as Supabase PostgreSQL

    Buyer->>App: Selects fractional shares (e.g. 5 shares @ $2,500)
    App->>API: POST /api/payments/checkout { assetId, sharesCount, paymentMethod }
    
    API->>DB: Check asset availability & shares_sold
    alt Available shares < requested
        DB-->>API: Shares exhausted
        API-->>App: 400 Bad Request: Not enough shares available
    else Shares available
        API->>EscrowSrv: Create escrow order (orderId, amount, type: 'fractional')
        EscrowSrv->>DB: Insert into escrow_orders (status: 'payment_secured')

        API->>InvestSrv: Record fractional investment position
        InvestSrv->>DB: Insert into public.investment_positions (user_id, asset_id, shares, cost_basis)
        
        API->>DB: UPDATE public.assets SET shares_sold = shares_sold + 5
        
        API->>DB: Insert into public.user_holdings (user_id, asset_id, asset_type: 'fractional', shares: 5)
        
        API-->>App: 200 OK: { success: true, orderId, holdingId, sharesRemaining }
        App->>Buyer: Display Confirmed Ownership Badge & Vault Share Certificate
    end
```

---

## 9. 3D Mesh Generation & Decimation Pipeline

SmartAssets generates interactive 3D assets from single images using Tripo AI and automatically optimizes the polygonal meshes for mobile 60 FPS rendering using `@gltf-transform/core` and `meshoptimizer`:

```mermaid
flowchart LR
    IMG[Listing Image / Photo] --> TRIPO_API[Tripo AI Task Submission<br/>POST /v2/openapi/task]
    TRIPO_API --> POLL[Poll Task Status<br/>status: 'running' -> 'success']
    POLL --> RAW_GLB[Download Raw glTF/GLB<br/>500k+ Triangles, 45MB+]

    subgraph OPTIMIZER ["Backend modelOptimizer.js"]
        RAW_GLB --> PARSE[Parse via @gltf-transform/core]
        PARSE --> DECIMATE[Meshoptimizer Simplification<br/>Target: 35,000 Triangles]
        DECIMATE --> RESIZE_TEX[Downscale Textures to 2048x2048 KTX2/WebP]
        RESIZE_TEX --> QUANTIZE[Quantize Vertex Attributes]
    end

    QUANTIZE --> OPT_GLB[Optimized GLB<br/>~2.5MB, 60 FPS Mobile Ready]
    OPT_GLB --> UPLOAD_CDN[Upload to CDN / Static Storage]
    UPLOAD_CDN --> DB_RECORD[Write listing_models Table in Supabase]
    DB_RECORD --> APP_RENDER[Render in ARScreen & LiveRoomPreview]
```

---

## 10. Supabase PostgreSQL Entity Relationship Diagram (ERD)

The durable source of truth is structured into normalized tables with foreign keys and Row-Level Security:

```mermaid
erDiagram
    auth_users ||--|| profiles : "owns"
    auth_users ||--o{ assets : "lists"
    auth_users ||--o{ user_holdings : "holds"
    auth_users ||--o{ vault_transactions : "conducts"
    auth_users ||--o{ verification_documents : "submits"
    auth_users ||--o{ bank_accounts : "links"
    auth_users ||--o{ escrow_orders : "participates (buyer/seller)"
    auth_users ||--o{ investment_positions : "co-owns"
    auth_users ||--o{ portfolio_snapshots : "tracks net worth over time"

    assets ||--o{ asset_history : "records provenance"
    assets ||--o| listing_models : "has 3D model"
    assets ||--o{ escrow_orders : "transacts in"
    assets ||--o{ investment_positions : "fractionalized into"
    assets ||--o{ user_holdings : "referenced by asset_id"

    profiles {
        uuid id PK
        text full_name
        text email
        text wallet_address
        text avatar_url
        numeric balance
        timestamptz created_at
    }

    assets {
        uuid id PK
        uuid user_id FK
        uuid seller_id FK
        uuid current_owner_id FK
        text name
        text category
        text price
        numeric price_num
        int year
        text condition
        text description
        text image
        text badge
        bool trending
        text cert
        int shares
        numeric share_price
        int shares_sold
        text status
        text token_id
        text tx_hash
        text contract_address
        text etherscan_url
        timestamptz created_at
    }

    user_holdings {
        uuid id PK
        uuid user_id FK
        uuid asset_id FK
        text name
        text category
        text price
        numeric price_num
        text gain
        text gain_pct
        bool positive
        text image
        text asset_type
        timestamptz created_at
    }

    portfolio_snapshots {
        uuid id PK
        uuid user_id FK
        numeric portfolio_value
        numeric cash_balance
        numeric total_value
        int holdings_count
        date snapshot_date
        timestamptz created_at
    }

    escrow_orders {
        uuid id PK
        int order_id_seq
        uuid buyer_id FK
        uuid seller_id FK
        uuid asset_id FK
        numeric amount
        text currency
        text status
        text tracking_carrier
        text tracking_number
        text dispute_reason
        text dispute_resolution
        text tx_hash
        timestamptz created_at
        timestamptz updated_at
    }

    listing_models {
        uuid id PK
        uuid listing_id FK
        text status
        text tripo_task_id
        text glb_url
        bigint size_bytes
        int triangle_count
        text source
        text placement
        numeric width_cm
        numeric height_cm
        numeric depth_cm
        timestamptz created_at
    }

    investment_positions {
        uuid id PK
        uuid user_id FK
        uuid asset_id FK
        int shares_owned
        numeric purchase_price_per_share
        numeric total_invested
        timestamptz created_at
    }
```
