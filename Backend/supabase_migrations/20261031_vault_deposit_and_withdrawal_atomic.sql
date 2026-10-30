-- ============================================================================
-- SMARTASSETS — Atomic Vault Deposits, Withdrawals & Balance Reservation
-- File: Backend/supabase_migrations/20261031_vault_deposit_and_withdrawal_atomic.sql
-- Purpose:
--   1. Adds reserved_balance and non-negative spendable constraints on profiles.
--   2. Prevents clients from directly mutating balance or reserved_balance.
--   3. Extends vault_transactions with settlement_ref, provider_ref, bank_account_id,
--      idempotency_key, and strict status check constraints.
--   4. Hardens RLS and revokes direct write grants from authenticated/anon on vault_transactions.
--   5. Provides atomic PostgreSQL RPCs with row locks (SELECT ... FOR UPDATE) for:
--      - request_vault_deposit_atomic
--      - confirm_vault_deposit_atomic
--      - reject_vault_deposit_atomic
--      - request_vault_withdrawal_atomic
--      - settle_vault_withdrawal_atomic
--      - cancel_or_reject_vault_withdrawal_atomic
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTEND PROFILES WITH RESERVED BALANCE & CONSTRAINTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_balance_non_negative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_balance_non_negative CHECK (balance >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_reserved_non_negative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_reserved_non_negative CHECK (reserved_balance >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_spendable_balance'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_spendable_balance CHECK (balance >= reserved_balance);
  END IF;
END $$;

-- Harden trigger so authenticated clients cannot directly mutate their own balance or reserved_balance
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Allow service_role or postgres superuser to update any column
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Block non-service_role from directly changing balance or reserved_balance
  IF NEW.balance IS DISTINCT FROM OLD.balance THEN
    RAISE EXCEPTION 'Forbidden: Users cannot directly modify their own balance.';
  END IF;

  IF NEW.reserved_balance IS DISTINCT FROM OLD.reserved_balance THEN
    RAISE EXCEPTION 'Forbidden: Users cannot directly modify their own reserved_balance.';
  END IF;

  -- Allow verified admins to update role or verification_status
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Block non-admins from changing their role or verification_status
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Forbidden: Users cannot modify their own role.';
  END IF;

  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    RAISE EXCEPTION 'Forbidden: Users cannot directly modify their own verification_status.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- ----------------------------------------------------------------------------
-- 2. EXTEND VAULT_TRANSACTIONS SCHEMA & CONSTRAINTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.vault_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS provider_ref TEXT,
  ADD COLUMN IF NOT EXISTS settlement_ref TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_summary TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.vault_transactions
  ALTER COLUMN status SET DEFAULT 'pending_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vault_tx_amount_positive'
  ) THEN
    ALTER TABLE public.vault_transactions
      ADD CONSTRAINT chk_vault_tx_amount_positive CHECK (amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vault_tx_status'
  ) THEN
    ALTER TABLE public.vault_transactions
      ADD CONSTRAINT chk_vault_tx_status CHECK (
        status IN (
          'pending_review',
          'settlement_processing',
          'completed',
          'rejected',
          'failed',
          'cancelled',
          'refunded'
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_tx_provider_ref_unique
  ON public.vault_transactions(provider_ref)
  WHERE provider_ref IS NOT NULL AND status = 'completed';

CREATE INDEX IF NOT EXISTS idx_vault_transactions_status
  ON public.vault_transactions(user_id, status);

-- ----------------------------------------------------------------------------
-- 3. HARDEN GRANTS & ROW-LEVEL SECURITY ON VAULT_TRANSACTIONS
-- ----------------------------------------------------------------------------
ALTER TABLE public.vault_transactions ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.vault_transactions FROM authenticated, anon;
REVOKE ALL ON TABLE public.vault_transactions FROM anon;
GRANT SELECT ON TABLE public.vault_transactions TO authenticated;
GRANT ALL ON TABLE public.vault_transactions TO postgres, service_role;

DROP POLICY IF EXISTS "Users can view only own vault transactions" ON public.vault_transactions;
CREATE POLICY "Users can view only own vault transactions"
  ON public.vault_transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vault_transactions'
      AND policyname = 'Service role full access on transactions'
  ) THEN
    CREATE POLICY "Service role full access on transactions"
      ON public.vault_transactions
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC RPC: REQUEST OR CREDIT VAULT DEPOSIT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_vault_deposit_atomic(
  p_user_id UUID,
  p_amount NUMERIC,
  p_method TEXT DEFAULT 'bank_eft',
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_is_verified_settlement BOOLEAN DEFAULT FALSE,
  p_provider_ref TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_existing_idemp RECORD;
  v_existing_provider RECORD;
  v_tx_id TEXT;
  v_status TEXT;
  v_new_balance NUMERIC;
  v_spendable NUMERIC;
  v_now TIMESTAMPTZ := NOW();
  v_response JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user ID is required.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be greater than R0.';
  END IF;

  -- 1. Check idempotency key
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_idemp
    FROM public.payment_idempotency
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND AND v_existing_idemp.status = 'settled' THEN
      RETURN v_existing_idemp.response || jsonb_build_object('duplicate', true);
    END IF;
  END IF;

  -- 2. Lock user profile row
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  IF v_profile.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'KYC Verification Required: Profile must be verified before depositing funds.';
  END IF;

  -- 3. If verified settlement, prevent replay of provider_ref
  IF p_is_verified_settlement THEN
    IF p_provider_ref IS NULL OR btrim(p_provider_ref) = '' THEN
      RAISE EXCEPTION 'Verified settlement requires an authoritative provider reference.';
    END IF;

    SELECT * INTO v_existing_provider
    FROM public.vault_transactions
    WHERE provider_ref = p_provider_ref
      AND status = 'completed'
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Duplicate provider payment reference: % has already been credited.', p_provider_ref;
    END IF;

    v_new_balance := COALESCE(v_profile.balance, 0) + p_amount;
    v_status := 'completed';

    UPDATE public.profiles
    SET balance = v_new_balance
    WHERE id = p_user_id;
  ELSE
    -- Unverified / manual bank transfer: DO NOT increase balance
    v_new_balance := COALESCE(v_profile.balance, 0);
    v_status := 'pending_review';
  END IF;

  v_spendable := v_new_balance - COALESCE(v_profile.reserved_balance, 0);
  v_tx_id := 'TXN-DEP-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));

  INSERT INTO public.vault_transactions (
    id,
    user_id,
    type,
    amount,
    amount_formatted,
    method,
    reference,
    provider_ref,
    settlement_ref,
    notes,
    status,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    v_tx_id,
    p_user_id,
    'deposit',
    p_amount,
    '+R' || to_char(p_amount, 'FM999,999,999,990'),
    COALESCE(p_method, 'Manual Bank EFT'),
    p_reference,
    p_provider_ref,
    CASE WHEN p_is_verified_settlement THEN p_provider_ref ELSE NULL END,
    COALESCE(
      p_notes,
      CASE
        WHEN p_is_verified_settlement THEN 'Verified provider deposit settled'
        ELSE 'Pending treasury bank receipt verification'
      END
    ),
    v_status,
    p_idempotency_key,
    v_now,
    v_now
  );

  v_response := jsonb_build_object(
    'transactionId', v_tx_id,
    'status', v_status,
    'credited', p_is_verified_settlement,
    'amount', p_amount,
    'newBalanceNum', v_spendable,
    'totalBalanceNum', v_new_balance,
    'reservedBalanceNum', COALESCE(v_profile.reserved_balance, 0),
    'duplicate', false
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_idempotency (
      idempotency_key,
      payment_rail,
      reference_id,
      user_id,
      status,
      response
    ) VALUES (
      p_idempotency_key,
      COALESCE(p_method, 'deposit'),
      v_tx_id,
      p_user_id,
      'settled',
      v_response
    )
    ON CONFLICT (idempotency_key) DO UPDATE
      SET status = 'settled',
          response = EXCLUDED.response;
  END IF;

  RETURN v_response;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. ATOMIC RPC: ADMIN CONFIRM PENDING DEPOSIT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_vault_deposit_atomic(
  p_tx_id TEXT,
  p_admin_id TEXT,
  p_settlement_ref TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx RECORD;
  v_profile RECORD;
  v_new_balance NUMERIC;
  v_spendable NUMERIC;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_settlement_ref IS NULL OR btrim(p_settlement_ref) = '' THEN
    RAISE EXCEPTION 'An authoritative bank/treasury settlement reference is required to confirm a deposit.';
  END IF;

  SELECT * INTO v_tx
  FROM public.vault_transactions
  WHERE id = p_tx_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit transaction % not found.', p_tx_id;
  END IF;

  IF v_tx.type <> 'deposit' THEN
    RAISE EXCEPTION 'Transaction % is not a deposit.', p_tx_id;
  END IF;

  IF v_tx.status = 'completed' THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_tx.user_id;
    RETURN jsonb_build_object(
      'transactionId', v_tx.id,
      'status', 'completed',
      'alreadyCompleted', true,
      'newBalanceNum', COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0)
    );
  END IF;

  IF v_tx.status <> 'pending_review' THEN
    RAISE EXCEPTION 'Cannot confirm deposit in status "%". Only pending_review deposits can be confirmed.', v_tx.status;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_tx.user_id
  FOR UPDATE;

  v_new_balance := COALESCE(v_profile.balance, 0) + v_tx.amount;
  v_spendable := v_new_balance - COALESCE(v_profile.reserved_balance, 0);

  UPDATE public.profiles
  SET balance = v_new_balance
  WHERE id = v_tx.user_id;

  UPDATE public.vault_transactions
  SET status = 'completed',
      settlement_ref = p_settlement_ref,
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      updated_at = v_now,
      notes = COALESCE(notes, '') || ' | Confirmed via ref ' || p_settlement_ref
  WHERE id = p_tx_id;

  RETURN jsonb_build_object(
    'transactionId', v_tx.id,
    'status', 'completed',
    'alreadyCompleted', false,
    'newBalanceNum', v_spendable,
    'totalBalanceNum', v_new_balance,
    'settlementRef', p_settlement_ref
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. ATOMIC RPC: REQUEST VAULT WITHDRAWAL (RESERVES FUNDS TO APPROVED BANK)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_vault_withdrawal_atomic(
  p_user_id UUID,
  p_amount NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_bank RECORD;
  v_existing_idemp RECORD;
  v_spendable NUMERIC;
  v_new_reserved NUMERIC;
  v_new_spendable NUMERIC;
  v_tx_id TEXT;
  v_dest_summary TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_response JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user ID is required.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than R0.';
  END IF;

  -- 1. Check idempotency key
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_idemp
    FROM public.payment_idempotency
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND AND v_existing_idemp.status = 'settled' THEN
      RETURN v_existing_idemp.response || jsonb_build_object('duplicate', true);
    END IF;
  END IF;

  -- 2. Lock user profile row
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  IF v_profile.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'KYC Verification Required: Profile must be verified before withdrawing funds.';
  END IF;

  -- 3. Strictly fetch approved bank account from DB (never trust request body)
  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE user_id = p_user_id
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved bank account required. Withdrawals are only permitted to your verified bank account on file.';
  END IF;

  -- 4. Check available spendable funds
  v_spendable := COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0);
  IF p_amount > v_spendable THEN
    RAISE EXCEPTION 'Insufficient available balance. Requested R%, available spendable balance is R%.', p_amount, v_spendable;
  END IF;

  -- 5. Reserve funds atomically
  v_new_reserved := COALESCE(v_profile.reserved_balance, 0) + p_amount;
  v_new_spendable := COALESCE(v_profile.balance, 0) - v_new_reserved;

  UPDATE public.profiles
  SET reserved_balance = v_new_reserved
  WHERE id = p_user_id;

  v_dest_summary := v_bank.bank_name || ' (...' || right(v_bank.account_number, 4) || ')';
  v_tx_id := 'TXN-WTH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));

  INSERT INTO public.vault_transactions (
    id,
    user_id,
    type,
    amount,
    amount_formatted,
    method,
    bank_account_id,
    destination_summary,
    notes,
    status,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    v_tx_id,
    p_user_id,
    'withdraw',
    p_amount,
    '-R' || to_char(p_amount, 'FM999,999,999,990'),
    'Approved Bank EFT',
    v_bank.id,
    v_dest_summary,
    COALESCE(p_notes, 'Pending review for payout to ' || v_dest_summary),
    'pending_review',
    p_idempotency_key,
    v_now,
    v_now
  );

  v_response := jsonb_build_object(
    'transactionId', v_tx_id,
    'status', 'pending_review',
    'amount', p_amount,
    'destination', v_dest_summary,
    'bankAccountId', v_bank.id,
    'newBalanceNum', v_new_spendable,
    'totalBalanceNum', COALESCE(v_profile.balance, 0),
    'reservedBalanceNum', v_new_reserved,
    'duplicate', false
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.payment_idempotency (
      idempotency_key,
      payment_rail,
      reference_id,
      user_id,
      status,
      response
    ) VALUES (
      p_idempotency_key,
      'withdraw_bank_eft',
      v_tx_id,
      p_user_id,
      'settled',
      v_response
    )
    ON CONFLICT (idempotency_key) DO UPDATE
      SET status = 'settled',
          response = EXCLUDED.response;
  END IF;

  RETURN v_response;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. ATOMIC RPC: SETTLE VAULT WITHDRAWAL (DEDUCTS TOTAL & RESERVED BALANCE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_vault_withdrawal_atomic(
  p_tx_id TEXT,
  p_admin_id TEXT,
  p_settlement_ref TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx RECORD;
  v_profile RECORD;
  v_new_balance NUMERIC;
  v_new_reserved NUMERIC;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_settlement_ref IS NULL OR btrim(p_settlement_ref) = '' THEN
    RAISE EXCEPTION 'An authoritative payout settlement reference is required to mark a withdrawal completed.';
  END IF;

  SELECT * INTO v_tx
  FROM public.vault_transactions
  WHERE id = p_tx_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal transaction % not found.', p_tx_id;
  END IF;

  IF v_tx.type <> 'withdraw' THEN
    RAISE EXCEPTION 'Transaction % is not a withdrawal.', p_tx_id;
  END IF;

  IF v_tx.status = 'completed' THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_tx.user_id;
    RETURN jsonb_build_object(
      'transactionId', v_tx.id,
      'status', 'completed',
      'alreadyCompleted', true,
      'newBalanceNum', COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0)
    );
  END IF;

  IF v_tx.status NOT IN ('pending_review', 'settlement_processing') THEN
    RAISE EXCEPTION 'Cannot settle withdrawal in status "%".', v_tx.status;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_tx.user_id
  FOR UPDATE;

  v_new_balance := GREATEST(0, COALESCE(v_profile.balance, 0) - v_tx.amount);
  v_new_reserved := GREATEST(0, COALESCE(v_profile.reserved_balance, 0) - v_tx.amount);

  UPDATE public.profiles
  SET balance = v_new_balance,
      reserved_balance = v_new_reserved
  WHERE id = v_tx.user_id;

  UPDATE public.vault_transactions
  SET status = 'completed',
      settlement_ref = p_settlement_ref,
      reference = p_settlement_ref,
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      updated_at = v_now
  WHERE id = p_tx_id;

  RETURN jsonb_build_object(
    'transactionId', v_tx.id,
    'status', 'completed',
    'alreadyCompleted', false,
    'newBalanceNum', v_new_balance - v_new_reserved,
    'totalBalanceNum', v_new_balance,
    'reservedBalanceNum', v_new_reserved,
    'settlementRef', p_settlement_ref
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. ATOMIC RPC: CANCEL OR REJECT VAULT WITHDRAWAL (RESTORES RESERVED FUNDS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_or_reject_vault_withdrawal_atomic(
  p_tx_id TEXT,
  p_actor_id TEXT,
  p_new_status TEXT DEFAULT 'rejected',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx RECORD;
  v_profile RECORD;
  v_new_reserved NUMERIC;
  v_spendable NUMERIC;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_new_status NOT IN ('rejected', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Invalid terminal reversal status: %', p_new_status;
  END IF;

  SELECT * INTO v_tx
  FROM public.vault_transactions
  WHERE id = p_tx_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal transaction % not found.', p_tx_id;
  END IF;

  IF v_tx.type <> 'withdraw' THEN
    RAISE EXCEPTION 'Transaction % is not a withdrawal.', p_tx_id;
  END IF;

  IF v_tx.status IN ('rejected', 'cancelled', 'failed') THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_tx.user_id;
    RETURN jsonb_build_object(
      'transactionId', v_tx.id,
      'status', v_tx.status,
      'alreadyReversed', true,
      'newBalanceNum', COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0)
    );
  END IF;

  IF v_tx.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot cancel or reject a withdrawal that has already settled.';
  END IF;

  IF p_new_status = 'cancelled' AND v_tx.status = 'settlement_processing' THEN
    RAISE EXCEPTION 'Cannot cancel withdrawal after payout settlement processing has started.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_tx.user_id
  FOR UPDATE;

  v_new_reserved := GREATEST(0, COALESCE(v_profile.reserved_balance, 0) - v_tx.amount);
  v_spendable := COALESCE(v_profile.balance, 0) - v_new_reserved;

  UPDATE public.profiles
  SET reserved_balance = v_new_reserved
  WHERE id = v_tx.user_id;

  UPDATE public.vault_transactions
  SET status = p_new_status,
      reviewed_by = p_actor_id,
      reviewed_at = v_now,
      updated_at = v_now,
      notes = COALESCE(p_reason, notes)
  WHERE id = p_tx_id;

  RETURN jsonb_build_object(
    'transactionId', v_tx.id,
    'status', p_new_status,
    'alreadyReversed', false,
    'newBalanceNum', v_spendable,
    'totalBalanceNum', COALESCE(v_profile.balance, 0),
    'reservedBalanceNum', v_new_reserved
  );
END;
$$;

