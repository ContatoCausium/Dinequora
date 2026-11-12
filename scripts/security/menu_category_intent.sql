\set ON_ERROR_STOP on
-- 0029: explicit intent for category saves (create / update / reactivate), checked inside the
-- transaction. Sequential contract fixture; the concurrent cases are in menu_category_intent_race.mjs.
-- Disposable local database only. Everything runs in ONE transaction that is rolled back.
--
--   org A: owner A · manager A (default manager permissions) with store A1 · staff A with store A1
--   org B: owner B (uses the same category client ids as org A)
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('a2900000-0000-4000-8000-000000000001','pr29-owner-a@example.test',now()),
('a2900000-0000-4000-8000-000000000002','pr29-manager-a@example.test',now()),
('a2900000-0000-4000-8000-000000000003','pr29-staff-a@example.test',now()),
('a2900000-0000-4000-8000-000000000004','pr29-owner-b@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES
('b2900000-0000-4000-8000-000000000001','pr29_a','PR29 A','starter','active'),
('b2900000-0000-4000-8000-000000000002','pr29_b','PR29 B','starter','active');
UPDATE public.subscriptions SET status='active' WHERE org_id IN ('b2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000002');
INSERT INTO public.locations(id,org_id,slug,name,tax_rate_ppm) VALUES
('c2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000001','pr29_a1','A1',62500),
('c2900000-0000-4000-8000-000000000003','b2900000-0000-4000-8000-000000000002','pr29_b1','B1',62500);
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('d2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000001','a2900000-0000-4000-8000-000000000001','owner'),
('d2900000-0000-4000-8000-000000000002','b2900000-0000-4000-8000-000000000001','a2900000-0000-4000-8000-000000000002','manager'),
('d2900000-0000-4000-8000-000000000003','b2900000-0000-4000-8000-000000000001','a2900000-0000-4000-8000-000000000003','staff'),
('d2900000-0000-4000-8000-000000000004','b2900000-0000-4000-8000-000000000002','a2900000-0000-4000-8000-000000000004','owner');
INSERT INTO public.member_location_access VALUES
('d2900000-0000-4000-8000-000000000002','c2900000-0000-4000-8000-000000000001'),
('d2900000-0000-4000-8000-000000000003','c2900000-0000-4000-8000-000000000001');

-- helpers (owner of the table): category state, menu.saved rows per category, whole-menu fingerprint
CREATE FUNCTION pg_temp.cat(_org uuid, _cid text) RETURNS public.menu_categories LANGUAGE sql AS
  $$ SELECT * FROM public.menu_categories WHERE org_id=_org AND client_id=_cid $$;
CREATE FUNCTION pg_temp.saves(_org uuid, _cid text, _op text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.audit_logs a JOIN public.menu_categories c ON a.target=c.id::text
     WHERE a.org_id=_org AND c.org_id=_org AND c.client_id=_cid AND a.action='menu.saved'
       AND a.metadata->>'kind'='category' AND (_op IS NULL OR a.metadata->>'op'=_op) $$;
-- read as the table owner (SECURITY DEFINER): the whole state of both organizations, whatever the caller can see
CREATE FUNCTION pg_temp.fingerprint() RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT md5(coalesce((SELECT string_agg(to_jsonb(c)::text, ',' ORDER BY c.org_id, c.client_id) FROM public.menu_categories c
                          WHERE c.org_id IN ('b2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000002')),'')
              || coalesce((SELECT string_agg(to_jsonb(p)::text, ',' ORDER BY p.org_id, p.client_id) FROM public.menu_products p
                          WHERE p.org_id IN ('b2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000002')),'')
              || (SELECT count(*)::text FROM public.audit_logs
                   WHERE org_id IN ('b2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000002'))) $$;
-- a save that must be refused with the given code and change nothing at all (data and audit)
CREATE FUNCTION pg_temp.refused(_org uuid, _kind text, _payload text, _code text, _label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _before text := pg_temp.fingerprint(); BEGIN
 BEGIN
  PERFORM public.save_operational_menu(_org,_kind,_payload::jsonb);
  RAISE EXCEPTION 'FAIL % accepted', _label;
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>_code THEN RAISE EXCEPTION 'FAIL % expected %, got %', _label, _code, SQLERRM; END IF;
 END;
 IF pg_temp.fingerprint() IS DISTINCT FROM _before THEN RAISE EXCEPTION 'FAIL % changed data or audit', _label; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2900000-0000-4000-8000-000000000001',false);

-- ---------------------------------------------------------------- 1. create: a new category is created active, audited with op=create
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"drinks","name":"Drinks","description":"Cold"}');
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"desserts","name":"Desserts"}');
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"drinks","priceCents":250,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000001','product','{"id":"cake","name":"Cake","category":"desserts","priceCents":600,"locationIds":[],"modifierGroups":[],"active":false}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2900000-0000-4000-8000-000000000001','drinks')).active IS DISTINCT FROM true
    OR (pg_temp.cat('b2900000-0000-4000-8000-000000000001','drinks')).description IS DISTINCT FROM 'Cold' THEN RAISE EXCEPTION 'FAIL 1 create'; END IF;
 IF pg_temp.saves('b2900000-0000-4000-8000-000000000001','drinks','create')<>1 THEN RAISE EXCEPTION 'FAIL 1 create not audited with op=create'; END IF;
 -- product audit metadata unchanged by 0029: {"kind":"product"} only
 IF EXISTS(SELECT 1 FROM public.audit_logs WHERE org_id='b2900000-0000-4000-8000-000000000001' AND action='menu.saved'
            AND metadata->>'kind'='product' AND metadata<>'{"kind":"product"}'::jsonb) THEN RAISE EXCEPTION 'FAIL 1 product audit metadata changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 2. create never overwrites nor re-activates
SET ROLE authenticated;
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"drinks","name":"Overwrite"}','category_exists','2 create over an active category');
SELECT public.archive_operational_menu('b2900000-0000-4000-8000-000000000001','category','desserts');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"desserts","name":"Revived"}','category_archived','2 create over an archived category');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2900000-0000-4000-8000-000000000001','drinks')).name IS DISTINCT FROM 'Drinks' THEN RAISE EXCEPTION 'FAIL 2 overwritten'; END IF;
 IF (pg_temp.cat('b2900000-0000-4000-8000-000000000001','desserts')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 2 re-activated'; END IF;
END $$;

-- ---------------------------------------------------------------- 3. update: renames an active category, never touches its active flag
SET ROLE authenticated;
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"drinks","name":"Cold drinks"}');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"desserts","name":"Renamed archived"}','category_archived','3 update of an archived category');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"no-such","name":"Ghost"}','not_found','3 update of an unknown category');
RESET ROLE;
DO $$ DECLARE c public.menu_categories; BEGIN
 c := pg_temp.cat('b2900000-0000-4000-8000-000000000001','drinks');
 -- description omitted = cleared (same as before 0029); active untouched
 IF c.name IS DISTINCT FROM 'Cold drinks' OR c.description IS DISTINCT FROM '' OR c.active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 3 update: %', to_jsonb(c); END IF;
 IF (pg_temp.cat('b2900000-0000-4000-8000-000000000001','no-such')).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL 3 update created a category'; END IF;
 IF pg_temp.saves('b2900000-0000-4000-8000-000000000001','drinks','update')<>1 THEN RAISE EXCEPTION 'FAIL 3 update not audited with op=update'; END IF;
