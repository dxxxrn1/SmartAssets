-- ============================================================================
-- SMARTASSETS — Atomic Investment Purchases, Investor Share Redemptions & RLS
-- Migration: 20261031_atomic_investment_and_share_sales.sql
-- Description:
-- 1. Adds reserved_shares to investor_positions to prevent double-selling.
-- 2. Adds check constraint on assets table to prevent shares_sold > shares.
-- 3. Creates public.share_redemption_requests table with strict RLS.
-- 4. Creates public.payment_idempotency table for idempotent financial writes.
-- 5. Implements atomic PostgreSQL RPCs with row locks:
--    - purchase_asset_shares_atomic
--    - request_share_redemption_atomic
--    - cancel_share_redemption_atomic
--    - settle_share_redemption_atomic
-- ============================================================================

-- 1. ASSET TABLE CONSTRAINTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'assets' AND constraint_name = 'assets_shares_sold_check'
  ) THEN
    ALTER TABLE public.assets
      ADD CONSTRAINT assets_shares_sold_check
      CHECK (shares_sold >= 0 AND (shares IS NULL OR shares_sold <= shares));
  END IF;
END $$;

-- 2. EXTEND INVESTOR_POSITIONS WITH RESERVED_SHARES & UPDATED STATUS
ALTER TABLE public.investor_positions
  ADD COLUMN IF NOT EXISTS reserved_shares INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'investor_positions' AND constraint_name = 'investor_positions_reserved_check'
  ) THEN
    ALTER TABLE public.investor_positions DROP CONSTRAINT investor_positions_reserved_check;
  END IF;

  ALTER TABLE public.investor_positions
    ADD CONSTRAINT investor_positions_reserved_check
    CHECK (reserved_shares >= 0 AND reserved_shares <= shares_held);

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'investor_positions' AND constraint_name = 'investor_positions_status_check'
  ) THEN
    ALTER TABLE public.investor_positions DROP CONSTRAINT investor_positions_status_check;
  END IF;

  ALTER TABLE public.investor_positions
    ADD CONSTRAINT investor_positions_status_check
    CHECK (status IN ('active', 'retired_bought_out', 'retired_delisted', 'retired_sold', 'liquidated'));
END $$;

-- 3. CREATE SHARE REDEMPTION REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.share_redemption_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id              UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  position_id           UUID NOT NULL REFERENCES public.investor_positions(id) ON DELETE CASCADE,
  shares_count          INTEGER NOT NULL CHECK (shares_count > 0),
  share_price_zar       NUMERIC NOT NULL CHECK (share_price_zar > 0),
  gross_amount_zar      NUMERIC NOT NULL CHECK (gross_amount_zar > 0),
  platform_fee_zar      NUMERIC NOT NULL DEFAULT 0 CHECK (platform_fee_zar >= 0),
  net_proceeds_zar      NUMERIC NOT NULL CHECK (net_proceeds_zar > 0),
  valuation_source      TEXT NOT NULL DEFAULT 'market_oracle_appraisal',
  destination_method    TEXT NOT NULL DEFAULT 'vault_cash' CHECK (destination_method IN ('vault_cash', 'bank_wire', 'crypto_wallet')),
  destination_details   JSONB DEFAULT '{}'::jsonb,
  status                TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved_pending_settlement', 'settlement_processing', 'completed', 'cancelled', 'rejected', 'failed')),
  settlement_ref        TEXT,
  settlement_notes      TEXT,
  idempotency_key       TEXT UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_redemptions_investor ON public.share_redemption_requests(investor_id, status);
