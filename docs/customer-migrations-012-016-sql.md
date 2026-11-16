# Complete local customer migration proposals 012–016

**NOT APPROVED, not backward compatible, not deployed.** Exact local SQL for review; canonical files are in `supabase/migrations/`. Candidate 016 depends on 012–015 and adds new interfaces. No rollback approval. See `customer-writer-compatibility.md` and `customer-snapshot-consistency.md`.

## `supabase/migrations/20261107001200_customer_versioned_edits.sql`

```sql
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
```

## `supabase/migrations/20261107001300_customer_duplicate_policy.sql`

```sql
-- Local proposal. Contact fields and GSTIN are not row identities: shared
-- contacts and multiple records per registration are legitimate. These
-- non-unique indexes support future advisory review; no match is auto-merged.
-- Existing active and archived duplicates remain untouched.
CREATE INDEX customer_business_email_match ON public.customers(business_id,lower(btrim(email))) WHERE nullif(btrim(email),'') IS NOT NULL;
CREATE INDEX customer_business_phone_match ON public.customers(business_id,regexp_replace(phone,'[^0-9]','','g')) WHERE nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'') IS NOT NULL;
CREATE INDEX customer_business_gstin_match ON public.customers(business_id,upper(btrim(gstin))) WHERE nullif(btrim(gstin),'') IS NOT NULL;
-- Direct inserts bypass request-key handling. Retiring them breaks legacy
-- clients; the existing RPC signature is retained, but rollout requires review.
REVOKE INSERT ON public.customers FROM PUBLIC, anon, authenticated;

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
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Customer write conflict' USING ERRCODE = '23505';
END $$;
```

## `supabase/migrations/20261107001400_customer_update_audit.sql`

```sql
-- Local proposal. Audit field names, not values; existing creation audit stays.
CREATE FUNCTION paidflow_private.audit_customer_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE changed text[];
BEGIN
  changed := array_remove(ARRAY[
    CASE WHEN OLD.name IS DISTINCT FROM NEW.name THEN 'name' END,
    CASE WHEN OLD.contact_person IS DISTINCT FROM NEW.contact_person THEN 'contact_person' END,
    CASE WHEN OLD.email IS DISTINCT FROM NEW.email THEN 'email' END,
    CASE WHEN OLD.phone IS DISTINCT FROM NEW.phone THEN 'phone' END,
    CASE WHEN OLD.whatsapp_phone IS DISTINCT FROM NEW.whatsapp_phone THEN 'whatsapp_phone' END,
    CASE WHEN OLD.gstin IS DISTINCT FROM NEW.gstin THEN 'gstin' END,
    CASE WHEN OLD.billing_address IS DISTINCT FROM NEW.billing_address THEN 'billing_address' END,
    CASE WHEN OLD.shipping_address IS DISTINCT FROM NEW.shipping_address THEN 'shipping_address' END,
    CASE WHEN OLD.state_code IS DISTINCT FROM NEW.state_code THEN 'state_code' END,
    CASE WHEN OLD.payment_terms_days IS DISTINCT FROM NEW.payment_terms_days THEN 'payment_terms_days' END,
    CASE WHEN OLD.credit_limit_paise IS DISTINCT FROM NEW.credit_limit_paise THEN 'credit_limit_paise' END,
    CASE WHEN OLD.internal_notes IS DISTINCT FROM NEW.internal_notes THEN 'internal_notes' END,
    CASE WHEN OLD.is_archived IS DISTINCT FROM NEW.is_archived THEN 'is_archived' END
  ], NULL);
  INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata)
  VALUES (NEW.business_id,auth.uid(),'customer',NEW.id,'customer.updated',jsonb_build_object('changed_fields',changed));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.audit_customer_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_customer_update AFTER UPDATE ON public.customers FOR EACH ROW
WHEN (ROW(OLD.name,OLD.contact_person,OLD.email,OLD.phone,OLD.whatsapp_phone,OLD.gstin,OLD.billing_address,OLD.shipping_address,OLD.state_code,OLD.payment_terms_days,OLD.credit_limit_paise,OLD.internal_notes,OLD.is_archived)
  IS DISTINCT FROM ROW(NEW.name,NEW.contact_person,NEW.email,NEW.phone,NEW.whatsapp_phone,NEW.gstin,NEW.billing_address,NEW.shipping_address,NEW.state_code,NEW.payment_terms_days,NEW.credit_limit_paise,NEW.internal_notes,NEW.is_archived))
EXECUTE FUNCTION paidflow_private.audit_customer_update();
```

## `supabase/migrations/20261107001500_customer_gstin_validation.sql`

```sql
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
```

## `supabase/migrations/20261107001600_customer_compatibility_review.sql`

