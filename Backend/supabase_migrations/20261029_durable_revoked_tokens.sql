-- ============================================================================
-- Migration: 20261029_durable_revoked_tokens.sql
-- Description: Durable session revocation storage for SmartAssets.
--              Stores SHA-256 cryptographic hashes of revoked tokens with
--              automatic expiration tracking and RLS fail-closed protections.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.revoked_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SHA-256 hash of the revoked JWT or session token (never the raw token)
    token_hash TEXT NOT NULL UNIQUE,
    -- User ID associated with the token (nullable for non-user tokens)
    user_id UUID,
    -- Token category: 'admin', 'user', 'refresh'
    token_type TEXT DEFAULT 'admin' NOT NULL,
    -- Audit reason for revocation (e.g. 'logout', 'inactivity_timeout', 'admin_revocation', 'password_reset')
    reason TEXT DEFAULT 'logout' NOT NULL,
    -- Timestamp when revocation occurred
    revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    -- Natural expiration of the token; used for automated cleanup
    expires_at TIMESTAMPTZ NOT NULL
);

-- Index for O(1) lookups on every incoming request
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_hash 
    ON public.revoked_tokens (token_hash);

-- Index for efficient background cleanup of expired revocation entries
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at 
    ON public.revoked_tokens (expires_at);

-- Enable Row Level Security (RLS)
ALTER TABLE public.revoked_tokens ENABLE ROW LEVEL SECURITY;

-- Deny all direct access to authenticated and anonymous roles.
-- Only the backend service_role can insert, query, and delete revoked tokens.
DROP POLICY IF EXISTS "Service role full access on revoked_tokens" ON public.revoked_tokens;
CREATE POLICY "Service role full access on revoked_tokens"
    ON public.revoked_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE public.revoked_tokens IS 
    'Durable session token revocation ledger. Stores SHA-256 hashes of terminated session tokens across server restarts.';
