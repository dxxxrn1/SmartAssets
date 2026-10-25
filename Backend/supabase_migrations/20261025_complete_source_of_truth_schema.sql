-- ============================================================================
-- SMARTASSETS — Complete Source-of-Truth Database Schema Migration
-- File: Backend/supabase_migrations/20261025_complete_source_of_truth_schema.sql
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================================

-- 1. PROFILES TABLE (Extend and ensure all necessary columns)
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  wallet_address  TEXT UNIQUE,
  avatar_url      TEXT,
  balance         NUMERIC NOT NULL DEFAULT 0,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS balance NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified';

-- 2. USER HOLDINGS TABLE (User-isolated Vault Assets)
CREATE TABLE IF NOT EXISTS public.user_holdings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       TEXT NOT NULL,
  price_num   NUMERIC NOT NULL DEFAULT 0,
  gain        TEXT DEFAULT '+0.0%',
  gain_pct    TEXT DEFAULT '0%',
  positive    BOOLEAN DEFAULT true,
  image       TEXT,
  asset_type  TEXT DEFAULT 'whole',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_holdings_user_id ON public.user_holdings(user_id);

-- 3. MARKETPLACE ASSETS TABLE
CREATE TABLE IF NOT EXISTS public.assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  price           TEXT NOT NULL,
  price_num       NUMERIC NOT NULL DEFAULT 0,
  year            INTEGER NOT NULL DEFAULT 2024,
  condition       TEXT NOT NULL DEFAULT 'Mint',
  description     TEXT,
  image           TEXT NOT NULL,
  badge           TEXT DEFAULT 'Verified',
  trending        BOOLEAN DEFAULT false,
  cert            TEXT,
  shares          INTEGER DEFAULT 100,
  share_price     NUMERIC DEFAULT 100,
  shares_sold     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',
  token_id        TEXT,
  tx_hash         TEXT,
  contract_address TEXT,
  etherscan_url   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_status ON public.assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_category ON public.assets(category);

-- 4. ASSET HISTORY / PROVENANCE TABLE
CREATE TABLE IF NOT EXISTS public.asset_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  year            TEXT NOT NULL,
  event           TEXT NOT NULL,
  party           TEXT NOT NULL,
  hash            TEXT,
  tx_hash         TEXT,
  verified        BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_history_asset_id ON public.asset_history(asset_id);

-- 5. VAULT TRANSACTIONS TABLE (Deposits, Withdrawals, Payouts)
CREATE TABLE IF NOT EXISTS public.vault_transactions (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL, -- 'deposit', 'withdraw'
  amount          NUMERIC NOT NULL,
  amount_formatted TEXT NOT NULL,
  method          TEXT DEFAULT 'bank',
  reference       TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'completed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_transactions_user_id ON public.vault_transactions(user_id);

-- 6. ESCROW ORDERS TABLE
CREATE TABLE IF NOT EXISTS public.escrow_orders (
  id              TEXT PRIMARY KEY,
  order_id        TEXT UNIQUE NOT NULL,
  buyer_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  asset_id        UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  asset_name      TEXT NOT NULL,
  asset_category  TEXT,
  asset_image     TEXT,
  amount_zar      NUMERIC NOT NULL,
  amount_eth      NUMERIC,
  amount_gbp      NUMERIC,
  status          TEXT NOT NULL DEFAULT 'payment_secured', -- 'payment_secured', 'in_transit', 'in_inspection', 'released', 'refunded'
  payment_method  TEXT,
  tx_hash         TEXT,
  timeline        JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_orders_buyer ON public.escrow_orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_escrow_orders_status ON public.escrow_orders(status);

-- 7. SUPPORT TICKETS TABLE
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id              TEXT PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      TEXT,
  user_name       TEXT,
  category        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  message         TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal',
  status          TEXT NOT NULL DEFAULT 'Open', -- 'Open', 'In Progress', 'In Review', 'Resolved'
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);

-- 8. WALLET NONCES TABLE (EIP-191 Authentication)
CREATE TABLE IF NOT EXISTS public.wallet_nonces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  message         TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used            BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_nonces_lookup ON public.wallet_nonces(wallet_address, used, expires_at);

-- 9. 3D MODELS TABLE (Tripo AI Image-to-3D)
CREATE TABLE IF NOT EXISTS public.listing_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  tripo_task_id   TEXT,
  glb_url         TEXT,
  size_bytes      BIGINT,
  triangle_count  INTEGER,
  source          TEXT NOT NULL DEFAULT 'ai_generated',
  placement       TEXT NOT NULL DEFAULT 'floor',
  width_cm        NUMERIC,
  height_cm       NUMERIC,
  depth_cm        NUMERIC,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_models_listing_id UNIQUE (listing_id)
);

