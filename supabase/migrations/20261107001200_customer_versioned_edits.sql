-- Local candidate only. Apply with a reviewed client/privilege rollout.
-- Direct authenticated customer UPDATE is deliberately retired in favour of
-- a checked RPC; privileged schema owners can still disable triggers.
ALTER TABLE public.customers ADD COLUMN edit_version integer NOT NULL DEFAULT 1 CHECK (edit_version > 0);

CREATE FUNCTION paidflow_private.customer_increment_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Do not let even ordinary privileged DML silently reassign identity or
  -- falsify creation metadata. Owners can still disable the trigger.
  IF (NEW.id, NEW.business_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.business_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Customer identity and creation metadata are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.edit_version := OLD.edit_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.customer_increment_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER customer_increment_version BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION paidflow_private.customer_increment_version();

REVOKE UPDATE (name,contact_person,email,phone,whatsapp_phone,gstin,billing_address,shipping_address,state_code,payment_terms_days,credit_limit_paise,internal_notes,is_archived) ON public.customers FROM authenticated;
REVOKE UPDATE ON public.customers FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.update_customer_if_version(
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
    OR (v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$')
    OR (v_state IS NOT NULL AND v_state !~ '^[0-9]{2}$')
    OR (v_gstin IS NOT NULL AND v_state IS NOT NULL AND left(v_gstin,2) <> v_state) THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE = '22023';
  END IF;
  UPDATE public.customers SET name=v_name, contact_person=v_contact, email=v_email, phone=v_phone, gstin=v_gstin, state_code=v_state
    WHERE business_id=p_business_id AND id=p_customer_id AND NOT is_archived AND edit_version=p_expected_version
    RETURNING edit_version INTO v_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable or changed' USING ERRCODE = '40001'; END IF;
  RETURN jsonb_build_object('customer_id',p_customer_id,'edit_version',v_version);
END $$;
REVOKE ALL ON FUNCTION public.update_customer_if_version(uuid,uuid,integer,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_customer_if_version(uuid,uuid,integer,text,text,text,text,text,text) TO authenticated;
