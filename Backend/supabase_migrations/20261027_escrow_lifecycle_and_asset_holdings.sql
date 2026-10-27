-- ============================================================================
-- SMARTASSETS — Escrow Lifecycle, Custody Integrity & Asset Holdings Migration
-- File: Backend/supabase_migrations/20261027_escrow_lifecycle_and_asset_holdings.sql
-- ============================================================================

-- 1. ADD ASSET_ID TO USER_HOLDINGS (Stable Asset-ID Reference)
ALTER TABLE public.user_holdings ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_user_holdings_asset_id ON public.user_holdings(asset_id);

-- 2. ENSURE ASSETS TABLE SUPPORTS IN_ESCROW STATUS
-- Update existing assets where current_owner_id is null
UPDATE public.assets
SET current_owner_id = user_id
WHERE current_owner_id IS NULL AND user_id IS NOT NULL;

UPDATE public.assets
SET seller_id = user_id
WHERE seller_id IS NULL AND user_id IS NOT NULL;

-- 3. ENSURE ESCROW_ORDERS STATUS SUPPORTS PENDING_PAYMENT
CREATE INDEX IF NOT EXISTS idx_escrow_orders_order_id ON public.escrow_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_orders_seller_id ON public.escrow_orders(seller_id);
