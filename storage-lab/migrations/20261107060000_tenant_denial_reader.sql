-- Local storage lab only. Never apply to hosted databases.
-- Existing unattributed rows remain NULL. No caller-provided metadata is stored.
ALTER TABLE paidflow_private.storage_access_denials
  ADD COLUMN business_id uuid,
  ADD COLUMN document_id uuid,
  ADD CONSTRAINT storage_denial_doc_requires_business CHECK (document_id IS NULL OR business_id IS NOT NULL);
CREATE INDEX storage_denial_business_id_idx ON paidflow_private.storage_access_denials(business_id,id DESC) WHERE business_id IS NOT NULL;

CREATE FUNCTION public.storage_record_context_denial(p_operation text,p_reason text,p_business uuid,p_document uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := paidflow_private.actor_id(); target public.documents; verified_business uuid; verified_document uuid;
BEGIN
  IF actor IS NULL OR p_operation IS NULL OR p_operation NOT IN ('upload','delete','grant','download','preview') OR p_reason IS NULL OR p_reason NOT IN ('access','validation') OR (p_business IS NOT NULL AND p_document IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023';
  END IF;
  -- Recheck authorization in the separate audit transaction. If access was
  -- revoked, retain a generic event without the target, not a tenant guess.
  BEGIN
    IF p_document IS NOT NULL AND p_operation IN ('delete','grant','download','preview') THEN
      target := public.storage_lock(p_document,CASE WHEN p_operation='delete' THEN 'delete' ELSE 'read' END);
      verified_business := target.business_id; verified_document := target.id;
    ELSIF p_business IS NOT NULL AND p_operation='upload' THEN
      PERFORM paidflow_private.require_business_role(p_business,ARRAY['owner','admin','manager']::public.business_role[]);
      verified_business := p_business;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    verified_business := NULL; verified_document := NULL;
  END;
  INSERT INTO paidflow_private.storage_access_denials(actor_user_id,operation,reason,business_id,document_id)
  VALUES(actor,p_operation,p_reason,verified_business,verified_document);
END $$;
REVOKE ALL ON FUNCTION public.storage_record_context_denial(text,text,uuid,uuid) FROM PUBLIC,paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.storage_record_context_denial(text,text,uuid,uuid) TO paidflow_runtime;

CREATE FUNCTION public.storage_tenant_denials(p_business uuid)
RETURNS TABLE(event_id bigint,event_time timestamptz,actor_id uuid,operation text,reason text,document_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM paidflow_private.require_business_role(p_business,ARRAY['owner','admin']::public.business_role[]);
  RETURN QUERY SELECT d.id,d.occurred_at,d.actor_user_id,d.operation,d.reason,d.document_id
    FROM paidflow_private.storage_access_denials d WHERE d.business_id=p_business
    ORDER BY d.id DESC LIMIT 101;
END $$;
REVOKE ALL ON FUNCTION public.storage_tenant_denials(uuid) FROM PUBLIC,paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.storage_tenant_denials(uuid) TO paidflow_runtime;
