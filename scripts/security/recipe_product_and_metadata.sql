\set ON_ERROR_STOP on
-- 0024: a recipe can change its product; ingredient cost snapshots never reach product_recipes.metadata.
-- Disposable local database only. Everything runs in ONE transaction that is rolled back.
--
--   owner of A (every permission) · kitchen staff of A with store A1 only (recipes.view and
--   inventory.view by default, never inventory.costs)
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('a2400000-0000-4000-8000-000000000001','pr24-owner@example.test',now()),
('a2400000-0000-4000-8000-000000000002','pr24-kitchen@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES
('b2400000-0000-4000-8000-000000000001','pr24_a','PR24 A','starter','active');
UPDATE public.subscriptions SET status='active' WHERE org_id='b2400000-0000-4000-8000-000000000001';
INSERT INTO public.locations(id,org_id,slug,name,tax_rate_ppm) VALUES
('c2400000-0000-4000-8000-000000000001','b2400000-0000-4000-8000-000000000001','pr24_a1','A1',62500);
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('d2400000-0000-4000-8000-000000000001','b2400000-0000-4000-8000-000000000001','a2400000-0000-4000-8000-000000000001','owner'),
('d2400000-0000-4000-8000-000000000002','b2400000-0000-4000-8000-000000000001','a2400000-0000-4000-8000-000000000002','staff');
INSERT INTO public.member_location_access VALUES
('d2400000-0000-4000-8000-000000000002','c2400000-0000-4000-8000-000000000001');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2400000-0000-4000-8000-000000000002'
               AND 'recipes.view'=ANY(effective_permissions) AND NOT 'inventory.costs'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: kitchen staff must hold recipes.view and not inventory.costs'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2400000-0000-4000-8000-000000000001',false);
SELECT public.save_operational_menu('b2400000-0000-4000-8000-000000000001','category','{"id":"food","name":"Food"}');
SELECT public.save_operational_menu('b2400000-0000-4000-8000-000000000001','product','{"id":"burger","name":"Burger","category":"food","priceCents":1500,"prepTimeMinutes":10,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2400000-0000-4000-8000-000000000001','product','{"id":"veggie","name":"Veggie Burger","category":"food","priceCents":1400,"prepTimeMinutes":10,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_menu('b2400000-0000-4000-8000-000000000001','product','{"id":"salad","name":"Salad","category":"food","priceCents":900,"prepTimeMinutes":5,"locationIds":[],"modifierGroups":[]}');
SELECT public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','inventory','{"name":"Beef","category":"meat","unit":"lb","quantity":10,"costCents":400}') AS beef_id \gset
SELECT public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','inventory','{"name":"Bun","category":"dry_goods","unit":"units","quantity":20,"costCents":50}') AS bun_id \gset
SELECT set_config('vars.beef',:'beef_id',false); SELECT set_config('vars.bun',:'bun_id',false);

-- 1. The payload of the inventory screen (before this PR) carried cost snapshots per ingredient.
SELECT public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',
  jsonb_build_object('productId','burger','productName','Burger','servings',1,'yieldQuantity',1,'yieldUnit','units','sellingPriceCents',1500,'prepInstructions','grill',
    'ingredients',jsonb_build_array(
      jsonb_build_object('inventoryItemId',:'beef_id','quantity',0.5,'unit','lb','wastePercentage',0,'unitCostCents',400,'subtotalCostCents',200,'name','Beef'),
      jsonb_build_object('inventoryItemId',:'bun_id','quantity',1,'unit','units','wastePercentage',0,'unitCostCents',50,'subtotalCostCents',50,'name','Bun')))) AS recipe_id \gset
