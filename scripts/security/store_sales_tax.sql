\set ON_ERROR_STOP on
-- Target guard (scripts/guard/target-guard.mjs): stops here, before any write, unless this database
-- was marked disposable (claim on a new, empty stack, or an explicit adopt of a copy).
DO $$ BEGIN
  IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
    RAISE EXCEPTION 'refused by the target guard: not a disposable database (no dq_guard marker)';
  END IF;
  PERFORM dq_guard.attest('fixture:store_sales_tax');
END $$;
-- 0025: one sales-tax rate per store, charged by the server. Disposable local database only.
-- Everything runs in ONE transaction that is rolled back.
--
--   A: owner (U1) · manager (U2, settings.locations by default, store A1 only) · cashier staff (U3,
--      store A1 only) · stores A1, A2 · product "soda" $10.00 at every store
--   B: owner (U4) · store B1
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('a2500000-0000-4000-8000-000000000001','pr25-owner-a@example.test',now()),
('a2500000-0000-4000-8000-000000000002','pr25-manager-a@example.test',now()),
('a2500000-0000-4000-8000-000000000003','pr25-cashier-a@example.test',now()),
('a2500000-0000-4000-8000-000000000004','pr25-owner-b@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES
('b2500000-0000-4000-8000-000000000001','pr25_a','PR25 A','starter','active'),
('b2500000-0000-4000-8000-000000000002','pr25_b','PR25 B','starter','active');
UPDATE public.subscriptions SET status='active'
 WHERE org_id IN('b2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000002');
UPDATE public.organizations SET store_limit_override=5 WHERE id='b2500000-0000-4000-8000-000000000001'; -- room for the store created in 9
INSERT INTO public.locations(id,org_id,slug,name) VALUES
('c2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000001','pr25_a1','A1'),
('c2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000001','pr25_a2','A2'),
('c2500000-0000-4000-8000-000000000003','b2500000-0000-4000-8000-000000000002','pr25_b1','B1');
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('d2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000001','a2500000-0000-4000-8000-000000000001','owner'),
('d2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000001','a2500000-0000-4000-8000-000000000002','manager'),
('d2500000-0000-4000-8000-000000000003','b2500000-0000-4000-8000-000000000001','a2500000-0000-4000-8000-000000000003','staff'),
('d2500000-0000-4000-8000-000000000004','b2500000-0000-4000-8000-000000000002','a2500000-0000-4000-8000-000000000004','owner');
INSERT INTO public.member_location_access VALUES
('d2500000-0000-4000-8000-000000000002','c2500000-0000-4000-8000-000000000001'),
('d2500000-0000-4000-8000-000000000003','c2500000-0000-4000-8000-000000000001');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2500000-0000-4000-8000-000000000002' AND 'settings.locations'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: the manager must hold settings.locations by default'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2500000-0000-4000-8000-000000000003' AND 'pos.sell'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: the cashier must hold pos.sell by default'; END IF;
 IF EXISTS(SELECT 1 FROM public.locations WHERE org_id='b2500000-0000-4000-8000-000000000001' AND tax_rate_ppm IS NOT NULL) THEN
  RAISE EXCEPTION 'FAIL fixture: a new store must start without a rate'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000001',false);
SELECT public.save_operational_menu('b2500000-0000-4000-8000-000000000001','category','{"op":"create","id":"drinks","name":"Drinks"}');
SELECT public.save_operational_menu('b2500000-0000-4000-8000-000000000001','product','{"id":"soda","name":"Soda","category":"drinks","priceCents":1000,"prepTimeMinutes":1,"locationIds":[],"modifierGroups":[]}');

-- 1. Without a configured rate no sale is recorded, whatever the client claims.
DO $$ DECLARE A uuid:='b2500000-0000-4000-8000-000000000001'; A1 uuid:='c2500000-0000-4000-8000-000000000001'; BEGIN
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>0,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-none-0'); RAISE EXCEPTION 'FAIL sale without a store rate (0)';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_not_configured' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>88750,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-none-1'); RAISE EXCEPTION 'FAIL sale without a store rate (88750)';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_not_configured' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic(A,A1,'takeout','T',_tax_rate_basis_points=>888,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-none-2'); RAISE EXCEPTION 'FAIL legacy sale without a store rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_not_configured' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.orders WHERE org_id=A) THEN RAISE EXCEPTION 'FAIL an order was recorded without a rate'; END IF;
END $$;

-- 2. Who may configure a store: owner anywhere in A; manager only at A1; cashier never; owner of B never.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 BEGIN PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000001',62500); RAISE EXCEPTION 'FAIL cashier configured the rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000004',false);
DO $$ BEGIN
 BEGIN PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000001',62500); RAISE EXCEPTION 'FAIL owner of B configured a store of A';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.locations WHERE id='c2500000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL owner of B reads a store of A'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 BEGIN PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000002',62500); RAISE EXCEPTION 'FAIL manager configured a store without access';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 BEGIN PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000001',-1); RAISE EXCEPTION 'FAIL negative rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tax_rate' THEN RAISE; END IF; END;
 BEGIN PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000001',1000001); RAISE EXCEPTION 'FAIL rate above 100%%';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tax_rate' THEN RAISE; END IF; END;
 BEGIN PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000001',NULL); RAISE EXCEPTION 'FAIL null rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tax_rate' THEN RAISE; END IF; END;
 PERFORM public.set_location_tax_rate('c2500000-0000-4000-8000-000000000001',62500); -- 6.25%
END $$;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000001',false);
SELECT public.set_location_tax_rate('c2500000-0000-4000-8000-000000000002',88750); -- 8.875%
DO $$ BEGIN
 IF (SELECT tax_rate_ppm FROM public.locations WHERE id='c2500000-0000-4000-8000-000000000001')<>62500
    OR (SELECT tax_rate_ppm FROM public.locations WHERE id='c2500000-0000-4000-8000-000000000002')<>88750 THEN RAISE EXCEPTION 'FAIL rates not stored'; END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE org_id='b2500000-0000-4000-8000-000000000001' AND action='location.tax_rate_updated')<>2 THEN RAISE EXCEPTION 'FAIL audit of the rate changes'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='location.tax_rate_updated' AND actor_id='a2500000-0000-4000-8000-000000000002'
               AND metadata->>'from_ppm' IS NULL AND (metadata->>'to_ppm')::int=62500) THEN RAISE EXCEPTION 'FAIL audit row of the manager'; END IF;
