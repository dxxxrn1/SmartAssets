-- ─── SmartAssets: Curated 3D Model Catalog & Fallback System ───────────────────
-- Migration: 20261101_curated_model_catalog.sql
-- Creates public.catalog_models for licensed, SmartAssets-owned curated GLBs,
-- enhances public.listing_models with catalog matching, source tracking,
-- license/attribution metadata, and provides atomic cross-instance job locking.

-- ─── 0. Preflight Verification Check ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'listing_models') THEN
    RAISE EXCEPTION 'Preflight check failed: public.listing_models table does not exist. Please apply 20261022_listing_models.sql first.';
  END IF;
END $$;

-- ─── 1. Storage Bucket & Permissions Configuration ────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('models', 'models', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public can view and download all model assets in 'models'
DROP POLICY IF EXISTS "Public can view 3D models" ON storage.objects;
CREATE POLICY "Public can view 3D models"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'models');

-- Authenticated administrators can manage objects in 'models'
DROP POLICY IF EXISTS "Admins can upload models" ON storage.objects;
CREATE POLICY "Admins can upload models"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'models' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE public.profiles.id = auth.uid()
        AND public.profiles.role = 'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'models' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE public.profiles.id = auth.uid()
        AND public.profiles.role = 'admin'
    )
  );

-- ─── 2. Create catalog_models Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.catalog_models (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL,
  categories              TEXT[] NOT NULL DEFAULT '{}',
  tags                    TEXT[] NOT NULL DEFAULT '{}',
  brand                   TEXT,
  product_type            TEXT,
  attributes              JSONB DEFAULT '{}'::jsonb,
  
  -- Model file and spatial dimensions
  glb_url                 TEXT NOT NULL,
  source_glb_url          TEXT,
  thumbnail_url           TEXT,
  placement               TEXT NOT NULL DEFAULT 'floor' CHECK (placement IN ('floor', 'wall', 'table')),
  width_cm                NUMERIC NOT NULL DEFAULT 40,
  height_cm               NUMERIC NOT NULL DEFAULT 40,
  depth_cm                NUMERIC NOT NULL DEFAULT 40,
  dimensions_approximate  BOOLEAN NOT NULL DEFAULT true,
  size_bytes              BIGINT,
  triangle_count          INTEGER,
  
  -- Rights, provenance and attribution
  source_name             TEXT NOT NULL,
  source_url              TEXT,
  creator                 TEXT NOT NULL,
  license                 TEXT NOT NULL,
  attribution             TEXT NOT NULL,
  acquired_at             TIMESTAMPTZ DEFAULT NOW(),
  
  -- Governance
  is_active               BOOLEAN NOT NULL DEFAULT true,
  is_approved             BOOLEAN NOT NULL DEFAULT true,
  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure column exists if table was pre-existing
ALTER TABLE public.catalog_models
  ADD COLUMN IF NOT EXISTS dimensions_approximate BOOLEAN NOT NULL DEFAULT true;

-- Indexes for fast category search, keyword matching, and active filtering
CREATE INDEX IF NOT EXISTS idx_catalog_models_category ON public.catalog_models(category);
CREATE INDEX IF NOT EXISTS idx_catalog_models_is_active ON public.catalog_models(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_catalog_models_tags ON public.catalog_models USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_catalog_models_categories ON public.catalog_models USING gin(categories);

-- ─── 3. Row Level Security for catalog_models ─────────────────────────────────
ALTER TABLE public.catalog_models ENABLE ROW LEVEL SECURITY;

-- Public (anonymous + authenticated) can view active & approved catalog models
DROP POLICY IF EXISTS "Public can view active catalog models" ON public.catalog_models;
CREATE POLICY "Public can view active catalog models"
  ON public.catalog_models
  FOR SELECT
  USING (is_active = true AND is_approved = true);

-- Only authenticated admins or service_role can insert/update/delete catalog entries
DROP POLICY IF EXISTS "Admins can manage catalog models" ON public.catalog_models;
CREATE POLICY "Admins can manage catalog models"
  ON public.catalog_models
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE public.profiles.id = auth.uid()
        AND public.profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE public.profiles.id = auth.uid()
        AND public.profiles.role = 'admin'
    )
  );

-- ─── 4. Enhance public.listing_models With Fallback & Provenance Columns ───────
ALTER TABLE public.listing_models
  ADD COLUMN IF NOT EXISTS catalog_model_id UUID REFERENCES public.catalog_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS match_reasons JSONB,
  ADD COLUMN IF NOT EXISTS attribution TEXT,
  ADD COLUMN IF NOT EXISTS license TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'tripo',
  ADD COLUMN IF NOT EXISTS dimensions_approximate BOOLEAN NOT NULL DEFAULT true;

-- Update the CHECK constraint on source in listing_models to include category_catalog and demo_showcase
ALTER TABLE public.listing_models DROP CONSTRAINT IF EXISTS listing_models_source_check;
ALTER TABLE public.listing_models
  ADD CONSTRAINT listing_models_source_check
  CHECK (source IN ('ai_generated', 'category_catalog', 'demo_showcase', 'scan'));

CREATE INDEX IF NOT EXISTS idx_listing_models_catalog_id ON public.listing_models(catalog_model_id);
CREATE INDEX IF NOT EXISTS idx_listing_models_source ON public.listing_models(source);

