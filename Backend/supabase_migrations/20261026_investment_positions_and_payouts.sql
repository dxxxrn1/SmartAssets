-- ============================================================================
-- SMARTASSETS — Fractional Investment Opt-In, Durable Positions & Buyout Ledger
-- File: Backend/supabase_migrations/20261026_investment_positions_and_payouts.sql
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================================

-- 1. ASSETS TABLE EXTENSIONS
-- Add allow_investment (defaults to false, including existing listings)
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS allow_investment BOOLEAN NOT NULL DEFAULT false;

-- Add explicit seller_id and current_owner_id columns to distinguish original lister from current owner
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS current_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill seller_id and current_owner_id from user_id for existing records
UPDATE public.assets
SET seller_id = user_id
WHERE seller_id IS NULL AND user_id IS NOT NULL;

UPDATE public.assets
SET current_owner_id = user_id
WHERE current_owner_id IS NULL AND user_id IS NOT NULL;

-- Ensure all existing rows default allow_investment to false
UPDATE public.assets
SET allow_investment = false
WHERE allow_investment IS NULL;

CREATE INDEX IF NOT EXISTS idx_assets_allow_investment ON public.assets(allow_investment);
CREATE INDEX IF NOT EXISTS idx_assets_current_owner_id ON public.assets(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_assets_seller_id ON public.assets(seller_id);

-- 2. DURABLE INVESTOR POSITIONS TABLE
-- Tracks individual investor holdings per asset with cost basis, status, and transaction reference
CREATE TABLE IF NOT EXISTS public.investor_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  investor_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shares_held     INTEGER NOT NULL CHECK (shares_held > 0),
  cost_basis_zar  NUMERIC NOT NULL DEFAULT 0,
  cost_basis_eth  NUMERIC DEFAULT 0,
  order_id        TEXT,
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired_bought_out', 'liquidated')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investor_positions_asset ON public.investor_positions(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_investor_positions_investor ON public.investor_positions(investor_id, status);

-- 3. INVESTMENT PAYOUTS LEDGER TABLE
-- Records immutable payout distribution events when an investment-enabled item is bought outright
CREATE TABLE IF NOT EXISTS public.investment_payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id              UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  order_id              TEXT NOT NULL,
  recipient_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_role        TEXT NOT NULL CHECK (recipient_role IN ('investor', 'seller')),
  shares_represented    INTEGER NOT NULL,
  total_shares          INTEGER NOT NULL,
  gross_sale_zar        NUMERIC NOT NULL,
  net_distributable_zar NUMERIC NOT NULL,
  platform_fee_zar      NUMERIC NOT NULL,
  payout_amount_zar     NUMERIC NOT NULL,
  payout_amount_eth     NUMERIC DEFAULT 0,
  tx_hash               TEXT,
  status                TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_payouts_asset ON public.investment_payouts(asset_id);
CREATE INDEX IF NOT EXISTS idx_investment_payouts_recipient ON public.investment_payouts(recipient_id);
CREATE INDEX IF NOT EXISTS idx_investment_payouts_order ON public.investment_payouts(order_id);

-- 4. RLS POLICIES FOR NEW TABLES
ALTER TABLE public.investor_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_payouts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investor_positions' AND policyname = 'Public can view active investor positions count'
  ) THEN
    CREATE POLICY "Public can view active investor positions count" ON public.investor_positions
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investor_positions' AND policyname = 'Users can view their own positions'
  ) THEN
    CREATE POLICY "Users can view their own positions" ON public.investor_positions
      FOR ALL USING (auth.uid() = investor_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'investment_payouts' AND policyname = 'Users can view their own payouts'
  ) THEN
    CREATE POLICY "Users can view their own payouts" ON public.investment_payouts
      FOR SELECT USING (auth.uid() = recipient_id);
  END IF;
END $$;
