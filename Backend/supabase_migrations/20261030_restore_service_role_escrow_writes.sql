-- Restore trusted backend write access after escrow write permissions were
-- revoked from public client roles. Buyer/seller clients remain read-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.escrow_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.escrow_audit_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.escrow_audit_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Service role full access on escrow" ON public.escrow_orders;
CREATE POLICY "Service role full access on escrow"
  ON public.escrow_orders
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on escrow audit" ON public.escrow_audit_events;
CREATE POLICY "Service role full access on escrow audit"
  ON public.escrow_audit_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
