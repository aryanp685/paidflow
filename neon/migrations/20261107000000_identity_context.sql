-- PostgreSQL foundation only: provision roles outside migrations on a disposable cluster.
-- The migration owner must be isolated from the request runtime and able to bypass RLS.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'paidflow_runtime';
  IF NOT FOUND OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication THEN
    RAISE EXCEPTION 'paidflow_runtime must exist and be a restricted non-BYPASSRLS role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreatedb OR p.rolcreaterole OR p.rolreplication) AND pg_catalog.pg_has_role('paidflow_runtime',p.oid,'MEMBER')) THEN
    RAISE EXCEPTION 'paidflow_runtime must not be a member of privileged roles';
  END IF;
  IF current_user = 'paidflow_runtime' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles p WHERE p.rolname=current_user AND (p.rolsuper OR p.rolbypassrls)) THEN
    RAISE EXCEPTION 'Migration owner must be separate and have BYPASSRLS or superuser';
  END IF;
END $$;

CREATE SCHEMA paidflow_identity;
REVOKE ALL ON SCHEMA paidflow_identity FROM PUBLIC, paidflow_runtime;
-- Internal identity anchor, NOT a login or Better Auth schema. It is managed only by a
-- trusted identity integration. The future integration must atomically map verification.
CREATE TABLE paidflow_identity.users (
  id uuid PRIMARY KEY,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON paidflow_identity.users FROM PUBLIC, paidflow_runtime;

CREATE SCHEMA paidflow_private;
REVOKE ALL ON SCHEMA paidflow_private FROM PUBLIC, paidflow_runtime;
GRANT USAGE ON SCHEMA paidflow_private TO paidflow_runtime;
-- This setting is a trusted-server assertion, NOT authentication: never accept its value
-- directly from a browser. SET LOCAL inside one transaction; absent context fails closed.
CREATE FUNCTION paidflow_private.actor_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(pg_catalog.current_setting('paidflow.actor_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION paidflow_private.actor_id() FROM PUBLIC, paidflow_runtime;
GRANT EXECUTE ON FUNCTION paidflow_private.actor_id() TO paidflow_runtime;
