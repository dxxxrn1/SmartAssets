# SmartAssets Backend — Render Production Deployment Guide

This guide contains the complete operational instructions for deploying the **SmartAssets** backend to **Render** as a high-security Web Service.

---

## 1. Architecture Overview on Render

- **Monorepo Root Directory:** `Backend`
- **Build Command:** `npm ci`
- **Start Command:** `npm start` (executes `node src/main.js`)
- **Health Check Endpoint:** `/api/health` (returns `{"status":"ok", "timestamp":"..."}`)
- **Port:** Render automatically injects `PORT` (defaults to `10000`).
- **Proxy Trust:** Render routes incoming traffic through its load-balancing edge proxies. Setting `TRUST_PROXY=1` ensures `req.ip` correctly resolves the true client IP for rate limiting and audit logs.

### Static Pages Served by Backend
The backend Express application serves two essential web interfaces:
1. **Administrator Web Console (`/admin`)**:
   - Served from `Backend/public/admin/`
   - Access URL: `https://<your-service>.onrender.com/admin/login.html`
   - Root redirect: Visiting `/` automatically redirects to `/admin`.
   - Requires Supabase Auth authentication and database role `profiles.role = 'admin'`.
2. **Public Cryptographic Certificate Verification Portal (`/verify/:productId`)**:
   - Served from `Backend/public/verify/index.html`
   - Access URL: `https://<your-service>.onrender.com/verify/<product-uuid>`
   - Fetches certificate JSON from `/api/certificates/:productId` and validates signatures against public keys published at `/api/certificates/keys`.

---

## 2. Deployment Setup on Render

