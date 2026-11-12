\set ON_ERROR_STOP on
-- 0028: saving a category ({"active": false}) can no longer deactivate it while it still has active
-- products (issue #18). Disposable local database only. Everything runs in ONE transaction that is
-- rolled back.
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
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Drinks"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"desserts","name":"Desserts"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"sides","name":"Sides"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"drinks","priceCents":250,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"cake","name":"Cake","category":"desserts","priceCents":600,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"pie","name":"Pie","category":"desserts","priceCents":550,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','product','{"id":"fries","name":"Fries","category":"sides","priceCents":400,"locationIds":[],"modifierGroups":[]}');
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000004',false);
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"id":"drinks","name":"B Drinks"}');
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
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_categories WHERE org_id='b2800000-0000-4000-8000-000000000001' AND active)<>4
    OR pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>1 THEN
  RAISE EXCEPTION 'FAIL fixture: org A must have 4 active categories, each saved (audited) once'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2800000-0000-4000-8000-000000000002' AND 'menu.edit'=ANY(effective_permissions))
    OR EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2800000-0000-4000-8000-000000000003' AND 'menu.edit'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: manager must hold menu.edit, staff must not'; END IF;
END $$;

-- ---------------------------------------------------------------- 1. no product at all: deactivation allowed and audited
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000001',false);
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal","active":false}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 1 empty category not deactivated'; END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>2 THEN RAISE EXCEPTION 'FAIL 1 deactivation must be audited once'; END IF;
END $$;

-- ---------------------------------------------------------------- 2. an active product: refused, nothing written (not even the new name), no audit
SET ROLE authenticated;
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Renamed while deactivating","active":false}');
 RAISE EXCEPTION 'FAIL 2 category with an active product deactivated';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_in_use' THEN RAISE EXCEPTION 'FAIL 2 expected category_in_use, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ DECLARE c public.menu_categories; BEGIN
 c := pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks');
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.name IS DISTINCT FROM 'Drinks' THEN RAISE EXCEPTION 'FAIL 2 category changed: %', to_jsonb(c); END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','drinks')<>1 THEN RAISE EXCEPTION 'FAIL 2 audit row recorded for a refused save'; END IF;
END $$;

-- ---------------------------------------------------------------- 3. only inactive products: deactivation allowed; products untouched
SET ROLE authenticated;
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"desserts","name":"Desserts","active":false}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','desserts')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 3 category with only inactive products not deactivated'; END IF;
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

-- ---------------------------------------------------------------- 4. re-activation and rename still work
SET ROLE authenticated;
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal again"}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"desserts","name":"Desserts","active":true}');
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Cold drinks"}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).name IS DISTINCT FROM 'Seasonal again' THEN RAISE EXCEPTION 'FAIL 4 re-activation with "active" omitted'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','desserts')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 4 re-activation with "active": true'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks')).name IS DISTINCT FROM 'Cold drinks'
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 4 rename of a category in use'; END IF;
END $$;

-- ---------------------------------------------------------------- 5. a new category created inactive is allowed (no product can use it)
SET ROLE authenticated;
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"draft","name":"Draft","active":false}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','draft')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 5 new inactive category'; END IF;
END $$;

-- ---------------------------------------------------------------- 6. authorization: categories are owner-only; staff has no menu.edit
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal","active":false}');
 RAISE EXCEPTION 'FAIL 6 manager deactivated a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 manager: expected forbidden, got %', SQLERRM; END IF; END $$;
-- authorization before the in-use check: a manager naming a category in use gets forbidden, not category_in_use
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Drinks","active":false}');
 RAISE EXCEPTION 'FAIL 6 manager deactivated a category in use';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 manager, category in use: expected forbidden, got %', SQLERRM; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal","active":false}');
 RAISE EXCEPTION 'FAIL 6 staff deactivated a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE EXCEPTION 'FAIL 6 staff: expected permission_denied, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 6 a refused call changed the category'; END IF;
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
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal","active":false}');
 RAISE EXCEPTION 'FAIL 7 owner B changed a category of org A';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 7 owner B on org A: expected forbidden, got %', SQLERRM; END IF; END $$;
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"id":"drinks","name":"B Drinks","active":false}');
 RAISE EXCEPTION 'FAIL 7 org B category with an active product deactivated';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_in_use' THEN RAISE EXCEPTION 'FAIL 7 org B: expected category_in_use, got %', SQLERRM; END IF; END $$;
-- the check is per organization: org B "seasonal" (new, no product) can be created inactive
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"id":"seasonal","name":"B Seasonal","active":false}');
SELECT set_config('request.jwt.claim.sub','a2800000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2800000-0000-4000-8000-000000000002','category','{"id":"drinks","name":"B Drinks","active":false}');
 RAISE EXCEPTION 'FAIL 7 owner A changed a category of org B';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 7 owner A on org B: expected forbidden, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000002','drinks')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 7 org B drinks changed'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000002','seasonal')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 7 org B seasonal (no product) not created inactive'; END IF;
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true
    OR (pg_temp.cat('b2800000-0000-4000-8000-000000000001','drinks')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 7 org A categories changed by org B calls'; END IF;
END $$;

-- ---------------------------------------------------------------- 8. rollback: an allowed deactivation that is rolled back leaves no change and no audit row
SAVEPOINT pr28_before_rollback;
SET ROLE authenticated;
SELECT public.save_operational_menu('b2800000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal","active":false}');
RESET ROLE;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL 8 deactivation inside the savepoint'; END IF;
 IF pg_temp.saves('b2800000-0000-4000-8000-000000000001','seasonal')<>4 THEN RAISE EXCEPTION 'FAIL 8 the deactivation inside the savepoint was not audited'; END IF;
END $$;
ROLLBACK TO SAVEPOINT pr28_before_rollback;
DO $$ BEGIN
 IF (pg_temp.cat('b2800000-0000-4000-8000-000000000001','seasonal')).active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 8 rolled-back deactivation persisted'; END IF;
 -- seasonal saves so far: setup, deactivation (1), re-activation (4) = 3; the rolled-back one is gone
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

SELECT ' PASS: category deactivation through save_operational_menu: allowed with no product or only inactive ones (audited), refused with category_in_use while an active product uses it (nothing written, no audit, new name not applied), re-activation and rename unchanged, new inactive category allowed, owner-only (manager forbidden before the in-use check, staff permission_denied), SECURITY DEFINER/search_path/grants kept, per-organization check with the same client id, rolled-back deactivation leaves no change or audit, archive still refuses, no active product in an inactive category';
ROLLBACK;
