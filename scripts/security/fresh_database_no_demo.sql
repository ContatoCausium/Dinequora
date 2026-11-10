\set ON_ERROR_STOP on
-- Fresh-database check (disposable QA/CI database only). Runs right after every migration has been
-- applied to a brand-new database, before any fixture or seed: structural migrations must not leave
-- fictional tenants behind (migration 0021 removes the 0000 seeds on a database without users).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'FAIL fresh-database check must run before any user exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE is_demo) THEN
    RAISE EXCEPTION 'FAIL a new database contains fictional organizations: %',
      (SELECT string_agg(slug, ', ' ORDER BY slug) FROM public.organizations WHERE is_demo);
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug IN ('org_marao', 'org_harbor'))
     OR EXISTS (SELECT 1 FROM public.locations
                 WHERE slug IN ('loc_marao_framingham', 'loc_marao_2', 'loc_marao_3', 'loc_harbor_1')) THEN
    RAISE EXCEPTION 'FAIL the 0000 seed organizations or stores are still present';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations) OR EXISTS (SELECT 1 FROM public.subscriptions) THEN
    RAISE EXCEPTION 'FAIL a new database must start without organizations or subscriptions';
  END IF;
END $$;
SELECT ' PASS: new database after all migrations: no organizations, no fictional tenants, no seed stores';
