-- Fail closed until a separately approved proof-verification pipeline exists.
-- This migration intentionally blocks every new non-NULL proof attachment. It
-- does not assert that historical proofs are safe or authorize object access.
-- Existing same-key record_payment replays and context-unchanged updates (e.g.
-- voids) do not create a new proof association and remain available.
-- Runtime roles cannot write payments directly in the preceding migrations;
-- this trigger also protects INSERTs performed by security-definer RPCs.
-- Privileged owners/superusers can disable triggers or use replication mode;
-- review those powers and hosted schema drift before any deployment.
CREATE FUNCTION paidflow_private.deny_payment_proof_attachment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.proof_document_id IS NOT NULL THEN
      RAISE EXCEPTION 'Payment proof attachment is unavailable' USING ERRCODE = '23514';
    END IF;
  ELSIF (OLD.proof_document_id IS NOT NULL OR NEW.proof_document_id IS NOT NULL)
    AND (OLD.id, OLD.business_id, OLD.invoice_id, OLD.customer_id, OLD.proof_document_id)
        IS DISTINCT FROM
        (NEW.id, NEW.business_id, NEW.invoice_id, NEW.customer_id, NEW.proof_document_id) THEN
    RAISE EXCEPTION 'Payment proof attachment is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.deny_payment_proof_attachment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER deny_payment_proof_attachment
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION paidflow_private.deny_payment_proof_attachment();

-- This candidate index makes historical-reference checks bounded by matching
-- rows rather than a full ledger scan. CREATE INDEX is non-concurrent here;
-- a real rollout needs a separately reviewed locking and deployment plan.
CREATE INDEX payment_proof_reference_hold_idx
ON public.payments (business_id, proof_document_id)
WHERE proof_document_id IS NOT NULL;

-- A document can also point to a payment directly, independently of
-- payments.proof_document_id. Close that association path while the hold is
-- active and freeze the metadata of historical documents linked in either
-- direction. This does not protect object bytes or make them safe to view.
-- The lookup must see payment links regardless of the caller's RLS view; the
-- definer is the migration owner and the lookup is fully schema-qualified.
-- The candidate needs owner/privilege and indexing review before any rollout.
CREATE FUNCTION paidflow_private.deny_document_payment_association() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE historical_link boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Payment document association is unavailable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  historical_link := OLD.payment_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.business_id = OLD.business_id AND p.proof_document_id = OLD.id
  );
  IF TG_OP = 'DELETE' THEN
    IF historical_link THEN
      RAISE EXCEPTION 'Historical payment document is held' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (historical_link AND NEW IS DISTINCT FROM OLD)
     OR (OLD.payment_id IS NULL AND NEW.payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Payment document association is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.deny_document_payment_association() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER deny_document_payment_association
BEFORE INSERT OR UPDATE OR DELETE ON public.documents
FOR EACH ROW EXECUTE FUNCTION paidflow_private.deny_document_payment_association();