END $$;

-- ---------------------------------------------------------------- 4. reactivate: explicit, only for an archived category; name and description kept
SET ROLE authenticated;
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"drinks","name":"Drinks"}','category_not_archived','4 reactivate an active category');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"no-such","name":"Ghost"}','not_found','4 reactivate an unknown category');
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"desserts","name":"Ignored name"}');
RESET ROLE;
DO $$ DECLARE c public.menu_categories; BEGIN
 c := pg_temp.cat('b2900000-0000-4000-8000-000000000001','desserts');
 IF c.active IS DISTINCT FROM true OR c.name IS DISTINCT FROM 'Desserts' THEN RAISE EXCEPTION 'FAIL 4 reactivate: %', to_jsonb(c); END IF;
 IF pg_temp.saves('b2900000-0000-4000-8000-000000000001','desserts','reactivate')<>1 THEN RAISE EXCEPTION 'FAIL 4 reactivate not audited with op=reactivate'; END IF;
 -- the product of the re-activated category stays inactive (re-activation never touches products)
 IF (SELECT active FROM public.menu_products WHERE org_id='b2900000-0000-4000-8000-000000000001' AND client_id='cake') IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 4 product changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 5. strict contract: no intent, unknown intent or an "active" key -> invalid_menu, nothing written
SET ROLE authenticated;
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"id":"new-one","name":"New"}','invalid_menu','5 no intent (new id)');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Legacy rename"}','invalid_menu','5 no intent (existing id)');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"upsert","id":"drinks","name":"X"}','invalid_menu','5 unknown intent');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":null,"id":"drinks","name":"X"}','invalid_menu','5 null intent');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"inactive-new","name":"X","active":false}','invalid_menu','5 create with active');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"drinks","name":"X","active":true}','invalid_menu','5 update with active');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"desserts","name":"X","active":null}','invalid_menu','5 reactivate with active null');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"","name":"Empty id"}','invalid_menu','5 empty id');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"no-name"}','invalid_menu','5 missing name');
RESET ROLE;

