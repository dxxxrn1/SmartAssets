-- Admin-controlled escrow protections. Apply only after review in Supabase SQL editor.
-- The backend uses the service role; public clients can read their own orders.
ALTER TABLE public.escrow_orders
  ADD COLUMN IF NOT EXISTS buyer_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_rail TEXT,
  ADD COLUMN IF NOT EXISTS release_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS refund_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS admin_action_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS admin_action_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS public.escrow_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES public.escrow_orders(order_id),
  actor_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'funding_verified', 'shipped', 'delivered', 'buyer_accepted',
    'disputed', 'release_started', 'released', 'refund_started', 'refunded'
  )),
  reason TEXT,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.escrow_audit_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.escrow_audit_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.escrow_audit_events_id_seq TO service_role;
REVOKE ALL ON public.escrow_audit_events FROM anon, authenticated;
GRANT SELECT ON public.escrow_audit_events TO authenticated;
DROP POLICY IF EXISTS "Escrow participants read audit" ON public.escrow_audit_events;
CREATE POLICY "Escrow participants read audit" ON public.escrow_audit_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.escrow_orders o
      WHERE o.order_id = escrow_audit_events.order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid() OR public.is_admin(auth.uid()))
    )
  );
-- No public client role can mutate escrow state or payment/audit records.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.escrow_orders, public.escrow_audit_events FROM anon, authenticated;
GRANT SELECT ON public.escrow_orders, public.escrow_audit_events TO authenticated;
DROP POLICY IF EXISTS "Escrow participants read own orders" ON public.escrow_orders;
CREATE POLICY "Escrow participants read own orders" ON public.escrow_orders
  FOR SELECT TO authenticated USING (
    buyer_id = auth.uid() OR seller_id = auth.uid() OR public.is_admin(auth.uid())
  );

-- Backend escrow operations claim accepted/funded states with conditional updates before
-- external transfers. A service crash can leave a *_processing state for manual review;
-- these states intentionally cannot be replayed automatically.
