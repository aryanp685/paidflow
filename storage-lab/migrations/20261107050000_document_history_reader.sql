-- Local storage lab only; never apply this migration to a hosted database.
-- A narrowly scoped lifecycle-history reader, NOT a full security audit.
CREATE FUNCTION public.storage_document_history(p_business uuid)
RETURNS TABLE(event_id uuid,actor_id uuid,document_id uuid,event_action text,event_time timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  -- The helper checks active membership and locks it through this transaction,
  -- serializing the query with suspension/demotion of the requesting member.
  PERFORM paidflow_private.require_business_role(p_business,ARRAY['owner','admin']::public.business_role[]);
  RETURN QUERY
    SELECT a.id,a.actor_user_id,a.entity_id,a.action,a.created_at
    FROM public.activity_logs a
    WHERE a.business_id=p_business AND a.entity_type='document'
      AND a.action IN ('document.registered','document.uploaded','document.deleted',
        'document.revoked','document.upload_abandoned','document.scan_status_reclassified')
    ORDER BY a.created_at DESC,a.id DESC LIMIT 101;
END $$;
REVOKE ALL ON FUNCTION public.storage_document_history(uuid) FROM PUBLIC,paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.storage_document_history(uuid) TO paidflow_runtime;
