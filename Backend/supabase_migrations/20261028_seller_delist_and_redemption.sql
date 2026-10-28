-- SMARTASSETS — Seller Delisting, Investor Redemption & Position Security RLS
-- File: Backend/supabase_migrations/20261028_seller_delist_and_redemption.sql
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- 1. EXTEND INVESTOR_POSITIONS STATUS CHECK & ASSETS COLUMNS
-- Add 'retired_delisted' to the allowed status values
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'investor_positions' AND constraint_name = 'investor_positions_status_check'
  ) THEN
    ALTER TABLE public.investor_positions DROP CONSTRAINT investor_positions_status_check;
  END IF;
  
  ALTER TABLE public.investor_positions 
    ADD CONSTRAINT investor_positions_status_check 
    CHECK (status IN ('active', 'retired_bought_out', 'retired_delisted', 'liquidated'));
END $$;

-- 2. CREATE IMMUTABLE INVESTOR REDEMPTIONS TABLE
-- Records each investor's principal and appreciation redemption event at delisting
CREATE TABLE IF NOT EXISTS public.investor_redemptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id              UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  seller_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investor_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id           UUID REFERENCES public.investor_positions(id) ON DELETE SET NULL,
  shares_redeemed       INTEGER NOT NULL,
  total_shares          INTEGER NOT NULL,
  initial_cost_basis    NUMERIC NOT NULL,
  redemption_valuation  NUMERIC NOT NULL,
  valuation_source      TEXT NOT NULL DEFAULT 'approved_listing_valuation',
  appreciation_amount   NUMERIC NOT NULL DEFAULT 0,
  total_payout_zar      NUMERIC NOT NULL,
  payout_source_ref     TEXT NOT NULL,
  payout_verified       BOOLEAN NOT NULL DEFAULT true,
  status                TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investor_redemptions_asset ON public.investor_redemptions(asset_id);
CREATE INDEX IF NOT EXISTS idx_investor_redemptions_seller ON public.investor_redemptions(seller_id);
CREATE INDEX IF NOT EXISTS idx_investor_redemptions_investor ON public.investor_redemptions(investor_id);

-- 3. HARDEN RLS POLICIES FOR INVESTOR POSITIONS (REQUIREMENT 7)
-- Disallow public leakage of investor identities/cost-basis and disallow client-side tampering
ALTER TABLE public.investor_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_redemptions ENABLE ROW LEVEL SECURITY;

-- Drop previous overly-permissive policies
DROP POLICY IF EXISTS "Public can view active investor positions count" ON public.investor_positions;
DROP POLICY IF EXISTS "Users can view their own positions" ON public.investor_positions;
DROP POLICY IF EXISTS "Investors can view only own positions" ON public.investor_positions;
DROP POLICY IF EXISTS "Investors can view only own redemptions" ON public.investor_redemptions;
DROP POLICY IF EXISTS "Sellers can view redemptions for their assets" ON public.investor_redemptions;

-- Investors can strictly read ONLY their own positions (SELECT only)
CREATE POLICY "Investors can view only own positions" ON public.investor_positions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = investor_id);

-- No INSERT, UPDATE, or DELETE policies exist for authenticated users on investor_positions.
-- All mutations must occur via service_role or SECURITY DEFINER database procedures.

-- Investors and sellers can view redemptions involving them
CREATE POLICY "Investors can view only own redemptions" ON public.investor_redemptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = investor_id);

CREATE POLICY "Sellers can view redemptions for their assets" ON public.investor_redemptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = seller_id);

-- 4. PUBLIC AGGREGATE SUMMARY (NON-LEAKING)
-- Exposes only share count and investor count without exposing user IDs or cost-basis
CREATE OR REPLACE FUNCTION public.get_asset_investment_summary(p_asset_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'asset_id', p_asset_id,
    'total_investors', COUNT(DISTINCT investor_id),
    'total_shares_invested', COALESCE(SUM(shares_held), 0)
  )
  FROM public.investor_positions
  WHERE asset_id = p_asset_id AND status = 'active';
$$;

