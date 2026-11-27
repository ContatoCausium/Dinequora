-- CLIENT PREVIEW identity marker (version 2). Run ONCE, by the operator, on the hosted client-preview
-- project right after its migrations, and never anywhere else:
--
--   PREVIEW_DB_OPERATION=mark node scripts/preview/hosted-db.mjs      (checked target; see its header)
--
-- or, with psql:
--
--   psql "<session-pooler connection string of the client-preview project>" \
--        -v project_ref=<20-character project ref> \
--        -v personal_owners=<the operator's PREVIEW_PERSONAL_OWNERS, comma-separated, at most 2> \
--        -f scripts/preview/sql/client-preview-identity.sql
--
-- It is not a migration (it lives outside drizzle/migrations and never reaches QA or production).
-- It creates dq_preview.marker (the project ref this database was marked for),
-- dq_preview.personal_accounts (the personal owners: at most two real people, fixed here and not
-- writable through the API) and public.client_preview_identity(), executable by service_role only,
-- which scripts/preview/preview-target.mjs reads before any seed, reset, verification or access link.
-- The addresses come from the operator's secrets file; they are never part of the repository.
--
-- Refuses before writing anything when: the ref is missing or malformed, the personal-owner list is
-- malformed (more than two, duplicates, not an address, a reserved test domain), the migrations are
-- not applied, the database is already marked, it is a local disposable stack (dq_guard), or it holds
-- real data (non-demo organizations, any account outside .test/.example/.invalid/.localhost, platform
-- roles).
\set ON_ERROR_STOP on
BEGIN;
-- Session settings for the checks below. The query shows only a boolean, so psql never echoes the
-- personal addresses (a WHERE-false query would be optimized away without running set_config).
SELECT set_config('dq_preview.project_ref', :'project_ref', true) IS NOT NULL
   AND set_config('dq_preview.personal_owners', :'personal_owners', true) IS NOT NULL
   AS settings_applied;
DO $$
DECLARE
  ref text := current_setting('dq_preview.project_ref', true);
  owners text[] := ARRAY(
    SELECT lower(trim(x)) FROM unnest(string_to_array(current_setting('dq_preview.personal_owners', true), ',')) x
    WHERE trim(x) <> '');
  e text;
BEGIN
  IF ref IS NULL OR ref !~ '^[a-z0-9]{20}$' THEN
    RAISE EXCEPTION 'refused: project_ref must be the 20-character reference of the client-preview project';
  END IF;
  IF current_setting('dq_preview.personal_owners', true) IS NULL
     OR current_setting('dq_preview.personal_owners', true) = ':personal_owners' THEN
    RAISE EXCEPTION 'refused: pass -v personal_owners=... (comma-separated, may be empty)';
  END IF;
  IF cardinality(owners) > 2 THEN
    RAISE EXCEPTION 'refused: at most two personal owners';
  END IF;
  IF cardinality(owners) <> (SELECT count(DISTINCT x) FROM unnest(owners) x) THEN
    RAISE EXCEPTION 'refused: duplicate personal owner';
  END IF;
  FOREACH e IN ARRAY owners LOOP
    IF e !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'refused: a personal owner is not an e-mail address';
    END IF;
    IF e ~ '\.(test|example|invalid|localhost)$' THEN
      RAISE EXCEPTION 'refused: a personal owner uses a reserved test domain';
    END IF;
  END LOOP;
  IF to_regclass('public.organizations') IS NULL OR to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'refused: apply the migrations before marking the database';
  END IF;
  IF to_regnamespace('dq_preview') IS NOT NULL THEN
    RAISE EXCEPTION 'refused: this database is already marked (the marker is never rewritten)';
  END IF;
  IF to_regnamespace('dq_guard') IS NOT NULL THEN
    RAISE EXCEPTION 'refused: this is a local disposable stack (dq_guard), not the hosted client preview';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE NOT is_demo) THEN
    RAISE EXCEPTION 'refused: the database has non-demo organizations (real data)';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users
             WHERE email IS NULL OR lower(email) !~ '\.(test|example|invalid|localhost)$') THEN
    RAISE EXCEPTION 'refused: the database has accounts outside the reserved test domains';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles) THEN
    RAISE EXCEPTION 'refused: the database has platform roles (the client preview has no platform admin)';
  END IF;
END $$;

CREATE SCHEMA dq_preview;
REVOKE ALL ON SCHEMA dq_preview FROM PUBLIC, anon, authenticated;

CREATE TABLE dq_preview.marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  label text NOT NULL CHECK (label = 'client-preview'),
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$'),
  marked_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON dq_preview.marker FROM PUBLIC, anon, authenticated;
INSERT INTO dq_preview.marker (label, project_ref)
VALUES ('client-preview', current_setting('dq_preview.project_ref'));

CREATE TABLE dq_preview.personal_accounts (
  email text PRIMARY KEY
    CHECK (email = lower(email) AND email !~ '\.(test|example|invalid|localhost)$'),
  fixed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON dq_preview.personal_accounts FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO dq_preview.personal_accounts (email)
SELECT DISTINCT lower(trim(x))
FROM unnest(string_to_array(current_setting('dq_preview.personal_owners'), ',')) x
WHERE trim(x) <> '';
-- Fixed list: nothing may add a third person later (the table is not reachable through the API and
-- this trigger refuses any later insert or update, even by the table owner).
CREATE FUNCTION dq_preview.personal_accounts_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'refused: the personal-owner list is fixed when the database is marked';
END $$;
CREATE TRIGGER personal_accounts_fixed BEFORE INSERT OR UPDATE ON dq_preview.personal_accounts
  FOR EACH ROW EXECUTE FUNCTION dq_preview.personal_accounts_fixed();

CREATE FUNCTION public.client_preview_identity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'label', m.label,
    'project_ref', m.project_ref,
    'marker_version', 2,
    'marked_at', m.marked_at,
    'non_demo_organizations', (SELECT count(*) FROM public.organizations o WHERE NOT o.is_demo),
    -- real accounts other than the fixed personal owners (must be 0)
    'non_test_users', (SELECT count(*) FROM auth.users u
                       WHERE (u.email IS NULL OR lower(u.email) !~ '\.(test|example|invalid|localhost)$')
                         AND lower(coalesce(u.email, '')) NOT IN (SELECT p.email FROM dq_preview.personal_accounts p)),
    'personal_accounts', (SELECT coalesce(jsonb_agg(p.email ORDER BY p.email), '[]'::jsonb)
                          FROM dq_preview.personal_accounts p),
    'platform_roles', (SELECT count(*) FROM public.user_roles))
  FROM dq_preview.marker m
$$;
REVOKE ALL ON FUNCTION public.client_preview_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_preview_identity() TO service_role;
COMMIT;