SELECT set_config('vars.recipe',:'recipe_id',false);
DO $$ DECLARE r public.product_recipes; BEGIN
 SELECT * INTO r FROM public.product_recipes WHERE id=current_setting('vars.recipe')::uuid;
 IF r.id IS NULL THEN RAISE EXCEPTION 'FAIL recipe not readable by its owner'; END IF;
 IF r.metadata ? 'ingredients' THEN RAISE EXCEPTION 'FAIL metadata stores the ingredient list'; END IF;
 IF r.metadata::text ~* 'cost' THEN RAISE EXCEPTION 'FAIL metadata stores a cost snapshot: %', r.metadata; END IF;
 IF r.metadata->>'productName'<>'Burger' OR (r.metadata->>'sellingPriceCents')::int<>1500 OR r.metadata->>'prepInstructions'<>'grill' THEN RAISE EXCEPTION 'FAIL metadata fields: %', r.metadata; END IF;
 IF (SELECT count(*) FROM public.recipe_ingredients WHERE recipe_id=r.id)<>2 THEN RAISE EXCEPTION 'FAIL recipe_ingredients rows'; END IF;
 IF r.product_id<>(SELECT id FROM public.menu_products WHERE client_id='burger') THEN RAISE EXCEPTION 'FAIL product'; END IF;
END $$;

-- 2. Editing the recipe and choosing another product updates product_id (audited); the sale RPC follows.
SELECT public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',
  jsonb_build_object('id',:'recipe_id','productId','veggie','productName','Veggie Burger','servings',1,'yieldQuantity',1,'yieldUnit','units','sellingPriceCents',1400,
    'ingredients',jsonb_build_array(
      jsonb_build_object('inventoryItemId',:'beef_id','quantity',0.5,'unit','lb','wastePercentage',0),
      jsonb_build_object('inventoryItemId',:'bun_id','quantity',1,'unit','units','wastePercentage',0))));
DO $$ DECLARE r public.product_recipes; a public.audit_logs; BEGIN
 SELECT * INTO r FROM public.product_recipes WHERE id=current_setting('vars.recipe')::uuid;
 IF r.id IS NULL THEN RAISE EXCEPTION 'FAIL recipe not readable after the edit'; END IF;
 IF r.product_id<>(SELECT id FROM public.menu_products WHERE client_id='veggie') THEN RAISE EXCEPTION 'FAIL product_id not updated'; END IF;
 IF r.metadata->>'productName'<>'Veggie Burger' THEN RAISE EXCEPTION 'FAIL productName not updated'; END IF;
 IF (SELECT count(*) FROM public.product_recipes WHERE org_id='b2400000-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'FAIL recipe duplicated'; END IF;
 SELECT * INTO a FROM public.audit_logs WHERE action='recipe.product_changed' AND org_id='b2400000-0000-4000-8000-000000000001';
 IF a.id IS NULL OR (a.metadata->>'from_product_id')::uuid<>(SELECT id FROM public.menu_products WHERE client_id='burger')
    OR (a.metadata->>'to_product_id')::uuid<>r.product_id THEN RAISE EXCEPTION 'FAIL audit of the product change: %', a.metadata; END IF;
END $$;
-- same product again: no new audit row
SELECT public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',
  jsonb_build_object('id',:'recipe_id','productId','veggie','servings',1,'ingredients',jsonb_build_array(
      jsonb_build_object('inventoryItemId',:'beef_id','quantity',0.5,'unit','lb','wastePercentage',0),
      jsonb_build_object('inventoryItemId',:'bun_id','quantity',1,'unit','units','wastePercentage',0))));
