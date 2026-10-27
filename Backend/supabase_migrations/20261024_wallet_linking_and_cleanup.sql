-- ─── SmartAssets Migration: Wallet Linking & Cryptographic Nonces ─────────────
-- Run this in your Supabase Dashboard SQL Editor.

-- 1. Ensure profiles has a lowercase, unique, nullable wallet_address column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Enforce lowercase and uniqueness if not already constrained
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_wallet_address_key'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_wallet_address_key UNIQUE (wallet_address);
  END IF;
END $$;

-- 2. Nonces table for EIP-191 / SIWE challenge-response verification
CREATE TABLE IF NOT EXISTS public.wallet_nonces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  message         TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used            BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by wallet address
CREATE INDEX IF NOT EXISTS idx_wallet_nonces_lookup 
  ON public.wallet_nonces(wallet_address, used, expires_at);

-- Grant permissions for service_role and backend
GRANT ALL ON TABLE public.wallet_nonces TO postgres, service_role, authenticated, anon;

-- 3. Cleanup: Remove old synthetic "MetaMask (0x...)" dummy users
-- Note: Reassign or archive any user holdings attached to synthetic accounts before removal
DELETE FROM public.user_holdings
WHERE user_id IN (
  SELECT id FROM public.profiles 
  WHERE email LIKE '%@metamask.smartassets.io' 
     OR full_name LIKE 'MetaMask (0x%'
);

DELETE FROM public.profiles
WHERE email LIKE '%@metamask.smartassets.io' 
   OR full_name LIKE 'MetaMask (0x%';

-- Also clean up auth.users if Supabase admin role executes this:
DELETE FROM auth.users 
WHERE email LIKE '%@metamask.smartassets.io';