-- ---------------------------------------------------------------- 6. authorization: owner-only categories; manager forbidden, staff permission_denied, for every intent
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2900000-0000-4000-8000-000000000002',false);
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"mgr","name":"Manager"}','forbidden','6 manager create');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"drinks","name":"Manager"}','forbidden','6 manager update');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"drinks","name":"Manager"}','forbidden','6 manager reactivate');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Manager"}','forbidden','6 manager without intent (authorization first)');
SELECT set_config('request.jwt.claim.sub','a2900000-0000-4000-8000-000000000003',false);
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"stf","name":"Staff"}','permission_denied','6 staff create');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"drinks","name":"Staff"}','permission_denied','6 staff update');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"drinks","name":"Staff"}','permission_denied','6 staff reactivate');
RESET ROLE;
DO $$ BEGIN
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_operational_menu(uuid,text,jsonb)'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_proc, unnest(proconfig) c WHERE oid='public.save_operational_menu(uuid,text,jsonb)'::regprocedure AND c='search_path=public')
    OR has_function_privilege('anon','public.save_operational_menu(uuid,text,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.save_operational_menu(uuid,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL 6 SECURITY DEFINER, search_path or grants changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 7. tenant isolation: same client ids, separate categories; no cross-tenant change
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2900000-0000-4000-8000-000000000004',false);
SELECT public.save_operational_menu('b2900000-0000-4000-8000-000000000002','category','{"op":"create","id":"drinks","name":"B Drinks"}');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"update","id":"drinks","name":"Hijacked"}','forbidden','7 owner B updates org A');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"create","id":"b-in-a","name":"Hijacked"}','forbidden','7 owner B creates in org A');
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"desserts","name":"Hijacked"}','forbidden','7 owner B reactivates in org A');
SELECT set_config('request.jwt.claim.sub','a2900000-0000-4000-8000-000000000001',false);
SELECT pg_temp.refused('b2900000-0000-4000-8000-000000000002','category','{"op":"update","id":"drinks","name":"Hijacked"}','forbidden','7 owner A updates org B');
-- org A's "drinks" exists, but org B's create of the same id succeeded above (per-organization ids)
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2900000-0000-4000-8000-000000000002','drinks')).name IS DISTINCT FROM 'B Drinks'
    OR (pg_temp.cat('b2900000-0000-4000-8000-000000000001','drinks')).name IS DISTINCT FROM 'Cold drinks' THEN RAISE EXCEPTION 'FAIL 7 cross-tenant change'; END IF;
END $$;

-- ---------------------------------------------------------------- 8. organization not operational: refused before the intent (no write, no audit)
UPDATE public.organizations SET status='suspended' WHERE id='b2900000-0000-4000-8000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2900000-0000-4000-8000-000000000004',false);
DO $$ DECLARE _before text := pg_temp.fingerprint(); BEGIN
 BEGIN
  PERFORM public.save_operational_menu('b2900000-0000-4000-8000-000000000002','category','{"op":"create","id":"suspended","name":"S"}');
  RAISE EXCEPTION 'FAIL 8 suspended organization accepted a category';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
 IF pg_temp.fingerprint() IS DISTINCT FROM _before THEN RAISE EXCEPTION 'FAIL 8 suspended organization: data or audit changed'; END IF;
END $$;
RESET ROLE;
UPDATE public.organizations SET status='active' WHERE id='b2900000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------- 9. invariants
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.menu_products mp JOIN public.menu_categories mc ON mc.id=mp.category_id
            WHERE mp.org_id IN ('b2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000002') AND mp.active AND NOT mc.active) THEN
  RAISE EXCEPTION 'FAIL 9 an active product is in an inactive category'; END IF;
 -- every successful category save is audited exactly once with its intent: 3 creates, 1 update, 1 reactivate
 IF (SELECT string_agg(op||':'||n, ',' ORDER BY op) FROM (SELECT metadata->>'op' AS op, count(*) AS n FROM public.audit_logs
      WHERE org_id IN ('b2900000-0000-4000-8000-000000000001','b2900000-0000-4000-8000-000000000002') AND action='menu.saved' AND metadata->>'kind'='category' GROUP BY 1) x)
    IS DISTINCT FROM 'create:3,reactivate:1,update:1' THEN RAISE EXCEPTION 'FAIL 9 category audit rows by intent'; END IF;
END $$;

SELECT ' PASS: category intents (0029): create makes a new active category and never overwrites (category_exists) nor re-activates (category_archived); update renames an active category without touching its active flag (archived: category_archived, unknown: not_found); reactivate is explicit, only for an archived category, keeps name/description and products (active: category_not_archived); no/unknown/null intent or an "active" key: invalid_menu; every refusal changes no data and writes no audit row; owner-only for every intent (manager forbidden first, staff permission_denied); SECURITY DEFINER/search_path/grants unchanged; tenant isolation; suspended organization refused; audit rows carry the intent; product audit metadata unchanged';
ROLLBACK;