DO $$ BEGIN IF (SELECT count(*) FROM public.audit_logs WHERE action='recipe.product_changed')<>1 THEN RAISE EXCEPTION 'FAIL audit written without a product change'; END IF; END $$;
-- selling the new product consumes the ingredients; selling the old one consumes nothing
SELECT public.persist_finalized_pos_sale_atomic_v2('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','takeout','Test',_tax_rate_ppm=>62500,_items=>'[{"product_id":"veggie","quantity":1,"modifiers":[]}]',_client_order_id=>'pr24-veggie',_payment_method=>'cash');
SELECT public.persist_finalized_pos_sale_atomic_v2('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','takeout','Test',_tax_rate_ppm=>62500,_items=>'[{"product_id":"burger","quantity":1,"modifiers":[]}]',_client_order_id=>'pr24-burger',_payment_method=>'cash');
DO $$ BEGIN
 IF (SELECT quantity FROM public.inventory_items WHERE id=current_setting('vars.beef')::uuid)<>9.5 THEN RAISE EXCEPTION 'FAIL beef consumption after the product change'; END IF;
 IF (SELECT quantity FROM public.inventory_items WHERE id=current_setting('vars.bun')::uuid)<>19 THEN RAISE EXCEPTION 'FAIL bun consumption after the product change'; END IF;
 IF (SELECT amount_cents FROM public.finance_entries e JOIN public.orders o ON o.id=e.order_id WHERE o.client_order_id='pr24-veggie' AND e.kind='cogs')<>250 THEN RAISE EXCEPTION 'FAIL cogs of the new product'; END IF;
 IF (SELECT amount_cents FROM public.finance_entries e JOIN public.orders o ON o.id=e.order_id WHERE o.client_order_id='pr24-burger' AND e.kind='cogs')<>0 THEN RAISE EXCEPTION 'FAIL the old product still consumes'; END IF;
END $$;

-- 3. One recipe per product and store, as a business error; invalid price or servings refused.
SELECT public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',
  jsonb_build_object('productId','salad','servings',1,'ingredients',jsonb_build_array(jsonb_build_object('inventoryItemId',:'bun_id','quantity',1,'unit','units','wastePercentage',0)))) AS salad_recipe \gset
SELECT set_config('vars.salad',:'salad_recipe',false);
DO $$ DECLARE bun text:=current_setting('vars.bun'); ing jsonb; BEGIN
 ing:=jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'quantity',1,'unit','units','wastePercentage',0));
 BEGIN PERFORM public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',jsonb_build_object('id',current_setting('vars.salad'),'productId','veggie','servings',1,'ingredients',ing)); RAISE EXCEPTION 'FAIL second recipe for the same product (edit)';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'recipe_exists_for_product' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',jsonb_build_object('productId','veggie','servings',1,'ingredients',ing)); RAISE EXCEPTION 'FAIL second recipe for the same product (create)';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'recipe_exists_for_product' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',jsonb_build_object('id',current_setting('vars.salad'),'productId','salad','servings',1,'sellingPriceCents',-1,'ingredients',ing)); RAISE EXCEPTION 'FAIL negative selling price';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_recipe' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record('b2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','recipe',jsonb_build_object('id',current_setting('vars.salad'),'productId','salad','servings',0,'ingredients',ing)); RAISE EXCEPTION 'FAIL zero servings';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_recipe' THEN RAISE; END IF; END;
 IF (SELECT product_id FROM public.product_recipes WHERE id=current_setting('vars.salad')::uuid)<>(SELECT id FROM public.menu_products WHERE client_id='salad') THEN RAISE EXCEPTION 'FAIL refused edits changed the recipe'; END IF;
END $$;

