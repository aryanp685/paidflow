-- Local candidate, not yet deployed. Keep all NEW issuance closed until
-- financial/GST requirements and real-provider security checks are approved.
-- Historical issued rows and idempotent issue_invoice replays remain intact.
-- This guard does not make existing issued invoices immutable, disable direct
-- admin bypass/trigger alteration, or prove GST compliance.
CREATE FUNCTION paidflow_private.hold_invoice_issuance() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status = 'issued' THEN
      RAISE EXCEPTION 'Invoice issuance is unavailable' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle_status = 'issued' AND OLD.lifecycle_status IS DISTINCT FROM 'issued' THEN
    RAISE EXCEPTION 'Invoice issuance is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.hold_invoice_issuance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hold_invoice_issuance BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION paidflow_private.hold_invoice_issuance();
