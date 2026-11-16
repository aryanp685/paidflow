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
