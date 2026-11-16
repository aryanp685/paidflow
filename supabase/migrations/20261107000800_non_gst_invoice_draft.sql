-- Candidate additive migration: non-GST invoice drafts only. Not yet deployed.
-- One request key represents one exact payload; invoice, lines, number, audit,
-- and idempotency record are committed together. Issuance is a separate step.
CREATE TABLE paidflow_private.invoice_draft_requests (
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  request_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, request_id),
  FOREIGN KEY (business_id, invoice_id) REFERENCES public.invoices(business_id, id)
);
REVOKE ALL ON paidflow_private.invoice_draft_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_non_gst_invoice_draft(
  p_business_id uuid, p_request_id uuid, p_customer_id uuid,
  p_invoice_date date, p_due_date date, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  request_payload jsonb; existing paidflow_private.invoice_draft_requests;
  item jsonb; line_no integer := 0; qty numeric; price numeric; line_total numeric;
  total numeric := 0; origin text; new_invoice uuid := gen_random_uuid();
  number text; fy integer;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin','manager']::public.business_role[]);
  IF p_business_id IS NULL OR p_request_id IS NULL OR p_customer_id IS NULL OR p_invoice_date IS NULL OR p_due_date IS NULL OR p_due_date < p_invoice_date THEN
    RAISE EXCEPTION 'Invalid invoice details' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Invalid invoice lines' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR octet_length(p_lines::text) > 120000 THEN RAISE EXCEPTION 'Invalid invoice lines' USING ERRCODE='22023'; END IF;
  fy := extract(year FROM p_invoice_date)::integer - CASE WHEN extract(month FROM p_invoice_date) < 4 THEN 1 ELSE 0 END;
  IF fy NOT BETWEEN 1900 AND 9998 THEN RAISE EXCEPTION 'Invalid invoice date' USING ERRCODE='22023'; END IF;
  request_payload := jsonb_build_object('customer_id',p_customer_id,'invoice_date',p_invoice_date,'due_date',p_due_date,'lines',p_lines);
  -- Scope the transaction lock to workspace + request. Hash collisions only
  -- serialize unrelated requests; the table's composite key remains authoritative.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_request_id::text, 0));
  SELECT * INTO existing FROM paidflow_private.invoice_draft_requests WHERE business_id=p_business_id AND request_id=p_request_id;
  IF FOUND THEN
    IF existing.payload IS DISTINCT FROM request_payload THEN RAISE EXCEPTION 'Request key reused with different invoice details' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('invoice_id',existing.invoice_id,'replayed',true);
  END IF;
  SELECT b.state_code INTO origin FROM public.businesses b WHERE b.id=p_business_id;
  IF origin IS NULL THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0002'; END IF;
  -- Serialize customer archive/update against draft creation.
  PERFORM 1 FROM public.customers c WHERE c.business_id=p_business_id AND c.id=p_customer_id AND NOT c.is_archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0002'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RAISE EXCEPTION 'Invalid invoice line' USING ERRCODE='22023'; END IF;
    IF NOT (item ?& ARRAY['description','quantity','unitPricePaise']) OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3 OR
       jsonb_typeof(item->'description') <> 'string' OR jsonb_typeof(item->'quantity') <> 'string' OR jsonb_typeof(item->'unitPricePaise') <> 'string' THEN
      RAISE EXCEPTION 'Invalid invoice line' USING ERRCODE='22023';
    END IF;
    IF length(trim(item->>'description')) NOT BETWEEN 1 AND 1000 OR
       (item->>'quantity') !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$' OR
       (item->>'unitPricePaise') !~ '^(0|[1-9][0-9]{0,15})$' THEN
      RAISE EXCEPTION 'Invalid invoice line' USING ERRCODE='22023';
    END IF;
    qty := (item->>'quantity')::numeric; price := (item->>'unitPricePaise')::numeric;
    IF qty <= 0 OR price > 9007199254740991 THEN RAISE EXCEPTION 'Invalid invoice line' USING ERRCODE='22023'; END IF;
    line_total := round(qty * price);
    total := total + line_total;
    IF line_total > 9007199254740991 OR total > 9007199254740991 THEN RAISE EXCEPTION 'Invoice amount too large' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF total <= 0 THEN RAISE EXCEPTION 'Invoice total must be positive' USING ERRCODE='22023'; END IF;
  number := public.allocate_invoice_number(p_business_id,p_invoice_date);
  INSERT INTO public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,
    origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise)
  VALUES(new_invoice,p_business_id,p_customer_id,number,p_invoice_date,p_due_date,fy,origin,origin,total::bigint,total::bigint,total::bigint,total::bigint);
  FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    qty := (item->>'quantity')::numeric; price := (item->>'unitPricePaise')::numeric;
    line_total := round(qty * price); line_no := line_no + 1;
    INSERT INTO public.invoice_items(business_id,invoice_id,sort_order,description,quantity,unit_price_paise,taxable_paise,line_total_paise)
    VALUES(p_business_id,new_invoice,line_no,trim(item->>'description'),qty,price::bigint,line_total::bigint,line_total::bigint);
  END LOOP;
  INSERT INTO paidflow_private.invoice_draft_requests(business_id,request_id,invoice_id,payload,created_by)
  VALUES(p_business_id,p_request_id,new_invoice,request_payload,auth.uid());
  RETURN jsonb_build_object('invoice_id',new_invoice,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_non_gst_invoice_draft(uuid,uuid,uuid,date,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_non_gst_invoice_draft(uuid,uuid,uuid,date,date,jsonb) TO authenticated;
