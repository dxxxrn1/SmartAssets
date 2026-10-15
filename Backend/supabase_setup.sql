-- ─── SmartAssets — Supabase Database Setup ────────────────────────────────────
-- Run this SQL in your Supabase Dashboard → SQL Editor → New Query → Run

-- 1. Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  wallet_address  TEXT UNIQUE,
  avatar_url      TEXT,
  balance         NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0;

-- 2. User Holdings table (personal vault, isolated per user)
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
  asset_type  TEXT DEFAULT 'whole',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Marketplace Assets table (Dynamic Assets)
CREATE TABLE IF NOT EXISTS public.assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  price           TEXT NOT NULL,
  price_num       NUMERIC NOT NULL DEFAULT 0,
  year            INTEGER NOT NULL DEFAULT 2024,
  condition       TEXT NOT NULL DEFAULT 'Mint',
  description     TEXT,
  image           TEXT NOT NULL,
  badge           TEXT DEFAULT 'Verified',
  trending        BOOLEAN DEFAULT false,
  cert            TEXT,
  shares          INTEGER DEFAULT 100,
  share_price     NUMERIC DEFAULT 100,
  shares_sold     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',
  token_id        TEXT,
  tx_hash         TEXT,
  contract_address TEXT,
  etherscan_url   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for existing tables:
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS token_id TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS contract_address TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS etherscan_url TEXT;

-- 4. Asset History / Provenance table (Dynamic Chain-of-Custody)
CREATE TABLE IF NOT EXISTS public.asset_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  year            TEXT NOT NULL,
  event           TEXT NOT NULL,
  party           TEXT NOT NULL,
  hash            TEXT,
  tx_hash         TEXT,
  verified        BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.asset_history ADD COLUMN IF NOT EXISTS tx_hash TEXT;

-- 5. Vault Transactions table (Deposits, Withdrawals, Payouts)
CREATE TABLE IF NOT EXISTS public.vault_transactions (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL, -- 'deposit', 'withdraw'
  amount          NUMERIC NOT NULL,
  amount_formatted TEXT NOT NULL,
  method          TEXT DEFAULT 'bank',
  reference       TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'completed',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Grant table permissions
GRANT ALL ON TABLE public.profiles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_holdings TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.assets TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.asset_history TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.vault_transactions TO postgres, anon, authenticated, service_role;

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_transactions ENABLE ROW LEVEL SECURITY;

-- 8. Policies for profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Service role can insert profiles" ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 8. Policies for user_holdings (Strict Isolation)
DROP POLICY IF EXISTS "Users can only view their own holdings" ON public.user_holdings;
DROP POLICY IF EXISTS "Users can only insert their own holdings" ON public.user_holdings;
DROP POLICY IF EXISTS "Service role full access on holdings" ON public.user_holdings;

CREATE POLICY "Users can only view their own holdings" ON public.user_holdings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can only insert their own holdings" ON public.user_holdings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access on holdings" ON public.user_holdings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. Policies for assets & asset_history
DROP POLICY IF EXISTS "Anyone can view active assets" ON public.assets;
DROP POLICY IF EXISTS "Users can create assets" ON public.assets;
DROP POLICY IF EXISTS "Service role full access on assets" ON public.assets;

CREATE POLICY "Anyone can view active assets" ON public.assets FOR SELECT USING (true);
CREATE POLICY "Users can create assets" ON public.assets FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role full access on assets" ON public.assets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view asset history" ON public.asset_history;
DROP POLICY IF EXISTS "Users can insert asset history" ON public.asset_history;
DROP POLICY IF EXISTS "Service role full access on asset history" ON public.asset_history;

CREATE POLICY "Anyone can view asset history" ON public.asset_history FOR SELECT USING (true);
CREATE POLICY "Users can insert asset history" ON public.asset_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role full access on asset history" ON public.asset_history FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. Policies for vault_transactions
DROP POLICY IF EXISTS "Users can view own transactions" ON public.vault_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.vault_transactions;
DROP POLICY IF EXISTS "Service role full access on transactions" ON public.vault_transactions;

CREATE POLICY "Users can view own transactions" ON public.vault_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON public.vault_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access on transactions" ON public.vault_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. Automatic trigger to sync auth.users with profiles
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

-- 11. Initial Setup Complete
-- Database is ready for dynamic user asset creation.

