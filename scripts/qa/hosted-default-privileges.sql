\set ON_ERROR_STOP on
-- Privilege model of the HOSTED projects (Client Preview, production), for a disposable test stack.
--
-- A stack started by the Supabase CLI gives the API roles (anon, authenticated, service_role) EVERY
-- privilege on every table, sequence and function that role postgres creates in schema public
-- (default privileges). The hosted projects created since 2026 do not: there only the explicit GRANTs
-- of the migrations count. Read from the hosted Client Preview (read-only audit of 2026-11-19,
-- pg_default_acl, role postgres, schema public):
--   functions  postgres=X                                   (no direct grant to the API roles; PUBLIC keeps
--              PostgreSQL's built-in EXECUTE on every function until a migration revokes it, in both models)
--   tables     postgres=arwdDxtm, anon/authenticated/service_role=Dxtm (TRUNCATE, REFERENCES, TRIGGER,
--              MAINTAIN only: no SELECT, INSERT, UPDATE or DELETE)
--   sequences  postgres=rwU                                 (nothing for the API roles)
-- The default privileges of role supabase_admin are the same on both sides and are not touched.
--
-- Applied by scripts/qa/security-suite.sh (step 0d, QA_PRIVILEGE_MODEL=hosted, the default) AFTER the
-- claim and BEFORE the migrations, so every object the migrations create gets exactly what it gets on
-- a hosted project. scripts/security/api_privileges.mjs then checks the result.
-- Target guard: stops here unless this database was marked disposable.
DO $$ BEGIN
  IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
    RAISE EXCEPTION 'refused by the target guard: not a disposable database (no dq_guard marker)';
  END IF;
  PERFORM dq_guard.attest('suite:privilege-model');
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','S'))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')) THEN
    RAISE EXCEPTION 'the privilege model is applied before the migrations: schema public already has objects';
  END IF;
END $$;

BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
COMMIT;
SELECT 'PASS hosted default privileges applied: ' || string_agg(d.defaclobjtype::text || '=' || array_to_string(d.defaclacl, ','), ' | ' ORDER BY d.defaclobjtype::text)
  FROM pg_default_acl d WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclrole = 'postgres'::regrole;
