\set ON_ERROR_STOP on
-- 0028 + 0029: a category can no longer be deactivated (or re-activated) through
-- save_operational_menu (issue #18). 0028 refused the deactivation while an active product used the
-- category; 0029 (strict intent contract) closes the path entirely: any "active" key in a category
-- save is refused with invalid_menu, nothing is written and nothing is audited. Deactivation exists
-- only through archive_operational_menu (0026, category_in_use), re-activation only through the
-- explicit "reactivate" intent. Disposable local database only. Everything runs in ONE transaction
-- that is rolled back.
--
--   org A: owner A · manager A (default manager permissions) with store A1 · staff A with store A1
--   org B: owner B (also uses the category client id "drinks", with an active product)
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('a2800000-0000-4000-8000-000000000001','pr28-owner-a@example.test',now()),
('a2800000-0000-4000-8000-000000000002','pr28-manager-a@example.test',now()),
('a2800000-0000-4000-8000-000000000003','pr28-staff-a@example.test',now()),
('a2800000-0000-4000-8000-000000000004','pr28-owner-b@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES
('b2800000-0000-4000-8000-000000000001','pr28_a','PR28 A','starter','active'),
('b2800000-0000-4000-8000-000000000002','pr28_b','PR28 B','starter','active');
UPDATE public.subscriptions SET status='active' WHERE org_id IN ('b2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000002');
INSERT INTO public.locations(id,org_id,slug,name,tax_rate_ppm) VALUES
('c2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000001','pr28_a1','A1',62500),
('c2800000-0000-4000-8000-000000000003','b2800000-0000-4000-8000-000000000002','pr28_b1','B1',62500);
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('d2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000001','a2800000-0000-4000-8000-000000000001','owner'),
('d2800000-0000-4000-8000-000000000002','b2800000-0000-4000-8000-000000000001','a2800000-0000-4000-8000-000000000002','manager'),
('d2800000-0000-4000-8000-000000000003','b2800000-0000-4000-8000-000000000001','a2800000-0000-4000-8000-000000000003','staff'),
('d2800000-0000-4000-8000-000000000004','b2800000-0000-4000-8000-000000000002','a2800000-0000-4000-8000-000000000004','owner');
INSERT INTO public.member_location_access VALUES
('d2800000-0000-4000-8000-000000000002','c2800000-0000-4000-8000-000000000001'),
('d2800000-0000-4000-8000-000000000003','c2800000-0000-4000-8000-000000000001');

SET ROLE authenticated;
-- ---------------------------------------------------------------- menus
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000001',false);
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"create","id":"drinks","name":"Drinks"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"create","id":"desserts","name":"Desserts"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"create","id":"seasonal","name":"Seasonal"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"create","id":"sides","name":"Sides"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"drinks","priceCents":250,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"cake","name":"Cake","category":"desserts","priceCents":600,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"pie","name":"Pie","category":"desserts","priceCents":550,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"fries","name":"Fries","category":"sides","priceCents":400,"locationIds":[],"modifierGroups":[]}');
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000004',false);
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"op":"create","id":"drinks","name":"B Drinks"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000002','product','{"id":"b-soda","name":"B Soda","category":"drinks","priceCents":250,"locationIds":[],"modifierGroups":[]}');
RESET ROLE;

-- helpers (read as the table owner): category state and its menu.saved audit rows (target = category id)
CREATE TEMP TABLE pr28_products_before AS
  SELECT id, org_id, client_id, category_id, name, price_cents, active, updated_at FROM public.menu_products
  WHERE org_id IN ('b2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000002');
CREATE FUNCTION pg_temp.cat(_org uuid, _cid text) RETURNS public.menu_categories LANGUAGE sql AS
  $$ SELECT * FROM public.menu_categories WHERE org_id=_org AND client_id=_cid $$;
CREATE FUNCTION pg_temp.saves(_org uuid, _cid text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.audit_logs a JOIN public.menu_categories c ON a.target=c.id::text
     WHERE a.org_id=_org AND c.org_id=_org AND c.client_id=_cid AND a.action='menu.saved' AND a.metadata->>'kind'='category' $$;
-- a category save that must be refused with invalid_menu (runs as the caller: SET ROLE authenticated)
CREATE FUNCTION pg_temp.refused(_org uuid, _payload text, _label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM public.save_operational_menu(_org,'category',_payload::jsonb);
 RAISE EXCEPTION 'FAIL % accepted', _label;
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_menu' THEN RAISE EXCEPTION 'FAIL % expected invalid_menu, got %', _label, SQLERRM; END IF; END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_categories WHERE org_id='b2800000-0000-4000-8000-000000000001' AND active)<>4
    OR pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>1 THEN
  RAISE EXCEPTION 'FAIL fixture: org A must have 4 active categories, each saved (audited) once'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2800000-0000-4000-8000-000000000002' AND 'menu.edit'=ANY(effective_permissions))
    OR EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2800000-0000-4000-8000-000000000003' AND 'menu.edit'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: manager must hold menu.edit, staff must not'; END IF;
END $$;

-- ---------------------------------------------------------------- 1. no product at all: deactivation through the save refused; through the archive allowed
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000001',false);
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"op":"update","id":"seasonal","name":"Seasonal","active":false}','1 update with active false');
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"id":"seasonal","name":"Seasonal","active":false}','1 legacy deactivation (no op)');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 1 a refused save deactivated the category'; END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>1 THEN RAISE EXCEPTION 'FAIL 1 a refused save was audited'; END IF;
END $$;
SET ROLE authenticated;
SELECT public.archive_operational_menu('b2800000-0000-4000-8000-000000000001','category','seasonal');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 1 empty category not archived'; END IF;
END $$;

-- ---------------------------------------------------------------- 2. an active product: every deactivation path refused, nothing written (not even the new name), no audit
SET ROLE authenticated;
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"op":"update","id":"drinks","name":"Renamed while deactivating","active":false}','2 update with active false');
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"id":"drinks","name":"Renamed while deactivating","active":false}','2 legacy deactivation');
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2800000-0000-4000-8000-000000000001','category','drinks');
 RAISE EXCEPTION 'FAIL 2 category with an active product archived';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_in_use' THEN RAISE EXCEPTION 'FAIL 2 archive: expected category_in_use, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ DECLARE c public.menu_categories; BEGIN
 c := pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks');
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.name IS DISTINCT FROM 'Drinks' THEN RAISE EXCEPTION 'FAIL 2 category changed: %', to_jsonb(c); END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','drinks')<>1 THEN RAISE EXCEPTION 'FAIL 2 audit row recorded for a refused save'; END IF;
END $$;