```sql
-- Local candidate only, depends on 012-015. Not a compatibility cutover.
-- Patch leaves unspecified fields untouched, including grandfathered identifiers.
CREATE FUNCTION public.patch_customer_if_version(p_business_id uuid,p_customer_id uuid,p_expected_version integer,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE oldrow public.customers; updated public.customers; patchrow public.customers; k text;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id,ARRAY['owner','admin','manager']::public.business_role[]);
  IF p_expected_version IS NULL OR p_expected_version < 1 OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k <> ALL(ARRAY['name','contact_person','email','phone','whatsapp_phone','gstin','billing_address','shipping_address','state_code','payment_terms_days','credit_limit_paise','internal_notes','is_archived']) THEN
      RAISE EXCEPTION 'Invalid customer details' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(p_patch->k) <> ALL(CASE WHEN k IN ('billing_address','shipping_address') THEN ARRAY['object','null'] WHEN k='is_archived' THEN ARRAY['boolean'] WHEN k IN ('payment_terms_days','credit_limit_paise') THEN ARRAY['number','null'] ELSE ARRAY['string','null'] END) THEN
      RAISE EXCEPTION 'Invalid customer details' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT * INTO oldrow FROM public.customers WHERE business_id=p_business_id AND id=p_customer_id AND edit_version=p_expected_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable or changed' USING ERRCODE='40001'; END IF;
  patchrow := jsonb_populate_record(oldrow,p_patch);
  IF patchrow.name IS NULL OR length(btrim(patchrow.name)) NOT BETWEEN 1 AND 200
     OR length(patchrow.contact_person)>200 OR length(patchrow.email)>254 OR length(patchrow.phone)>40 OR length(patchrow.whatsapp_phone)>40
     OR (p_patch ? 'gstin' AND patchrow.gstin IS NOT NULL AND NOT paidflow_private.is_standard_customer_gstin(patchrow.gstin))
     OR (p_patch ? 'state_code' AND patchrow.state_code IS NOT NULL AND patchrow.state_code !~ '^(0[1-9]|[12][0-9]|3[0-8])$')
     OR ((p_patch ? 'gstin' OR p_patch ? 'state_code') AND patchrow.gstin IS NOT NULL AND patchrow.state_code IS NOT NULL AND left(patchrow.gstin,2)<>patchrow.state_code) THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE='22023'; END IF;
  UPDATE public.customers SET name=patchrow.name,contact_person=patchrow.contact_person,email=patchrow.email,phone=patchrow.phone,whatsapp_phone=patchrow.whatsapp_phone,gstin=patchrow.gstin,billing_address=patchrow.billing_address,shipping_address=patchrow.shipping_address,state_code=patchrow.state_code,payment_terms_days=patchrow.payment_terms_days,credit_limit_paise=patchrow.credit_limit_paise,internal_notes=patchrow.internal_notes,is_archived=patchrow.is_archived
  WHERE business_id=p_business_id AND id=p_customer_id AND edit_version=p_expected_version RETURNING * INTO updated;
  RETURN jsonb_build_object('customer_id',updated.id,'edit_version',updated.edit_version);
END $$;
REVOKE ALL ON FUNCTION public.patch_customer_if_version(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patch_customer_if_version(uuid,uuid,integer,jsonb) TO authenticated;

-- Presence-only result; no IDs, names, contact values, counts, or archive status.
-- This is advisory at one instant and cannot prevent races or deduplicate.
CREATE FUNCTION public.customer_duplicate_advisory(p_business_id uuid,p_email text,p_phone text,p_gstin text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e text:=nullif(lower(btrim(p_email)),''); p text:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),''); g text:=nullif(upper(btrim(p_gstin)),'');
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id,ARRAY['owner','admin','manager']::public.business_role[]);
  IF length(p_email)>254 OR length(p_phone)>40 OR length(p_gstin)>15 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('possible_match',EXISTS(SELECT 1 FROM public.customers c WHERE c.business_id=p_business_id AND ((e IS NOT NULL AND lower(btrim(c.email))=e) OR (p IS NOT NULL AND regexp_replace(c.phone,'[^0-9]','','g')=p) OR (g IS NOT NULL AND upper(btrim(c.gstin))=g))));
END $$;
REVOKE ALL ON FUNCTION public.customer_duplicate_advisory(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_duplicate_advisory(uuid,text,text,text) TO authenticated;

-- STABLE SQL: the subqueries share the calling statement's MVCC snapshot.
-- SECURITY INVOKER preserves RLS on all three tables. No hidden references,
-- notes, proof metadata or unbounded histories. Decimal paise are strings.
CREATE FUNCTION public.customer_financial_snapshot(p_business_id uuid,p_customer_id uuid,p_payment_page integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object(
   'balance_count',(SELECT count(*) FROM public.invoices i WHERE i.business_id=c.business_id AND i.customer_id=c.id AND i.lifecycle_status='issued' AND NOT i.is_archived),
   'balances',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'due_date',q.due_date,'balance_paise',q.balance_paise::text) ORDER BY q.id),'[]'::jsonb) FROM (SELECT i.id,i.due_date,i.balance_paise FROM public.invoices i WHERE i.business_id=c.business_id AND i.customer_id=c.id AND i.lifecycle_status='issued' AND NOT i.is_archived ORDER BY i.id LIMIT 1000) q),
   'payment_count',(SELECT count(*) FROM public.payments p WHERE p.business_id=c.business_id AND p.customer_id=c.id),
   'payments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'payment_date',q.payment_date,'amount_paise',q.amount_paise::text,'payment_mode',q.payment_mode,'status',q.status) ORDER BY q.payment_date DESC,q.id DESC),'[]'::jsonb) FROM (SELECT p.id,p.payment_date,p.amount_paise,p.payment_mode,p.status FROM public.payments p WHERE p.business_id=c.business_id AND p.customer_id=c.id ORDER BY p.payment_date DESC,p.id DESC LIMIT 20 OFFSET (greatest(0,least(999,p_payment_page::bigint-1))*20)) q)
 ) FROM public.customers c WHERE c.business_id=p_business_id AND c.id=p_customer_id AND p_payment_page BETWEEN 1 AND 1000
$$;
REVOKE ALL ON FUNCTION public.customer_financial_snapshot(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_financial_snapshot(uuid,uuid,integer) TO authenticated;
```
