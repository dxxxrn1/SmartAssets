-- ============================================================================
-- SMARTASSETS — KYC Document Verification & Bank Account Approval Migration
-- File: Backend/supabase_migrations/20261025_kyc_and_bank_verification.sql
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTEND PROFILES TABLE (role & verification_status)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected'));

-- Helper function to check if a user is an admin (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = check_user_id
      AND role = 'admin'
  );
$$;

-- Trigger to prevent regular users from escalating their own role or verification_status
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Allow service_role or postgres superuser or verified admins to update any column
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR public.is_admin(auth.uid()) THEN
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
-- 2. VERIFICATION DOCUMENTS TABLE
--    One active document per doc_type ('id' | 'tax' | 'proof_of_residence') per user
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type          TEXT NOT NULL CHECK (doc_type IN ('id', 'tax', 'proof_of_residence')),
  file_path         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  TEXT,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_verification_documents_user_doctype UNIQUE (user_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_verification_docs_user_id ON public.verification_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_docs_status ON public.verification_documents(status);

-- ----------------------------------------------------------------------------
-- 3. BANK ACCOUNTS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_holder    TEXT NOT NULL,
  bank_name         TEXT NOT NULL,
  account_number    TEXT NOT NULL,
  branch_code       TEXT NOT NULL,
  account_type      TEXT NOT NULL DEFAULT 'Cheque / Current',
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  TEXT,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON public.bank_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_status ON public.bank_accounts(status);

-- ----------------------------------------------------------------------------
-- 4. ADMIN AUDIT LOGS TABLE (Who, What, When for every approval & rejection)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_email     TEXT,
  action          TEXT NOT NULL, -- 'APPROVE_DOCUMENT', 'REJECT_DOCUMENT', 'APPROVE_BANK', 'REJECT_BANK'
  target_type     TEXT NOT NULL, -- 'verification_document' | 'bank_account'
  target_id       TEXT NOT NULL,
  target_user_id  UUID,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. PROTECT STATUS / REVIEW FIELDS FROM NON-ADMIN MODIFICATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_review_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Regular users inserting or re-uploading a rejected document/bank account
  -- can only set status = 'pending' and cannot set reviewed_by or reviewed_at.
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.rejection_reason := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Forbidden: Only admins can approve or reject records.';
    END IF;
    NEW.rejection_reason := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.created_at := NOW();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_verification_docs_review ON public.verification_documents;
CREATE TRIGGER trg_protect_verification_docs_review
  BEFORE INSERT OR UPDATE ON public.verification_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_review_fields();

DROP TRIGGER IF EXISTS trg_protect_bank_accounts_review ON public.bank_accounts;
CREATE TRIGGER trg_protect_bank_accounts_review
  BEFORE INSERT OR UPDATE ON public.bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_review_fields();

-- ----------------------------------------------------------------------------
-- 6. AUTOMATIC PROFILE VERIFICATION STATUS TRIGGER
--    - All 3 docs ('id', 'tax', 'proof_of_residence') approved -> 'verified'
--    - Any doc rejected -> 'rejected'
--    - Docs submitted & awaiting review -> 'pending'
--    - Otherwise -> 'unverified'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_verification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID;
  v_total_docs    INTEGER;
  v_approved_docs INTEGER;
  v_rejected_docs INTEGER;
  v_new_status    TEXT;
BEGIN
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'approved' AND doc_type IN ('id', 'tax', 'proof_of_residence')),
    COUNT(*) FILTER (WHERE status = 'rejected')
  INTO v_total_docs, v_approved_docs, v_rejected_docs
  FROM public.verification_documents
  WHERE user_id = v_user_id;

  IF v_rejected_docs > 0 THEN
    v_new_status := 'rejected';
  ELSIF v_approved_docs >= 3 THEN
    v_new_status := 'verified';
  ELSIF v_total_docs > 0 THEN
    v_new_status := 'pending';
  ELSE
    v_new_status := 'unverified';
  END IF;

  UPDATE public.profiles
  SET verification_status = v_new_status
  WHERE id = v_user_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_verification_status ON public.verification_documents;
CREATE TRIGGER trg_sync_profile_verification_status
  AFTER INSERT OR UPDATE OR DELETE ON public.verification_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_verification_status();

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
GRANT ALL ON TABLE public.verification_documents TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.bank_accounts TO postgres, authenticated, service_role;
GRANT ALL ON TABLE public.admin_audit_logs TO postgres, authenticated, service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles RLS: Admins can view & update all profiles; users can view/update own profile
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin(auth.uid()));

-- Verification Documents RLS
DROP POLICY IF EXISTS "Users can read own verification documents" ON public.verification_documents;
CREATE POLICY "Users can read own verification documents"
  ON public.verification_documents FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can insert own verification documents" ON public.verification_documents;
CREATE POLICY "Users can insert own verification documents"
  ON public.verification_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can re-upload or admins can review documents" ON public.verification_documents;
CREATE POLICY "Users can re-upload or admins can review documents"
  ON public.verification_documents FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role full access verification_documents" ON public.verification_documents;
CREATE POLICY "Service role full access verification_documents"
  ON public.verification_documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Bank Accounts RLS
DROP POLICY IF EXISTS "Users can read own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users can read own bank accounts"
  ON public.bank_accounts FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can insert own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users can insert own bank accounts"
  ON public.bank_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own pending/rejected or admins can review bank accounts" ON public.bank_accounts;
CREATE POLICY "Users can update own pending/rejected or admins can review bank accounts"
  ON public.bank_accounts FOR UPDATE
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role full access bank_accounts" ON public.bank_accounts;
CREATE POLICY "Service role full access bank_accounts"
  ON public.bank_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Admin Audit Logs RLS
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role full access admin_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "Service role full access admin_audit_logs"
  ON public.admin_audit_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 8. SUPABASE STORAGE: PRIVATE BUCKET "verification-docs"
--    Path format: {user_id}/{doc_type}/{filename}
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'verification-docs',
  'verification-docs',
  false,
  10485760, -- 10 MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

-- Storage RLS Policies on storage.objects
DROP POLICY IF EXISTS "Users can upload own verification docs" ON storage.objects;
CREATE POLICY "Users can upload own verification docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] IN ('id', 'tax', 'proof_of_residence')
  );

DROP POLICY IF EXISTS "Users can update own verification docs" ON storage.objects;
CREATE POLICY "Users can update own verification docs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can read own verification docs and admins can read all" ON storage.objects;
CREATE POLICY "Users can read own verification docs and admins can read all"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 9. PROMOTE A USER TO ADMIN (Uncomment & replace email to promote an admin)
-- ----------------------------------------------------------------------------
-- UPDATE public.profiles
-- SET role = 'admin', verification_status = 'verified'
-- WHERE email = 'darrenforster3@gmail.com';
