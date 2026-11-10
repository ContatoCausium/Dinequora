\set ON_ERROR_STOP on
-- Regression gate for 0022 on whatever data the database holds (the seeded QA tenant in CI, a copy
-- of the demo locally). For every member and every catalog permission:
--   * own organization, with no store and with each of its stores: has_permission and
--     has_any_permission give exactly the 0019 answer;
--   * every store of ANOTHER organization: refused;
--   * orgs_with_any_permission and my_permissions give the 0019 answer.
-- Permissions mapped to a feature are excluded from the comparison (their answer is meant to
-- change). Read-only: one transaction, rolled back.
BEGIN;
CREATE TEMP TABLE eq_result(kind text, checked bigint, differ bigint) ON COMMIT DROP;
DO $$
DECLARE r record; n bigint; d bigint;
BEGIN
  FOR r IN SELECT m.user_id, m.org_id FROM public.organization_members m ORDER BY m.id LOOP
    PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);
    -- own organization (no store + each store): same answer as 0019
    SELECT count(*), count(*) FILTER (WHERE s.new_any IS DISTINCT FROM s.old OR s.new_one IS DISTINCT FROM s.old) INTO n, d FROM (
      SELECT public.has_permission(r.org_id, p, l) AS new_one,
             public.has_any_permission(r.org_id, ARRAY[p], l) AS new_any,
             (EXISTS (SELECT 1 FROM public.organization_members m2
                      WHERE m2.org_id = r.org_id AND m2.user_id = auth.uid()
                        AND (m2.role = 'owner' OR p = ANY(m2.effective_permissions)))
              AND (l IS NULL OR public.can_access_location(l))) AS old
      FROM unnest(public.permission_catalog()) p
      CROSS JOIN (SELECT NULL::uuid AS l UNION ALL SELECT id FROM public.locations WHERE org_id = r.org_id) ls
      WHERE NOT EXISTS (SELECT 1 FROM public.feature_permissions fp WHERE fp.permission = p)) s;
    INSERT INTO eq_result VALUES ('own organization', n, d);
    -- stores of other organizations: always refused
    SELECT count(*), count(*) FILTER (WHERE public.has_permission(r.org_id, p, l.id) OR public.has_any_permission(r.org_id, ARRAY[p], l.id)) INTO n, d
      FROM unnest(public.permission_catalog()) p CROSS JOIN public.locations l WHERE l.org_id <> r.org_id;
    INSERT INTO eq_result VALUES ('other organization store', n, d);
    -- RLS organization set, one permission at a time
    SELECT count(*), count(*) FILTER (WHERE s.new IS DISTINCT FROM s.old) INTO n, d FROM (
      SELECT (SELECT array_agg(o ORDER BY o) FROM public.orgs_with_any_permission(ARRAY[p]) o) AS new,
             (SELECT array_agg(m2.org_id ORDER BY m2.org_id) FROM public.organization_members m2
               WHERE m2.user_id = auth.uid() AND (m2.role = 'owner' OR m2.effective_permissions && ARRAY[p])) AS old
      FROM unnest(public.permission_catalog()) p
      WHERE NOT EXISTS (SELECT 1 FROM public.feature_permissions fp WHERE fp.permission = p)) s;
    INSERT INTO eq_result VALUES ('rls organizations', n, d);
    -- what the app shows
    SELECT 1, CASE WHEN public.my_permissions(r.org_id) IS DISTINCT FROM coalesce(
        (SELECT public.member_permissions(m2.id) FROM public.organization_members m2
          WHERE m2.org_id = r.org_id AND m2.user_id = auth.uid()), '{}'::text[]) THEN 1 ELSE 0 END INTO n, d;
    INSERT INTO eq_result VALUES ('my_permissions', n, d);
  END LOOP;
  IF EXISTS (SELECT 1 FROM eq_result WHERE differ > 0) THEN
    RAISE EXCEPTION 'FAIL permission equivalence: %', (SELECT string_agg(kind || ' ' || s || ' differ', ', ') FROM (
      SELECT kind, sum(differ) s FROM eq_result GROUP BY kind HAVING sum(differ) > 0) x);
  END IF;
END $$;
SELECT 'PASS permission equivalence: ' || string_agg(kind || ' ' || c || ' checked', ', ' ORDER BY kind)
       || ' | members ' || (SELECT count(*) FROM public.organization_members) || ', organizations '
       || (SELECT count(*) FROM public.organizations) || ', stores ' || (SELECT count(*) FROM public.locations)
  FROM (SELECT kind, sum(checked) c FROM eq_result GROUP BY kind) t;
ROLLBACK;
