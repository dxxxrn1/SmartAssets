-- ============================================================================
-- SMARTASSETS — Product Identity, Metadata Digest & Blockchain Registration
-- File: Backend/supabase_migrations/20261028_product_identity_and_blockchain_registration.sql
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================================

-- 1. ADD IDENTITY & REGISTRATION COLUMNS TO ASSETS TABLE
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS metadata_digest TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS registration_status TEXT DEFAULT 'unregistered';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS registration_error TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS nft_token_id TEXT;

-- 2. ENSURE REGISTRATION STATUS CHECK CONSTRAINT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'assets' AND constraint_name = 'assets_registration_status_check'
  ) THEN
    ALTER TABLE public.assets DROP CONSTRAINT assets_registration_status_check;
  END IF;

  ALTER TABLE public.assets 
    ADD CONSTRAINT assets_registration_status_check 
    CHECK (registration_status IN ('unregistered', 'pending', 'verified_on_chain', 'failed'));
END $$;

-- 3. CREATE PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_assets_metadata_digest ON public.assets(metadata_digest);
CREATE INDEX IF NOT EXISTS idx_assets_registration_status ON public.assets(registration_status);
CREATE INDEX IF NOT EXISTS idx_assets_token_id ON public.assets(token_id);
