\set ON_ERROR_STOP on
-- Operations, hardening and purchases fixture: prices/tax/stock/COGS/idempotence/reversal/RLS/store
-- scope/anon; movement idempotence/consent/auth; purchase receipts/transfer conservation.
--
-- These used to be three files (reconstructed_operations/_hardening/_purchases) run one after the
-- other, with literal ids, outside any transaction: the first COMMITTED a tenant (Test A/B) that the
-- other two used. On a database that already held those ids it failed, and a failure part-way left
-- the rows written so far. Now:
--   * one transaction that always ends in ROLLBACK: nothing it writes survives. When a check fails,
--     psql stops at once (ON_ERROR_STOP) and the open transaction is discarded with the connection;
--   * the users, organizations, stores and memberships get fresh ids, emails and slugs on every run,
--     so rows left by the old fixture (or anything else) can never collide with this run;
--   * the checks read through RLS as users this run created (members of this run's organizations
--     only) or filter by this run's ids, so other data in the database cannot change a result;
--   * it refuses to run unless the database is marked disposable (target guard, below): an
--     accidental psql against the persistent QA, the demo, a restored copy or a hosted project stops
--     before writing anything. (PR #22 used an opt-in setting; any session could set it.)
-- psql -v fixture_interrupt=1 makes it fail on purpose after every write (suite step 3b), to prove
-- that an interrupted run leaves nothing behind.
-- Target guard (scripts/guard/target-guard.mjs): stops here, before any write, unless this database
-- was marked disposable (claim on a new, empty stack, or an explicit adopt of a copy).
DO $$ BEGIN
  IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
    RAISE EXCEPTION 'refused by the target guard: not a disposable database (no dq_guard marker)';
  END IF;
  PERFORM dq_guard.attest('fixture:reconstructed_operations');
END $$;

BEGIN;
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b, gen_random_uuid() AS staff_a,
       gen_random_uuid() AS org_a, gen_random_uuid() AS org_b,
       gen_random_uuid() AS loc_a1, gen_random_uuid() AS loc_a2, gen_random_uuid() AS loc_b1,
       gen_random_uuid() AS mem_owner_a, gen_random_uuid() AS mem_owner_b, gen_random_uuid() AS mem_staff_a,
       substr(md5(gen_random_uuid()::text), 1, 12) AS run \gset
-- The same ids for the DO blocks below (psql variables are not expanded inside them).
SELECT set_config('fx.staff_a', :'staff_a', true), set_config('fx.org_a', :'org_a', true),
       set_config('fx.org_b', :'org_b', true), set_config('fx.loc_a1', :'loc_a1', true),
       set_config('fx.loc_a2', :'loc_a2', true) \gset fx_

-- ===================================================================== operations
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
(:'owner_a','owner-a-'||:'run'||'@example.test',now()),
(:'owner_b','owner-b-'||:'run'||'@example.test',now()),
(:'staff_a','staff-a-'||:'run'||'@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES (:'org_a','test_a_'||:'run','Test A','starter','active'),(:'org_b','test_b_'||:'run','Test B','starter','active');
UPDATE public.subscriptions SET status='active' WHERE org_id IN(:'org_a',:'org_b');
INSERT INTO public.locations(id,org_id,slug,name) VALUES
(:'loc_a1',:'org_a','test_a1_'||:'run','A1'),
(:'loc_a2',:'org_a','test_a2_'||:'run','A2'),
(:'loc_b1',:'org_b','test_b1_'||:'run','B1');
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
(:'mem_owner_a',:'org_a',:'owner_a','owner'),
(:'mem_owner_b',:'org_b',:'owner_b','owner'),
(:'mem_staff_a',:'org_a',:'staff_a','staff');
INSERT INTO public.member_location_access VALUES(:'mem_staff_a',:'loc_a1');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT public.save_operational_menu(:'org_a','category','{"op":"create","id":"food","name":"Food"}');
SELECT public.save_operational_menu(:'org_a','product','{"id":"burger","name":"Burger","category":"food","priceCents":1500,"prepTimeMinutes":10,"locationIds":[],"modifierGroups":[{"id":"extras","name":"Extras","required":false,"minSelections":0,"maxSelections":1,"options":[{"id":"cheese","name":"Cheese","priceCents":250}]}]}');
SELECT public.save_operational_record(:'org_a',:'loc_a1','inventory','{"name":"Beef","category":"meat","unit":"lb","quantity":10,"costCents":400}') AS inventory_id \gset
SELECT public.save_operational_record(:'org_a',:'loc_a1','recipe',jsonb_build_object('productId','burger','servings',1,'yieldQuantity',1,'ingredients',jsonb_build_array(jsonb_build_object('inventoryItemId',:'inventory_id','quantity',0.5,'unit','lb','wastePercentage',0)))) AS recipe_id \gset
-- 0025: the store's configured rate is what the sale charges; 825 bp below confirms it (8.25% = 82,500 ppm).
SELECT public.set_location_tax_rate(:'loc_a1', 82500);
SELECT public.persist_finalized_pos_sale_atomic(:'org_a',:'loc_a1','dine_in','Test',_discount_cents=>400,_tax_rate_basis_points=>825,_items=>'[{"product_id":"burger","unit_price_cents":1,"quantity":2,"modifiers":[{"group_id":"extras","option_id":"cheese","price_cents":1}]}]',_client_order_id=>'tx1',_payment_method=>'cash') AS sale_id \gset
-- As owner A (a user this run created, member of organization A only), RLS limits the reads below
-- to organization A.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE client_order_id='tx1' AND subtotal_cents=3500 AND tax_cents=256 AND total_cents=3356) THEN RAISE EXCEPTION 'FAIL server price/tax'; END IF;
 IF (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>9 THEN RAISE EXCEPTION 'FAIL consumption'; END IF;
 IF (SELECT sum(amount_cents) FROM public.finance_entries WHERE kind='cogs')<>400 THEN RAISE EXCEPTION 'FAIL cogs'; END IF;
END $$;
SELECT public.persist_finalized_pos_sale_atomic(:'org_a',:'loc_a1','dine_in','Test',_discount_cents=>400,_tax_rate_basis_points=>825,_items=>'[{"product_id":"burger","unit_price_cents":1,"quantity":2,"modifiers":[{"group_id":"extras","option_id":"cheese","price_cents":1}]}]',_client_order_id=>'tx1',_payment_method=>'cash');
DO $$ BEGIN IF (SELECT count(*) FROM public.orders WHERE client_order_id='tx1')<>1 OR (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>9 THEN RAISE EXCEPTION 'FAIL idempotence'; END IF; END $$;
SELECT public.update_order_status(:'sale_id','in_prep'); SELECT public.update_order_status(:'sale_id','ready');
SELECT public.cancel_order_with_reversal(:'sale_id','test'); SELECT public.cancel_order_with_reversal(:'sale_id','test');
DO $$ BEGIN IF (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>10 THEN RAISE EXCEPTION 'FAIL reversal'; END IF; IF (SELECT sum(CASE WHEN kind='revenue' THEN amount_cents WHEN kind='reversal_revenue' THEN -amount_cents ELSE 0 END) FROM public.finance_entries)<>0 THEN RAISE EXCEPTION 'FAIL finance reversal'; END IF; END $$;
DO $$ DECLARE org_a uuid := current_setting('fx.org_a')::uuid; org_b uuid := current_setting('fx.org_b')::uuid; loc_a1 uuid := current_setting('fx.loc_a1')::uuid; BEGIN
 BEGIN PERFORM public.create_pos_sale(org_b,loc_a1,'dine_in','bad',_client_order_id=>'cross'); RAISE EXCEPTION 'FAIL cross org accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_pos_sale(org_a,loc_a1,'dine_in','bad',_items=>'[{"product_id":"burger","quantity":1}]',_is_simulation=>true,_client_order_id=>'demo'); RAISE EXCEPTION 'FAIL simulated real org'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'simulation_forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_pos_sale(org_a,loc_a1,'dine_in','bad',_items=>'[{"product_id":"burger","quantity":1}]',_client_order_id=>'tx1'); RAISE EXCEPTION 'FAIL reused different payload'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'idempotency_conflict' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic(org_a,loc_a1,'dine_in','bad',_tax_rate_basis_points=>825,_items=>'[{"product_id":"burger","quantity":100}]',_client_order_id=>'insufficient'); RAISE EXCEPTION 'FAIL insufficient accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'insufficient_stock' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.orders WHERE client_order_id='insufficient') THEN RAISE EXCEPTION 'FAIL atomic rollback'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',:'staff_a',false);
DO $$ DECLARE org_a uuid := current_setting('fx.org_a')::uuid; org_b uuid := current_setting('fx.org_b')::uuid; loc_a1 uuid := current_setting('fx.loc_a1')::uuid; loc_a2 uuid := current_setting('fx.loc_a2')::uuid; staff_a uuid := current_setting('fx.staff_a')::uuid; BEGIN
 BEGIN PERFORM public.create_pos_sale(org_a,loc_a2,'dine_in','bad',_client_order_id=>'cross-store'); RAISE EXCEPTION 'FAIL unauthorized store'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.cancel_order_with_reversal((SELECT id FROM public.orders LIMIT 1),'staff'); RAISE EXCEPTION 'FAIL staff cancel'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.orders WHERE org_id=org_b) THEN RAISE EXCEPTION 'FAIL tenant RLS'; END IF;
 BEGIN INSERT INTO public.orders(org_id,location_id,order_number,type,client_order_id,request_hash,created_by) VALUES(org_a,loc_a1,'hack','dine_in','hack','hack',staff_a); RAISE EXCEPTION 'FAIL direct insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub',:'owner_b',false);
-- Owner B (member of organization B only, which has no orders, stock or menu) sees no such row at all.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.orders) OR EXISTS(SELECT 1 FROM public.inventory_items) OR EXISTS(SELECT 1 FROM public.menu_products) THEN RAISE EXCEPTION 'FAIL other org RLS'; END IF; END $$;
RESET ROLE; SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.update_order_status('00000000-0000-4000-8000-000000000000','ready'); RAISE EXCEPTION 'FAIL anon execute'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;

