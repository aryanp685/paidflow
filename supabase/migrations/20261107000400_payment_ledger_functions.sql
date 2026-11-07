-- Idempotency keys belong to a business; retries must use identical parameters.
CREATE FUNCTION public.record_payment(p_business_id uuid, p_invoice_id uuid, p_idempotency_key uuid, p_amount_paise bigint, p_payment_date date, p_payment_mode text, p_reference_id text DEFAULT NULL, p_proof_document_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv public.invoices; pay public.payments; actual numeric;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin','manager','accountant']::public.business_role[]);
  IF p_idempotency_key IS NULL OR p_amount_paise IS NULL OR p_amount_paise <= 0 OR p_payment_date IS NULL OR p_payment_mode IS NULL OR p_payment_mode NOT IN ('upi','neft','rtgs','imps','bank_transfer','cash','cheque','other') THEN RAISE EXCEPTION 'Invalid payment input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE business_id = p_business_id AND id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO pay FROM public.payments WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF (pay.invoice_id,pay.amount_paise,pay.payment_date,pay.payment_mode,pay.reference_id,pay.proof_document_id,pay.notes) IS DISTINCT FROM (p_invoice_id,p_amount_paise,p_payment_date,p_payment_mode,p_reference_id,p_proof_document_id,p_notes) THEN RAISE EXCEPTION 'Idempotency key reused with different payment details' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('payment',to_jsonb(pay),'invoice',to_jsonb(inv),'replayed',true);
  END IF;
  IF inv.lifecycle_status <> 'issued' THEN RAISE EXCEPTION 'Payments require an issued invoice'; END IF;
  SELECT coalesce(sum(amount_paise),0) INTO actual FROM public.payments WHERE business_id = p_business_id AND invoice_id = p_invoice_id AND status = 'recorded';
  IF actual <> inv.paid_paise::numeric OR inv.balance_paise::numeric <> inv.total_paise::numeric - actual THEN RAISE EXCEPTION 'Ledger and invoice balance mismatch'; END IF;
  IF p_amount_paise::numeric > inv.total_paise::numeric - actual THEN RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.payments(business_id,invoice_id,customer_id,payment_date,amount_paise,payment_mode,reference_id,proof_document_id,verification_status,notes,idempotency_key,recorded_by)
  VALUES (p_business_id,p_invoice_id,inv.customer_id,p_payment_date,p_amount_paise,p_payment_mode,p_reference_id,p_proof_document_id,CASE WHEN p_proof_document_id IS NULL THEN 'user_recorded' ELSE 'proof_attached' END,p_notes,p_idempotency_key,auth.uid()) RETURNING * INTO pay;
  UPDATE public.invoices SET paid_paise = (actual + p_amount_paise)::bigint, balance_paise = (total_paise::numeric - actual - p_amount_paise)::bigint, updated_at = clock_timestamp() WHERE business_id = p_business_id AND id = p_invoice_id RETURNING * INTO inv;
  INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata) VALUES (p_business_id,auth.uid(),'payment',pay.id,'payment.recorded',jsonb_build_object('invoice_id',p_invoice_id,'amount_paise',p_amount_paise));
  RETURN jsonb_build_object('payment',to_jsonb(pay),'invoice',to_jsonb(inv),'replayed',false);
END $$;
CREATE FUNCTION public.void_payment(p_business_id uuid, p_payment_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv public.invoices; pay public.payments; actual numeric; target_invoice uuid;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin']::public.business_role[]);
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 OR length(p_reason) > 500 THEN RAISE EXCEPTION 'A void reason is required' USING ERRCODE = '22023'; END IF;
  SELECT invoice_id INTO target_invoice FROM public.payments WHERE business_id = p_business_id AND id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE business_id = p_business_id AND id = target_invoice FOR UPDATE;
  SELECT * INTO pay FROM public.payments WHERE business_id = p_business_id AND id = p_payment_id FOR UPDATE;
  IF pay.status = 'voided' THEN RETURN jsonb_build_object('payment',to_jsonb(pay),'invoice',to_jsonb(inv),'replayed',true); END IF;
  SELECT coalesce(sum(amount_paise),0) INTO actual FROM public.payments WHERE business_id = p_business_id AND invoice_id = target_invoice AND status = 'recorded';
  IF actual <> inv.paid_paise::numeric OR inv.balance_paise::numeric <> inv.total_paise::numeric - actual THEN RAISE EXCEPTION 'Ledger and invoice balance mismatch'; END IF;
  UPDATE public.payments SET status = 'voided', voided_at = clock_timestamp(), voided_by = auth.uid(), voided_reason = trim(p_reason) WHERE business_id = p_business_id AND id = p_payment_id RETURNING * INTO pay;
  UPDATE public.invoices SET paid_paise = (actual - pay.amount_paise)::bigint, balance_paise = (total_paise::numeric - actual + pay.amount_paise)::bigint, updated_at = clock_timestamp() WHERE business_id = p_business_id AND id = target_invoice RETURNING * INTO inv;
  INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata) VALUES (p_business_id,auth.uid(),'payment',pay.id,'payment.voided',jsonb_build_object('invoice_id',target_invoice,'amount_paise',pay.amount_paise));
  RETURN jsonb_build_object('payment',to_jsonb(pay),'invoice',to_jsonb(inv),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.record_payment(uuid,uuid,uuid,bigint,date,text,text,uuid,text), public.void_payment(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,uuid,uuid,bigint,date,text,text,uuid,text), public.void_payment(uuid,uuid,text) TO authenticated;

-- Deferred invariant protects even privileged direct SQL writes from silently desynchronizing
-- the cached totals. RPCs update payment and invoice within the same transaction.
CREATE FUNCTION paidflow_private.assert_ledger_consistent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b uuid; i uuid; inv public.invoices; actual numeric;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN b := NEW.business_id; i := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN b := OLD.business_id; i := OLD.invoice_id;
  ELSE
    b := NEW.business_id; i := NEW.invoice_id;
    IF TG_OP = 'UPDATE' AND (OLD.business_id,OLD.invoice_id) IS DISTINCT FROM (NEW.business_id,NEW.invoice_id) THEN RAISE EXCEPTION 'Cannot move a payment to another invoice'; END IF;
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE business_id = b AND id = i FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger invoice missing'; END IF;
  SELECT coalesce(sum(amount_paise),0) INTO actual FROM public.payments WHERE business_id = b AND invoice_id = i AND status = 'recorded';
  IF actual <> inv.paid_paise::numeric OR inv.balance_paise::numeric <> inv.total_paise::numeric - actual OR (actual > 0 AND inv.lifecycle_status <> 'issued') THEN
    RAISE EXCEPTION 'Ledger and invoice balance mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.assert_ledger_consistent() FROM PUBLIC, anon, authenticated;
CREATE CONSTRAINT TRIGGER invoice_ledger_consistency AFTER INSERT OR UPDATE ON public.invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION paidflow_private.assert_ledger_consistent();
CREATE CONSTRAINT TRIGGER payment_ledger_consistency AFTER INSERT OR UPDATE OR DELETE ON public.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION paidflow_private.assert_ledger_consistent();
