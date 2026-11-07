-- Neon-compatible PostgreSQL adaptation of 20261107000500_indexes_and_audit.sql; original retained unchanged.
-- Local-only verification; not yet verified against Neon or Better Auth.
-- Atomic counter per workspace and April–March financial year; gaps are permitted.
CREATE FUNCTION public.allocate_invoice_number(p_business_id uuid, p_invoice_date date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE yr integer; seq bigint; prefix text;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin','manager']::public.business_role[]);
  IF p_invoice_date IS NULL THEN RAISE EXCEPTION 'Invoice date required' USING ERRCODE = '22023'; END IF;
  yr := extract(year FROM p_invoice_date)::integer - CASE WHEN extract(month FROM p_invoice_date) < 4 THEN 1 ELSE 0 END;
  IF yr NOT BETWEEN 1900 AND 9998 THEN RAISE EXCEPTION 'Financial year out of range' USING ERRCODE = '22023'; END IF;
  SELECT invoice_prefix INTO prefix FROM public.businesses WHERE id = p_business_id;
  INSERT INTO public.invoice_sequences AS seqs(business_id,fy_start_year,last_number) VALUES (p_business_id,yr,1)
  ON CONFLICT (business_id,fy_start_year) DO UPDATE SET last_number = seqs.last_number + 1 RETURNING last_number INTO seq;
  -- lpad alone truncates values above six digits; pad only while shorter.
  RETURN prefix || '-' || yr::text || '-' || right((yr + 1)::text,2) || '-' || CASE WHEN seq < 1000000 THEN lpad(seq::text,6,'0') ELSE seq::text END;
END $$;

-- Bootstrap owns the very first membership atomically. No unrestricted membership INSERT is granted.
CREATE FUNCTION public.create_business(p_name text, p_state_code text) RETURNS public.businesses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b public.businesses;
BEGIN
  IF paidflow_private.actor_id() IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.businesses(name,state_code,created_by) VALUES (p_name,p_state_code,paidflow_private.actor_id()) RETURNING * INTO b;
  INSERT INTO public.business_members(business_id,user_id,role) VALUES (b.id,paidflow_private.actor_id(),'owner');
  INSERT INTO public.subscriptions(business_id) VALUES (b.id);
  INSERT INTO public.notification_preferences(business_id) VALUES (b.id);
  RETURN b;
END $$;

-- No ownership transfer via this function. The caller cannot modify their own membership;
-- admins can manage only manager/accountant/viewer memberships. Lock the workspace row.
CREATE FUNCTION public.set_member_access(p_business_id uuid, p_user_id uuid, p_role public.business_role, p_status public.member_status) RETURNS public.business_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_role public.business_role; target public.business_members;
BEGIN
  IF paidflow_private.actor_id() IS NULL OR p_role IS NULL OR p_status IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT paidflow_private.has_business_role(p_business_id, ARRAY['owner','admin']::public.business_role[]) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.businesses WHERE id = p_business_id FOR NO KEY UPDATE;
  SELECT role INTO actor_role FROM public.business_members WHERE business_id = p_business_id AND user_id = paidflow_private.actor_id() AND status = 'active' FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner','admin') OR p_user_id = paidflow_private.actor_id() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO target FROM public.business_members WHERE business_id = p_business_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
  IF target.role = 'owner' OR p_role = 'owner' OR (actor_role = 'admin' AND (target.role = 'admin' OR p_role = 'admin')) THEN RAISE EXCEPTION 'Cannot modify privileged membership' USING ERRCODE = '42501'; END IF;
  UPDATE public.business_members SET role = p_role, status = p_status WHERE id = target.id RETURNING * INTO target;
  RETURN target;
END $$;
CREATE FUNCTION public.create_business_invitation(p_business_id uuid, p_email text, p_role public.business_role, p_token_hash text, p_expires_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_role public.business_role; invitation_id uuid;
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id, ARRAY['owner','admin']::public.business_role[]);
  SELECT role INTO actor_role FROM public.business_members WHERE business_id = p_business_id AND user_id = paidflow_private.actor_id() AND status = 'active';
  IF actor_role IS NULL OR actor_role NOT IN ('owner','admin') OR p_role IS NULL OR p_role = 'owner' OR (actor_role = 'admin' AND p_role = 'admin') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF p_email IS NULL OR length(trim(p_email)) < 3 OR p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.business_invitations(business_id,email,role,token_hash,invited_by,expires_at) VALUES (p_business_id,lower(trim(p_email)),p_role,p_token_hash,paidflow_private.actor_id(),p_expires_at) RETURNING id INTO invitation_id;
  RETURN invitation_id;
END $$;
REVOKE ALL ON FUNCTION public.allocate_invoice_number(uuid,date), public.create_business(text,text), public.set_member_access(uuid,uuid,public.business_role,public.member_status), public.create_business_invitation(uuid,text,public.business_role,text,timestamptz) FROM PUBLIC, paidflow_runtime;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(uuid,date), public.create_business(text,text), public.set_member_access(uuid,uuid,public.business_role,public.member_status), public.create_business_invitation(uuid,text,public.business_role,text,timestamptz) TO paidflow_runtime;

CREATE FUNCTION paidflow_private.audit_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b uuid; entity uuid; event text; entity_name text; safe_metadata jsonb := '{}'::jsonb;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN b := NEW.id; entity := NEW.id; entity_name := 'business'; event := 'business.created';
  ELSIF TG_TABLE_NAME = 'business_members' THEN b := NEW.business_id; entity := NEW.id; entity_name := 'member'; event := 'member.access_changed'; safe_metadata := jsonb_build_object('role',NEW.role,'status',NEW.status);
  ELSIF TG_TABLE_NAME = 'business_invitations' THEN b := NEW.business_id; entity := NEW.id; entity_name := 'invitation'; event := 'member.invited'; safe_metadata := jsonb_build_object('role',NEW.role);
  ELSIF TG_TABLE_NAME = 'customers' THEN b := NEW.business_id; entity := NEW.id; entity_name := 'customer'; event := 'customer.created';
  ELSIF TG_TABLE_NAME = 'invoices' THEN b := NEW.business_id; entity := NEW.id; entity_name := 'invoice'; event := CASE WHEN TG_OP = 'INSERT' THEN 'invoice.created' ELSE 'invoice.issued' END;
  ELSIF TG_TABLE_NAME = 'documents' THEN b := NEW.business_id; entity := NEW.id; entity_name := 'document'; event := 'document.registered'; safe_metadata := jsonb_build_object('category',NEW.category);
  ELSE RAISE EXCEPTION 'Unsupported audit source'; END IF;
  INSERT INTO public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata) VALUES (b,paidflow_private.actor_id(),entity_name,entity,event,safe_metadata);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.audit_event() FROM PUBLIC, paidflow_runtime;
