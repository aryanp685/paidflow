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
