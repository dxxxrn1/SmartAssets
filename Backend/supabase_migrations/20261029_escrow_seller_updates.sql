-- Allow seller product and shipment updates to be recorded in the escrow audit log.
ALTER TABLE public.escrow_orders
  ADD COLUMN IF NOT EXISTS tracking_carrier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT;

ALTER TABLE public.escrow_audit_events
  DROP CONSTRAINT IF EXISTS escrow_audit_events_event_type_check;

ALTER TABLE public.escrow_audit_events
  ADD CONSTRAINT escrow_audit_events_event_type_check CHECK (event_type IN (
    'created', 'funding_verified', 'shipped', 'delivered', 'buyer_accepted',
    'seller_update', 'disputed', 'release_started', 'released', 'refund_started', 'refunded'
  ));