-- ---------------------------------------------------------------- 3. only inactive products: the archive is allowed; products untouched
SET ROLE authenticated;
SELECT public.archive_operational_menu('b2800000-0000-4000-8000-000000000001','category','desserts');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','desserts')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 3 category with only inactive products not archived'; END IF;
 IF EXISTS(
   (SELECT id, org_id, client_id, category_id, name, price_cents, active, updated_at FROM public.menu_products
     WHERE org_id IN ('b2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000002')
    EXCEPT SELECT * FROM pr28_products_before)
   UNION ALL
   (SELECT * FROM pr28_products_before
    EXCEPT SELECT id, org_id, client_id, category_id, name, price_cents, active, updated_at FROM public.menu_products
     WHERE org_id IN ('b2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000002'))) THEN
  RAISE EXCEPTION 'FAIL 3 a product changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 4. re-activation only explicit; rename keeps the active flag
SET ROLE authenticated;
-- implicit re-activation paths are closed: "active": true, re-saving without op, editing or creating an archived category
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"op":"update","id":"desserts","name":"Desserts","active":true}','4 update with active true');
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"id":"seasonal","name":"Seasonal again"}','4 legacy re-save (no op)');
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"seasonal","name":"Seasonal again"}');
 RAISE EXCEPTION 'FAIL 4 edit re-activated or changed an archived category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_archived' THEN RAISE EXCEPTION 'FAIL 4 edit of an archived category: expected category_archived, got %', SQLERRM; END IF; END $$;
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"create","id":"seasonal","name":"Seasonal again"}');
 RAISE EXCEPTION 'FAIL 4 create re-activated an archived category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_archived' THEN RAISE EXCEPTION 'FAIL 4 create over an archived category: expected category_archived, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM false
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).name IS DISTINCT FROM 'Seasonal' THEN RAISE EXCEPTION 'FAIL 4 a refused save changed the archived category'; END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>1 THEN RAISE EXCEPTION 'FAIL 4 a refused save was audited'; END IF;
END $$;
-- explicit re-activation, then rename
SET ROLE authenticated;
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"seasonal","name":"Seasonal"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"desserts","name":"Desserts"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"seasonal","name":"Seasonal again"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"drinks","name":"Cold drinks"}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).name IS DISTINCT FROM 'Seasonal again' THEN RAISE EXCEPTION 'FAIL 4 explicit re-activation then rename'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','desserts')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 4 explicit re-activation'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks')).name IS DISTINCT FROM 'Cold drinks'
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 4 rename of a category in use'; END IF;
 -- seasonal: create (1) + reactivate (2) + rename (3); refused calls and the archive (menu.archived) add no menu.saved row
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>3 THEN RAISE EXCEPTION 'FAIL 4 seasonal audit rows: %', pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal'); END IF;
END $$;

-- ---------------------------------------------------------------- 5. a category cannot be created inactive any more (no "active" key at all)
SET ROLE authenticated;
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"op":"create","id":"draft","name":"Draft","active":false}','5 create inactive');
SELECT pg_temp.refused('b2800000-0000-4000-8000-000000000001','{"id":"draft","name":"Draft","active":false}','5 legacy create inactive');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','draft')).id IS NOT NULL THEN RAISE EXCEPTION 'FAIL 5 a refused create wrote a category'; END IF;
END $$;

