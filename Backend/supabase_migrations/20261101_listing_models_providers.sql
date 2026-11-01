-- ─── SmartAssets: 3D Model Providers & Cost Controls Migration ───────────────
-- Adds provider tracking, fallback provider task identifiers, and per-listing attempt caps.
ALTER TABLE public.listing_models
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'tripo',
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT,
  ADD COLUMN IF NOT EXISTS fallback_task_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
-- Optional index for auditing provider distribution
CREATE INDEX IF NOT EXISTS idx_listing_models_provider ON public.listing_models(provider);

