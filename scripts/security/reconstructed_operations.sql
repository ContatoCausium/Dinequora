\set ON_ERROR_STOP on
-- Only disposable local database. No hosted users or tenants are touched.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('aaaaaaaa-0000-4000-8000-000000000001','owner-a@example.test',now()),
('aaaaaaaa-0000-4000-8000-000000000002','owner-b@example.test',now()),
('aaaaaaaa-0000-4000-8000-000000000003','staff-a@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES ('bbbbbbbb-0000-4000-8000-000000000001','test_a','Test A','starter','active'),('bbbbbbbb-0000-4000-8000-000000000002','test_b','Test B','starter','active');
UPDATE public.subscriptions SET status='active' WHERE org_id IN('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002');
INSERT INTO public.locations(id,org_id,slug,name) VALUES
('cccccccc-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','test_a1','A1'),
('cccccccc-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001','test_a2','A2'),
('cccccccc-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000002','test_b1','B1');
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('dddddddd-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','owner'),
('dddddddd-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002','owner'),
('dddddddd-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','staff');
INSERT INTO public.member_location_access VALUES('dddddddd-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000001');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001',false);
SELECT public.save_operational_menu('bbbbbbbb-0000-4000-8000-000000000001','category','{"id":"food","name":"Food"}');
SELECT public.save_operational_menu('bbbbbbbb-0000-4000-8000-000000000001','product','{"id":"burger","name":"Burger","category":"food","priceCents":1500,"prepTimeMinutes":10,"locationIds":[],"modifierGroups":[{"id":"extras","name":"Extras","required":false,"minSelections":0,"maxSelections":1,"options":[{"id":"cheese","name":"Cheese","priceCents":250}]}]}');
SELECT public.save_operational_record('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','inventory','{"name":"Beef","category":"meat","unit":"lb","quantity":10,"costCents":400}') AS inventory_id \gset
SELECT public.save_operational_record('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','recipe',jsonb_build_object('productId','burger','servings',1,'yieldQuantity',1,'ingredients',jsonb_build_array(jsonb_build_object('inventoryItemId',:'inventory_id','quantity',0.5,'unit','lb','wastePercentage',0)))) AS recipe_id \gset
-- 0025: the store's configured rate is what the sale charges; 825 bp below confirms it (8.25% = 82,500 ppm).
SELECT public.set_location_tax_rate('cccccccc-0000-4000-8000-000000000001', 82500);
SELECT public.persist_finalized_pos_sale_atomic('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','dine_in','Test',_discount_cents=>400,_tax_rate_basis_points=>825,_items=>'[{"product_id":"burger","unit_price_cents":1,"quantity":2,"modifiers":[{"group_id":"extras","option_id":"cheese","price_cents":1}]}]',_client_order_id=>'tx1',_payment_method=>'cash') AS sale_id \gset
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE client_order_id='tx1' AND subtotal_cents=3500 AND tax_cents=256 AND total_cents=3356) THEN RAISE EXCEPTION 'FAIL server price/tax'; END IF;
 IF (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>9 THEN RAISE EXCEPTION 'FAIL consumption'; END IF;
 IF (SELECT sum(amount_cents) FROM public.finance_entries WHERE kind='cogs')<>400 THEN RAISE EXCEPTION 'FAIL cogs'; END IF;
END $$;
SELECT public.persist_finalized_pos_sale_atomic('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','dine_in','Test',_discount_cents=>400,_tax_rate_basis_points=>825,_items=>'[{"product_id":"burger","unit_price_cents":1,"quantity":2,"modifiers":[{"group_id":"extras","option_id":"cheese","price_cents":1}]}]',_client_order_id=>'tx1',_payment_method=>'cash');
DO $$ BEGIN IF (SELECT count(*) FROM public.orders WHERE client_order_id='tx1')<>1 OR (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>9 THEN RAISE EXCEPTION 'FAIL idempotence'; END IF; END $$;
SELECT public.update_order_status(:'sale_id','in_prep'); SELECT public.update_order_status(:'sale_id','ready');
SELECT public.cancel_order_with_reversal(:'sale_id','test'); SELECT public.cancel_order_with_reversal(:'sale_id','test');
DO $$ BEGIN IF (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>10 THEN RAISE EXCEPTION 'FAIL reversal'; END IF; IF (SELECT sum(CASE WHEN kind='revenue' THEN amount_cents WHEN kind='reversal_revenue' THEN -amount_cents ELSE 0 END) FROM public.finance_entries)<>0 THEN RAISE EXCEPTION 'FAIL finance reversal'; END IF; END $$;
DO $$ BEGIN
 BEGIN PERFORM public.create_pos_sale('bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000001','dine_in','bad',_client_order_id=>'cross'); RAISE EXCEPTION 'FAIL cross org accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_pos_sale('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','dine_in','bad',_items=>'[{"product_id":"burger","quantity":1}]',_is_simulation=>true,_client_order_id=>'demo'); RAISE EXCEPTION 'FAIL simulated real org'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'simulation_forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_pos_sale('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','dine_in','bad',_items=>'[{"product_id":"burger","quantity":1}]',_client_order_id=>'tx1'); RAISE EXCEPTION 'FAIL reused different payload'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'idempotency_conflict' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','dine_in','bad',_items=>'[{"product_id":"burger","quantity":100}]',_client_order_id=>'insufficient'); RAISE EXCEPTION 'FAIL insufficient accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'insufficient_stock' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.orders WHERE client_order_id='insufficient') THEN RAISE EXCEPTION 'FAIL atomic rollback'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 BEGIN PERFORM public.create_pos_sale('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000002','dine_in','bad',_client_order_id=>'cross-store'); RAISE EXCEPTION 'FAIL unauthorized store'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.cancel_order_with_reversal((SELECT id FROM public.orders LIMIT 1),'staff'); RAISE EXCEPTION 'FAIL staff cancel'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.orders WHERE org_id='bbbbbbbb-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL tenant RLS'; END IF;
 BEGIN INSERT INTO public.orders(org_id,location_id,order_number,type,client_order_id,request_hash,created_by) VALUES('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','hack','dine_in','hack','hack','aaaaaaaa-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL direct insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000002',false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.orders) OR EXISTS(SELECT 1 FROM public.inventory_items) OR EXISTS(SELECT 1 FROM public.menu_products) THEN RAISE EXCEPTION 'FAIL other org RLS'; END IF; END $$;
RESET ROLE; SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.update_order_status('00000000-0000-4000-8000-000000000000','ready'); RAISE EXCEPTION 'FAIL anon execute'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SELECT 'PASS: prices, tax, recipe consumption, cogs, idempotence, KDS, reversal, cross-org, cross-store, demo, conflict, rollback, staff cancellation, direct-write denial, RLS, anon execute';
