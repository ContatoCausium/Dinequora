\set ON_ERROR_STOP on
-- Target guard (scripts/guard/target-guard.mjs): stops here, before any write, unless this database
-- was marked disposable (claim on a new, empty stack, or an explicit adopt of a copy).
DO $$ BEGIN
  IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
    RAISE EXCEPTION 'refused by the target guard: not a disposable database (no dq_guard marker)';
  END IF;
  PERFORM dq_guard.attest('fixture:permission_equivalence');
END $$;
-- Regression gate for 0022/0023 on whatever data the database holds (the seeded QA tenant in CI, a
-- copy of the demo locally). The permission checks are compared with an EXPECTED rule written here
-- independently (it does not call has_permission, can_access_location or the feature helpers):
--
--   allowed(user, org, permissions, store) =
--     the user is a member of org, holds at least one of the permissions (owner = all) whose
--     feature (if any) is enabled for org, and — with a store — the store belongs to org and the
--     user may use it (owner, or explicit store access).
--
-- For every user that is a member of an organization or a platform admin, against EVERY
-- organization (own and foreign) and every store (own and foreign, plus "no store"):
--   * has_permission(p) and has_any_permission([p]) for each catalog permission;
--   * has_any_permission with several permissions (sliding pairs, the whole catalog), an empty list
--     and NULL (always false);
--   * orgs_with_any_permission (RLS) for single permissions and pairs;
--   * my_permissions (what the app shows) = configured permissions whose feature is enabled.
-- Phase 1 uses the data as stored. Phase 2 (inside the same transaction) maps two permissions to
-- features, enables one of them for a single organization, and repeats everything.
-- Read-only: one transaction, rolled back.
BEGIN;
CREATE TEMP TABLE eq_result(phase text, kind text, role text, checked bigint, differ bigint) ON COMMIT DROP;

CREATE FUNCTION pg_temp.feature_ok(_org uuid, _perm text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.feature_permissions fp
    LEFT JOIN public.org_features f ON f.org_id = _org AND f.feature = fp.feature
    LEFT JOIN public.feature_catalog c ON c.key = fp.feature
    WHERE fp.permission = _perm AND NOT coalesce(f.enabled, c.default_enabled, false))
$$;
CREATE FUNCTION pg_temp.store_ok(_user uuid, _org uuid, _loc uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _loc IS NULL OR EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.organization_members m ON m.org_id = l.org_id AND m.user_id = _user
    WHERE l.id = _loc AND l.org_id = _org
      AND (m.role = 'owner' OR EXISTS (SELECT 1 FROM public.member_location_access a
                                       WHERE a.member_id = m.id AND a.location_id = l.id)))
$$;
CREATE FUNCTION pg_temp.allowed(_user uuid, _org uuid, _perms text[], _loc uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.organization_members m, unnest(coalesce(_perms, '{}'::text[])) p
      WHERE m.org_id = _org AND m.user_id = _user
        AND (m.role = 'owner' OR p = ANY(m.effective_permissions)) AND pg_temp.feature_ok(_org, p))
    AND pg_temp.store_ok(_user, _org, _loc)
$$;

