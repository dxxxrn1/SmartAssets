-- ============================================================================
-- SMARTASSETS — Portfolio Snapshots Schema Migration
-- File: Backend/supabase_migrations/20261028_portfolio_snapshots.sql
-- ============================================================================

-- 1. Create portfolio_snapshots table for authoritative dated valuation history
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_value NUMERIC NOT NULL DEFAULT 0,
  cash_balance    NUMERIC NOT NULL DEFAULT 0,
  total_value     NUMERIC NOT NULL DEFAULT 0,
  holdings_count  INTEGER NOT NULL DEFAULT 0,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_portfolio_snapshot_date UNIQUE (user_id, snapshot_date)
);

-- 2. Indexes for fast user time-series lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_date
  ON public.portfolio_snapshots(user_id, snapshot_date ASC);

-- 3. Permissions
GRANT ALL ON TABLE public.portfolio_snapshots TO postgres, anon, authenticated, service_role;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "Users can view own portfolio snapshots" ON public.portfolio_snapshots;
DROP POLICY IF EXISTS "Users can insert own portfolio snapshots" ON public.portfolio_snapshots;
DROP POLICY IF EXISTS "Users can update own portfolio snapshots" ON public.portfolio_snapshots;
DROP POLICY IF EXISTS "Service role full access on portfolio snapshots" ON public.portfolio_snapshots;

-- User read access to own records
CREATE POLICY "Users can view own portfolio snapshots"
  ON public.portfolio_snapshots FOR SELECT
  USING (auth.uid() = user_id);

-- User insert access (required for new date snapshots)
CREATE POLICY "Users can insert own portfolio snapshots"
  ON public.portfolio_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- User update access (REQUIRED for upsert / ON CONFLICT DO UPDATE)
CREATE POLICY "Users can update own portfolio snapshots"
  ON public.portfolio_snapshots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role / backend administrator full access
CREATE POLICY "Service role full access on portfolio snapshots"
  ON public.portfolio_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
