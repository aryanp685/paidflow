-- Step 2D.1, local lab ONLY; additive to the unchanged Step 2A/2B/2C migrations.
-- The earlier "verified" status meant structurally checked, NOT malware scanned.
-- Preserve payment/audit history while removing that misleading trust designation.
ALTER TABLE public.documents DROP CONSTRAINT storage_status_check;
ALTER TABLE public.documents ADD CONSTRAINT storage_status_check CHECK (storage_status IN (
  'legacy_unverified','quarantine','structurally_valid_unscanned','verified','revoked','deleting','deleted','abandoned'
));
INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata)
SELECT business_id,NULL,'document',id,'document.scan_status_reclassified',
       jsonb_build_object('from','verified','to','structurally_valid_unscanned','reason','prior structural validation was not malware scanning')
FROM public.documents WHERE storage_status='verified';
UPDATE public.documents SET storage_status='structurally_valid_unscanned',storage_updated_at=now() WHERE storage_status='verified';

-- Only the trusted owner can set verified; this lab has no scanner and exposes
-- no runtime transition to verified. Protect every INSERT and context-changing
-- UPDATE, while leaving unrelated historical updates (e.g. payment void) intact.
CREATE FUNCTION paidflow_private.enforce_payment_proof_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.documents;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.business_id,NEW.invoice_id,NEW.customer_id,NEW.proof_document_id) IS NOT DISTINCT FROM (OLD.business_id,OLD.invoice_id,OLD.customer_id,OLD.proof_document_id) THEN RETURN NEW; END IF;
  IF NEW.proof_document_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO d FROM public.documents WHERE id=NEW.proof_document_id FOR UPDATE;
  IF NOT FOUND OR d.business_id IS DISTINCT FROM NEW.business_id OR d.invoice_id IS DISTINCT FROM NEW.invoice_id
     OR (d.customer_id IS NOT NULL AND d.customer_id IS DISTINCT FROM NEW.customer_id)
     OR (d.payment_id IS NOT NULL AND d.payment_id IS DISTINCT FROM NEW.id)
     OR d.storage_area IS DISTINCT FROM 'payment-proofs' OR d.storage_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'Payment proof unavailable or invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.enforce_payment_proof_lifecycle() FROM PUBLIC,paidflow_runtime;
CREATE TRIGGER payment_proof_lifecycle BEFORE INSERT OR UPDATE OF business_id,invoice_id,customer_id,proof_document_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION paidflow_private.enforce_payment_proof_lifecycle();

-- Every lifecycle operation takes the same row lock as the payment trigger.
-- Once referenced by ANY payment (including voided) or extraction, retention is
-- mandatory: no deletion or revocation, and existing history is not rewritten.
CREATE OR REPLACE FUNCTION public.storage_transition(p_doc uuid,p_next text) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.documents; event text; act text;
BEGIN
  act := CASE WHEN p_next='structurally_valid_unscanned' THEN 'write' ELSE 'delete' END;
  d := public.storage_lock(p_doc,act);
  IF p_next='structurally_valid_unscanned' AND d.storage_status='quarantine' AND d.storage_expires_at > now() THEN event:='document.uploaded';
  ELSIF p_next IN ('deleting','revoked') AND d.storage_status IN ('structurally_valid_unscanned','verified','revoked') AND (p_next='deleting' OR d.storage_status<>'revoked') THEN
    IF d.payment_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.payments p WHERE p.business_id=d.business_id AND p.proof_document_id=d.id) OR EXISTS (SELECT 1 FROM public.document_extractions e WHERE e.business_id=d.business_id AND e.document_id=d.id) THEN RAISE EXCEPTION 'Document is linked to retained records' USING ERRCODE='23503'; END IF;
    event:=CASE WHEN p_next='revoked' THEN 'document.revoked' ELSE NULL END;
  ELSIF p_next='deleted' AND d.storage_status='deleting' THEN event:='document.deleted';
  ELSIF p_next='abandoned' AND d.storage_status='quarantine' AND d.storage_expires_at <= now() THEN event:='document.upload_abandoned';
  ELSE RAISE EXCEPTION 'Invalid document state' USING ERRCODE='22023'; END IF;
  UPDATE public.documents SET storage_status=p_next,storage_updated_at=now() WHERE id=d.id RETURNING * INTO d;
  IF event IS NOT NULL THEN INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata) VALUES(d.business_id,paidflow_private.actor_id(),'document',d.id,event,jsonb_build_object('area',d.storage_area,'mime_type',d.mime_type,'size_bytes',d.file_size_bytes)); END IF;
  RETURN d;
END $$;
