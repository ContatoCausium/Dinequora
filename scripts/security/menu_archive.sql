\set ON_ERROR_STOP on
-- 0026: archive_operational_menu archives categories again (42702 "p.category_id is ambiguous"
-- since 0013), with the same authorization, tenant isolation and audit; plus menu regressions.
-- Disposable local database only. Everything runs in ONE transaction that is rolled back.
--
--   org A: owner A · manager A (default manager permissions: menu.view/create/edit/delete) with
--          store A1 · staff A (default: menu.view only) with store A1
--   org B: owner B (also uses the client id "drinks", like org A)
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('a2600000-0000-4000-8000-000000000001','pr26-owner-a@example.test',now()),
('a2600000-0000-4000-8000-000000000002','pr26-manager-a@example.test',now()),
('a2600000-0000-4000-8000-000000000003','pr26-staff-a@example.test',now()),
('a2600000-0000-4000-8000-000000000004','pr26-owner-b@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES
('b2600000-0000-4000-8000-000000000001','pr26_a','PR26 A','starter','active'),
('b2600000-0000-4000-8000-000000000002','pr26_b','PR26 B','starter','active');
UPDATE public.subscriptions SET status='active' WHERE org_id IN ('b2600000-0000-4000-8000-000000000001','b2600000-0000-4000-8000-000000000002');
INSERT INTO public.locations(id,org_id,slug,name,tax_rate_ppm) VALUES
('c2600000-0000-4000-8000-000000000001','b2600000-0000-4000-8000-000000000001','pr26_a1','A1',62500),
('c2600000-0000-4000-8000-000000000002','b2600000-0000-4000-8000-000000000001','pr26_a2','A2',62500),
('c2600000-0000-4000-8000-000000000003','b2600000-0000-4000-8000-000000000002','pr26_b1','B1',62500);
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('d2600000-0000-4000-8000-000000000001','b2600000-0000-4000-8000-000000000001','a2600000-0000-4000-8000-000000000001','owner'),
('d2600000-0000-4000-8000-000000000002','b2600000-0000-4000-8000-000000000001','a2600000-0000-4000-8000-000000000002','manager'),
('d2600000-0000-4000-8000-000000000003','b2600000-0000-4000-8000-000000000001','a2600000-0000-4000-8000-000000000003','staff'),
('d2600000-0000-4000-8000-000000000004','b2600000-0000-4000-8000-000000000002','a2600000-0000-4000-8000-000000000004','owner');
INSERT INTO public.member_location_access VALUES
('d2600000-0000-4000-8000-000000000002','c2600000-0000-4000-8000-000000000001'),
('d2600000-0000-4000-8000-000000000003','c2600000-0000-4000-8000-000000000001');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2600000-0000-4000-8000-000000000002' AND 'menu.delete'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: manager must hold menu.delete by default'; END IF;
 IF EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2600000-0000-4000-8000-000000000003' AND ('menu.delete'=ANY(effective_permissions) OR 'menu.create'=ANY(effective_permissions))) THEN
  RAISE EXCEPTION 'FAIL fixture: staff must not hold menu.create/menu.delete by default'; END IF;
END $$;

SET ROLE authenticated;
-- ---------------------------------------------------------------- menu of org A (owner A)
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000001',false);
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Drinks"}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"desserts","name":"Desserts"}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal"}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"sides","name":"Sides"}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"drinks","priceCents":250,"prepTimeMinutes":1,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"cake","name":"Cake","category":"desserts","priceCents":600,"prepTimeMinutes":2,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"pie","name":"Pie","category":"desserts","priceCents":550,"prepTimeMinutes":2,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"fries","name":"Fries","category":"sides","priceCents":400,"prepTimeMinutes":5,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"a1-special","name":"A1 Special","category":"sides","priceCents":700,"prepTimeMinutes":5,"locationIds":["c2600000-0000-4000-8000-000000000001"],"modifierGroups":[]}');
-- org B uses the same client id "drinks" for its own category
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000004',false);
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000002','category','{"id":"drinks","name":"B Drinks"}');
RESET ROLE;
CREATE TEMP TABLE pr26_products_before AS
  SELECT id, org_id, client_id, category_id, name, price_cents, active, location_ids, modifier_groups, updated_at
  FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001';
GRANT SELECT ON pr26_products_before TO authenticated;

-- ---------------------------------------------------------------- 1. archive an empty category (the defect)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000001',false);
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','seasonal');
RESET ROLE;
DO $$ DECLARE a public.audit_logs; BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='seasonal') IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'FAIL 1 category not archived'; END IF;
 SELECT * INTO a FROM public.audit_logs WHERE org_id='b2600000-0000-4000-8000-000000000001' AND action='menu.archived' AND target='seasonal';
 IF a.id IS NULL OR a.actor_id<>'a2600000-0000-4000-8000-000000000001' OR a.metadata->>'kind'<>'category' THEN
  RAISE EXCEPTION 'FAIL 1 audit row: %', to_jsonb(a); END IF;
 IF (SELECT count(*) FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND active)<>3 THEN
  RAISE EXCEPTION 'FAIL 1 another category changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 2. idempotent: archiving it again