-- ─── 5. Atomic Cross-Instance Job Claim & Reservation Engine ──────────────────
CREATE OR REPLACE FUNCTION public.claim_model_generation_job(
  p_listing_id UUID,
  p_max_concurrent INT DEFAULT 3,
  p_max_attempts INT DEFAULT 2,
  p_stale_interval_minutes INT DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing RECORD;
  v_active_count INT;
  v_attempts INT := 0;
  v_record RECORD;
BEGIN
  -- 1. Acquire transaction-level advisory lock on global generation queue to serialize concurrent reservation across instances
  PERFORM pg_advisory_xact_lock(hashtext('model_generation_global_queue'));

  -- 2. Check & lock row for this listing if it exists
  SELECT * INTO v_existing
  FROM public.listing_models
  WHERE listing_id = p_listing_id
  FOR UPDATE;

  -- 3. If already ready, cannot re-claim
  IF v_existing.status = 'ready' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'code', 'ALREADY_READY',
      'message', '3D model is already ready for this listing.',
      'model', to_jsonb(v_existing)
    );
  END IF;

  -- 4. If currently processing on any instance, check staleness
  IF v_existing.status = 'processing' THEN
    IF v_existing.updated_at > NOW() - (p_stale_interval_minutes || ' minutes')::INTERVAL THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'code', 'IN_PROGRESS',
        'message', '3D model generation is already in progress.',
        'model', to_jsonb(v_existing)
      );
    END IF;
    -- Stale job: allow recovery and retry
  END IF;

  -- 5. Check persistent per-listing attempt cap
  v_attempts := COALESCE(v_existing.attempt_count, 0);
  IF v_attempts >= p_max_attempts THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'code', 'ATTEMPT_LIMIT_REACHED',
      'message', 'Maximum 3D generation attempts reached for this listing.',
      'attempt_count', v_attempts
    );
  END IF;

  -- 6. Check global active processing count across all instances
  SELECT COUNT(*) INTO v_active_count
  FROM public.listing_models
  WHERE status = 'processing'
    AND updated_at > NOW() - (p_stale_interval_minutes || ' minutes')::INTERVAL
    AND listing_id != p_listing_id;

  IF v_active_count >= p_max_concurrent THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'code', 'CONCURRENCY_LIMIT_REACHED',
      'message', '3D generation queue is currently at capacity across all instances.',
      'active_count', v_active_count
    );
  END IF;

  -- 7. Atomically reserve slot and increment attempt count
  v_attempts := v_attempts + 1;
  INSERT INTO public.listing_models (
    listing_id, status, provider, source, attempt_count, updated_at
  ) VALUES (
    p_listing_id, 'processing', 'tripo', 'ai_generated', v_attempts, NOW()
  )
  ON CONFLICT (listing_id) DO UPDATE SET
    status = 'processing',
    provider = 'tripo',
    attempt_count = v_attempts,
    updated_at = NOW(),
    error_message = NULL
  RETURNING * INTO v_record;

  RETURN jsonb_build_object(
    'claimed', true,
    'attempt_count', v_attempts,
    'record', to_jsonb(v_record)
  );
END;
$$;

-- Restrict claim function strictly to service_role
REVOKE ALL ON FUNCTION public.claim_model_generation_job(UUID, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_model_generation_job(UUID, INT, INT, INT) TO service_role;

-- Release / terminal resolution function
CREATE OR REPLACE FUNCTION public.release_model_generation_job(
  p_listing_id UUID,
  p_status TEXT, -- 'ready', 'failed', or 'cancelled'
  p_task_id TEXT DEFAULT NULL,
  p_glb_url TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record RECORD;
BEGIN
  -- Validate state transition: status must be 'ready', 'failed', or 'cancelled'
  IF p_status NOT IN ('ready', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATUS',
      'message', 'Invalid status transition. Allowed terminal statuses: ready, failed, cancelled.'
    );
  END IF;

  -- Acquire lock on listing model record
  SELECT * INTO v_record
  FROM public.listing_models
  WHERE listing_id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'Listing model record not found.'
    );
  END IF;

  UPDATE public.listing_models
  SET status = p_status,
      tripo_task_id = COALESCE(p_task_id, tripo_task_id),
      glb_url = COALESCE(p_glb_url, glb_url),
      error_message = p_error_message,
      updated_at = NOW()
  WHERE listing_id = p_listing_id
  RETURNING * INTO v_record;

  RETURN jsonb_build_object('success', true, 'record', to_jsonb(v_record));
END;
$$;

-- Restrict release function strictly to service_role
REVOKE ALL ON FUNCTION public.release_model_generation_job(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_model_generation_job(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ─── 6. Post-Migration Verification Block ─────────────────────────────────────
DO $$
DECLARE
  v_catalog_exists BOOLEAN;
  v_col_count INTEGER;
  v_func_count INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'catalog_models'
  ) INTO v_catalog_exists;

  SELECT COUNT(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'listing_models'
    AND column_name IN ('catalog_model_id', 'match_confidence', 'match_reasons', 'attribution', 'license', 'provider', 'attempt_count');

  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc
  WHERE proname IN ('claim_model_generation_job', 'release_model_generation_job');

  IF NOT v_catalog_exists THEN
    RAISE EXCEPTION 'Verification failure: public.catalog_models table was not created.';
  END IF;

  IF v_col_count < 7 THEN
    RAISE EXCEPTION 'Verification failure: expected 7 new columns in public.listing_models, found %', v_col_count;
  END IF;

  IF v_func_count < 2 THEN
    RAISE EXCEPTION 'Verification failure: expected 2 atomic claim functions, found %', v_func_count;
  END IF;

  RAISE NOTICE '✅ 20261101_curated_model_catalog migration verified successfully! (catalog_models created, listing_models enhanced with % columns, % atomic locking functions registered)', v_col_count, v_func_count;
END $$;