CREATE TRIGGER audit_business_created AFTER INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION paidflow_private.audit_event();
CREATE TRIGGER audit_member_access AFTER UPDATE OF role,status ON public.business_members FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION paidflow_private.audit_event();
CREATE TRIGGER audit_invitation AFTER INSERT ON public.business_invitations FOR EACH ROW EXECUTE FUNCTION paidflow_private.audit_event();
CREATE TRIGGER audit_customer_created AFTER INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION paidflow_private.audit_event();
CREATE TRIGGER audit_invoice_created AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION paidflow_private.audit_event();
CREATE TRIGGER audit_invoice_issued AFTER UPDATE OF lifecycle_status ON public.invoices FOR EACH ROW WHEN (OLD.lifecycle_status = 'draft' AND NEW.lifecycle_status = 'issued') EXECUTE FUNCTION paidflow_private.audit_event();
CREATE TRIGGER audit_document_uploaded AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION paidflow_private.audit_event();
-- Download is a future server-authorized storage operation, not falsely logged on metadata SELECT.

-- Tenant-scoped access paths. Existing unique constraints already index business/id and business/invoice_number.
CREATE INDEX members_user_active_idx ON public.business_members(user_id,business_id) WHERE status = 'active';
CREATE INDEX invitations_business_created_idx ON public.business_invitations(business_id,created_at DESC);
CREATE INDEX customers_business_name_idx ON public.customers(business_id,name) WHERE NOT is_archived;
CREATE INDEX invoices_business_due_idx ON public.invoices(business_id,due_date) WHERE lifecycle_status = 'issued' AND NOT is_archived;
CREATE INDEX invoices_business_customer_date_idx ON public.invoices(business_id,customer_id,invoice_date DESC);
CREATE INDEX invoices_business_lifecycle_fy_idx ON public.invoices(business_id,lifecycle_status,fy_start_year);
CREATE INDEX items_invoice_order_idx ON public.invoice_items(business_id,invoice_id,sort_order);
CREATE INDEX payments_invoice_recorded_idx ON public.payments(business_id,invoice_id) INCLUDE (amount_paise) WHERE status = 'recorded';
CREATE INDEX payments_business_date_idx ON public.payments(business_id,payment_date DESC);
CREATE INDEX commitments_business_due_idx ON public.payment_commitments(business_id,promised_date) WHERE status = 'pending';
CREATE INDEX reminders_business_status_date_idx ON public.reminders(business_id,status,next_followup_date);
CREATE INDEX reminder_logs_invoice_created_idx ON public.reminder_logs(business_id,invoice_id,created_at DESC);
CREATE INDEX documents_invoice_category_idx ON public.documents(business_id,invoice_id,category,created_at DESC);
CREATE INDEX extractions_business_status_idx ON public.document_extractions(business_id,status,created_at DESC);
CREATE INDEX activity_business_created_idx ON public.activity_logs(business_id,created_at DESC);