-- 10. ROW LEVEL SECURITY (RLS) & GRANTS
GRANT ALL ON TABLE public.profiles TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.user_holdings TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.assets TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.asset_history TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.vault_transactions TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.escrow_orders TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.support_tickets TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.wallet_nonces TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.listing_models TO postgres, service_role, authenticated, anon;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_models ENABLE ROW LEVEL SECURITY;

-- Service Role full access policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on profiles') THEN
    CREATE POLICY "Service role full access on profiles" ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on holdings') THEN
    CREATE POLICY "Service role full access on holdings" ON public.user_holdings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on assets') THEN
    CREATE POLICY "Service role full access on assets" ON public.assets FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on transactions') THEN
    CREATE POLICY "Service role full access on transactions" ON public.vault_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on escrow') THEN
    CREATE POLICY "Service role full access on escrow" ON public.escrow_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on tickets') THEN
    CREATE POLICY "Service role full access on tickets" ON public.support_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 11. VERIFICATION DOCUMENTS TABLE (Granular 3-Doc KYC)
CREATE TABLE IF NOT EXISTS public.verification_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL CHECK (doc_type IN ('id', 'tax', 'proof_of_residence')),
  file_path           TEXT NOT NULL,
  storage_bucket_path TEXT,
  meta_value          TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason    TEXT,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_doc_type UNIQUE (user_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_verification_docs_user ON public.verification_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_docs_status ON public.verification_documents(status);

-- 12. KYC DOCUMENTS TABLE (Alternative schema compatibility)
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,
  file_path           TEXT,
  storage_bucket_path TEXT,
  meta_value          TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kyc_user_doc UNIQUE (user_id, doc_type)
);

-- 13. BANK ACCOUNTS TABLE (Withdrawal Approval Desk)
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_holder      TEXT NOT NULL,
  bank_name           TEXT NOT NULL,
  account_number      TEXT NOT NULL,
  branch_code         TEXT NOT NULL,
  account_type        TEXT DEFAULT 'Cheque / Current',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason    TEXT,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON public.bank_accounts(user_id);

-- 14. ADMIN AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id            UUID,
  admin_email         TEXT,
  action              TEXT NOT NULL,
  target_table        TEXT,
  target_type         TEXT,
  target_id           TEXT,
  target_user_id      UUID,
  reason              TEXT,
  metadata            JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.admin_audit_logs(action);

-- GRANTS & RLS FOR NEW COMPLIANCE TABLES
GRANT ALL ON TABLE public.verification_documents TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.kyc_documents TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.bank_accounts TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.admin_audit_logs TO postgres, service_role, authenticated, anon;

ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on verification_documents') THEN
    CREATE POLICY "Service role full access on verification_documents" ON public.verification_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on kyc_documents') THEN
    CREATE POLICY "Service role full access on kyc_documents" ON public.kyc_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on bank_accounts') THEN
    CREATE POLICY "Service role full access on bank_accounts" ON public.bank_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access on admin_audit_logs') THEN
    CREATE POLICY "Service role full access on admin_audit_logs" ON public.admin_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