-- ===================================================================== hardening
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT id AS inv_id FROM public.inventory_items WHERE location_id=:'loc_a1' AND name='Beef' \gset
SELECT public.record_operational_movement(:'org_a',:'loc_a1',:'inv_id','in',1,'repeat','move-repeat');
SELECT public.record_operational_movement(:'org_a',:'loc_a1',:'inv_id','in',1,'repeat','move-repeat');
DO $$ DECLARE org_a uuid := current_setting('fx.org_a')::uuid; loc_a1 uuid := current_setting('fx.loc_a1')::uuid; BEGIN
 BEGIN PERFORM public.record_operational_movement(org_a,loc_a1,(SELECT id FROM public.inventory_items WHERE location_id=loc_a1 AND name='Beef'),'in',2,'repeat','move-repeat'); RAISE EXCEPTION 'FAIL movement replay conflict'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'idempotency_conflict' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.inventory_movements WHERE client_event_id='move-repeat')<>1 THEN RAISE EXCEPTION 'FAIL movement duplicate'; END IF;
 BEGIN PERFORM public.save_operational_record(org_a,'00000000-0000-0000-0000-000000000000','whatsapp','{"kind":"contact","consentGranted":false}'); RAISE EXCEPTION 'FAIL missing consent'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'consent_required' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record(org_a,'00000000-0000-0000-0000-000000000000','whatsapp','{"kind":"message","status":"sent"}'); RAISE EXCEPTION 'FAIL fake delivery'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'provider_unavailable' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ DECLARE org_a uuid := current_setting('fx.org_a')::uuid; loc_a1 uuid := current_setting('fx.loc_a1')::uuid; BEGIN BEGIN PERFORM public.create_pos_sale(org_a,loc_a1,'dine_in','none',_client_order_id=>'no-auth'); RAISE EXCEPTION 'FAIL missing auth'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END; END $$;