CREATE INDEX IF NOT EXISTS idx_share_redemptions_asset ON public.share_redemption_requests(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_share_redemptions_position ON public.share_redemption_requests(position_id);

-- 4. CREATE PAYMENT IDEMPOTENCY TABLE
CREATE TABLE IF NOT EXISTS public.payment_idempotency (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key       TEXT NOT NULL UNIQUE,
  payment_rail          TEXT NOT NULL,
  reference_id          TEXT NOT NULL,
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id              UUID REFERENCES public.assets(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('processing', 'settled', 'failed')),
  response              JSONB DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_key ON public.payment_idempotency(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_idempotency_ref ON public.payment_idempotency(reference_id);

-- 5. HARDEN ROW-LEVEL SECURITY (RLS)
ALTER TABLE public.investor_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_redemption_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_payouts ENABLE ROW LEVEL SECURITY;

-- Clean existing policies
DROP POLICY IF EXISTS "Investors can view only own positions" ON public.investor_positions;
DROP POLICY IF EXISTS "Public can view active investor positions count" ON public.investor_positions;
DROP POLICY IF EXISTS "Users can view their own positions" ON public.investor_positions;
DROP POLICY IF EXISTS "Investors can view only own share redemptions" ON public.share_redemption_requests;
DROP POLICY IF EXISTS "Users can view their own payouts" ON public.investment_payouts;
DROP POLICY IF EXISTS "Users can view own idempotency" ON public.payment_idempotency;

-- Strict SELECT-only policies for authenticated owners:
CREATE POLICY "Investors can view only own positions" ON public.investor_positions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = investor_id);

CREATE POLICY "Investors can view only own share redemptions" ON public.share_redemption_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = investor_id);

CREATE POLICY "Users can view their own payouts" ON public.investment_payouts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_id);

CREATE POLICY "Users can view own idempotency" ON public.payment_idempotency
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Explicitly disallow INSERT, UPDATE, DELETE for regular authenticated users.
-- All state mutations are strictly reserved for service_role or SECURITY DEFINER database functions.