CREATE FUNCTION pg_temp.run_phase(_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u record; o record; n bigint; d bigint; cat text[] := public.permission_catalog(); role_name text;
BEGIN
  FOR u IN
    SELECT DISTINCT x.user_id FROM (
      SELECT user_id FROM public.organization_members
      UNION SELECT user_id FROM public.user_roles WHERE role = 'platform_admin') x ORDER BY 1
  LOOP
    PERFORM set_config('request.jwt.claim.sub', u.user_id::text, true);
    FOR o IN SELECT id FROM public.organizations ORDER BY id LOOP
      role_name := coalesce(
        (SELECT m.role::text FROM public.organization_members m WHERE m.org_id = o.id AND m.user_id = u.user_id),
        CASE WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.user_id AND r.role = 'platform_admin')
             THEN 'platform admin (not a member)' ELSE 'not a member' END);

      -- single permission, every store of every organization + no store
      SELECT count(*), count(*) FILTER (WHERE s.got_one IS DISTINCT FROM s.want OR s.got_any IS DISTINCT FROM s.want) INTO n, d
      FROM (SELECT public.has_permission(o.id, p, l) AS got_one,
                   public.has_any_permission(o.id, ARRAY[p], l) AS got_any,
                   pg_temp.allowed(u.user_id, o.id, ARRAY[p], l) AS want
            FROM unnest(cat) p
            CROSS JOIN (SELECT NULL::uuid AS l UNION ALL SELECT id FROM public.locations) ls) s;
      INSERT INTO eq_result VALUES (_phase, 'single permission x store', role_name, n, d);

      -- several permissions: sliding pairs and the whole catalog; empty list and NULL are false
      SELECT count(*), count(*) FILTER (WHERE s.got IS DISTINCT FROM s.want) INTO n, d
      FROM (SELECT public.has_any_permission(o.id, ps, l) AS got, pg_temp.allowed(u.user_id, o.id, ps, l) AS want
            FROM (SELECT ARRAY[cat[i], cat[1 + i % array_length(cat, 1)]] AS ps FROM generate_series(1, array_length(cat, 1)) i
                  UNION ALL SELECT cat) perms
            CROSS JOIN (SELECT NULL::uuid AS l UNION ALL SELECT id FROM public.locations) ls) s;
      INSERT INTO eq_result VALUES (_phase, 'several permissions x store', role_name, n, d);
      SELECT count(*), count(*) FILTER (WHERE s.got IS DISTINCT FROM false) INTO n, d
      FROM (SELECT public.has_any_permission(o.id, ps, l) AS got
            FROM (SELECT '{}'::text[] AS ps UNION ALL SELECT NULL::text[]) perms
            CROSS JOIN (SELECT NULL::uuid AS l UNION ALL SELECT id FROM public.locations) ls) s;
      INSERT INTO eq_result VALUES (_phase, 'empty or NULL list', role_name, n, d);

      -- what the app shows
      SELECT 1, CASE WHEN public.my_permissions(o.id) IS DISTINCT FROM coalesce((
          SELECT array(SELECT p FROM unnest(public.member_permissions(m.id)) WITH ORDINALITY AS x(p, k)
                       WHERE pg_temp.feature_ok(o.id, p) ORDER BY k)
          FROM public.organization_members m WHERE m.org_id = o.id AND m.user_id = u.user_id), '{}'::text[])
        THEN 1 ELSE 0 END INTO n, d;
      INSERT INTO eq_result VALUES (_phase, 'my_permissions', role_name, n, d);
    END LOOP;

    -- RLS organization set, single permissions and pairs
    SELECT count(*), count(*) FILTER (WHERE s.got IS DISTINCT FROM s.want) INTO n, d
    FROM (SELECT (SELECT array_agg(x ORDER BY x) FROM public.orgs_with_any_permission(ps) x) AS got,
                 (SELECT array_agg(og.id ORDER BY og.id) FROM public.organizations og
                   WHERE pg_temp.allowed(u.user_id, og.id, ps, NULL)) AS want
          FROM (SELECT ARRAY[p] AS ps FROM unnest(cat) p
                UNION ALL SELECT ARRAY[cat[i], cat[1 + i % array_length(cat, 1)]] FROM generate_series(1, array_length(cat, 1)) i
                UNION ALL SELECT '{}'::text[]) perms) s;
    INSERT INTO eq_result VALUES (_phase, 'rls organizations', 'all roles', n, d);
  END LOOP;
END $$;

SELECT pg_temp.run_phase('1 stored data');

-- Phase 2: reports.view needs "integrations" (enabled for ONE organization only) and finance.view
-- needs "cash_management" (enabled nowhere).
INSERT INTO public.feature_permissions(permission, feature) VALUES ('reports.view', 'integrations'), ('finance.view', 'cash_management');
INSERT INTO public.org_features(org_id, feature, enabled) SELECT id, 'integrations', true FROM public.organizations ORDER BY id LIMIT 1;
SELECT pg_temp.run_phase('2 features mapped');
DO $$ BEGIN
  IF (SELECT count(*) FROM eq_result) = 0 THEN RAISE EXCEPTION 'FAIL permission equivalence: nothing checked'; END IF;
  IF EXISTS (SELECT 1 FROM eq_result WHERE differ > 0) THEN
    RAISE EXCEPTION 'FAIL permission equivalence: %', (SELECT string_agg(phase || ' / ' || kind || ' / ' || role || ': ' || s || ' differ', '; ') FROM (
      SELECT phase, kind, role, sum(differ) s FROM eq_result GROUP BY 1, 2, 3 HAVING sum(differ) > 0) x);
  END IF;
END $$;
SELECT 'PASS permission equivalence: ' || (SELECT sum(checked) FROM eq_result) || ' checks, 0 differ | '
       || (SELECT string_agg(kind || ' ' || c, ', ' ORDER BY kind) FROM (SELECT kind, sum(checked) c FROM eq_result GROUP BY kind) k)
       || ' | roles: ' || (SELECT string_agg(role || ' ' || c, ', ' ORDER BY role) FROM (SELECT role, sum(checked) c FROM eq_result WHERE role <> 'all roles' GROUP BY role) r)
       || ' | users ' || (SELECT count(DISTINCT user_id) FROM (SELECT user_id FROM public.organization_members UNION SELECT user_id FROM public.user_roles WHERE role = 'platform_admin') x)
       || ', organizations ' || (SELECT count(*) FROM public.organizations) || ', stores ' || (SELECT count(*) FROM public.locations);
ROLLBACK;
