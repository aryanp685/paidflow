-- Arithmetic is numeric for intermediates and BIGINT for stored paise; no FLOAT.
ALTER TABLE public.invoices ADD CONSTRAINT invoice_financial_checks CHECK (
  subtotal_paise >= 0 AND discount_paise >= 0 AND taxable_paise >= 0 AND cgst_paise >= 0 AND sgst_paise >= 0 AND igst_paise >= 0 AND shipping_paise >= 0 AND additional_charges_paise >= 0 AND total_paise >= 0 AND paid_paise >= 0 AND balance_paise >= 0 AND round_off_paise BETWEEN -99 AND 99
  AND greatest(subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,shipping_paise,additional_charges_paise,total_paise,paid_paise,balance_paise) <= 9007199254740991
  AND discount_paise <= subtotal_paise AND taxable_paise::numeric = subtotal_paise::numeric - discount_paise
  AND total_paise::numeric = taxable_paise::numeric + cgst_paise::numeric + sgst_paise::numeric + igst_paise::numeric + shipping_paise::numeric + additional_charges_paise::numeric + round_off_paise::numeric
  AND paid_paise <= total_paise AND balance_paise::numeric = total_paise::numeric - paid_paise
  AND fy_start_year = extract(year FROM invoice_date)::integer - CASE WHEN extract(month FROM invoice_date) < 4 THEN 1 ELSE 0 END
  AND ((supply_type = 'non_gst' AND NOT is_gst_invoice AND cgst_paise = 0 AND sgst_paise = 0 AND igst_paise = 0)
    OR (supply_type = 'intra_state' AND is_gst_invoice AND origin_state_code = place_of_supply_state_code AND igst_paise = 0)
    OR (supply_type = 'inter_state' AND is_gst_invoice AND origin_state_code <> place_of_supply_state_code AND cgst_paise = 0 AND sgst_paise = 0))
  AND ((lifecycle_status = 'draft' AND issued_at IS NULL AND cancelled_at IS NULL AND cancelled_reason IS NULL AND sent_at IS NULL)
    OR (lifecycle_status = 'issued' AND issued_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_reason IS NULL)
    OR (lifecycle_status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL AND length(trim(cancelled_reason)) > 0 AND paid_paise = 0))
);
ALTER TABLE public.invoice_items ADD CONSTRAINT item_financial_checks CHECK (
  unit_price_paise >= 0 AND discount_paise >= 0 AND taxable_paise >= 0 AND cgst_paise >= 0 AND sgst_paise >= 0 AND igst_paise >= 0 AND line_total_paise >= 0
  AND greatest(unit_price_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,line_total_paise) <= 9007199254740991
  AND gst_rate_bps BETWEEN 0 AND 10000
  AND discount_paise::numeric <= round(quantity * unit_price_paise::numeric)
  AND taxable_paise::numeric = round(quantity * unit_price_paise::numeric) - discount_paise::numeric
  AND (cgst_paise::numeric + sgst_paise::numeric + igst_paise::numeric) = round(taxable_paise::numeric * gst_rate_bps::numeric / 10000)
  AND line_total_paise::numeric = taxable_paise::numeric + cgst_paise::numeric + sgst_paise::numeric + igst_paise::numeric
);
-- Lock the parent before changing a line, so issue and line edits cannot race.
CREATE FUNCTION paidflow_private.lock_draft_invoice_for_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b uuid; i uuid; s text;
BEGIN
  b := CASE WHEN TG_OP = 'DELETE' THEN OLD.business_id ELSE NEW.business_id END;
  i := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF TG_OP = 'UPDATE' AND (NEW.business_id,NEW.invoice_id) IS DISTINCT FROM (OLD.business_id,OLD.invoice_id) THEN RAISE EXCEPTION 'Cannot move invoice items'; END IF;
  IF current_setting('role', true) = 'authenticated' AND NOT paidflow_private.has_business_role(b, ARRAY['owner','admin','manager']::public.business_role[]) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  SELECT lifecycle_status INTO s FROM public.invoices WHERE business_id = b AND id = i FOR UPDATE;
  IF NOT FOUND OR s <> 'draft' THEN RAISE EXCEPTION 'Invoice is not an editable draft'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.lock_draft_invoice_for_item() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invoice_item_draft_lock BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION paidflow_private.lock_draft_invoice_for_item();

-- Issuance is the boundary between a draft and an immutable financial snapshot.
CREATE FUNCTION public.issue_invoice(p_business_id uuid, p_invoice_id uuid) RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv public.invoices; n bigint; gross numeric; discounts numeric; taxable numeric; cgst numeric; sgst numeric; igst numeric; bad bigint;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin','manager']::public.business_role[]);
  SELECT * INTO inv FROM public.invoices WHERE business_id = p_business_id AND id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF inv.lifecycle_status = 'issued' THEN RETURN inv; END IF;
  IF inv.lifecycle_status <> 'draft' THEN RAISE EXCEPTION 'Only drafts can be issued'; END IF;
  SELECT count(*), coalesce(sum(round(quantity * unit_price_paise::numeric)),0), coalesce(sum(discount_paise),0), coalesce(sum(taxable_paise),0), coalesce(sum(cgst_paise),0), coalesce(sum(sgst_paise),0), coalesce(sum(igst_paise),0),
    count(*) FILTER (WHERE CASE inv.supply_type WHEN 'non_gst' THEN gst_rate_bps <> 0 OR cgst_paise <> 0 OR sgst_paise <> 0 OR igst_paise <> 0 WHEN 'intra_state' THEN igst_paise <> 0 OR abs(cgst_paise::numeric - sgst_paise::numeric) > 1 ELSE cgst_paise <> 0 OR sgst_paise <> 0 END)
  INTO n,gross,discounts,taxable,cgst,sgst,igst,bad FROM public.invoice_items WHERE business_id = p_business_id AND invoice_id = p_invoice_id;
  IF n = 0 OR inv.total_paise <= 0 OR bad > 0 OR (gross,discounts,taxable,cgst,sgst,igst) IS DISTINCT FROM (inv.subtotal_paise::numeric,inv.discount_paise::numeric,inv.taxable_paise::numeric,inv.cgst_paise::numeric,inv.sgst_paise::numeric,inv.igst_paise::numeric) THEN RAISE EXCEPTION 'Invoice lines, totals, or tax distribution are invalid'; END IF;
  IF inv.is_gst_invoice AND NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.is_gst_registered AND b.state_code = inv.origin_state_code) THEN RAISE EXCEPTION 'GST invoice requires registered business and matching origin state'; END IF;
  UPDATE public.invoices SET lifecycle_status = 'issued', issued_at = clock_timestamp(), updated_at = clock_timestamp() WHERE business_id = p_business_id AND id = p_invoice_id RETURNING * INTO inv;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public.issue_invoice(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid,uuid) TO authenticated;
