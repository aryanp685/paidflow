-- Helpers are owned by the migration role. FORCE RLS requires this role to bypass RLS;
-- otherwise membership lookup either recurses or fails closed. Verify, never assume.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Migration owner must have BYPASSRLS or be superuser for security-definer helpers';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS paidflow_private;
REVOKE ALL ON SCHEMA paidflow_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA paidflow_private TO authenticated;

CREATE FUNCTION paidflow_private.has_business_access(target_business_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id = target_business_id AND m.user_id = auth.uid() AND m.status = 'active')
$$;
CREATE FUNCTION paidflow_private.has_business_role(target_business_id uuid, allowed_roles public.business_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id = target_business_id AND m.user_id = auth.uid() AND m.status = 'active' AND m.role = ANY (allowed_roles))
$$;
REVOKE ALL ON FUNCTION paidflow_private.has_business_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION paidflow_private.has_business_role(uuid,public.business_role[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION paidflow_private.has_business_access(uuid), paidflow_private.has_business_role(uuid,public.business_role[]) TO authenticated;

-- Serialize privileged RPCs with membership suspension/demotion. The row lock lasts
-- to transaction end; only definer functions can invoke this helper.
CREATE FUNCTION paidflow_private.require_business_role(target_business_id uuid, allowed_roles public.business_role[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE member_role public.business_role;
BEGIN
  SELECT m.role INTO member_role FROM public.business_members m WHERE m.business_id = target_business_id AND m.user_id = auth.uid() AND m.status = 'active' FOR SHARE;
  IF member_role IS NULL OR NOT (member_role = ANY(allowed_roles)) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.require_business_role(uuid,public.business_role[]) FROM PUBLIC, anon, authenticated;

-- Revoke Supabase's broad default grants and rebuild an explicit least-privilege surface.
REVOKE ALL ON public.profiles, public.businesses, public.business_members, public.business_invitations, public.invoice_sequences, public.customers, public.invoices, public.invoice_items, public.payments, public.payment_commitments, public.reminders, public.reminder_logs, public.documents, public.document_extractions, public.activity_logs, public.subscriptions, public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','businesses','business_members','business_invitations','invoice_sequences','customers','invoices','invoice_items','payments','payment_commitments','reminders','reminder_logs','documents','document_extractions','activity_logs','subscriptions','notification_preferences'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

GRANT SELECT ON public.businesses, public.business_members, public.invoice_sequences, public.customers, public.invoices, public.invoice_items, public.payments, public.payment_commitments, public.reminders, public.reminder_logs, public.documents, public.document_extractions, public.activity_logs, public.subscriptions, public.notification_preferences TO authenticated;
-- Invitation token hashes are not exposed even to workspace administrators.
GRANT SELECT (id,business_id,email,role,invited_by,expires_at,accepted_at,created_at) ON public.business_invitations TO authenticated;
CREATE POLICY businesses_read ON public.businesses FOR SELECT TO authenticated USING (paidflow_private.has_business_access(id));
CREATE POLICY members_read ON public.business_members FOR SELECT TO authenticated USING (paidflow_private.has_business_access(business_id));
CREATE POLICY invitations_read ON public.business_invitations FOR SELECT TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin']::public.business_role[]));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_sequences','customers','invoices','invoice_items','payments','payment_commitments','reminders','reminder_logs','documents','document_extractions','activity_logs','subscriptions','notification_preferences'] LOOP
    EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING (paidflow_private.has_business_access(business_id))',t);
  END LOOP;
END $$;
-- Business and membership creation / changes are RPC-only. No client role can write audit or payment rows directly.
GRANT UPDATE (name,legal_name,business_type,is_gst_registered,gstin,address_line1,address_line2,city,state_code,pincode,invoice_prefix,upi_id,upi_payee_name,default_payment_terms_days) ON public.businesses TO authenticated;
CREATE POLICY business_update ON public.businesses FOR UPDATE TO authenticated USING (paidflow_private.has_business_role(id, ARRAY['owner','admin']::public.business_role[])) WITH CHECK (paidflow_private.has_business_role(id, ARRAY['owner','admin']::public.business_role[]));
GRANT INSERT ON public.customers TO authenticated;
GRANT UPDATE (name,contact_person,email,phone,whatsapp_phone,gstin,billing_address,shipping_address,state_code,payment_terms_days,credit_limit_paise,internal_notes,is_archived) ON public.customers TO authenticated;
CREATE POLICY customer_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()) AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
CREATE POLICY customer_update ON public.customers FOR UPDATE TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[])) WITH CHECK (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
GRANT INSERT (id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,is_gst_invoice,supply_type,origin_state_code,place_of_supply_state_code,po_number,po_date,delivery_challan_number,notes,terms,subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,shipping_paise,additional_charges_paise,round_off_paise,total_paise,balance_paise) ON public.invoices TO authenticated;
GRANT UPDATE (customer_id,invoice_number,invoice_date,due_date,fy_start_year,is_gst_invoice,supply_type,origin_state_code,place_of_supply_state_code,po_number,po_date,delivery_challan_number,notes,terms,subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,shipping_paise,additional_charges_paise,round_off_paise,total_paise,balance_paise) ON public.invoices TO authenticated;
CREATE POLICY invoices_insert ON public.invoices FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()) AND lifecycle_status = 'draft' AND paid_paise = 0 AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
CREATE POLICY invoices_update ON public.invoices FOR UPDATE TO authenticated USING (lifecycle_status = 'draft' AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[])) WITH CHECK (lifecycle_status = 'draft' AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
GRANT INSERT, DELETE ON public.invoice_items TO authenticated;
GRANT UPDATE (sort_order,description,hsn_sac_code,unit,quantity,unit_price_paise,discount_paise,taxable_paise,gst_rate_bps,cgst_paise,sgst_paise,igst_paise,line_total_paise) ON public.invoice_items TO authenticated;
CREATE POLICY items_insert ON public.invoice_items FOR INSERT TO authenticated WITH CHECK (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]) AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.business_id = invoice_items.business_id AND i.id = invoice_items.invoice_id AND i.lifecycle_status = 'draft'));
CREATE POLICY items_update ON public.invoice_items FOR UPDATE TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]) AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.business_id = invoice_items.business_id AND i.id = invoice_items.invoice_id AND i.lifecycle_status = 'draft')) WITH CHECK (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
CREATE POLICY items_delete ON public.invoice_items FOR DELETE TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]) AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.business_id = invoice_items.business_id AND i.id = invoice_items.invoice_id AND i.lifecycle_status = 'draft'));
GRANT INSERT ON public.documents TO authenticated;
CREATE POLICY documents_insert ON public.documents FOR INSERT TO authenticated WITH CHECK (uploaded_by = (SELECT auth.uid()) AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
GRANT INSERT ON public.reminder_logs TO authenticated;
CREATE POLICY reminder_logs_insert ON public.reminder_logs FOR INSERT TO authenticated WITH CHECK (acted_by = (SELECT auth.uid()) AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
GRANT INSERT ON public.reminders, public.payment_commitments TO authenticated;
GRANT UPDATE (category,tone,language,next_followup_date,status) ON public.reminders TO authenticated;
GRANT UPDATE (promised_date,promised_amount_paise,status,customer_note,resolved_at) ON public.payment_commitments TO authenticated;
CREATE POLICY reminders_insert ON public.reminders FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()) AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
CREATE POLICY reminders_update ON public.reminders FOR UPDATE TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[])) WITH CHECK (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
CREATE POLICY commitments_insert ON public.payment_commitments FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()) AND paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
CREATE POLICY commitments_update ON public.payment_commitments FOR UPDATE TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[])) WITH CHECK (paidflow_private.has_business_role(business_id, ARRAY['owner','admin','manager']::public.business_role[]));
GRANT UPDATE (default_reminder_language,default_reminder_tone,due_soon_days_before,enable_digest) ON public.notification_preferences TO authenticated;
CREATE POLICY preferences_update ON public.notification_preferences FOR UPDATE TO authenticated USING (paidflow_private.has_business_role(business_id, ARRAY['owner','admin']::public.business_role[])) WITH CHECK (paidflow_private.has_business_role(business_id, ARRAY['owner','admin']::public.business_role[]));