-- 6. ATOMIC PURCHASE RPC WITH ROW LOCKING & IDEMPOTENCY
CREATE OR REPLACE FUNCTION public.purchase_asset_shares_atomic(
  p_asset_id UUID,
  p_investor_id UUID,
  p_shares_count INTEGER,
  p_cost_basis_zar NUMERIC,
  p_order_id TEXT,
  p_tx_hash TEXT DEFAULT NULL,
  p_payment_rail TEXT DEFAULT 'Settled Payment',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_asset RECORD;
  v_existing_idemp RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_total_shares INTEGER;
  v_shares_sold INTEGER;
  v_remaining_shares INTEGER;
  v_max_shares_per_investor INTEGER;
  v_existing_investor_shares INTEGER := 0;
  v_position RECORD;
  v_position_id UUID;
BEGIN
  -- 1. Authorization check: caller must match p_investor_id or be service_role
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_investor_id THEN
    RAISE EXCEPTION 'Unauthorized: Caller identity does not match investor ID.';
  END IF;

  IF p_shares_count <= 0 THEN
    RAISE EXCEPTION 'Invalid shares count: %', p_shares_count;
  END IF;

  -- 2. Idempotency check: if this idempotency key was already settled, return existing state
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_idemp
    FROM public.payment_idempotency
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN v_existing_idemp.response;
    END IF;
  END IF;

  -- 3. Row-level lock on the target asset
  SELECT * INTO v_asset
  FROM public.assets
  WHERE id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % not found.', p_asset_id;
  END IF;

  -- 4. Verify fractional investment is explicitly enabled and asset is active
  IF NOT COALESCE(v_asset.allow_investment, false) THEN
    RAISE EXCEPTION 'Fractional investment is not enabled for this asset listing.';
  END IF;

  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Asset listing is not active (current status: %).', v_asset.status;
  END IF;

  -- Self-dealing check: original seller cannot invest in their own listing
  IF COALESCE(v_asset.seller_id, v_asset.user_id) = p_investor_id THEN
    RAISE EXCEPTION 'Self-dealing Violation: You cannot invest in your own asset listing.';
  END IF;

  v_total_shares := COALESCE(v_asset.shares, 100);
  v_shares_sold := COALESCE(v_asset.shares_sold, 0);
  v_remaining_shares := v_total_shares - v_shares_sold;

  -- 5. Inventory availability check
  IF p_shares_count > v_remaining_shares THEN
    RAISE EXCEPTION 'Insufficient shares available: requested %, only % remaining.', p_shares_count, v_remaining_shares;
  END IF;

  -- 6. Anti-whale rule: max 25% ownership per investor
  v_max_shares_per_investor := GREATEST(1, FLOOR(v_total_shares * 0.25));
  SELECT COALESCE(SUM(shares_held), 0) INTO v_existing_investor_shares
  FROM public.investor_positions
  WHERE asset_id = p_asset_id AND investor_id = p_investor_id AND status = 'active';

  IF (v_existing_investor_shares + p_shares_count) > v_max_shares_per_investor THEN
    RAISE EXCEPTION 'Anti-whale Cap Exceeded: Maximum 25%% (% shares) per investor. Currently hold %, requesting %.',
      v_max_shares_per_investor, v_existing_investor_shares, p_shares_count;
  END IF;

  -- 7. Atomically increment shares_sold and update status if fully funded
  UPDATE public.assets
  SET shares_sold = v_shares_sold + p_shares_count,
      status = CASE WHEN (v_shares_sold + p_shares_count) >= v_total_shares THEN 'funded' ELSE 'active' END,
      updated_at = v_now
  WHERE id = p_asset_id;

  -- 8. Create or update durable investor position
  SELECT * INTO v_position
  FROM public.investor_positions
  WHERE asset_id = p_asset_id AND investor_id = p_investor_id AND status = 'active'
  LIMIT 1;

  IF FOUND THEN
    v_position_id := v_position.id;
    UPDATE public.investor_positions
    SET shares_held = shares_held + p_shares_count,
        cost_basis_zar = cost_basis_zar + p_cost_basis_zar,
        updated_at = v_now
    WHERE id = v_position.id;
  ELSE
    INSERT INTO public.investor_positions (
      asset_id,
      investor_id,
      shares_held,
      cost_basis_zar,
      order_id,
      tx_hash,
      status,
      created_at,
      updated_at
    ) VALUES (
      p_asset_id,
      p_investor_id,
      p_shares_count,
      p_cost_basis_zar,
      p_order_id,
      p_tx_hash,
      'active',
      v_now,
      v_now
    ) RETURNING id INTO v_position_id;
  END IF;

  -- 9. Insert provenance milestone
  INSERT INTO public.asset_history (
    asset_id,
    year,
    event,
    party,
    hash,
    tx_hash,
    verified
  ) VALUES (
    p_asset_id,
    TO_CHAR(v_now, 'YYYY'),
    'Fractional Investment: Acquired ' || p_shares_count::TEXT || ' Shares via ' || p_payment_rail || '.',
    'Investor (' || SUBSTRING(p_investor_id::TEXT FROM 1 FOR 8) || ')',
    COALESCE(p_tx_hash, p_order_id),
    p_tx_hash,
    true
  );

  -- 10. Record idempotency entry
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_idempotency (
      idempotency_key,
      payment_rail,
      reference_id,
      user_id,
      asset_id,
      status,
      response,
      created_at
    ) VALUES (
      p_idempotency_key,
      p_payment_rail,
      p_order_id,
      p_investor_id,
      p_asset_id,
      'settled',
      jsonb_build_object(
        'success', true,
        'position_id', v_position_id,
        'asset_id', p_asset_id,
        'investor_id', p_investor_id,
        'shares_acquired', p_shares_count,
        'shares_sold_total', v_shares_sold + p_shares_count,
        'total_shares', v_total_shares,
        'cost_basis_zar', p_cost_basis_zar,
        'order_id', p_order_id
      ),
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'position_id', v_position_id,
    'asset_id', p_asset_id,
    'investor_id', p_investor_id,
    'shares_acquired', p_shares_count,
    'shares_sold_total', v_shares_sold + p_shares_count,
    'total_shares', v_total_shares,
    'cost_basis_zar', p_cost_basis_zar,
    'order_id', p_order_id
  );
END;
$$;

-- 7. ATOMIC SHARE REDEMPTION REQUEST RPC WITH SHARE RESERVATION
CREATE OR REPLACE FUNCTION public.request_share_redemption_atomic(
  p_position_id UUID,
  p_investor_id UUID,
  p_shares_count INTEGER,
  p_destination_method TEXT DEFAULT 'vault_cash',
  p_destination_details JSONB DEFAULT '{}'::jsonb,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pos RECORD;
  v_asset RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_available_shares INTEGER;
  v_share_price NUMERIC;
  v_gross_amount NUMERIC;
  v_platform_fee NUMERIC;
  v_net_proceeds NUMERIC;
  v_request_id UUID;
  v_existing_req RECORD;
BEGIN
  -- 1. Authorization check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_investor_id THEN
    RAISE EXCEPTION 'Unauthorized: Caller identity does not match position owner.';
  END IF;

  IF p_shares_count <= 0 THEN
    RAISE EXCEPTION 'Requested shares count must be greater than zero.';
  END IF;

  -- 2. Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_req
    FROM public.share_redemption_requests
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'request_id', v_existing_req.id,
        'status', v_existing_req.status,
        'shares_count', v_existing_req.shares_count,
        'net_proceeds_zar', v_existing_req.net_proceeds_zar,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- 3. Row lock on the investor position
  SELECT * INTO v_pos
  FROM public.investor_positions
  WHERE id = p_position_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investor position % not found.', p_position_id;
  END IF;

  IF v_pos.investor_id <> p_investor_id THEN
    RAISE EXCEPTION 'Unauthorized: Position does not belong to user %.', p_investor_id;
  END IF;

  IF v_pos.status <> 'active' THEN
    RAISE EXCEPTION 'Position cannot be sold/redeemed: current status is "%".', v_pos.status;
  END IF;

  v_available_shares := v_pos.shares_held - COALESCE(v_pos.reserved_shares, 0);
  IF p_shares_count > v_available_shares THEN
    RAISE EXCEPTION 'Insufficient unreserved shares: you own % total, % reserved in pending sale, % available to sell.',
      v_pos.shares_held, COALESCE(v_pos.reserved_shares, 0), v_available_shares;
  END IF;

  -- 4. Row lock on asset to ensure asset is not delisted or sold
  SELECT * INTO v_asset
  FROM public.assets
  WHERE id = v_pos.asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % not found.', v_pos.asset_id;
  END IF;

  IF v_asset.status IN ('delisted', 'sold') THEN
    RAISE EXCEPTION 'Asset is % and shares cannot be redeemed via secondary sale.', v_asset.status;
  END IF;

  -- 5. Calculate authoritative price and fee
  v_share_price := COALESCE(v_asset.share_price, ROUND(COALESCE(v_asset.price_num, 1000) / COALESCE(v_asset.shares, 100)));
  v_gross_amount := p_shares_count * v_share_price;
  v_platform_fee := ROUND(v_gross_amount * 0.025); -- 2.5% platform liquidity fee
  v_net_proceeds := v_gross_amount - v_platform_fee;

  -- 6. Atomically reserve the shares in the position record
  UPDATE public.investor_positions
  SET reserved_shares = COALESCE(reserved_shares, 0) + p_shares_count,
      updated_at = v_now
  WHERE id = p_position_id;

  -- 7. Create redemption request record
  INSERT INTO public.share_redemption_requests (
    investor_id,
    asset_id,
    position_id,
    shares_count,
    share_price_zar,
    gross_amount_zar,
    platform_fee_zar,
    net_proceeds_zar,
    valuation_source,
    destination_method,
    destination_details,
    status,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    p_investor_id,
    v_pos.asset_id,
    p_position_id,
    p_shares_count,
    v_share_price,
    v_gross_amount,
    v_platform_fee,
    v_net_proceeds,
    'approved_listing_share_price',
    p_destination_method,
    p_destination_details,
    'pending_review',
    p_idempotency_key,
    v_now,
    v_now
  ) RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'position_id', p_position_id,
    'asset_id', v_pos.asset_id,
    'shares_count', p_shares_count,
    'share_price_zar', v_share_price,
    'gross_amount_zar', v_gross_amount,
    'platform_fee_zar', v_platform_fee,
    'net_proceeds_zar', v_net_proceeds,
    'status', 'pending_review',
    'destination_method', p_destination_method
  );
END;
$$;

-- 8. ATOMIC CANCEL SHARE REDEMPTION RPC
CREATE OR REPLACE FUNCTION public.cancel_share_redemption_atomic(
  p_request_id UUID,
  p_investor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_pos RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Lock the redemption request
  SELECT * INTO v_req
  FROM public.share_redemption_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption request % not found.', p_request_id;
  END IF;

  -- Authorization check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_investor_id THEN
    RAISE EXCEPTION 'Unauthorized: Caller identity does not match request investor.';
  END IF;

  IF v_req.investor_id <> p_investor_id THEN
    RAISE EXCEPTION 'Unauthorized: Request does not belong to user %.', p_investor_id;
  END IF;

  -- Condition: Can only cancel if pending_review or approved_pending_settlement
  -- Strictly forbidden after settlement starts!
  IF v_req.status IN ('settlement_processing', 'completed') THEN
    RAISE EXCEPTION 'Cannot cancel redemption request: settlement is already in progress or completed.';
  END IF;

  IF v_req.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Request already cancelled.');
  END IF;

  -- 2. Lock position and un-reserve shares
  SELECT * INTO v_pos
  FROM public.investor_positions
  WHERE id = v_req.position_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.investor_positions
    SET reserved_shares = GREATEST(0, COALESCE(reserved_shares, 0) - v_req.shares_count),
        updated_at = v_now
    WHERE id = v_req.position_id;
  END IF;

  -- 3. Mark request cancelled
  UPDATE public.share_redemption_requests
  SET status = 'cancelled',
      updated_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'status', 'cancelled',
    'shares_unreserved', v_req.shares_count
  );
END;
$$;

-- 9. ATOMIC SETTLE SHARE REDEMPTION RPC (Privileged Custody Execution)
CREATE OR REPLACE FUNCTION public.settle_share_redemption_atomic(
  p_request_id UUID,
  p_settlement_ref TEXT,
  p_settlement_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_pos RECORD;
  v_asset RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_new_shares_held INTEGER;
  v_new_reserved INTEGER;
BEGIN
  -- Lock request
  SELECT * INTO v_req
  FROM public.share_redemption_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption request % not found.', p_request_id;
  END IF;

  IF v_req.status IN ('completed', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot settle request with status "%".', v_req.status;
  END IF;

  -- Lock position
  SELECT * INTO v_pos
  FROM public.investor_positions
  WHERE id = v_req.position_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position % not found for redemption.', v_req.position_id;
  END IF;

  v_new_reserved := GREATEST(0, COALESCE(v_pos.reserved_shares, 0) - v_req.shares_count);
  v_new_shares_held := GREATEST(0, v_pos.shares_held - v_req.shares_count);

  -- Deduct shares held and reserved
  UPDATE public.investor_positions
  SET shares_held = v_new_shares_held,
      reserved_shares = v_new_reserved,
      status = CASE WHEN v_new_shares_held = 0 THEN 'retired_sold' ELSE 'active' END,
      updated_at = v_now
  WHERE id = v_pos.id;

  -- Record in investment_payouts ledger
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
    tx_hash,
    status,
    created_at
  ) VALUES (
    v_req.asset_id,
    'REDEMPTION-' || p_request_id::TEXT,
    v_req.investor_id,
    'investor',
    v_req.shares_count,
    COALESCE((SELECT shares FROM public.assets WHERE id = v_req.asset_id), 100),
    v_req.gross_amount_zar,
    v_req.net_proceeds_zar,
    v_req.platform_fee_zar,
    v_req.net_proceeds_zar,
    p_settlement_ref,
    'completed',
    v_now
  );

  -- Mark request completed
  UPDATE public.share_redemption_requests
  SET status = 'completed',
      settlement_ref = p_settlement_ref,
      settlement_notes = p_settlement_notes,
      settled_at = v_now,
      updated_at = v_now
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'status', 'completed',
    'payout_amount_zar', v_req.net_proceeds_zar,
    'settlement_ref', p_settlement_ref
  );
END;
$$;
