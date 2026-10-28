-- ============================================================================
-- SMARTASSETS — Real Cryptographic Product Certificates Migration
-- File: Backend/supabase_migrations/20261029_real_product_certificates.sql
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================================

-- 1. ADD CERTIFICATE COLUMNS TO ASSETS TABLE
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_id TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_version TEXT DEFAULT '1.0.0';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_signature TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_key_id TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_issuer JSONB DEFAULT '{"id":"smartassets-va","name":"SmartAssets Verification Authority"}'::jsonb;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_issued_at TIMESTAMPTZ;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_evidence JSONB;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_lifecycle_status TEXT DEFAULT 'draft';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_revoked BOOLEAN DEFAULT FALSE;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_revoked_at TIMESTAMPTZ;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS certificate_revocation_reason TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS block_number BIGINT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS blockchain_confirmed_at TIMESTAMPTZ;

-- 2. ENSURE CERTIFICATE LIFECYCLE CHECK CONSTRAINT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'assets' AND constraint_name = 'assets_cert_lifecycle_check'
  ) THEN
    ALTER TABLE public.assets DROP CONSTRAINT assets_cert_lifecycle_check;
  END IF;

  ALTER TABLE public.assets 
    ADD CONSTRAINT assets_cert_lifecycle_check 
    CHECK (certificate_lifecycle_status IN (
      'draft',
      'awaiting_inspection',
      'issued',
      'anchored',
      'revoked',
      'unverifiable'
    ));
END $$;

-- 3. CREATE PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_assets_certificate_id ON public.assets(certificate_id);
CREATE INDEX IF NOT EXISTS idx_assets_cert_lifecycle ON public.assets(certificate_lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_assets_cert_key_id ON public.assets(certificate_key_id);
