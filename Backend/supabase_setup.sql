-- ─── SmartAssets — Supabase Database Setup ────────────────────────────────────
-- Run this SQL in your Supabase Dashboard → SQL Editor → New Query → Run

-- 1. Create or update the profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  wallet_address  TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure wallet_address column exists if profiles already existed
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT UNIQUE;

-- 2. Create the user_holdings table (isolated per user)
CREATE TABLE IF NOT EXISTS public.user_holdings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       TEXT NOT NULL,
  price_num   NUMERIC NOT NULL DEFAULT 0,
  gain        TEXT DEFAULT '+0.0%',
  gain_pct    TEXT DEFAULT '0%',
  positive    BOOLEAN DEFAULT true,
  image       TEXT,
  asset_type  TEXT DEFAULT 'whole', -- 'whole' or 'fractional'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Grant table permissions
GRANT ALL ON TABLE public.profiles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_holdings TO postgres, anon, authenticated, service_role;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_holdings ENABLE ROW LEVEL SECURITY;

-- 5. Clean up any existing policies before recreating
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can only view their own holdings" ON public.user_holdings;
DROP POLICY IF EXISTS "Users can only insert their own holdings" ON public.user_holdings;
DROP POLICY IF EXISTS "Users can update their own holdings" ON public.user_holdings;
DROP POLICY IF EXISTS "Users can delete their own holdings" ON public.user_holdings;
DROP POLICY IF EXISTS "Service role full access on holdings" ON public.user_holdings;

-- 6. Policies for profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 7. Policies for user_holdings (Strict User Data Isolation)
CREATE POLICY "Users can only view their own holdings"
  ON public.user_holdings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own holdings"
  ON public.user_holdings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own holdings"
  ON public.user_holdings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own holdings"
  ON public.user_holdings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on holdings"
  ON public.user_holdings FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 8. Automatic trigger to sync auth.users with profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, wallet_address)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'wallet_address'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      wallet_address = COALESCE(EXCLUDED.wallet_address, public.profiles.wallet_address);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