SET ROLE authenticated;
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','seasonal');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='seasonal') IS DISTINCT FROM false
    OR (SELECT count(*) FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND active)<>3 THEN
  RAISE EXCEPTION 'FAIL 2 second archive changed the menu'; END IF;
END $$;

-- ---------------------------------------------------------------- 3. a category that does not exist: refused, nothing written
SET ROLE authenticated;
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','no-such-category');
 RAISE EXCEPTION 'FAIL 3 missing category accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'not_found' THEN RAISE EXCEPTION 'FAIL 3 expected not_found, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.audit_logs WHERE action='menu.archived' AND target='no-such-category') THEN
  RAISE EXCEPTION 'FAIL 3 audit row recorded for a category that does not exist'; END IF;
END $$;

-- ---------------------------------------------------------------- 4. a category with an active product is kept
SET ROLE authenticated;
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','drinks');
 RAISE EXCEPTION 'FAIL 4 category with an active product archived';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_in_use' THEN RAISE EXCEPTION 'FAIL 4 expected category_in_use, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='drinks') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'FAIL 4 category changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 5. a category whose products are all unavailable: archived, products untouched
SET ROLE authenticated;
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','desserts');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='desserts') IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'FAIL 5 category not archived'; END IF;
 IF EXISTS(
   (SELECT id, org_id, client_id, category_id, name, price_cents, active, location_ids, modifier_groups, updated_at FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001'
    EXCEPT SELECT * FROM pr26_products_before)
   UNION ALL
   (SELECT * FROM pr26_products_before
    EXCEPT SELECT id, org_id, client_id, category_id, name, price_cents, active, location_ids, modifier_groups, updated_at FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001')) THEN
  RAISE EXCEPTION 'FAIL 5 a product changed when categories were archived'; END IF;
END $$;

-- ---------------------------------------------------------------- 6. authorization
SET ROLE authenticated;
-- manager (holds menu.delete): categories are owner-only
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','sides');
 RAISE EXCEPTION 'FAIL 6 manager archived a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 manager: expected forbidden, got %', SQLERRM; END IF; END $$;
-- staff (no menu.delete)
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','sides');
 RAISE EXCEPTION 'FAIL 6 staff archived a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE EXCEPTION 'FAIL 6 staff: expected permission_denied, got %', SQLERRM; END IF; END $$;
-- owner of another organization, on org A
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000004',false);
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','sides');
 RAISE EXCEPTION 'FAIL 6 non-member archived a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 non-member: expected forbidden, got %', SQLERRM; END IF; END $$;
-- no session
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','sides');
 RAISE EXCEPTION 'FAIL 6 no session archived a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 6 no session: expected forbidden, got %', SQLERRM; END IF; END $$;
RESET ROLE;
-- anon cannot even execute it
SET ROLE anon;
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','sides');
 RAISE EXCEPTION 'FAIL 6 anon executed archive_operational_menu';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='sides') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'FAIL 6 a refused call changed the category'; END IF;
 IF has_function_privilege('anon','public.archive_operational_menu(uuid,text,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.archive_operational_menu(uuid,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL 6 grants changed'; END IF;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.archive_operational_menu(uuid,text,text)'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_proc, unnest(proconfig) c WHERE oid='public.archive_operational_menu(uuid,text,text)'::regprocedure AND c='search_path=public') THEN
  RAISE EXCEPTION 'FAIL 6 SECURITY DEFINER or search_path changed'; END IF;
END $$;

-- ---------------------------------------------------------------- 7. isolation: same client id in two organizations
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000004',false);
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000002','category','drinks');
-- owner A cannot archive a category of org B by naming org B
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000002','category','drinks');
 RAISE EXCEPTION 'FAIL 7 owner A archived in org B';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 7 expected forbidden, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000002' AND client_id='drinks') IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'FAIL 7 org B category not archived'; END IF;
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='drinks') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'FAIL 7 org A category with the same client id was changed'; END IF;
 IF (SELECT org_id FROM public.audit_logs WHERE action='menu.archived' AND target='drinks') IS DISTINCT FROM 'b2600000-0000-4000-8000-000000000002' THEN
  RAISE EXCEPTION 'FAIL 7 audit row of org B'; END IF;
END $$;

-- ---------------------------------------------------------------- 8. product branch (unchanged behavior)
SET ROLE authenticated;
-- manager archives a product of its own store
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000002',false);
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','product','a1-special');
-- manager cannot archive a product sold in every store
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','product','fries');
 RAISE EXCEPTION 'FAIL 8 manager archived an all-stores product';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 8 expected forbidden, got %', SQLERRM; END IF; END $$;
-- staff cannot archive products
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','product','soda');
 RAISE EXCEPTION 'FAIL 8 staff archived a product';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE EXCEPTION 'FAIL 8 staff: expected permission_denied, got %', SQLERRM; END IF; END $$;
-- owner archives a product; missing product and unknown kind are refused
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000001',false);
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','product','fries');
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','product','no-such-product');
 RAISE EXCEPTION 'FAIL 8 missing product accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 8 missing product: expected forbidden, got %', SQLERRM; END IF; END $$;
DO $$ BEGIN
 PERFORM public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','combo','x');
 RAISE EXCEPTION 'FAIL 8 unknown kind accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_kind' THEN RAISE EXCEPTION 'FAIL 8 expected invalid_kind, got %', SQLERRM; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='a1-special') IS DISTINCT FROM false
    OR (SELECT active FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='fries') IS DISTINCT FROM false
    OR (SELECT active FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='soda') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'FAIL 8 product states'; END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE org_id='b2600000-0000-4000-8000-000000000001' AND action='menu.archived' AND metadata->>'kind'='product')<>2 THEN
  RAISE EXCEPTION 'FAIL 8 product audit rows'; END IF;