-- 3b. Direct RPC calls with a malformed ingredient list never store a recipe: the list is validated in
--     SQL (0024), not only by the application schema. Absent key, JSON null, object, string and empty
--     array -> ingredients_required; a non-object element, a non-numeric quantity or a waste
--     percentage outside 0..100 -> invalid_recipe; a zero or negative quantity -> invalid_quantity;
--     more than 200 elements -> invalid_recipe; an item of another store -> ingredient_not_in_store.
--     An edit with a malformed list keeps the recipe and its ingredient rows. Same guard for the item
--     list of a purchase order (items_required). A NULL payload -> invalid_payload.
DO $$ DECLARE A uuid:='b2400000-0000-4000-8000-000000000001'; A1 uuid:='c2400000-0000-4000-8000-000000000001'; bun text:=current_setting('vars.bun'); salad uuid:=current_setting('vars.salad')::uuid; recipes int; rows int; bad jsonb; sup uuid; BEGIN
 recipes:=(SELECT count(*) FROM public.product_recipes WHERE org_id=A); rows:=(SELECT count(*) FROM public.recipe_ingredients WHERE org_id=A);
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    '{"productId":"burger","servings":1}'::jsonb,
    '{"productId":"burger","servings":1,"ingredients":null}'::jsonb,
    '{"productId":"burger","servings":1,"ingredients":{}}'::jsonb,
    '{"productId":"burger","servings":1,"ingredients":"x"}'::jsonb,
    '{"productId":"burger","servings":1,"ingredients":[]}'::jsonb)) LOOP
  BEGIN PERFORM public.save_operational_record(A,A1,'recipe',bad); RAISE EXCEPTION 'FAIL recipe stored with ingredients=%', coalesce(bad->'ingredients','"absent"'::jsonb);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ingredients_required' THEN RAISE; END IF; END;
 END LOOP;
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_array(1),
    jsonb_build_array('text'),
    jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'quantity','1','unit','units')),
    jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'unit','units')),
    jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'quantity',1,'unit','units','wastePercentage',101)),
    jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'quantity',1,'unit','units','wastePercentage',-1)),
    (SELECT jsonb_agg(jsonb_build_object('inventoryItemId',bun,'quantity',1,'unit','units')) FROM generate_series(1,201)))) LOOP
  BEGIN PERFORM public.save_operational_record(A,A1,'recipe',jsonb_build_object('productId','burger','servings',1,'ingredients',bad)); RAISE EXCEPTION 'FAIL recipe stored with element list %', left(bad::text,80);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_recipe' THEN RAISE; END IF; END;
 END LOOP;
 FOR bad IN SELECT value FROM jsonb_array_elements('[0,-1]'::jsonb) LOOP
  BEGIN PERFORM public.save_operational_record(A,A1,'recipe',jsonb_build_object('productId','burger','servings',1,'ingredients',jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'quantity',bad,'unit','units')))); RAISE EXCEPTION 'FAIL recipe stored with quantity %', bad;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_quantity' THEN RAISE; END IF; END;
 END LOOP;
 BEGIN PERFORM public.save_operational_record(A,A1,'recipe',jsonb_build_object('productId','burger','servings',1,'ingredients',jsonb_build_array(jsonb_build_object('inventoryItemId',gen_random_uuid(),'quantity',1,'unit','units')))); RAISE EXCEPTION 'FAIL recipe stored with an unknown ingredient';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ingredient_not_in_store' THEN RAISE; END IF; END;
 -- an edit with a malformed list is refused before anything is touched
 BEGIN PERFORM public.save_operational_record(A,A1,'recipe',jsonb_build_object('id',salad,'productId','salad','servings',1)); RAISE EXCEPTION 'FAIL edit without ingredients accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ingredients_required' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record(A,A1,'recipe',jsonb_build_object('id',salad,'productId','salad','servings',1,'ingredients','[]'::jsonb)); RAISE EXCEPTION 'FAIL edit with an empty list accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ingredients_required' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record(A,A1,'recipe',jsonb_build_object('id',salad,'productId','salad','servings',1,'ingredients',jsonb_build_array(jsonb_build_object('inventoryItemId',bun,'quantity',0,'unit','units')))); RAISE EXCEPTION 'FAIL edit with a zero quantity accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_quantity' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.recipe_ingredients WHERE recipe_id=salad)<>1 THEN RAISE EXCEPTION 'FAIL a refused edit changed the ingredient rows'; END IF;
 IF (SELECT count(*) FROM public.product_recipes WHERE org_id=A)<>recipes OR (SELECT count(*) FROM public.recipe_ingredients WHERE org_id=A)<>rows THEN RAISE EXCEPTION 'FAIL a refused call changed the recipes'; END IF;
 IF EXISTS(SELECT 1 FROM public.product_recipes r WHERE r.org_id=A AND NOT EXISTS(SELECT 1 FROM public.recipe_ingredients i WHERE i.recipe_id=r.id)) THEN RAISE EXCEPTION 'FAIL a recipe without ingredient rows exists'; END IF;
 BEGIN PERFORM public.save_operational_record(A,A1,'recipe',NULL); RAISE EXCEPTION 'FAIL NULL payload accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_payload' THEN RAISE; END IF; END;
 -- purchase orders: the item list has the same NULL-safe guard
 sup:=public.save_operational_record(A,A1,'supplier','{"name":"PR24 Supplier"}');
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array('{}'::jsonb,'{"items":null}'::jsonb,'{"items":{}}'::jsonb,'{"items":"x"}'::jsonb,'{"items":[]}'::jsonb)) LOOP
  BEGIN PERFORM public.save_operational_record(A,A1,'purchase',jsonb_build_object('supplierId',sup)||bad); RAISE EXCEPTION 'FAIL purchase stored with items=%', coalesce(bad->'items','"absent"'::jsonb);
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'items_required' THEN RAISE; END IF; END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.purchase_orders WHERE org_id=A) THEN RAISE EXCEPTION 'FAIL a purchase order without items was stored'; END IF;
END $$;

