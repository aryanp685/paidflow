-- Step 2C local lab only. Apply after 2A and 2B, never to a remote database.
-- Existing rows are preserved and explicitly not considered verified objects.
ALTER TABLE public.documents
  ADD COLUMN storage_area text,
  ADD COLUMN storage_status text NOT NULL DEFAULT 'legacy_unverified',
  ADD COLUMN storage_request_id uuid,
  ADD COLUMN storage_expires_at timestamptz,
  ADD COLUMN storage_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT storage_area_check CHECK (storage_area IS NULL OR storage_area IN ('evidence','payment-proofs','ocr-staging')),
  ADD CONSTRAINT storage_status_check CHECK (storage_status IN ('legacy_unverified','quarantine','verified','deleting','deleted','abandoned')),
  ADD CONSTRAINT storage_lab_fields_check CHECK (storage_status='legacy_unverified' OR (storage_area IS NOT NULL AND storage_request_id IS NOT NULL AND sha256_checksum ~ '^[0-9a-f]{64}$'));
CREATE UNIQUE INDEX documents_storage_request_idx ON public.documents(business_id,uploaded_by,storage_request_id) WHERE storage_request_id IS NOT NULL;
CREATE INDEX documents_storage_cleanup_idx ON public.documents(business_id,storage_status,storage_expires_at) WHERE storage_status IN ('quarantine','deleting');
-- No direct runtime metadata mutation: the functions below own state transitions.
REVOKE INSERT ON public.documents FROM paidflow_runtime;
DROP POLICY tenant_read ON public.documents;
CREATE POLICY tenant_read ON public.documents FOR SELECT TO paidflow_runtime USING (
  CASE storage_area
    WHEN 'payment-proofs' THEN paidflow_private.has_business_role(business_id,ARRAY['owner','admin','manager','accountant']::public.business_role[])
    WHEN 'ocr-staging' THEN paidflow_private.has_business_role(business_id,ARRAY['owner','admin','manager']::public.business_role[])
    ELSE paidflow_private.has_business_access(business_id)
  END
);

CREATE FUNCTION public.storage_register(p_business uuid,p_doc uuid,p_request uuid,p_path text,p_area text,p_name text,p_mime text,p_size bigint,p_hash text)
RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.documents; actor uuid := paidflow_private.actor_id();
BEGIN
  PERFORM paidflow_private.require_business_role(p_business,ARRAY['owner','admin','manager']::public.business_role[]);
  IF p_doc IS NULL OR p_request IS NULL OR p_area IS NULL OR p_area NOT IN ('evidence','payment-proofs','ocr-staging') OR p_mime IS NULL OR p_mime NOT IN ('image/png','image/jpeg','application/pdf') OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 5242880 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 180 OR p_path IS NULL OR p_path !~ ('^' || p_business::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'Invalid document' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business::text || ':' || actor::text || ':' || p_request::text,0));
  SELECT * INTO d FROM public.documents WHERE business_id=p_business AND uploaded_by=actor AND storage_request_id=p_request;
  IF FOUND THEN
    IF (d.storage_area,d.file_name,d.mime_type,d.file_size_bytes,d.sha256_checksum) IS DISTINCT FROM (p_area,p_name,p_mime,p_size,p_hash) THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='22023'; END IF;
    RETURN d;
  END IF;
  INSERT INTO public.documents(id,business_id,category,file_name,storage_path,mime_type,file_size_bytes,sha256_checksum,uploaded_by,storage_area,storage_status,storage_request_id,storage_expires_at)
  VALUES(p_doc,p_business,CASE WHEN p_area='payment-proofs' THEN 'payment_receipt' ELSE 'other' END,p_name,p_path,p_mime,p_size,p_hash,actor,p_area,'quarantine',p_request,now()+interval '15 minutes') RETURNING * INTO d;
  RETURN d;
END $$;

CREATE FUNCTION public.storage_lock(p_doc uuid,p_action text) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.documents; roles public.business_role[];
BEGIN
  SELECT * INTO d FROM public.documents WHERE id=p_doc FOR UPDATE;
  IF NOT FOUND OR d.storage_area IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  roles := CASE p_action
    WHEN 'read' THEN CASE d.storage_area WHEN 'ocr-staging' THEN ARRAY['owner','admin','manager']::public.business_role[] WHEN 'payment-proofs' THEN ARRAY['owner','admin','manager','accountant']::public.business_role[] ELSE ARRAY['owner','admin','manager','accountant','viewer']::public.business_role[] END
    WHEN 'write' THEN ARRAY['owner','admin','manager']::public.business_role[]
    WHEN 'delete' THEN ARRAY['owner','admin']::public.business_role[]
    ELSE ARRAY[]::public.business_role[] END;
  PERFORM paidflow_private.require_business_role(d.business_id,roles);
  RETURN d;
END $$;

CREATE FUNCTION public.storage_transition(p_doc uuid,p_next text) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.documents; event text; act text;
BEGIN
  act := CASE WHEN p_next='verified' THEN 'write' ELSE 'delete' END;
  d := public.storage_lock(p_doc,act);
  IF p_next='verified' AND d.storage_status='quarantine' AND d.storage_expires_at > now() THEN event:='document.uploaded';
  ELSIF p_next='deleting' AND d.storage_status='verified' THEN
    IF d.payment_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.payments p WHERE p.business_id=d.business_id AND p.proof_document_id=d.id) OR EXISTS (SELECT 1 FROM public.document_extractions e WHERE e.business_id=d.business_id AND e.document_id=d.id) THEN RAISE EXCEPTION 'Document is linked to retained records' USING ERRCODE='23503'; END IF;
    event:=NULL;
  ELSIF p_next='deleted' AND d.storage_status='deleting' THEN event:='document.deleted';
  ELSIF p_next='abandoned' AND d.storage_status='quarantine' AND d.storage_expires_at <= now() THEN event:='document.upload_abandoned';
  ELSE RAISE EXCEPTION 'Invalid document state' USING ERRCODE='22023'; END IF;
  UPDATE public.documents SET storage_status=p_next,storage_updated_at=now() WHERE id=d.id RETURNING * INTO d;
  IF event IS NOT NULL THEN INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata) VALUES(d.business_id,paidflow_private.actor_id(),'document',d.id,event,jsonb_build_object('area',d.storage_area,'mime_type',d.mime_type,'size_bytes',d.file_size_bytes)); END IF;
  RETURN d;
END $$;
CREATE FUNCTION public.storage_authorize_cleanup(p_business uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM paidflow_private.require_business_role(p_business,ARRAY['owner','admin']::public.business_role[]);
END $$;
REVOKE ALL ON FUNCTION public.storage_authorize_cleanup(uuid) FROM PUBLIC,paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.storage_authorize_cleanup(uuid) TO paidflow_runtime;
REVOKE ALL ON FUNCTION public.storage_register(uuid,uuid,uuid,text,text,text,text,bigint,text),public.storage_lock(uuid,text),public.storage_transition(uuid,text) FROM PUBLIC,paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.storage_register(uuid,uuid,uuid,text,text,text,text,bigint,text),public.storage_lock(uuid,text),public.storage_transition(uuid,text) TO paidflow_runtime;
