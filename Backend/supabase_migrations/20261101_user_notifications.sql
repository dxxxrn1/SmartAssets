-- Durable, user-scoped in-app notifications.
CREATE TABLE IF NOT EXISTS public.notifications (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  order_id    TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC) WHERE read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='Service role full access on notifications') THEN
    CREATE POLICY "Service role full access on notifications" ON public.notifications
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_user_notification(
  p_user_id UUID, p_type TEXT, p_title TEXT, p_message TEXT,
  p_order_id TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications(user_id, type, title, message, order_id, metadata)
  VALUES (p_user_id, p_type, p_title, p_message, p_order_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_vault_transaction_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type TEXT;
  v_title TEXT;
  v_message TEXT;
  v_status TEXT;
  v_amount TEXT;
BEGIN
  IF NEW.type NOT IN ('deposit', 'withdraw') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_status := COALESCE(NEW.status, 'pending_review');
  v_amount := COALESCE(NEW.amount_formatted, 'R' || COALESCE(NEW.amount, 0)::text);
  IF NEW.type = 'deposit' THEN
    IF v_status NOT IN ('pending_review', 'completed', 'rejected') THEN RETURN NEW; END IF;
    v_type := 'deposit_' || v_status;
    v_title := CASE v_status WHEN 'pending_review' THEN 'Deposit submitted' WHEN 'completed' THEN 'Deposit approved' ELSE 'Deposit rejected' END;
    v_message := CASE v_status
      WHEN 'pending_review' THEN 'Your deposit request for ' || v_amount || ' is awaiting treasury verification.'
      WHEN 'completed' THEN 'Your deposit of ' || v_amount || ' has been verified and credited to your Vault.'
      ELSE 'Your deposit request for ' || v_amount || ' was rejected. ' || COALESCE(NULLIF(NEW.audit_reason, ''), 'Please contact support for details.') END;
  ELSE
    IF v_status NOT IN ('pending_review', 'settlement_processing', 'completed', 'rejected', 'cancelled') THEN RETURN NEW; END IF;
    v_type := 'withdrawal_' || v_status;
    v_title := CASE v_status WHEN 'pending_review' THEN 'Withdrawal submitted' WHEN 'settlement_processing' THEN 'Withdrawal processing' WHEN 'completed' THEN 'Withdrawal completed' WHEN 'rejected' THEN 'Withdrawal rejected' ELSE 'Withdrawal cancelled' END;
    v_message := CASE v_status
      WHEN 'pending_review' THEN 'Your withdrawal request for ' || v_amount || ' was submitted for treasury review.'
      WHEN 'settlement_processing' THEN 'Your withdrawal request for ' || v_amount || ' is being processed.'
      WHEN 'completed' THEN 'Your withdrawal of ' || v_amount || ' has been paid.'
      WHEN 'rejected' THEN 'Your withdrawal request for ' || v_amount || ' was rejected. ' || COALESCE(NULLIF(NEW.audit_reason, ''), 'Reserved funds have been restored to your Vault.')
      ELSE 'Your withdrawal request for ' || v_amount || ' was cancelled and reserved funds were restored.' END;
  END IF;
  PERFORM public.create_user_notification(NEW.user_id, v_type, v_title, v_message, NEW.id,
    jsonb_build_object('transactionId', NEW.id, 'transactionType', NEW.type, 'status', v_status, 'amount', NEW.amount));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_vault_transaction_insert ON public.vault_transactions;
CREATE TRIGGER trg_notify_vault_transaction_insert AFTER INSERT ON public.vault_transactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_vault_transaction_change();
DROP TRIGGER IF EXISTS trg_notify_vault_transaction_update ON public.vault_transactions;
CREATE TRIGGER trg_notify_vault_transaction_update AFTER UPDATE OF status ON public.vault_transactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_vault_transaction_change();

CREATE OR REPLACE FUNCTION public.notify_support_ticket_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
  v_note TEXT;
  v_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.admin_notes IS NOT DISTINCT FROM OLD.admin_notes THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  v_status := COALESCE(NEW.status, 'Open');
  v_note := NULLIF(BTRIM(COALESCE(NEW.admin_notes, '')), '');
  v_type := CASE WHEN v_status = 'Resolved' THEN 'support_resolved' ELSE 'support_response' END;
  PERFORM public.create_user_notification(NEW.user_id, v_type,
    CASE WHEN v_status = 'Resolved' THEN 'Support ticket resolved' ELSE 'Support ticket updated' END,
    'Your support ticket "' || COALESCE(NEW.subject, NEW.id) || '" is ' || LOWER(v_status) || '.' ||
      CASE WHEN v_note IS NULL THEN '' ELSE ' Admin response: ' || v_note END,
    NEW.id, jsonb_build_object('ticketId', NEW.id, 'status', v_status));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_support_ticket_update ON public.support_tickets;
CREATE TRIGGER trg_notify_support_ticket_update AFTER UPDATE OF status, admin_notes ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_ticket_change();

-- Trigger functions are invoked by PostgreSQL triggers, not exposed as RPCs.
REVOKE ALL ON FUNCTION public.create_user_notification(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_vault_transaction_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_support_ticket_change() FROM PUBLIC, anon, authenticated;