RESET ROLE;

-- ===================================================================== purchases
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT id AS inventory_id FROM public.inventory_items WHERE location_id=:'loc_a1' AND name='Beef' \gset
SELECT public.save_operational_record(:'org_a','00000000-0000-0000-0000-000000000000','supplier','{"name":"Test supplier"}') AS supplier_id \gset
SELECT public.save_operational_record(:'org_a',:'loc_a1','purchase',jsonb_build_object('supplierId',:'supplier_id','status','sent','discountCents',1000,'taxCents',1200,'shippingCents',500,'items',jsonb_build_array(jsonb_build_object('inventoryItemId',:'inventory_id','quantityOrdered',10,'unitPriceCents',1500)))) AS po_id \gset
DO $$ BEGIN IF (SELECT sum(round(i.quantity_ordered*i.unit_price_cents))-p.discount_cents+p.tax_cents+p.shipping_cents FROM public.purchase_orders p JOIN public.purchase_order_items i ON i.purchase_order_id=p.id GROUP BY p.id)<>15700 THEN RAISE EXCEPTION 'FAIL PO total'; END IF; END $$;
SELECT id AS po_item FROM public.purchase_order_items WHERE purchase_order_id=:'po_id' \gset
-- Stock baseline: assertions are relative to the stock after the hardening section (Beef +1).
SELECT set_config('qa.po_id',:'po_id',true), set_config('qa.inv_id',:'inventory_id',true), set_config('qa.beef0',(SELECT quantity::text FROM public.inventory_items WHERE id=:'inventory_id'),true), set_config('qa.beef_org0',(SELECT sum(quantity)::text FROM public.inventory_items WHERE org_id=:'org_a' AND name='Beef'),true) \gset qa_
SELECT public.receive_operational_purchase(:'po_id',jsonb_build_array(jsonb_build_object('itemId',:'po_item','receivedNow',4,'priceVerifiedCents',1500)),'receipt1','partial');
SELECT public.receive_operational_purchase(:'po_id',jsonb_build_array(jsonb_build_object('itemId',:'po_item','receivedNow',4,'priceVerifiedCents',1500)),'receipt1','partial');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.purchase_receipts WHERE purchase_order_id=current_setting('qa.po_id')::uuid AND client_event_id='receipt1')<>1 THEN RAISE EXCEPTION 'FAIL receipt duplicate (receipt row)'; END IF;
 IF (SELECT count(*) FROM public.inventory_movements WHERE inventory_item_id=current_setting('qa.inv_id')::uuid AND kind='receiving')<>1 THEN RAISE EXCEPTION 'FAIL receipt duplicate (stock movement)'; END IF;
 IF (SELECT quantity FROM public.inventory_items WHERE id=current_setting('qa.inv_id')::uuid)<>current_setting('qa.beef0')::numeric+4 THEN RAISE EXCEPTION 'FAIL receipt duplicate (stock quantity)'; END IF;
 IF (SELECT status FROM public.purchase_orders WHERE id=current_setting('qa.po_id')::uuid)<>'partially_received' THEN RAISE EXCEPTION 'FAIL partial status'; END IF;