-- 4. Reads by the kitchen: recipes are visible, costs are not (neither in metadata nor through the gate).
SELECT set_config('request.jwt.claim.sub','a2400000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.product_recipes WHERE org_id='b2400000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'FAIL kitchen cannot read the recipes of its store'; END IF;
 IF EXISTS(SELECT 1 FROM public.product_recipes WHERE metadata::text ~* 'cost' OR metadata ? 'ingredients') THEN RAISE EXCEPTION 'FAIL a recipe readable by the kitchen carries costs'; END IF;
 IF (SELECT count(*) FROM public.recipe_ingredients WHERE org_id='b2400000-0000-4000-8000-000000000001')<>3 THEN RAISE EXCEPTION 'FAIL kitchen reads ingredient rows'; END IF;
 BEGIN PERFORM public.inventory_item_costs('b2400000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'FAIL kitchen reads costs through the gate';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE; END IF; END;
END $$;
RESET ROLE;

-- 5. No code path can store the list again; the rows migrated by 0024 keep their ingredients.
DO $$ BEGIN
 BEGIN UPDATE public.product_recipes SET metadata=metadata||'{"ingredients":[{"unitCostCents":1}]}' WHERE id=current_setting('vars.recipe')::uuid; RAISE EXCEPTION 'FAIL metadata accepted an ingredient list';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.product_recipes WHERE metadata ? 'ingredients') THEN RAISE EXCEPTION 'FAIL a recipe still carries metadata.ingredients'; END IF;
 IF EXISTS(SELECT 1 FROM public.product_recipes r WHERE NOT EXISTS(SELECT 1 FROM public.recipe_ingredients i WHERE i.recipe_id=r.id)) THEN RAISE EXCEPTION 'FAIL a recipe lost its ingredient rows'; END IF;
 IF EXISTS(SELECT 1 FROM public.product_recipes r JOIN public.menu_products p ON p.id=r.product_id WHERE r.metadata->>'productName' IS DISTINCT FROM p.name) THEN RAISE EXCEPTION 'FAIL productName differs from the product'; END IF;
END $$;
SELECT 'PASS: recipe product change (product_id, audit, sale consumption), one recipe per product, invalid recipe refused, malformed ingredient lists refused by SQL on direct RPC calls (absent/null/non-array/empty/bad elements, edits untouched, purchase items too), metadata without ingredient list or cost snapshots (RPC, CHECK, kitchen read), migrated rows keep recipe_ingredients';
ROLLBACK;
