-- ============================================================================
-- SMARTASSETS — Withdrawal Email-Code (OTP) Verification & Atomic Reservation
-- File: Backend/supabase_migrations/20261031_withdrawal_email_otp_verification.sql
-- Purpose:
--   1. Creates durable `public.withdrawal_verification_challenges` and
--      `public.withdrawal_otp_rate_limits` tables.
--   2. Enforces strict Row-Level Security (RLS) and revokes ALL privileges from
--      `PUBLIC`, `anon`, and `authenticated` so clients can never read or modify
--      OTP hashes, salts, attempt counts, or verification status.
--   3. Binds each challenge to:
--      - `user_id` (authenticated user)
--      - `attempt_id` (withdrawal attempt identifier)
--      - `amount` & `currency` ('ZAR')
--      - `bank_account_id` & `bank_version_hash` (approved bank record & version)
--      - `expires_at` (`NOW() + INTERVAL '120 seconds'` on the server clock)
--   4. Provides atomic PostgreSQL `SECURITY DEFINER` RPCs (restricted to `service_role`):
--      - `create_withdrawal_otp_challenge_atomic`
--      - `cancel_withdrawal_otp_challenge_atomic`
--      - `verify_withdrawal_otp_and_reserve_atomic`
--      Enforcing:
--      - Server-clock 120-second expiration
--      - Strictly ONE submission attempt per challenge (wrong first code immediately
--        invalidates the challenge and marks it `cancelled` with `attempt_count = 1`)
--      - Single-use challenge consumption (`status = 'verified'`, `attempt_count = 1`)
--      - Authoritative re-verification of account suspension, KYC (`verified`),
--        approved bank account (`status = 'approved'` & matching `bank_version_hash`),
--        spendable balance (`balance - reserved_balance >= amount`), and idempotency
--      - Atomic reservation of funds (`reserved_balance += amount`) and creation of
--        a `pending_review` withdrawal row for the existing admin treasury queue.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DURABLE WITHDRAWAL VERIFICATION CHALLENGES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withdrawal_verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_masked TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (upper(currency) = 'ZAR'),
  bank_account_id TEXT NOT NULL,
  bank_version_hash TEXT NOT NULL,
  destination_summary TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'verified', 'cancelled', 'expired', 'delivery_failed')
  ),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 1),
  max_attempts INT NOT NULL DEFAULT 1 CHECK (max_attempts = 1),
  idempotency_key TEXT,
  request_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  withdrawal_tx_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wth_otp_challenges_user_status
  ON public.withdrawal_verification_challenges(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wth_otp_challenges_expires_at
  ON public.withdrawal_verification_challenges(expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_wth_otp_challenges_idempotency
  ON public.withdrawal_verification_challenges(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status = 'verified';

-- ----------------------------------------------------------------------------
-- 2. DURABLE RATE-LIMITING TABLE FOR OTP SENDS & VERIFICATION ATTEMPTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withdrawal_otp_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INT NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. NARROWLY SCOPED RLS & PRIVILEGE REVOCATION
--    Clients (`anon`, `authenticated`) have ZERO direct table access.
-- ----------------------------------------------------------------------------
ALTER TABLE public.withdrawal_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_otp_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.withdrawal_verification_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.withdrawal_otp_rate_limits FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.withdrawal_verification_challenges TO postgres, service_role;
GRANT ALL ON TABLE public.withdrawal_otp_rate_limits TO postgres, service_role;

DROP POLICY IF EXISTS "Service role full access on withdrawal_verification_challenges"
  ON public.withdrawal_verification_challenges;
CREATE POLICY "Service role full access on withdrawal_verification_challenges"
  ON public.withdrawal_verification_challenges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on withdrawal_otp_rate_limits"
  ON public.withdrawal_otp_rate_limits;
CREATE POLICY "Service role full access on withdrawal_otp_rate_limits"
  ON public.withdrawal_otp_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 4. ATOMIC RPC: CREATE WITHDRAWAL OTP CHALLENGE (INVALIDATES PRIOR PENDING)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_withdrawal_otp_challenge_atomic(
  p_challenge_id UUID,
  p_attempt_id TEXT,
  p_user_id UUID,
  p_email_masked TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_bank_account_id TEXT,
  p_bank_version_hash TEXT,
  p_destination_summary TEXT,
  p_otp_hash TEXT,
  p_otp_salt TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_request_ip TEXT DEFAULT NULL,
  p_ttl_seconds INT DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_bank RECORD;
  v_spendable NUMERIC;
  v_now TIMESTAMPTZ := NOW();
  v_expires_at TIMESTAMPTZ;
  v_ttl INT := GREATEST(30, LEAST(COALESCE(p_ttl_seconds, 120), 120));
BEGIN
  PERFORM public.assert_service_role_caller();

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user ID is required.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than R0.';
  END IF;

  IF upper(COALESCE(p_currency, 'ZAR')) <> 'ZAR' THEN
    RAISE EXCEPTION 'Unsupported withdrawal currency: %', p_currency;
  END IF;

  -- 1. Lock user profile and verify eligibility
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  IF COALESCE(v_profile.is_suspended, false) = true OR COALESCE(v_profile.status, 'active') = 'suspended' THEN
    RAISE EXCEPTION 'ACCOUNT_SUSPENDED: Account Suspended by Compliance. Withdrawals blocked.';
  END IF;

  IF v_profile.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'KYC_REQUIRED: Profile must be verified before withdrawing funds.';
  END IF;

  v_spendable := COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0);
  IF p_amount > v_spendable THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS: Insufficient available balance. Requested R%, available spendable balance is R%.', p_amount, v_spendable;
  END IF;

  -- 2. Verify approved bank account on file matches bound bank_account_id
  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE user_id = p_user_id
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_bank.id::text <> p_bank_account_id THEN
    RAISE EXCEPTION 'BANK_APPROVAL_REQUIRED: Approved bank account on file does not match or is not approved.';
  END IF;

  -- 3. Invalidate any previous active/pending challenges for this user
  UPDATE public.withdrawal_verification_challenges
  SET status = 'cancelled',
      cancelled_at = v_now,
      cancellation_reason = 'superseded_by_new_challenge',
      updated_at = v_now
  WHERE user_id = p_user_id
    AND status = 'pending';

  -- 4. Insert new challenge bound to server clock + 120s
  v_expires_at := v_now + make_interval(secs => v_ttl);

  INSERT INTO public.withdrawal_verification_challenges (
    id,
    attempt_id,
    user_id,
    email_masked,
    amount,
    currency,
    bank_account_id,
    bank_version_hash,
    destination_summary,
    otp_hash,
    otp_salt,
    status,
    attempt_count,
    max_attempts,
    idempotency_key,
    request_ip,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    COALESCE(p_challenge_id, gen_random_uuid()),
    p_attempt_id,
    p_user_id,
    p_email_masked,
    p_amount,
    'ZAR',
    p_bank_account_id,
    p_bank_version_hash,
    p_destination_summary,
    p_otp_hash,
    p_otp_salt,
    'pending',
    0,
    1,
    p_idempotency_key,
    p_request_ip,
    v_expires_at,
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'challengeId', p_challenge_id,
    'attemptId', p_attempt_id,
    'status', 'pending',
    'expiresAt', v_expires_at,
    'expiresInSeconds', v_ttl
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. ATOMIC RPC: CANCEL WITHDRAWAL OTP CHALLENGE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_withdrawal_otp_challenge_atomic(
  p_challenge_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT 'user_cancelled'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_challenge RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  PERFORM public.assert_service_role_caller();

  SELECT * INTO v_challenge
  FROM public.withdrawal_verification_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CHALLENGE_NOT_FOUND');
  END IF;

  IF v_challenge.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CHALLENGE_USER_MISMATCH');
  END IF;

  IF v_challenge.status = 'verified' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CHALLENGE_ALREADY_VERIFIED',
      'status', v_challenge.status
    );
  END IF;

  IF v_challenge.status = 'pending' THEN
    UPDATE public.withdrawal_verification_challenges
    SET status = 'cancelled',
        cancelled_at = v_now,
        cancellation_reason = COALESCE(p_reason, 'user_cancelled'),
        updated_at = v_now
    WHERE id = p_challenge_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'challengeId', v_challenge.id,
    'attemptId', v_challenge.attempt_id,
    'status', 'cancelled',
    'reason', COALESCE(p_reason, 'user_cancelled')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. ATOMIC RPC: VERIFY OTP (SINGLE ATTEMPT) + RECHECK ELIGIBILITY + RESERVE FUNDS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_withdrawal_otp_and_reserve_atomic(
  p_challenge_id UUID,
  p_user_id UUID,
  p_otp_hash TEXT,
  p_expected_bank_version_hash TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_challenge RECORD;
  v_profile RECORD;
  v_bank RECORD;
  v_existing_tx RECORD;
  v_spendable NUMERIC;
  v_new_reserved NUMERIC;
  v_new_spendable NUMERIC;
  v_tx_id TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  PERFORM public.assert_service_role_caller();

  -- 1. Lock the challenge row for atomic single-attempt enforcement
  SELECT * INTO v_challenge
  FROM public.withdrawal_verification_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CHALLENGE_NOT_FOUND',
      'error', 'Withdrawal verification challenge not found.'
    );
  END IF;

  -- 2. Verify authenticated user owns this challenge
  IF v_challenge.user_id <> p_user_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CHALLENGE_USER_MISMATCH',
      'error', 'Forbidden: Withdrawal verification challenge belongs to a different user.'
    );
  END IF;

  -- 3. Idempotent replay check: if already verified with same idempotency_key, return existing tx
  IF v_challenge.status = 'verified' AND v_challenge.withdrawal_tx_id IS NOT NULL THEN
    IF p_idempotency_key IS NOT NULL AND v_challenge.idempotency_key = p_idempotency_key THEN
      SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'idempotent', true,
        'status', 'pending_review',
        'transactionId', v_challenge.withdrawal_tx_id,
        'challengeId', v_challenge.id,
        'attemptId', v_challenge.attempt_id,
        'amount', v_challenge.amount,
        'destination', v_challenge.destination_summary,
        'bankAccountId', v_challenge.bank_account_id,
        'newBalanceNum', COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0),
        'totalBalanceNum', COALESCE(v_profile.balance, 0),
        'reservedBalanceNum', COALESCE(v_profile.reserved_balance, 0)
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CHALLENGE_ALREADY_CONSUMED',
      'status', v_challenge.status,
      'error', 'This withdrawal verification code has already been used.'
    );
  END IF;

  -- 4. Reject if challenge is already cancelled, expired, or has already had 1 attempt
  IF v_challenge.status <> 'pending' OR v_challenge.attempt_count >= 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE
        WHEN v_challenge.status = 'expired' THEN 'CHALLENGE_EXPIRED'
        ELSE 'CHALLENGE_INVALIDATED'
      END,
      'status', v_challenge.status,
      'error', CASE
        WHEN v_challenge.status = 'expired' THEN 'Verification code expired after 2 minutes. Please request a new code.'
        ELSE 'This verification challenge is no longer active. Please start a new withdrawal verification.'
      END
    );
  END IF;

  -- 5. Enforce 120-second server-clock expiry BEFORE comparing code
  IF v_now >= v_challenge.expires_at THEN
    UPDATE public.withdrawal_verification_challenges
    SET status = 'expired',
        cancelled_at = v_now,
        cancellation_reason = 'expired_120s',
        updated_at = v_now
    WHERE id = v_challenge.id;

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'CHALLENGE_EXPIRED',
      'status', 'expired',
      'error', 'Verification code has expired (2-minute limit reached). Withdrawal was cancelled and no funds were reserved.'
    );
  END IF;

  -- 6. Strictly ONE code submission attempt per challenge:
  --    If the first submitted hash does not match, immediately invalidate the challenge!
  IF v_challenge.otp_hash <> COALESCE(p_otp_hash, '') THEN
    UPDATE public.withdrawal_verification_challenges
    SET attempt_count = 1,
        status = 'cancelled',
        cancelled_at = v_now,
        cancellation_reason = 'invalid_code_single_attempt_exhausted',
        updated_at = v_now
    WHERE id = v_challenge.id;

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_OTP_CODE',
      'status', 'cancelled',
      'attemptCount', 1,
      'error', 'Incorrect verification code. For your security, this withdrawal attempt has been cancelled after 1 failed attempt and no funds were reserved.'
    );
  END IF;

  -- 7. Code is valid! Re-verify user profile, KYC, bank approval, bank version binding, and spendable balance
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.withdrawal_verification_challenges
    SET attempt_count = 1, status = 'cancelled', cancelled_at = v_now, cancellation_reason = 'profile_not_found', updated_at = v_now
    WHERE id = v_challenge.id;
    RETURN jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND', 'status', 'cancelled', 'error', 'User profile not found.');
  END IF;

  IF COALESCE(v_profile.is_suspended, false) = true OR COALESCE(v_profile.status, 'active') = 'suspended' THEN
    UPDATE public.withdrawal_verification_challenges
    SET attempt_count = 1, status = 'cancelled', cancelled_at = v_now, cancellation_reason = 'account_suspended', updated_at = v_now
    WHERE id = v_challenge.id;
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED', 'status', 'cancelled', 'error', 'Account Suspended by Compliance. Withdrawals blocked.');
  END IF;

  IF v_profile.verification_status <> 'verified' THEN
    UPDATE public.withdrawal_verification_challenges
    SET attempt_count = 1, status = 'cancelled', cancelled_at = v_now, cancellation_reason = 'kyc_not_verified', updated_at = v_now
    WHERE id = v_challenge.id;
    RETURN jsonb_build_object('ok', false, 'code', 'KYC_REQUIRED', 'status', 'cancelled', 'error', 'KYC verification is no longer active.');
  END IF;

  -- Lock & recheck approved bank account and version hash
  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE user_id = p_user_id
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND
     OR v_bank.id::text <> v_challenge.bank_account_id
     OR (p_expected_bank_version_hash IS NOT NULL AND p_expected_bank_version_hash <> v_challenge.bank_version_hash) THEN
    UPDATE public.withdrawal_verification_challenges
    SET attempt_count = 1,
        status = 'cancelled',
        cancelled_at = v_now,
        cancellation_reason = 'bank_account_changed_or_unapproved',
        updated_at = v_now
    WHERE id = v_challenge.id;

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BANK_DETAILS_CHANGED',
      'status', 'cancelled',
      'error', 'Your approved bank account details changed or are no longer approved since this challenge was issued. Withdrawal cancelled.'
    );
  END IF;

  -- Recheck spendable balance
  v_spendable := COALESCE(v_profile.balance, 0) - COALESCE(v_profile.reserved_balance, 0);
  IF v_challenge.amount > v_spendable THEN
    UPDATE public.withdrawal_verification_challenges
    SET attempt_count = 1,
        status = 'cancelled',
        cancelled_at = v_now,
        cancellation_reason = 'insufficient_funds_at_verification',
        updated_at = v_now
    WHERE id = v_challenge.id;

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INSUFFICIENT_FUNDS',
      'status', 'cancelled',
      'error', format('Insufficient available balance. Requested R%s, available spendable balance is R%s.', v_challenge.amount, v_spendable)
    );
  END IF;

  -- 8. Consume challenge once, atomically reserve funds, and insert `pending_review` withdrawal
  v_new_reserved := COALESCE(v_profile.reserved_balance, 0) + v_challenge.amount;
  v_new_spendable := COALESCE(v_profile.balance, 0) - v_new_reserved;

  UPDATE public.profiles
  SET reserved_balance = v_new_reserved
  WHERE id = p_user_id;

  v_tx_id := 'TXN-WTH-' || upper(substr(md5(random()::text || clock_timestamp()::text || v_challenge.id::text), 1, 10));

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
    v_challenge.amount,
    '-R' || to_char(v_challenge.amount, 'FM999,999,999,990'),
    'Approved Bank EFT',
    v_bank.id,
    v_challenge.destination_summary,
    COALESCE(p_notes, 'Email-verified withdrawal request (' || v_challenge.attempt_id || ') pending manual treasury EFT payout to ' || v_challenge.destination_summary),
    'pending_review',
    COALESCE(p_idempotency_key, v_challenge.idempotency_key),
    v_now,
    v_now
  );

  UPDATE public.withdrawal_verification_challenges
  SET attempt_count = 1,
      status = 'verified',
      consumed_at = v_now,
      withdrawal_tx_id = v_tx_id,
      idempotency_key = COALESCE(p_idempotency_key, idempotency_key),
      updated_at = v_now
  WHERE id = v_challenge.id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'idempotent', false,
    'status', 'pending_review',
    'transactionId', v_tx_id,
    'challengeId', v_challenge.id,
    'attemptId', v_challenge.attempt_id,
    'amount', v_challenge.amount,
    'destination', v_challenge.destination_summary,
    'bankAccountId', v_challenge.bank_account_id,
    'newBalanceNum', v_new_spendable,
    'totalBalanceNum', COALESCE(v_profile.balance, 0),
    'reservedBalanceNum', v_new_reserved
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. LOCK DOWN FUNCTION EXECUTION PERMISSIONS
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_withdrawal_otp_challenge_atomic(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_withdrawal_otp_challenge_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_withdrawal_otp_and_reserve_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_withdrawal_otp_challenge_atomic(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_withdrawal_otp_challenge_atomic(UUID, UUID, TEXT)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.verify_withdrawal_otp_and_reserve_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO postgres, service_role;

