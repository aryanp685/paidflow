-- Local lab only. No target identifiers or arbitrary request metadata are stored.
CREATE TABLE paidflow_private.storage_access_denials (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  actor_user_id uuid,
  operation text NOT NULL CHECK (operation IN ('upload','delete','grant','download','preview','list','cleanup')),
  reason text NOT NULL CHECK (reason IN ('access','validation','origin','unauthenticated','auth_unavailable')),
  CHECK ((actor_user_id IS NOT NULL AND reason IN ('access','validation')) OR
         (actor_user_id IS NULL AND reason IN ('origin','unauthenticated','auth_unavailable')))
);
REVOKE ALL ON paidflow_private.storage_access_denials FROM PUBLIC, paidflow_runtime;
REVOKE ALL ON SEQUENCE paidflow_private.storage_access_denials_id_seq FROM PUBLIC, paidflow_runtime;

-- Only trusted server code can assert actor context. Neither function accepts
-- document/tenant IDs or arbitrary metadata. Anonymous writes ignore actor GUC.
CREATE FUNCTION public.storage_record_access_denial(p_operation text, p_reason text DEFAULT 'access') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid := paidflow_private.actor_id();
BEGIN
  IF actor IS NULL OR p_operation IS NULL OR p_operation NOT IN ('upload','delete','grant','download','preview','list','cleanup') OR p_reason IS NULL OR p_reason NOT IN ('access','validation') THEN
    RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023';
  END IF;
  INSERT INTO paidflow_private.storage_access_denials(actor_user_id,operation,reason) VALUES(actor,p_operation,p_reason);
END $$;
CREATE FUNCTION public.storage_record_anonymous_denial(p_operation text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('upload','delete','grant','download','preview','list','cleanup') OR p_reason IS NULL OR p_reason NOT IN ('origin','unauthenticated','auth_unavailable') THEN
    RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023';
  END IF;
  INSERT INTO paidflow_private.storage_access_denials(actor_user_id,operation,reason) VALUES(NULL,p_operation,p_reason);
END $$;
REVOKE ALL ON FUNCTION public.storage_record_access_denial(text,text),public.storage_record_anonymous_denial(text,text) FROM PUBLIC,paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.storage_record_access_denial(text,text),public.storage_record_anonymous_denial(text,text) TO paidflow_runtime;