END $$;
-- once all its products are archived, the category can be archived
SET ROLE authenticated;
SELECT public.archive_operational_menu('b2600000-0000-4000-8000-000000000001','category','sides');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='sides') IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'FAIL 8 category sides not archived after its products'; END IF;
END $$;

-- ---------------------------------------------------------------- 9. menu regressions (save_operational_menu unchanged)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000001',false);
-- edit a category name; a product cannot use an archived category; re-saving a category restores it
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"drinks","name":"Cold drinks"}');
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"tart","name":"Tart","category":"desserts","priceCents":500,"locationIds":[],"modifierGroups":[]}');
 RAISE EXCEPTION 'FAIL 9 product saved into an archived category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'category_required' THEN RAISE EXCEPTION 'FAIL 9 expected category_required, got %', SQLERRM; END IF; END $$;
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"seasonal","name":"Seasonal"}');
-- edit a product: price, availability, and move it to another category
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"drinks","priceCents":275,"prepTimeMinutes":1,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"seasonal","priceCents":275,"prepTimeMinutes":1,"locationIds":[],"modifierGroups":[],"active":false}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"seasonal","priceCents":275,"prepTimeMinutes":1,"locationIds":[],"modifierGroups":[],"active":true}');
-- manager creates and edits a product of its store; cannot create categories
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000002',false);
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"a1-tea","name":"A1 Tea","category":"seasonal","priceCents":300,"locationIds":["c2600000-0000-4000-8000-000000000001"],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"a1-tea","name":"A1 Iced Tea","category":"seasonal","priceCents":325,"locationIds":["c2600000-0000-4000-8000-000000000001"],"modifierGroups":[]}');
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2600000-0000-4000-8000-000000000001','category','{"id":"manager-cat","name":"Manager category"}');
 RAISE EXCEPTION 'FAIL 9 manager created a category';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE EXCEPTION 'FAIL 9 manager category: expected forbidden, got %', SQLERRM; END IF; END $$;
-- staff can read the menu but not change it
SELECT set_config('request.jwt.claim.sub','a2600000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 PERFORM public.save_operational_menu('b2600000-0000-4000-8000-000000000001','product','{"id":"staff-item","name":"Staff item","category":"seasonal","priceCents":100,"locationIds":["c2600000-0000-4000-8000-000000000001"],"modifierGroups":[]}');
 RAISE EXCEPTION 'FAIL 9 staff created a product';
EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE EXCEPTION 'FAIL 9 staff product: expected permission_denied, got %', SQLERRM; END IF; END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001')=0 THEN
  RAISE EXCEPTION 'FAIL 9 staff cannot read the menu'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE p public.menu_products; BEGIN
 IF (SELECT name FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='drinks')<>'Cold drinks' THEN RAISE EXCEPTION 'FAIL 9 category rename'; END IF;
 IF (SELECT active FROM public.menu_categories WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='seasonal') IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 9 re-saved category not restored'; END IF;
 SELECT * INTO p FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='soda';
 IF p.price_cents<>275 OR NOT p.active OR p.category_id<>(SELECT id FROM public.menu_categories WHERE org_id=p.org_id AND client_id='seasonal') THEN RAISE EXCEPTION 'FAIL 9 product edit: %', to_jsonb(p); END IF;
 SELECT * INTO p FROM public.menu_products WHERE org_id='b2600000-0000-4000-8000-000000000001' AND client_id='a1-tea';
 IF p.name<>'A1 Iced Tea' OR p.price_cents<>325 OR p.location_ids<>ARRAY['c2600000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'FAIL 9 manager product: %', to_jsonb(p); END IF;
 IF EXISTS(SELECT 1 FROM public.menu_products WHERE client_id='staff-item') OR EXISTS(SELECT 1 FROM public.menu_categories WHERE client_id='manager-cat') THEN RAISE EXCEPTION 'FAIL 9 refused save wrote a row'; END IF;
END $$;

SELECT ' PASS: category archive works (empty and all-unavailable categories), idempotent, missing category refused without audit, category in use kept, products untouched, audit row (actor, kind), owner-only (manager/staff/non-member/no session/anon refused), grants/SECURITY DEFINER/search_path kept, same client id isolated per organization, product archive unchanged (store scope, staff, missing, kind), menu edits/availability/category moves/manager and staff permissions';
ROLLBACK;