### Option A: Using the Render Blueprint (`render.yaml`) (Recommended)
1. In the [Render Dashboard](https://dashboard.render.com/), click **Blueprints** -> **New Blueprint Instance**.
2. Select the repository: `SmartAssets`.
3. Render reads `render.yaml` and provisions the Web Service `smartassets-backend` with:
   - Root directory: `Backend`
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check: `/api/health`
4. In the Render Dashboard under **Environment**, fill in the required secret values marked with `sync: false` (see Section 5 below).

### Option B: Manual Web Service Creation
1. Click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the following fields:
   - **Name:** `smartassets-backend`
   - **Region:** Frankfurt (or region closest to your users)
   - **Branch:** `main`
   - **Root Directory:** `Backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start`
   - **Plan:** Starter ($7/mo) or Standard
4. Under **Advanced**:
   - **Health Check Path:** `/api/health`
   - **Auto-Deploy:** Yes

---

## 3. Persistent Private File Storage (KYC Documents)

Render web services run inside ephemeral containers where the local filesystem is reset upon every deploy or restart.

### Storage Architecture
- **Private KYC Documents (`verification-docs`)**:
  - Uploaded directly to private Supabase Storage bucket `verification-docs`.
  - Storage path: `{userId}/{docType}.{ext}` (e.g. `d3b07384-.../id.jpg`).
  - Gated access: Accessible **only** via short-lived signed URLs (`/api/verification/documents/:id/url`) or authenticated streaming (`/uploads/kyc/*`).
  - Strict authorization: Requests must be made by the document owner or an authenticated administrator. Unauthenticated or third-party requests are rejected with HTTP 401/403.
  - Never made public.
- **Public Product Images**:
  - Uploaded to Cloudinary (`smartassets/assets`, `smartassets/avatars`) for CDN caching.
  - Completely isolated from private KYC documents.

### Storage Bucket Setup
1. In the [Supabase Dashboard](https://supabase.com/dashboard), navigate to **Storage**.
2. Confirm the **`verification-docs`** bucket exists.
3. If creating manually:
   - Name: `verification-docs`
   - **Public bucket:** **OFF** (Private)
   - **File size limit:** `10 MB`
   - **Allowed MIME types:** `image/jpeg, image/png, image/webp, application/pdf`

---

## 4. Stable Certificate Signing Keys (PKI Authority)

The backend cryptographically signs luxury asset provenance certificates with RSA-2048 (`RS256`). To ensure redeployments on Render do not invalidate previously issued certificates, signing keys must be persistent and managed via environment variables.

### Generating the Production RSA Keypair
Run this secure Node.js one-liner in your terminal:

```bash
node -e "const { privateKey, publicKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); console.log('=== PRIVATE KEY (CERTIFICATE_SIGNING_PRIVATE_KEY) ===\n' + privateKey); console.log('=== PUBLIC KEY (CERTIFICATE_SIGNING_PUBLIC_KEY) ===\n' + publicKey);"
```

### Environment Configuration
1. Set `CERTIFICATE_SIGNING_PRIVATE_KEY` in the Render Dashboard to the full private key PEM string (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`).
2. Set `CERTIFICATE_SIGNING_PUBLIC_KEY` to the corresponding public key PEM string.
3. Set `CERTIFICATE_SIGNING_KEY_ID` to an identifier (e.g. `sa-cert-key-2026-v1`).

### Fail-Closed Production Behavior
- If `NODE_ENV === 'production'` and `CERTIFICATE_SIGNING_PRIVATE_KEY` is missing or malformed, the server immediately halts boot with `CERTIFICATE_SIGNING_CONFIG_ERROR`.
- The server **never** generates temporary keys in production.
- If `CERTIFICATE_SIGNING_PUBLIC_KEY` does not match the private key, boot is blocked immediately.

### Key Rotation & Historical Verification
When rotating the signing key in the future:
1. Generate a new keypair (e.g. `sa-cert-key-2027-v1`) and set it as `CERTIFICATE_SIGNING_PRIVATE_KEY`.
2. Add the retired public key to `CERTIFICATE_HISTORICAL_PUBLIC_KEYS_JSON`:
   ```json
   [{"keyId":"sa-cert-key-2026-v1","publicKeyPem":"-----BEGIN PUBLIC KEY...\n-----END PUBLIC KEY-----","status":"retired"}]
   ```
3. Previously issued certificates continue to verify seamlessly via `GET /api/certificates/keys`.

---

## 5. Required Environment Variables Reference

Configure these in the Render Dashboard (**Environment** tab):

| Variable | Required | Description | Example / Recommended Value |
|---|:---:|---|---|
| `NODE_ENV` | **Yes** | Server runtime environment | `production` |
| `PORT` | **Yes** | Web server listening port | `10000` (Render default) |
| `SUPABASE_URL` | **Yes** | Supabase Project URL | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Secret service-role key (bypasses RLS) | `eyJhbGciOi...` |
| `ADMIN_JWT_SECRET` | **Yes** | 256-bit HMAC secret for admin session tokens | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_WEB_BASE_URL` | **Yes** | Canonical base URL for certificates & QR codes | `https://api.smartassets.io` or `https://smartassets-backend.onrender.com` |
| `CORS_ALLOWED_ORIGINS` | **Yes** | Comma-delimited list of exact allowed origins | `https://app.smartassets.io,https://admin.smartassets.io` |
| `TRUST_PROXY` | **Yes** | Reverse proxy hop count | `1` |
| `ENFORCE_HSTS` | **Yes** | Strict Transport Security header | `true` |
| `CERTIFICATE_SIGNING_PRIVATE_KEY` | **Yes** | RSA-2048 private key PEM | `-----BEGIN PRIVATE KEY...` |
| `CERTIFICATE_SIGNING_PUBLIC_KEY` | **Yes** | RSA-2048 public key PEM | `-----BEGIN PUBLIC KEY...` |
| `CERTIFICATE_SIGNING_KEY_ID` | **Yes** | Active Key ID | `sa-cert-key-2026-v1` |
| `CLOUDINARY_CLOUD_NAME` | *Optional* | Cloudinary cloud name for media | `your-cloud-name` |
| `CLOUDINARY_API_KEY` | *Optional* | Cloudinary API key | `1234567890` |
| `CLOUDINARY_API_SECRET` | *Optional* | Cloudinary API secret | `secret` |
| `STRIPE_SECRET_KEY` | *Optional* | Stripe API secret key for card checkout | `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | *Optional* | Stripe publishable key | `pk_live_...` |
| `SEPOLIA_RPC_URL` | *Optional* | Ethereum Sepolia RPC URL for blockchain | `https://sepolia.infura.io/v3/...` |
| `SEPOLIA_RELAYER_PRIVATE_KEY`| *Optional* | Hex relayer wallet key for escrow | `0x1234...` |
| `TRIPO_API_KEY` | *Optional* | Tripo AI 3D model generation key | `tripo_key_...` |
| `SERPAPI_KEY` | *Optional* | Google Shopping price oracle key | `serp_key_...` |

---

## 6. Custom Domain, HTTPS, CORS, and HSTS Configuration

### Custom Domain on Render
1. In the Render Dashboard, open your Web Service and navigate to **Settings** -> **Custom Domains**.
2. Click **Add Custom Domain** (e.g. `api.smartassets.io`).
3. In your DNS provider (Cloudflare, AWS Route 53, Namecheap), add:
   - **Type:** `CNAME`
   - **Name:** `api`
   - **Value:** `smartassets-backend.onrender.com`
4. Render automatically provisions a free Let's Encrypt SSL/TLS certificate.

### Synchronizing CORS and Public URLs
Once your custom domain is active:
1. Update `PUBLIC_WEB_BASE_URL` to `https://api.smartassets.io`.
2. Add your frontend origins to `CORS_ALLOWED_ORIGINS`:
   ```env
   CORS_ALLOWED_ORIGINS=https://app.smartassets.io,https://admin.smartassets.io,https://smartassets.io
   ```
3. Set `ENFORCE_HSTS=true` so browsers enforce HTTPS on all future connections.

---

## 7. Pre-Flight Verification & Deployment Checklist

Before announcing production readiness:

- [ ] **Database Migrations:** Run all 10 required migrations from `Backend/supabase_migrations/MIGRATION_CHECKLIST.md`.
- [ ] **Verify Schema:** Execute the verification SQL query in Supabase to confirm all 8 tables and RLS policies are present.
- [ ] **Storage Bucket:** Verify `verification-docs` exists and is **Private**.
- [ ] **Admin Account:** Verify at least one user in `auth.users` has `public.profiles.role = 'admin'`.
- [ ] **Environment Secrets:** Populate all required variables in the Render Dashboard.
- [ ] **Build & Deploy:** Trigger deploy on Render and inspect deployment logs for:
  ```text
  🔒 [Config] Validating SmartAssets production configuration...
  🔒 [Security] Administrator authentication configuration validated.
  🚀 SmartAssets API running at http://localhost:10000
  ```
- [ ] **Health Check:** Confirm `curl -I https://<your-service>.onrender.com/api/health` returns `HTTP/2 200`.
- [ ] **Admin Portal:** Visit `https://<your-service>.onrender.com/admin/login.html` and verify login works.
- [ ] **Certificate Authority:** Verify `curl https://<your-service>.onrender.com/api/certificates/keys` returns your active RSA public key.
- [ ] **Rate Limiting:** Verify RateLimit headers (`ratelimit-remaining`, `ratelimit-limit`) are present on API responses.
