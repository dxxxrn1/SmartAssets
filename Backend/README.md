# SmartAssets — Backend API & Microservices

> **Framework:** Express.js 4.21.2 on Node.js (CommonJS)  
> **Port:** `5000` (`http://localhost:5000`)  
> **Database:** Supabase PostgreSQL with Row-Level Security (RLS)  
> **Decentralized Settlement:** Ethers.js v6 (Ethereum Sepolia Testnet)  
> **Intelligence:** Google Gemini Flash Vision API + Tripo 3D AI Engine

---

## 🏗️ Server Architecture & Middleware Pipeline

```mermaid
flowchart TD
    REQ[Incoming HTTP / WebSocket Request] --> TIMING[Timing Middleware (Latency Logging)]
    TIMING --> HELMET[Helmet & Strict Security Headers]
    HELMET --> CORS_GUARD[CORS Whitelist: 5000, 5500, 8081, 19006, LAN IPs]
    CORS_GUARD --> BODY_PARSE{Path Type?}
    
    BODY_PARSE -->|Upload Paths: /api/uploads, /verification, /api/assets| LIMIT_15MB[15MB JSON / Form-Data Parser]
    BODY_PARSE -->|Standard API Routes| LIMIT_1MB[Strict 1MB JSON Parser]

    LIMIT_15MB --> SQL_GUARD{Is Image Upload?}
    LIMIT_1MB --> SQL_GUARD

    SQL_GUARD -->|Yes: Raw Image Buffer| SKIP_SQL[Bypass Regex Filter]
    SQL_GUARD -->|No: Standard JSON/Query| RUN_SQL[SQL Injection Sanitizer Middleware]

    SKIP_SQL --> RATE_LIMIT[Rate Limiter: 30 req/15min on /api/auth]
    RUN_SQL --> RATE_LIMIT

    RATE_LIMIT --> ROUTER[Express Route Handlers]
    
    subgraph DOMAIN_SERVICES ["Integrated Domain Services"]
        ROUTER --> AI_CV[aiVisionGatekeeper.js (Gemini CV)]
        ROUTER --> KYC[complianceService.js (3-Doc KYC)]
        ROUTER --> ESCROW[escrowService.js (Escrow Engine)]
        ROUTER --> ORACLE[marketOracleService.js (Valuation)]
        ROUTER --> WEB3[web3Service.js (Ethers Sepolia)]
        ROUTER --> MODELS[modelOptimizer.js (glTF Transform)]
    end
```

---

## 📡 Mounted API Routes

| Path Prefix | Router File | Primary Responsibility |
| :--- | :--- | :--- |
| `/api/auth` | `src/routes/authRoutes.js` | User registration, login, SIWE nonce generation, and wallet authentication. |
| `/api/assets` & `/api/list-item` | `src/routes/assetRoutes.js` | Marketplace listings, category filters, whole & fractional catalog, AI Gatekeeper listing, dynamic AI Health Report. |
| `/api/verification` | `src/routes/verificationRoutes.js` | 3-document compliance uploads (`id`, `tax`, `proof_of_residence`), status inspection. |
| `/api/bank-accounts` | `src/routes/bankAccountRoutes.js` | Bank account linking, masking (`****3746`), and withdrawal approvals. |
| `/api/escrow` | `src/routes/escrowRoutes.js` | Dual-ledger escrow orders, carrier tracking, physical horological inspection, disputes. |
| `/api/payments` | `src/routes/paymentRoutes.js` | Stripe checkout sessions, fiat billing, and crypto payment intents. |
| `/api/user` & `/api/users` | `src/routes/userRoutes.js` | Profile retrieval, personal custody holdings (`user_holdings`), deposits, withdrawals. |
| `/api/models` | `src/routes/modelRoutes.js` | Tripo 3D AI submissions, task polling, and decimation down to 35k polygons. |
| `/api/admin` & `/admin` | `src/routes/adminRoutes.js` | Admin browser console, escrow dispute arbitration, user KYC auditing. |

---

## 🛠️ Getting Started

### 1. Install Dependencies
```bash
cd d:\Native\SmartAssets\Backend
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the `Backend/` directory (or use root `.env`):
```env
PORT=5000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Google Gemini Vision
GEMINI_API_KEY=your-google-gemini-api-key

# Web3 / Ethereum Sepolia
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your-api-key
ESCROW_CONTRACT_ADDRESS=0x...
CERTIFICATE_CONTRACT_ADDRESS=0x...
PRIVATE_KEY=your-deployer-private-key

# Storage & Stripe
CLOUDINARY_URL=cloudinary://...
STRIPE_SECRET_KEY=sk_test_...
```

### 3. Initialize Database
Execute the master SQL script in your Supabase SQL editor:
```
Backend/supabase_setup.sql
```
And apply incremental migrations located in `Backend/supabase_migrations/`.

### 4. Run Server
```bash
# Development with node --watch
npm run dev

# Production start
npm start
```

### 5. Run Test Suites
```bash
npm test
```
The test script runs 14 integration test suites covering:
- Escrow comprehensive, buying & selling flows (`escrowComprehensive.test.js`, `escrowBuyingAndSellingFlow.test.js`)
- Portfolio summary & snapshot time-series (`portfolioSummaryAndSnapshots.test.js`, `analyticsAudit.test.js`)
- KYC compliance, document upload & profile verification (`profileIntegration.test.js`, `avatarIntegration.test.js`)
- Vault holdings & custody balance isolation (`vaultIntegration.test.js`)
- Admin security & image handling (`adminAndImageIntegration.test.js`)
- 3D model optimization (`modelIntegration.test.js`)
- SQL injection & rate limiting security (`security.test.js`)
- Web3 wallet signature authentication (`walletAuth.test.js`)
- Buyout allocation & fractional investment rules (`buyoutAllocationAndInvestmentRules.test.js`)


---

## 📖 Related Documentation
- [Backend API Specification](../docs/BACKEND_API.md)
- [System Architecture Guide](../docs/ARCHITECTURE.md)
- [Database Schema & RLS Policies](../docs/DATABASE_SCHEMA.md)
- [Visual Diagrams & State Machines](../docs/SYSTEM_DIAGRAMS.md)
