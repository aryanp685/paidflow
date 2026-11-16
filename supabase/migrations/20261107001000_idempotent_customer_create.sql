-- Local candidate only: idempotent creation does not constrain other direct INSERT paths.
CREATE TABLE paidflow_private.customer_create_requests (
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  request_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, request_id),
  FOREIGN KEY (business_id, customer_id) REFERENCES public.customers(business_id, id)
);
REVOKE ALL ON paidflow_private.customer_create_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_customer_once(
  p_business_id uuid, p_request_id uuid, p_name text, p_contact_person text,
  p_email text, p_phone text, p_gstin text, p_state_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_name text := btrim(p_name); v_contact text := nullif(btrim(p_contact_person), '');
  v_email text := nullif(btrim(p_email), ''); v_phone text := nullif(btrim(p_phone), '');
  v_gstin text := nullif(upper(btrim(p_gstin)), ''); v_state text := nullif(btrim(p_state_code), '');
  v_payload jsonb; existing paidflow_private.customer_create_requests; customer_id uuid;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin','manager']::public.business_role[]);
  IF p_business_id IS NULL OR p_request_id IS NULL OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200
    OR length(v_contact) > 200 OR length(v_email) > 254 OR length(v_phone) > 40
    OR (v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$')
    OR (v_state IS NOT NULL AND v_state !~ '^[0-9]{2}$')
    OR (v_gstin IS NOT NULL AND v_state IS NOT NULL AND left(v_gstin, 2) <> v_state) THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE = '22023';
  END IF;
  v_payload := jsonb_build_object('name',v_name,'contact_person',v_contact,'email',v_email,'phone',v_phone,'gstin',v_gstin,'state_code',v_state);
  PERFORM pg_advisory_xact_lock(hashtextextended('customer-create:' || p_business_id::text || ':' || p_request_id::text, 0));
  SELECT * INTO existing FROM paidflow_private.customer_create_requests WHERE business_id = p_business_id AND request_id = p_request_id;
  IF FOUND THEN
    IF existing.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Request key reused with different customer details' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('customer_id',existing.customer_id,'replayed',true);
  END IF;
  INSERT INTO public.customers(business_id,name,contact_person,email,phone,gstin,state_code)
  VALUES (p_business_id,v_name,v_contact,v_email,v_phone,v_gstin,v_state) RETURNING id INTO customer_id;
  INSERT INTO paidflow_private.customer_create_requests(business_id,request_id,customer_id,payload,created_by)
  VALUES(p_business_id,p_request_id,customer_id,v_payload,auth.uid());
  RETURN jsonb_build_object('customer_id',customer_id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_customer_once(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_once(uuid,uuid,text,text,text,text,text,text) TO authenticated;
