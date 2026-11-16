-- Local candidate. This narrow standard PAN-based format is not registry
-- verification; special identifiers and state-code policy require review.
CREATE FUNCTION paidflow_private.is_standard_customer_gstin(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
DECLARE i integer; factor integer := 2; product integer; total integer := 0; alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
BEGIN
  IF value !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$' OR left(value,2)::integer NOT BETWEEN 1 AND 38 THEN RETURN false; END IF;
  FOR i IN REVERSE 14..1 LOOP
    product := (strpos(alphabet,substr(value,i,1))-1)*factor;
    total := total + product / 36 + product % 36;
    factor := 3-factor;
  END LOOP;
  RETURN (36-total%36)%36 = strpos(alphabet,substr(value,15,1))-1;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.is_standard_customer_gstin(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_customer_once(
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
  -- Preserve replay of earlier accepted keys before applying stricter new-entry rules.
  IF (v_gstin IS NOT NULL AND NOT paidflow_private.is_standard_customer_gstin(v_gstin))
     OR (v_state IS NOT NULL AND v_state !~ '^(0[1-9]|[12][0-9]|3[0-8])$') THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.customers(business_id,name,contact_person,email,phone,gstin,state_code)
  VALUES (p_business_id,v_name,v_contact,v_email,v_phone,v_gstin,v_state) RETURNING id INTO customer_id;
  INSERT INTO paidflow_private.customer_create_requests(business_id,request_id,customer_id,payload,created_by)
  VALUES(p_business_id,p_request_id,customer_id,v_payload,auth.uid());
  RETURN jsonb_build_object('customer_id',customer_id,'replayed',false);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Customer write conflict' USING ERRCODE = '23505';
END $$;

CREATE OR REPLACE FUNCTION public.update_customer_if_version(
  p_business_id uuid, p_customer_id uuid, p_expected_version integer, p_name text,
  p_contact_person text, p_email text, p_phone text, p_gstin text, p_state_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_name text := btrim(p_name); v_contact text := nullif(btrim(p_contact_person), '');
  v_email text := nullif(btrim(p_email), ''); v_phone text := nullif(btrim(p_phone), '');
  v_gstin text := nullif(upper(btrim(p_gstin)), ''); v_state text := nullif(btrim(p_state_code), '');
  v_version integer;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin','manager']::public.business_role[]);
  IF p_customer_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200
    OR length(v_contact) > 200 OR length(v_email) > 254 OR length(v_phone) > 40
    OR (v_gstin IS NOT NULL AND NOT paidflow_private.is_standard_customer_gstin(v_gstin))
    OR (v_state IS NOT NULL AND (v_state !~ '^(0[1-9]|[12][0-9]|3[0-8])$'))
    OR (v_gstin IS NOT NULL AND v_state IS NOT NULL AND left(v_gstin,2) <> v_state) THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE = '22023';
  END IF;
  UPDATE public.customers SET name=v_name, contact_person=v_contact, email=v_email, phone=v_phone, gstin=v_gstin, state_code=v_state
    WHERE business_id=p_business_id AND id=p_customer_id AND NOT is_archived AND edit_version=p_expected_version
    RETURNING edit_version INTO v_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable or changed' USING ERRCODE = '40001'; END IF;
  RETURN jsonb_build_object('customer_id',p_customer_id,'edit_version',v_version);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Customer write conflict' USING ERRCODE = '23505';
END $$;
