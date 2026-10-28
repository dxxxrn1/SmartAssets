# SmartAssets — Documentation Hub

Welcome to the **SmartAssets Documentation Suite**. This directory contains comprehensive specifications, visual architecture diagrams, API references, smart contract source documentation, and database schemas for the entire SmartAssets platform.

---

## 🗺️ Documentation Index

| Document | Path | Primary Audience | Description |
| :--- | :--- | :--- | :--- |
| **Visual Architecture & Diagrams** | [SYSTEM_DIAGRAMS.md](file:///d:/Native/SmartAssets/docs/SYSTEM_DIAGRAMS.md) | All Engineers, Architects | Production-ready Mermaid diagrams: End-to-end architecture, escrow state machine, AI Vision Gatekeeper, screen flows, SIWE auth, and database ERD. |
| **System Architecture Guide** | [ARCHITECTURE.md](file:///d:/Native/SmartAssets/docs/ARCHITECTURE.md) | Architects, Tech Leads | Cross-tier engineering design, tech stack matrix, service interactions, and security/compliance models. |
| **Frontend Mobile Architecture** | [FRONTEND_ARCHITECTURE.md](file:///d:/Native/SmartAssets/docs/FRONTEND_ARCHITECTURE.md) | Mobile & React Native Devs | React Native (Expo SDK 54), React Navigation v7, design tokens, vector icon standardization, AR/Camera Live Room Preview, and AuthContext. |
| **Backend API Reference** | [BACKEND_API.md](file:///d:/Native/SmartAssets/docs/BACKEND_API.md) | Backend Devs, Integrators | Express 4.21 REST endpoints, request/response payloads, 3-doc KYC compliance, Rate Limiting, and WebSockets. |
| **Smart Contracts & Blockchain** | [BLOCKCHAIN_SMART_CONTRACTS.md](file:///d:/Native/SmartAssets/docs/BLOCKCHAIN_SMART_CONTRACTS.md) | Web3 & Solidity Devs | `SmartAssetCertificate.sol` (ERC-721), `SmartAssetEscrow.sol` (9-stage trust engine), Hardhat deployment, and security audits. |
| **Database & Supabase Schema** | [DATABASE_SCHEMA.md](file:///d:/Native/SmartAssets/docs/DATABASE_SCHEMA.md) | Database Admins, Backend Devs | PostgreSQL tables, Row-Level Security (RLS) policies, storage buckets, triggers, and migrations. |

---

## 🧭 Reading Guides by Role

### 📱 For Mobile & Frontend Developers
1. Start with [FRONTEND_ARCHITECTURE.md](file:///d:/Native/SmartAssets/docs/FRONTEND_ARCHITECTURE.md) to understand screen routing, theme tokens, and `@expo/vector-icons`.
2. Inspect the **Mobile Navigation Hierarchy** in [SYSTEM_DIAGRAMS.md](file:///d:/Native/SmartAssets/docs/SYSTEM_DIAGRAMS.md#4-mobile-navigation-topology--screen-hierarchy).
3. Review [BACKEND_API.md](file:///d:/Native/SmartAssets/docs/BACKEND_API.md) to integrate API endpoints with frontend service clients.

### ⚙️ For Backend & DevOps Engineers
1. Read [ARCHITECTURE.md](file:///d:/Native/SmartAssets/docs/ARCHITECTURE.md) for server architecture, rate limiting, and security headers.
2. Study the **Escrow Lifecycle State Machine** and **AI Vision Gatekeeper** in [SYSTEM_DIAGRAMS.md](file:///d:/Native/SmartAssets/docs/SYSTEM_DIAGRAMS.md).
3. Review [DATABASE_SCHEMA.md](file:///d:/Native/SmartAssets/docs/DATABASE_SCHEMA.md) to manage migrations, indexes, and RLS policies.

### ⛓️ For Web3 & Smart Contract Engineers
1. Read [BLOCKCHAIN_SMART_CONTRACTS.md](file:///d:/Native/SmartAssets/docs/BLOCKCHAIN_SMART_CONTRACTS.md) for Solidity contracts, event signatures, and reentrancy defenses.
2. Review the **Web3 SIWE Sequence** in [SYSTEM_DIAGRAMS.md](file:///d:/Native/SmartAssets/docs/SYSTEM_DIAGRAMS.md#5-web3-signature-authentication--session-flow-siwe--eip-4361).
3. Consult `Blockchain/` for Hardhat test runners and deployment scripts.

---

## ⚡ Quick Start Shortcuts

- **Mobile App:** `cd Public/App && npm start`
- **Backend API:** `cd Backend && npm run dev`
- **Blockchain Tests:** `cd Blockchain && npx hardhat test`
