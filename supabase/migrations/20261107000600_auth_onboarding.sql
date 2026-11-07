-- Step 1C. Append-only: previous migrations are unchanged. No service credentials needed.
ALTER TABLE public.businesses ADD COLUMN district text, ADD COLUMN udyam_number text,
  ADD COLUMN onboarding_key uuid;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_udyam_format CHECK (udyam_number IS NULL OR udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$');
ALTER TABLE public.businesses ADD CONSTRAINT businesses_onboarding_idempotency UNIQUE (created_by,onboarding_key);
-- GSTIN is optional even for a registered business; it is not a verification of registration.
ALTER TABLE public.businesses DROP CONSTRAINT businesses_check;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_optional_gstin CHECK (is_gst_registered OR gstin IS NULL);
ALTER TABLE public.profiles ADD COLUMN default_business_id uuid;
ALTER TABLE public.profiles ADD CONSTRAINT profile_default_membership_fk FOREIGN KEY(default_business_id,id) REFERENCES public.business_members(business_id,user_id);
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name,preferred_language) ON public.profiles TO authenticated;
-- The legacy minimal bootstrap lacks idempotency/default selection. Retain for migration
-- compatibility, but do not expose it as a browser RPC.
REVOKE EXECUTE ON FUNCTION public.create_business(text,text) FROM authenticated;

CREATE FUNCTION paidflow_private.create_profile_for_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  INSERT INTO public.profiles(id) VALUES (NEW.id) ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.create_profile_for_auth_user() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER paidflow_auth_user_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION paidflow_private.create_profile_for_auth_user();
INSERT INTO public.profiles(id) SELECT id FROM auth.users ON CONFLICT (id) DO NOTHING;

-- This extra guard protects tax invoices when registration was selected without a GSTIN.
CREATE FUNCTION paidflow_private.require_gstin_for_issued_invoice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.lifecycle_status='issued' AND NEW.is_gst_invoice AND NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=NEW.business_id AND b.is_gst_registered AND b.gstin IS NOT NULL) THEN
    RAISE EXCEPTION 'A GSTIN is required before issuing a GST invoice';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.require_gstin_for_issued_invoice() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invoice_gstin_before_issue BEFORE INSERT OR UPDATE OF lifecycle_status ON public.invoices FOR EACH ROW EXECUTE FUNCTION paidflow_private.require_gstin_for_issued_invoice();

CREATE FUNCTION public.onboard_business(p_key uuid, p_name text, p_legal_name text, p_business_type text, p_address text, p_city text, p_district text, p_state_code text, p_pincode text, p_is_gst_registered boolean, p_gstin text, p_udyam_number text, p_invoice_prefix text, p_terms_days integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE uid uuid := auth.uid(); b public.businesses;
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
  IF p_key IS NULL OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 200 OR p_business_type IS NULL OR p_business_type NOT IN ('manufacturer','wholesaler','distributor','service','agency','other') OR p_address IS NULL OR length(trim(p_address)) NOT BETWEEN 1 AND 300 OR p_city IS NULL OR length(trim(p_city)) NOT BETWEEN 1 AND 100 OR p_district IS NULL OR length(trim(p_district)) NOT BETWEEN 1 AND 100 OR p_state_code IS NULL OR p_state_code NOT IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','28','29','30','31','32','33','34','35','36','37','38') OR p_pincode IS NULL OR p_pincode !~ '^[0-9]{6}$' OR p_is_gst_registered IS NULL OR p_invoice_prefix IS NULL OR p_invoice_prefix !~ '^[A-Z0-9]{1,10}$' OR p_terms_days IS NULL OR p_terms_days NOT BETWEEN 0 AND 3650 OR length(coalesce(p_legal_name,'')) > 200 OR (p_gstin IS NOT NULL AND (p_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' OR left(p_gstin,2) <> p_state_code OR NOT p_is_gst_registered)) OR (p_udyam_number IS NOT NULL AND p_udyam_number !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$') THEN
    RAISE EXCEPTION 'Invalid business information' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  SELECT * INTO b FROM public.businesses WHERE created_by=uid AND onboarding_key=p_key;
  IF FOUND THEN
    IF (b.name,b.legal_name,b.business_type,b.address_line1,b.city,b.district,b.state_code,b.pincode,b.is_gst_registered,b.gstin,b.udyam_number,b.invoice_prefix,b.default_payment_terms_days) IS DISTINCT FROM (trim(p_name),nullif(trim(p_legal_name),''),p_business_type,trim(p_address),trim(p_city),trim(p_district),p_state_code,p_pincode,p_is_gst_registered,p_gstin,p_udyam_number,p_invoice_prefix,p_terms_days) THEN RAISE EXCEPTION 'Idempotency key reused with different business details' USING ERRCODE='22023'; END IF;
    IF NOT paidflow_private.has_business_role(b.id,ARRAY['owner']::public.business_role[]) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
    RETURN b.id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_members m WHERE m.user_id=uid AND m.status='active') THEN RAISE EXCEPTION 'Initial workspace already exists' USING ERRCODE='23505'; END IF;
  INSERT INTO public.profiles(id) VALUES(uid) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.businesses(name,legal_name,business_type,address_line1,city,district,state_code,pincode,is_gst_registered,gstin,udyam_number,invoice_prefix,default_payment_terms_days,created_by,onboarding_key)
  VALUES(trim(p_name),nullif(trim(p_legal_name),''),p_business_type,trim(p_address),trim(p_city),trim(p_district),p_state_code,p_pincode,p_is_gst_registered,p_gstin,p_udyam_number,p_invoice_prefix,p_terms_days,uid,p_key) RETURNING * INTO b;
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(b.id,uid,'owner');
  INSERT INTO public.subscriptions(business_id) VALUES(b.id);
  INSERT INTO public.notification_preferences(business_id) VALUES(b.id);
  UPDATE public.profiles SET default_business_id=b.id,updated_at=clock_timestamp() WHERE id=uid;
  RETURN b.id;
END $$;
CREATE FUNCTION public.set_default_business(p_business_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM paidflow_private.require_business_role(p_business_id,ARRAY['owner','admin','manager','accountant','viewer']::public.business_role[]);
  UPDATE public.profiles SET default_business_id=p_business_id,updated_at=clock_timestamp() WHERE id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found' USING ERRCODE='P0002'; END IF;
  RETURN p_business_id;
END $$;
REVOKE ALL ON FUNCTION public.onboard_business(uuid,text,text,text,text,text,text,text,text,boolean,text,text,text,integer), public.set_default_business(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_business(uuid,text,text,text,text,text,text,text,text,boolean,text,text,text,integer), public.set_default_business(uuid) TO authenticated;
