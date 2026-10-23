-- ─── SmartAssets: 3D Models Migration ──────────────────────────────────────────
-- Creates the listing_models table, RLS policies, and models storage bucket.

-- 1. Create listing_models table
CREATE TABLE IF NOT EXISTS public.listing_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  tripo_task_id   TEXT,
  glb_url         TEXT,
  size_bytes      BIGINT,
  triangle_count  INTEGER,
  source          TEXT NOT NULL DEFAULT 'ai_generated' CHECK (source IN ('ai_generated', 'scan')),
  placement       TEXT NOT NULL DEFAULT 'floor' CHECK (placement IN ('wall', 'floor')),
  width_cm        NUMERIC,
  height_cm       NUMERIC,
  depth_cm        NUMERIC,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_listing_models_listing_id UNIQUE (listing_id)
);

-- Index on listing_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_listing_models_listing_id ON public.listing_models(listing_id);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.listing_models ENABLE ROW LEVEL SECURITY;

-- Policy 1: Anyone (authenticated or anonymous) can view rows with status 'ready'
DROP POLICY IF EXISTS "Public can view ready listing models" ON public.listing_models;
CREATE POLICY "Public can view ready listing models"
  ON public.listing_models
  FOR SELECT
  USING (status = 'ready');

-- Policy 2: Authenticated sellers can view any status of their own listing models
DROP POLICY IF EXISTS "Sellers can view own listing models" ON public.listing_models;
CREATE POLICY "Sellers can view own listing models"
  ON public.listing_models
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assets
      WHERE public.assets.id = listing_models.listing_id
        AND public.assets.user_id = auth.uid()
    )
  );

-- Policy 3: Only the listing's seller or an admin can insert rows
DROP POLICY IF EXISTS "Sellers or admins can insert listing models" ON public.listing_models;
CREATE POLICY "Sellers or admins can insert listing models"
  ON public.listing_models
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assets
      WHERE public.assets.id = listing_models.listing_id
        AND (
          public.assets.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE public.profiles.id = auth.uid()
              AND (public.profiles.email LIKE '%admin%' OR public.profiles.role = 'admin')
          )
        )
    )
  );

-- Policy 4: Only the listing's seller or an admin can update rows
DROP POLICY IF EXISTS "Sellers or admins can update listing models" ON public.listing_models;
CREATE POLICY "Sellers or admins can update listing models"
  ON public.listing_models
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assets
      WHERE public.assets.id = listing_models.listing_id
        AND (
          public.assets.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE public.profiles.id = auth.uid()
              AND (public.profiles.email LIKE '%admin%' OR public.profiles.role = 'admin')
          )
        )
    )
  );

-- 3. Storage Bucket: 'models' (Public-read storage for GLB files)
INSERT INTO storage.buckets (id, name, public)
VALUES ('models', 'models', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy: Public can view/download model files
DROP POLICY IF EXISTS "Public can view 3D models" ON storage.objects;
CREATE POLICY "Public can view 3D models"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'models');

-- Policy: Authenticated users can upload to models bucket
DROP POLICY IF EXISTS "Authenticated users can upload models" ON storage.objects;
CREATE POLICY "Authenticated users can upload models"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'models');
