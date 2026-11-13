-- CLIENT PREVIEW identity marker. Run ONCE, by the operator, on the hosted client-preview project
-- right after its migrations, and never anywhere else:
--
--   psql "<direct connection string of the client-preview project>" \
--        -v project_ref=<20-character project ref> -f scripts/preview/sql/client-preview-identity.sql
--
-- It is not a migration (it lives outside drizzle/migrations and never reaches QA or production).
-- It creates dq_preview.marker (the project ref this database was marked for) and
-- public.client_preview_identity(), executable by service_role only, which
-- scripts/preview/preview-target.mjs reads before any seed or reset.
--
-- Refuses before writing anything when: the ref is missing or malformed, the migrations are not
-- applied, the database is already marked, it is a local disposable stack (dq_guard), or it holds
-- real data (non-demo organizations, accounts outside .test/.example/.invalid, platform roles).
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('dq_preview.project_ref', :'project_ref', true);
DO $$
DECLARE
  ref text := current_setting('dq_preview.project_ref', true);
BEGIN
  IF ref IS NULL OR ref !~ '^[a-z0-9]{20}$' THEN
    RAISE EXCEPTION 'refused: project_ref must be the 20-character reference of the client-preview project';
  END IF;
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
             WHERE email IS NULL OR lower(email) !~ '\.(test|example|invalid)$') THEN
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

CREATE FUNCTION public.client_preview_identity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'label', m.label,
    'project_ref', m.project_ref,
    'marker_version', 1,
    'marked_at', m.marked_at,
    'non_demo_organizations', (SELECT count(*) FROM public.organizations o WHERE NOT o.is_demo),
    'non_test_users', (SELECT count(*) FROM auth.users u
                       WHERE u.email IS NULL OR lower(u.email) !~ '\.(test|example|invalid)$'),
    'platform_roles', (SELECT count(*) FROM public.user_roles))
  FROM dq_preview.marker m
$$;
REVOKE ALL ON FUNCTION public.client_preview_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_preview_identity() TO service_role;
COMMIT;