END $$;

-- 3. The cashier cannot choose the rate: the claimed rate must equal the store's; the tax comes from the store.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000003',false);
DO $$ DECLARE A uuid:='b2500000-0000-4000-8000-000000000001'; A1 uuid:='c2500000-0000-4000-8000-000000000001'; A2 uuid:='c2500000-0000-4000-8000-000000000002'; sale uuid; o public.orders; BEGIN
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>0,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-claim-0'); RAISE EXCEPTION 'FAIL cashier sold at 0%%';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_changed' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>1000000,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-claim-100'); RAISE EXCEPTION 'FAIL cashier sold at 100%%';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_changed' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>62501,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-claim-off'); RAISE EXCEPTION 'FAIL a rate off by 1 ppm was accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_changed' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>NULL,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-claim-null'); RAISE EXCEPTION 'FAIL null confirmation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_sale' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.orders WHERE org_id=A) THEN RAISE EXCEPTION 'FAIL a refused sale was recorded'; END IF;
 -- the confirmed sale: 1000 x 6.25% = 62.5 -> 63 (half away from zero)
 sale:=public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>62500,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-ok-1'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.subtotal_cents<>1000 OR o.tax_cents<>63 OR o.total_cents<>1063 OR o.tax_rate_ppm<>62500 OR o.tax_rate_basis_points<>625 THEN RAISE EXCEPTION 'FAIL recorded sale: % % % % %', o.subtotal_cents, o.tax_cents, o.total_cents, o.tax_rate_ppm, o.tax_rate_basis_points; END IF;
 IF (SELECT amount_cents FROM public.payments WHERE order_id=o.id)<>1063 THEN RAISE EXCEPTION 'FAIL payment amount'; END IF;
 IF (SELECT amount_cents FROM public.finance_entries WHERE order_id=o.id AND kind='revenue')<>1000 THEN RAISE EXCEPTION 'FAIL revenue net of tax'; END IF;
 -- cashier cannot sell at A2 at all (store scope), rate or no rate
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A2,'takeout','T',_tax_rate_ppm=>88750,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-a2-cashier'); RAISE EXCEPTION 'FAIL cashier sold at A2';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END; -- assert_operational_scope: store outside the cashier's access
END $$;