-- ---------------------------------------------------------------- 6. authorization: categories are owner-only; staff has no menu.edit
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"seasonal","name":"Manager rename"}');
 RAISE EXCEPTION 'FAIL 6 manager renamed a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 manager: expected forbidden, got %', SQLERRM; END IF; END $$;
-- authorization before the contract check: a manager gets forbidden, not invalid_menu
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Drinks","active":false}');
 RAISE EXCEPTION 'FAIL 6 manager deactivated a category in use';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 manager, legacy payload: expected forbidden, got %', SQLERRM; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"seasonal","name":"Staff rename"}');
 RAISE EXCEPTION 'FAIL 6 staff renamed a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE EXCEPTION 'FAIL 6 staff: expected permission_denied, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).name IS DISTINCT FROM 'Seasonal again' THEN RAISE EXCEPTION 'FAIL 6 a refused call changed the category'; END IF;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_operational_menu(uuid,text,jsonb)'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_proc, unnest(proconfig) c WHERE oid='public.save_operational_menu(uuid,text,jsonb)'::regprocedure AND c='search_path=public')
    OR has_function_privilege('anon','public.save_operational_menu(uuid,text,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.save_operational_menu(uuid,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL 6 SECURITY DEFINER, search_path or grants changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 7. tenant isolation (same client id "drinks" in both organizations)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000004',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"seasonal","name":"Hijacked"}');
 RAISE EXCEPTION 'FAIL 7 owner B changed a category of org A';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 7 owner B on org A: expected forbidden, got %', SQLERRM; END IF; END $$;
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2800000-0000-4000-8000-000000000002','category','drinks');
 RAISE EXCEPTION 'FAIL 7 org B category with an active product archived';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_in_use' THEN RAISE EXCEPTION 'FAIL 7 org B: expected category_in_use, got %', SQLERRM; END IF; END $$;
-- the same client id in another organization is a different category: org B can create "seasonal"
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"op":"create","id":"seasonal","name":"B Seasonal"}');
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"op":"update","id":"drinks","name":"B Drinks hijacked"}');
 RAISE EXCEPTION 'FAIL 7 owner A changed a category of org B';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 7 owner A on org B: expected forbidden, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000002','drinks')).active IS DISTINCT FROM true
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000002','drinks')).name IS DISTINCT FROM 'B Drinks' THEN RAISE EXCEPTION 'FAIL 7 org B drinks changed'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000002','seasonal')).name IS DISTINCT FROM 'B Seasonal' THEN RAISE EXCEPTION 'FAIL 7 org B seasonal not created'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).name IS DISTINCT FROM 'Seasonal again'
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 7 org A categories changed by org B calls'; END IF;
END $$;

-- ---------------------------------------------------------------- 8. rollback: allowed operations that are rolled back leave no change and no audit row
SAVEPOINT pr28_before_rollback;
SET ROLE authenticated;
SELECT public.archive_operational_menu('b2800000-0000-4000-8000-000000000001','category','seasonal');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"reactivate","id":"seasonal","name":"Seasonal again"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"op":"update","id":"seasonal","name":"Rolled back"}');
RESET ROLE;
DO $$ BEGIN
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>5 THEN RAISE EXCEPTION 'FAIL 8 the operations inside the savepoint were not audited'; END IF;
END $$;
ROLLBACK TO SAVEPOINT pr28_before_rollback;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).name IS DISTINCT FROM 'Seasonal again' THEN RAISE EXCEPTION 'FAIL 8 rolled-back operations persisted'; END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>3 THEN RAISE EXCEPTION 'FAIL 8 audit rows after rollback: %', pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal'); END IF;
END $$;

-- ---------------------------------------------------------------- 9. archive (0026) and invariants
SET ROLE authenticated;
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2800000-0000-4000-8000-000000000001','category','sides');
 RAISE EXCEPTION 'FAIL 9 archive of a category in use accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_in_use' THEN RAISE EXCEPTION 'FAIL 9 archive: expected category_in_use, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.menu_products mp JOIN public.menu_categories mc ON mc.id=mp.category_id
            WHERE mp.org_id IN ('b2800000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000002') AND mp.active AND NOT mc.active) THEN
  RAISE EXCEPTION 'FAIL 9 an active product is in an inactive category'; END IF;
END $$;

SELECT ' PASS: a category can no longer be deactivated or re-activated through save_operational_menu (any "active" key, with or without op: invalid_menu, nothing written, no audit); deactivation only through the archive (category_in_use while an active product uses it); re-activation only through the explicit reactivate intent; editing or creating an archived category refused (category_archived); rename keeps the active flag; owner-only (manager forbidden before the contract check, staff permission_denied), SECURITY DEFINER/search_path/grants unchanged, tenant isolation, rollback leaves no change and no audit row, no active product in an inactive category';
ROLLBACK;