END $$;
SELECT public.receive_operational_purchase(:'po_id',jsonb_build_array(jsonb_build_object('itemId',:'po_item','receivedNow',6,'priceVerifiedCents',1500)),'receipt2','complete');
DO $$ BEGIN IF (SELECT quantity FROM public.inventory_items WHERE id=current_setting('qa.inv_id')::uuid)<>current_setting('qa.beef0')::numeric+10 OR (SELECT status FROM public.purchase_orders WHERE id=current_setting('qa.po_id')::uuid)<>'received' THEN RAISE EXCEPTION 'FAIL complete receipt'; END IF; END $$;
SELECT public.record_operational_movement(:'org_a',:'loc_a1',:'inventory_id','transfer',2,'transfer','transfer1',:'loc_a2');
DO $$ BEGIN IF (SELECT sum(quantity) FROM public.inventory_items WHERE org_id=current_setting('fx.org_a')::uuid AND name='Beef')<>current_setting('qa.beef_org0')::numeric+10 THEN RAISE EXCEPTION 'FAIL transfer conservation'; END IF; END $$;
RESET ROLE;

\if :{?fixture_interrupt}
DO $$ BEGIN RAISE EXCEPTION 'fixture interrupted on purpose after all its writes (fixture_interrupt)'; END $$;
\endif
ROLLBACK;

-- After the rollback nothing of this run remains (checked by id, as the connecting role).
SELECT set_config('fx.left_org_a', :'org_a', false), set_config('fx.left_org_b', :'org_b', false),
       set_config('fx.left_owner_a', :'owner_a', false) \gset fx_
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.organizations WHERE id IN (current_setting('fx.left_org_a')::uuid, current_setting('fx.left_org_b')::uuid))
     OR EXISTS(SELECT 1 FROM auth.users WHERE id=current_setting('fx.left_owner_a')::uuid)
     OR EXISTS(SELECT 1 FROM public.orders WHERE org_id=current_setting('fx.left_org_a')::uuid) THEN
    RAISE EXCEPTION 'FAIL rollback: rows of this run remained';
  END IF;
END $$;
SELECT 'PASS: prices, tax, recipe consumption, cogs, idempotence, KDS, reversal, cross-org, cross-store, demo, conflict, rollback, staff cancellation, direct-write denial, RLS, anon execute; movement idempotence/conflict, consent enforcement, fake delivery denial, missing auth; PO formula 15700, partial/complete receipt, repeat receipt, transfer conservation; nothing kept (ROLLBACK)';