-- 5. ATOMIC DELIST AND INVESTOR REDEMPTION TRANSACTION RPC (REQUIREMENTS 2, 4, 6)
CREATE OR REPLACE FUNCTION public.delist_asset_and_redeem(
  p_asset_id UUID,
  p_seller_id UUID,
  p_redemption_valuation NUMERIC,
  p_valuation_source TEXT,
  p_payout_ref TEXT,
  p_redemptions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_asset RECORD;
  v_item JSONB;
  v_now TIMESTAMPTZ := NOW();
  v_redeemed_count INTEGER := 0;
  v_total_payout NUMERIC := 0;
BEGIN
  -- 1. Row-level lock on asset to serialize concurrent delisting requests
  SELECT * INTO v_asset
  FROM public.assets
  WHERE id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % does not exist.', p_asset_id;
  END IF;

  -- 2. Enforce strict seller authorization on durable record
  IF COALESCE(v_asset.seller_id, v_asset.user_id) <> p_seller_id THEN
    RAISE EXCEPTION 'Unauthorized: Only the original listing owner may delist this asset.';
  END IF;

  -- 3. Verify listing status is active
  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot delist asset: current status is "%". Only active listings can be delisted.', v_asset.status;
  END IF;

  -- 4. Retire all active investor positions for this asset atomically
  UPDATE public.investor_positions
  SET status = 'retired_delisted',
      updated_at = v_now
  WHERE asset_id = p_asset_id AND status = 'active';

  -- 5. Record individual investor redemptions and payout ledger entries
  IF p_redemptions IS NOT NULL AND jsonb_array_length(p_redemptions) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_redemptions)
    LOOP
      v_redeemed_count := v_redeemed_count + 1;
      v_total_payout := v_total_payout + COALESCE((v_item->>'total_payout')::NUMERIC, 0);

      -- Immutable redemptions audit log
      INSERT INTO public.investor_redemptions (
        asset_id,
        seller_id,
        investor_id,
        position_id,
        shares_redeemed,
        total_shares,
        initial_cost_basis,
        redemption_valuation,
        valuation_source,
        appreciation_amount,
        total_payout_zar,
        payout_source_ref,
        payout_verified,
        status,
        created_at
      ) VALUES (
        p_asset_id,
        p_seller_id,
        (v_item->>'investor_id')::UUID,
        (v_item->>'position_id')::UUID,
        (v_item->>'shares')::INTEGER,
        COALESCE(v_asset.shares, 100),
        (v_item->>'cost_basis')::NUMERIC,
        p_redemption_valuation,
        p_valuation_source,
        COALESCE((v_item->>'appreciation')::NUMERIC, 0),
        (v_item->>'total_payout')::NUMERIC,
        p_payout_ref,
        true,
        'completed',
        v_now
      );

      -- Co-record in investment_payouts ledger for unified reporting
      INSERT INTO public.investment_payouts (
        asset_id,
        order_id,
        recipient_id,
        recipient_role,
        shares_represented,
        total_shares,
        gross_sale_zar,
        net_distributable_zar,
        platform_fee_zar,
        payout_amount_zar,
        payout_amount_eth,
        tx_hash,
        status,
        created_at
      ) VALUES (
        p_asset_id,
        'DELIST-' || p_asset_id,
        (v_item->>'investor_id')::UUID,
        'investor',
        (v_item->>'shares')::INTEGER,
        COALESCE(v_asset.shares, 100),
        p_redemption_valuation,
        (v_item->>'total_payout')::NUMERIC,
        0,
        (v_item->>'total_payout')::NUMERIC,
        0,
        p_payout_ref,
        'completed',
        v_now
      );
    END LOOP;
  END IF;

  -- 6. Update asset record: mark delisted and close investment opt-in
  UPDATE public.assets
  SET status = 'delisted',
      allow_investment = false,
      updated_at = v_now
  WHERE id = p_asset_id;

  -- 7. Record provenance milestone in asset history
  INSERT INTO public.asset_history (
    asset_id,
    year,
    event,
    party,
    hash,
    verified
  ) VALUES (
    p_asset_id,
    TO_CHAR(v_now, 'YYYY'),
    'Listing Delisted & Investor Positions Redeemed: Seller voluntary delist at valuation R' || p_redemption_valuation::TEXT || ' (' || p_valuation_source || '). ' || v_redeemed_count::TEXT || ' active investor position(s) retired.',
    'Seller (' || SUBSTRING(p_seller_id::TEXT FROM 1 FOR 8) || ')',
    p_payout_ref,
    true
  );

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'status', 'delisted',
    'redeemed_count', v_redeemed_count,
    'total_payout_zar', v_total_payout,
    'valuation', p_redemption_valuation,
    'valuation_source', p_valuation_source
  );
END;
$$;
