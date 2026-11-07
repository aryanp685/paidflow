-- LOCAL TEST FOUNDATION ONLY. Run as the migration owner after the Step 2A baseline.
-- The auth service and application runtime are distinct unprivileged logins.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname='paidflow_auth_service';
  IF NOT FOUND OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR
     EXISTS (SELECT 1 FROM pg_catalog.pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreatedb OR p.rolcreaterole OR p.rolreplication) AND pg_catalog.pg_has_role('paidflow_auth_service',p.oid,'MEMBER')) THEN
    RAISE EXCEPTION 'paidflow_auth_service must be a restricted role';
  END IF;
  IF pg_catalog.pg_has_role('paidflow_auth_service','paidflow_runtime','MEMBER') OR pg_catalog.pg_has_role('paidflow_runtime','paidflow_auth_service','MEMBER') THEN
    RAISE EXCEPTION 'auth and runtime roles must not inherit one another';
  END IF;
END $$;
REVOKE ALL ON public."user", public."session", public."account", public."verification" FROM PUBLIC, paidflow_runtime, paidflow_auth_service;
GRANT USAGE ON SCHEMA public TO paidflow_auth_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user", public."session", public."account", public."verification" TO paidflow_auth_service;
-- Make the UUID mapping a database invariant. Deletion is deliberately blocked until
-- a safe account deletion/retention policy is designed; never silently delete history.
ALTER TABLE paidflow_identity.users ADD CONSTRAINT better_auth_identity_fk FOREIGN KEY (id) REFERENCES public."user"(id) ON DELETE RESTRICT;
CREATE FUNCTION paidflow_private.sync_better_auth_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO paidflow_identity.users(id,email_verified_at)
    VALUES(NEW.id,CASE WHEN NEW."emailVerified" THEN pg_catalog.clock_timestamp() ELSE NULL END);
  ELSE
    UPDATE paidflow_identity.users SET email_verified_at=CASE WHEN NEW."emailVerified" THEN COALESCE(email_verified_at,pg_catalog.clock_timestamp()) ELSE NULL END WHERE id=NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Better Auth identity mapping missing'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION paidflow_private.sync_better_auth_identity() FROM PUBLIC,paidflow_runtime,paidflow_auth_service;
CREATE TRIGGER better_auth_identity_sync AFTER INSERT OR UPDATE OF "emailVerified" ON public."user" FOR EACH ROW EXECUTE FUNCTION paidflow_private.sync_better_auth_identity();