-- 4. Three-decimal rate, discount, explicit 0%, rounding exactly as the money library.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000001',false);
DO $$ DECLARE A uuid:='b2500000-0000-4000-8000-000000000001'; A1 uuid:='c2500000-0000-4000-8000-000000000001'; A2 uuid:='c2500000-0000-4000-8000-000000000002'; sale uuid; o public.orders; BEGIN
 -- 1000 x 8.875% = 88.75 -> 89; basis points recorded as 888 (887.5 rounded half away from zero)
 sale:=public.persist_finalized_pos_sale_atomic_v2(A,A2,'takeout','T',_tax_rate_ppm=>88750,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-a2-1'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.tax_cents<>89 OR o.total_cents<>1089 OR o.tax_rate_ppm<>88750 OR o.tax_rate_basis_points<>888 THEN RAISE EXCEPTION 'FAIL 8.875%% sale: % % % %', o.tax_cents, o.total_cents, o.tax_rate_ppm, o.tax_rate_basis_points; END IF;
 -- 2 x 1000 - 500 = 1500 taxable x 8.875% = 133.125 -> 133
 sale:=public.persist_finalized_pos_sale_atomic_v2(A,A2,'takeout','T',_discount_cents=>500,_tax_rate_ppm=>88750,_items=>'[{"product_id":"soda","quantity":2,"modifiers":[]}]',_client_order_id=>'t-a2-2'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.subtotal_cents<>2000 OR o.discount_cents<>500 OR o.tax_cents<>133 OR o.total_cents<>1633 THEN RAISE EXCEPTION 'FAIL discounted sale: % % % %', o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents; END IF;
 -- explicit 0%: allowed and recorded as 0
 PERFORM public.set_location_tax_rate(A1,0);
 sale:=public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>0,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-a1-zero'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.tax_cents<>0 OR o.total_cents<>1000 OR o.tax_rate_ppm<>0 OR o.tax_rate_basis_points<>0 THEN RAISE EXCEPTION 'FAIL explicit 0%% sale'; END IF;
 PERFORM public.set_location_tax_rate(A1,62500);
END $$;

-- 5. A rate change while a ticket is open: the stale confirmation is refused, the replay of an
--    already recorded sale still returns it, and the new rate is accepted.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000003',false);
DO $$ DECLARE A uuid:='b2500000-0000-4000-8000-000000000001'; A1 uuid:='c2500000-0000-4000-8000-000000000001'; first uuid; sale uuid; o public.orders; BEGIN
 first:=(SELECT id FROM public.orders WHERE client_order_id='t-ok-1');
 PERFORM set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000001',true);
 PERFORM public.set_location_tax_rate(A1,70000); -- the owner changes the rate to 7%
 PERFORM set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000003',true);
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>62500,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-open-ticket'); RAISE EXCEPTION 'FAIL stale ticket charged at the old rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_changed' THEN RAISE; END IF; END;
 IF public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>62500,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-ok-1')<>first THEN RAISE EXCEPTION 'FAIL replay of a recorded sale after the rate change'; END IF;
 IF (SELECT count(*) FROM public.orders WHERE client_order_id='t-ok-1')<>1 OR (SELECT tax_cents FROM public.orders WHERE id=first)<>63 THEN RAISE EXCEPTION 'FAIL replay altered the recorded sale'; END IF;
 sale:=public.persist_finalized_pos_sale_atomic_v2(A,A1,'takeout','T',_tax_rate_ppm=>70000,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-open-ticket'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.tax_cents<>70 OR o.total_cents<>1070 OR o.tax_rate_ppm<>70000 THEN RAISE EXCEPTION 'FAIL sale at the new rate'; END IF;
END $$;

-- 6. Previous signatures: basis points x 100 must equal the store rate; they never bypass it.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000001',false);
DO $$ DECLARE A uuid:='b2500000-0000-4000-8000-000000000001'; A1 uuid:='c2500000-0000-4000-8000-000000000001'; A2 uuid:='c2500000-0000-4000-8000-000000000002'; sale uuid; o public.orders; BEGIN
 sale:=public.persist_finalized_pos_sale_atomic(A,A1,'takeout','T',_tax_rate_basis_points=>700,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-legacy-ok'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.tax_cents<>70 OR o.tax_rate_ppm<>70000 OR o.tax_rate_basis_points<>700 THEN RAISE EXCEPTION 'FAIL legacy sale at the store rate'; END IF;
 sale:=public.create_pos_sale(A,A1,'takeout','T',_tax_rate_basis_points=>700,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-legacy-open'); SELECT * INTO o FROM public.orders WHERE id=sale; IF o.id IS NULL THEN RAISE EXCEPTION 'FAIL recorded order not readable by the caller'; END IF;
 IF o.tax_cents<>70 OR o.tax_rate_ppm<>70000 OR o.status<>'new' THEN RAISE EXCEPTION 'FAIL legacy open order at the store rate'; END IF;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic(A,A1,'takeout','T',_tax_rate_basis_points=>0,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-legacy-0'); RAISE EXCEPTION 'FAIL legacy sale at 0%%';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_changed' THEN RAISE; END IF; END;
 BEGIN PERFORM public.persist_finalized_pos_sale_atomic(A,A2,'takeout','T',_tax_rate_basis_points=>888,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-legacy-888'); RAISE EXCEPTION 'FAIL legacy 888 accepted at 8.875%%';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'tax_rate_changed' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_pos_sale(A,A1,'takeout','T',_tax_rate_basis_points=>10001,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-legacy-range'); RAISE EXCEPTION 'FAIL legacy range';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_sale' THEN RAISE; END IF; END;
END $$;

-- 7. Reads: members see the rate of their stores (the POS needs it); the other organization does not.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 IF (SELECT tax_rate_ppm FROM public.locations WHERE id='c2500000-0000-4000-8000-000000000001')<>70000 THEN RAISE EXCEPTION 'FAIL cashier cannot read the rate of its store'; END IF;
 IF EXISTS(SELECT 1 FROM public.locations WHERE org_id='b2500000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL cashier reads stores of B'; END IF;
 IF (SELECT tax_rate_ppm FROM public.orders WHERE client_order_id='t-ok-1')<>62500 THEN RAISE EXCEPTION 'FAIL order keeps the rate it was charged'; END IF;
END $$;
RESET ROLE;

-- 8. Grants: new RPCs callable by authenticated only; previous rows got ppm = bp x 100.
DO $$ BEGIN
 IF has_function_privilege('anon','public.set_location_tax_rate(uuid,integer)','execute') THEN RAISE EXCEPTION 'FAIL anon may call set_location_tax_rate'; END IF;
 IF NOT has_function_privilege('authenticated','public.set_location_tax_rate(uuid,integer)','execute') THEN RAISE EXCEPTION 'FAIL authenticated cannot call set_location_tax_rate'; END IF;
 IF has_function_privilege('anon','public.create_location_with_tax_rate(uuid,text,text,text,text,integer)','execute') THEN RAISE EXCEPTION 'FAIL anon may call create_location_with_tax_rate'; END IF;
 IF NOT has_function_privilege('authenticated','public.create_location_with_tax_rate(uuid,text,text,text,text,integer)','execute') THEN RAISE EXCEPTION 'FAIL authenticated cannot call create_location_with_tax_rate'; END IF;
 IF has_function_privilege('anon','public.create_pos_sale_v2(uuid,uuid,public.order_type,text,text,text,text,text,text,integer,integer,jsonb,boolean,text)','execute') THEN RAISE EXCEPTION 'FAIL anon may call create_pos_sale_v2'; END IF;
 IF has_function_privilege('anon','public.persist_finalized_pos_sale_atomic_v2(uuid,uuid,public.order_type,text,text,text,text,text,text,integer,integer,jsonb,boolean,text,text)','execute') THEN RAISE EXCEPTION 'FAIL anon may call persist v2'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE tax_rate_ppm IS NULL OR tax_rate_ppm<>tax_rate_basis_points*100 AND tax_rate_basis_points<>round(tax_rate_ppm/100.0)) THEN RAISE EXCEPTION 'FAIL an order has no ppm or inconsistent basis points'; END IF;
END $$;
-- 9. Store creation with its rate in ONE transaction (create_location_with_tax_rate): owner only;
--    the rate is validated before anything is written; a refusal leaves no store and no audit row;
--    the created store is active, carries the rate, has both audit rows and sells at once.
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000002',false); -- manager (settings.locations at A1)
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.create_location_with_tax_rate('b2500000-0000-4000-8000-000000000001','A3','123 Main St','America/New_York','',62500); RAISE EXCEPTION 'FAIL manager created a store';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000003',false); -- cashier
DO $$ BEGIN
 BEGIN PERFORM public.create_location_with_tax_rate('b2500000-0000-4000-8000-000000000001','A3','123 Main St','America/New_York','',62500); RAISE EXCEPTION 'FAIL cashier created a store';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000004',false); -- owner of B
DO $$ BEGIN
 BEGIN PERFORM public.create_location_with_tax_rate('b2500000-0000-4000-8000-000000000001','A3','123 Main St','America/New_York','',62500); RAISE EXCEPTION 'FAIL owner of B created a store in A';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','a2500000-0000-4000-8000-000000000001',false); -- owner of A
DO $$ DECLARE A uuid:='b2500000-0000-4000-8000-000000000001'; n int; nid uuid; o public.orders; BEGIN
 n:=(SELECT count(*) FROM public.locations WHERE org_id=A);
 BEGIN PERFORM public.create_location_with_tax_rate(A,'A3','123 Main St','America/New_York','',NULL); RAISE EXCEPTION 'FAIL store created without a rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tax_rate' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_location_with_tax_rate(A,'A3','123 Main St','America/New_York','',1000001); RAISE EXCEPTION 'FAIL store created with a rate above 100%%';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tax_rate' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_location_with_tax_rate(A,'A3','123 Main St','America/New_York','',-1); RAISE EXCEPTION 'FAIL store created with a negative rate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tax_rate' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_location_with_tax_rate(A,'A3','123 Main St','Mars/Olympus','',62500); RAISE EXCEPTION 'FAIL store created with an invalid time zone';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_timezone' THEN RAISE; END IF; END;
 BEGIN PERFORM public.create_location_with_tax_rate(A,'A','123 Main St','America/New_York','',62500); RAISE EXCEPTION 'FAIL store created with a one-letter name';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_name' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.locations WHERE org_id=A)<>n THEN RAISE EXCEPTION 'FAIL a refused creation left a store'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_logs WHERE org_id=A AND action='location.created' AND target IN('A3','A')) THEN RAISE EXCEPTION 'FAIL a refused creation was audited'; END IF;
 nid:=public.create_location_with_tax_rate(A,'A3','123 Main St','America/New_York','+1 555-0100',66250); -- 6.625% (NJ)
 IF (SELECT count(*) FROM public.locations WHERE org_id=A)<>n+1 THEN RAISE EXCEPTION 'FAIL store not created'; END IF;
 IF (SELECT tax_rate_ppm FROM public.locations WHERE id=nid)<>66250 OR (SELECT status FROM public.locations WHERE id=nid)<>'active' THEN RAISE EXCEPTION 'FAIL created store rate or status'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE org_id=A AND action='location.created' AND target='A3' AND actor_id='a2500000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL creation not audited'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE org_id=A AND action='location.tax_rate_updated' AND (metadata->>'location_id')::uuid=nid AND metadata->>'from_ppm' IS NULL AND (metadata->>'to_ppm')::int=66250) THEN RAISE EXCEPTION 'FAIL rate of the new store not audited'; END IF;
 -- the new store sells at its rate immediately: 1000 x 6.625% = 66.25 -> 66
 PERFORM public.persist_finalized_pos_sale_atomic_v2(A,nid,'takeout','T',_tax_rate_ppm=>66250,_items=>'[{"product_id":"soda","quantity":1,"modifiers":[]}]',_client_order_id=>'t-a3-1');
 SELECT * INTO o FROM public.orders WHERE client_order_id='t-a3-1';
 IF o.id IS NULL OR o.location_id<>nid OR o.tax_cents<>66 OR o.total_cents<>1066 OR o.tax_rate_ppm<>66250 THEN RAISE EXCEPTION 'FAIL sale at the new store'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: store without a rate cannot sell, only owner/manager with settings.locations configure their own stores (audited, cross-org denied), claimed rate must equal the store rate exactly, tax from the store rate (6.25%, 8.875%, discount, explicit 0%), rate change with an open ticket, idempotent replay, previous signatures delegate, reads scoped, grants, store created with its rate in one transaction (owner only, nothing written on refusal)';
ROLLBACK;
