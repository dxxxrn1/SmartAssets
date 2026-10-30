# SmartAssets Supabase Migration Checklist & Verification Guide

This document provides the authoritative, ordered execution guide for applying database migrations to your production Supabase database prior to deploying the backend to Render.

> ⚠️ **Operator Notice:** Migrations must **never** be applied automatically by deployment scripts. Run these scripts manually in the [Supabase Dashboard SQL Editor](https://supabase.com/dashboard) or via the Supabase CLI (`supabase db push`).

---

## 1. Migration Execution Order

Apply migrations in the exact chronological order below.

| Step | Migration File | Status | Description |
|:---:|---|:---:|---|
| **1** | `20261025_complete_source_of_truth_schema.sql` | **REQUIRED** | Baseline schema: `profiles`, `assets`, `transactions`, `user_wallets`, and core indexes. |
| **2** | `20261025_kyc_and_bank_verification.sql` | **REQUIRED** | `verification_documents`, `bank_accounts`, `verification-docs` storage bucket, RLS, status triggers. |
| **3** | `20261026_investment_positions_and_payouts.sql` | **REQUIRED** | `investor_positions` table for fractional asset ownership and dividend/buyout payouts. |
| **4** | `20261027_escrow_lifecycle_and_asset_holdings.sql` | **REQUIRED** | `escrow_orders` table, escrow state transitions, and asset custody tracking. |
| **5** | `20261028_admin_controlled_escrow.sql` | **REQUIRED** | Admin escrow controls, appraiser inspection fields, and delivery confirmation steps. |
| **6** | `20261028_product_identity_and_blockchain_registration.sql` | **REQUIRED** | Product identity, serials, brand, model, and on-chain registration metadata on `assets`. |
| **7** | `20261028_seller_delist_and_redemption.sql` | **REQUIRED** | Seller delisting mechanisms and proportional investor redemption tracking. |
| **8** | `20261029_durable_revoked_tokens.sql` | **REQUIRED** | Durable session revocation ledger (`revoked_tokens`), SHA-256 hash indexes, and service-role RLS. |
| **9** | `20261029_real_product_certificates.sql` | **REQUIRED** | Cryptographic certificate fields on `assets`: `certificate_id`, `certificate_signature`, `certificate_key_id`. |
| **10** | `20261030_restore_service_role_escrow_writes.sql` | **REQUIRED** | Ensures backend `service_role` has full write and update privileges on escrow tables. |
| **11** | `20261022_listing_models.sql` | *Optional* | 3D model reconstruction fields on `listings` (Tripo AI). |
| **12** | `20261024_wallet_linking_and_cleanup.sql` | *Optional* | Wallet challenge nonces and signature replay defense tables. |
| **13** | `20261028_portfolio_snapshots.sql` | *Optional* | Periodic portfolio value history snapshots table. |
| **14** | `20261029_escrow_seller_updates.sql` | *Optional* | Supplementary seller escrow notification flags. |
| **15** | `20261031_atomic_investment_and_share_sales.sql` | **REQUIRED** | Atomic share purchases, anti-whale cap, `reserved_shares`, `share_redemption_requests`, `payment_idempotency`, and PostgreSQL RPCs. |
| **16** | `20261031_vault_deposit_and_withdrawal_atomic.sql` | **REQUIRED** | Atomic Vault deposits, pending bank review, `reserved_balance` on `profiles`, approved-bank-only withdrawals, RLS hardening, and settlement RPCs. |

---

## 2. Pre-Deployment Database Readiness Verification Query

After applying the required migrations, paste and run the following diagnostic script in the **Supabase SQL Editor** to confirm all tables, indexes, and RLS policies are active:

```sql
-- ─── SmartAssets Pre-Flight Schema Verification ─────────────────────────────
SELECT 
    t.table_name,
    CASE 
        WHEN c.table_name IS NOT NULL THEN '✅ Present' 
        ELSE '❌ Missing' 
    END AS status,
    CASE 
        WHEN p.rowsecurity = true THEN '🛡️ RLS Enabled' 
        ELSE '⚠️ RLS Disabled' 
    END AS rls_status
FROM (
    VALUES 
        ('profiles'),
        ('assets'),
        ('transactions'),
        ('verification_documents'),
        ('bank_accounts'),
        ('investor_positions'),
        ('escrow_orders'),
        ('revoked_tokens'),
        ('share_redemption_requests'),
        ('payment_idempotency')
) AS t(table_name)
LEFT JOIN information_schema.tables c 
    ON c.table_schema = 'public' AND c.table_name = t.table_name
LEFT JOIN pg_tables p 
    ON p.schemaname = 'public' AND p.tablename = t.table_name;

-- ─── Verify RLS Policy on revoked_tokens ─────────────────────────────────────
SELECT 
    policyname, 
    roles, 
    cmd, 
    qual 
FROM pg_policies 
WHERE tablename = 'revoked_tokens';

-- ─── Verify Private Storage Bucket for KYC ──────────────────────────────────
SELECT 
    id, 
    name, 
    public, 
    file_size_limit, 
    allowed_mime_types 
FROM storage.buckets 
WHERE name = 'verification-docs';
```

### Expected Output Checklist
1. All 8 tables (`profiles`, `assets`, `transactions`, `verification_documents`, `bank_accounts`, `investor_positions`, `escrow_orders`, `revoked_tokens`) report **✅ Present** and **🛡️ RLS Enabled**.
2. `revoked_tokens` policy shows:
   - `policyname`: `Service role full access on revoked_tokens`
   - `roles`: `{service_role}`
   - `cmd`: `ALL`
3. Storage bucket `verification-docs` shows `public: false` (strictly private).

---

## 3. First Administrator Account Setup

To authorize an administrator account to access the Admin Console (`/admin`):

```sql
-- Verify or promote user to admin
UPDATE public.profiles
SET role = 'admin',
    verification_status = 'verified',
    updated_at = NOW()
WHERE email = 'your-admin-email@smartassets.io';
```
