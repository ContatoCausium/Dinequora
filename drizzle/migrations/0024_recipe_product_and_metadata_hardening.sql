-- 0024: recipes — the product of a recipe can be changed, and ingredient cost snapshots never
-- reach product_recipes.metadata.
--
-- Two defects of save_operational_record (last defined in 0020, same signature here):
--   1. The recipe upsert did not include product_id in its ON CONFLICT ... DO UPDATE list. Editing
--      a recipe and choosing another product wrote only metadata.productName, so the card showed the
--      new product while the sale RPC kept consuming the ingredients for the old one.
--   2. The whole payload was stored as metadata. The inventory screen sent each ingredient with its
--      cost snapshot (unitCostCents / subtotalCostCents), readable through product_recipes by any
--      member with recipes.view or inventory.view — bypassing the inventory.costs gate of 0020.
--
-- Changes (additive; the function keeps its signature, permission checks and every other branch):
--   - recipe branch: product_id is updated; changing the product of an existing recipe is audited
--     (recipe.product_changed); a second recipe for the same product at the same store is refused
--     with recipe_exists_for_product (the UNIQUE(org_id, location_id, product_id) of 0012 used to
--     surface as a raw unique_violation); metadata is built explicitly (productName from
--     menu_products, sellingPriceCents, prepInstructions, yieldUnit) and never copied from the
--     payload; a negative selling price is refused (invalid_recipe); the ingredient list is validated
--     in SQL (absent, JSON null, non-array or empty -> ingredients_required; an element that is not an
--     object with a numeric quantity and a waste percentage within 0..100 -> invalid_recipe), so a
--     direct RPC call cannot store a recipe without ingredients. The same NULL-safe guard applies to
--     the item list of a purchase (items_required).
--   - existing rows: the unread metadata.ingredients key is removed (the ingredients live in
--     recipe_ingredients, nothing reads the copy) and productName is realigned to menu_products.
--   - CHECK product_recipes_metadata_no_ingredients so no future code path can store the list (and
--     its cost snapshots) in metadata again.

CREATE OR REPLACE FUNCTION public.save_operational_record(_org_id uuid, _location_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE id0 uuid; item jsonb; ref uuid; product uuid; product_name text; meta jsonb; category text; existing public.inventory_items; recipe public.product_recipes; po public.purchase_orders; BEGIN
IF _kind='whatsapp' THEN IF auth.uid() IS NULL OR NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_org_operational(_org_id);ELSIF _kind='supplier' THEN IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id,'suppliers.edit'); PERFORM public.assert_org_operational(_org_id);ELSE PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id, CASE _kind WHEN 'inventory' THEN CASE WHEN coalesce(_payload->>'id','')='' THEN 'inventory.create' ELSE 'inventory.edit' END WHEN 'recipe' THEN 'recipes.edit' WHEN 'purchase' THEN 'purchases.create' WHEN 'expense' THEN CASE WHEN coalesce(_payload->>'id','')='' THEN 'expenses.create' ELSE 'expenses.edit' END ELSE 'invalid_kind' END, _location_id); IF _kind='purchase' AND coalesce(_payload->>'status','draft')='sent' THEN PERFORM public.assert_permission(_org_id,'purchases.approve',_location_id); END IF; IF _kind='expense' AND coalesce(_payload->>'status','')='paid' AND NOT EXISTS(SELECT 1 FROM public.finance_expenses WHERE id::text=coalesce(_payload->>'id','') AND payload->>'status'='paid') THEN PERFORM public.assert_permission(_org_id,'expenses.pay',_location_id); END IF; IF _kind='expense' AND coalesce((_payload->>'active')::boolean,true)=false THEN PERFORM public.assert_permission(_org_id,'expenses.delete',_location_id); END IF; END IF;
IF _payload IS NULL OR jsonb_typeof(_payload)<>'object' THEN RAISE EXCEPTION 'invalid_payload'; END IF;
IF coalesce(_payload->>'id','')<>'' THEN id0:=(_payload->>'id')::uuid; END IF;
IF _kind='inventory' THEN IF NOT (_payload ? 'quantity' AND _payload ? 'costCents' AND _payload ? 'unit') OR _payload->>'quantity' IS NULL OR _payload->>'costCents' IS NULL OR _payload->>'unit' NOT IN('oz','lb','gal','kg','units','pack') THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR (_payload->>'costCents')::int<0 OR (_payload->>'quantity')::numeric<0 THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO existing FROM public.inventory_items WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF existing.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 UPDATE public.inventory_items SET name=_payload->>'name',category=coalesce(_payload->>'category','dry_goods'),sku=coalesce(_payload->>'sku',''),min_quantity=coalesce((_payload->>'minQuantity')::numeric,0),cost_cents=CASE WHEN public.has_permission(_org_id,'inventory.costs',_location_id) THEN (_payload->>'costCents')::int ELSE cost_cents END,supplier=coalesce(_payload->>'supplier',''),active=coalesce((_payload->>'active')::boolean,true),updated_at=now() WHERE id=id0;
 ELSE id0:=gen_random_uuid(); INSERT INTO public.inventory_items(id,org_id,location_id,client_id,name,category,sku,unit,quantity,min_quantity,cost_cents,supplier) VALUES(id0,_org_id,_location_id,id0::text,_payload->>'name',coalesce(_payload->>'category','dry_goods'),coalesce(_payload->>'sku',''),_payload->>'unit',(_payload->>'quantity')::numeric,coalesce((_payload->>'minQuantity')::numeric,0),(_payload->>'costCents')::int,coalesce(_payload->>'supplier',''));
 IF (_payload->>'quantity')::numeric>0 THEN INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,id0,(_payload->>'quantity')::numeric,(_payload->>'costCents')::int,'opening','opening:'||id0::text,'Opening stock',auth.uid()); END IF; END IF;
ELSIF _kind='recipe' THEN
 SELECT id,name INTO product,product_name FROM public.menu_products WHERE org_id=_org_id AND (id::text=_payload->>'productId' OR client_id=_payload->>'productId') AND active AND (cardinality(location_ids)=0 OR _location_id=ANY(location_ids)); IF product IS NULL THEN RAISE EXCEPTION 'product_required'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO recipe FROM public.product_recipes WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF recipe.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; END IF;
 -- The ingredient list is validated here, not only by the application: jsonb_typeof(NULL) is NULL, so a
 -- missing key would have slipped through "<> 'array'". Absent, JSON null, non-array and empty are refused.
 IF NOT (_payload ? 'ingredients') OR jsonb_typeof(_payload->'ingredients') IS DISTINCT FROM 'array' OR jsonb_array_length(_payload->'ingredients')=0 THEN RAISE EXCEPTION 'ingredients_required'; END IF;
 IF jsonb_array_length(_payload->'ingredients')>200 THEN RAISE EXCEPTION 'invalid_recipe'; END IF;
 IF coalesce((_payload->>'sellingPriceCents')::int,0)<0 OR coalesce((_payload->>'servings')::numeric,0)<=0 THEN RAISE EXCEPTION 'invalid_recipe'; END IF;
 -- One recipe per product and store (UNIQUE of 0012), reported as a business error instead of a raw unique_violation.
 IF EXISTS(SELECT 1 FROM public.product_recipes r WHERE r.org_id=_org_id AND r.location_id=_location_id AND r.product_id=product AND (id0 IS NULL OR r.id<>id0)) THEN RAISE EXCEPTION 'recipe_exists_for_product'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 -- metadata is built here, never copied from the payload: no ingredient list (and no cost snapshot) is ever stored in it.
 meta:=jsonb_build_object('productName',product_name,'sellingPriceCents',coalesce((_payload->>'sellingPriceCents')::int,0),'prepInstructions',coalesce(_payload->>'prepInstructions',''),'yieldUnit',coalesce(_payload->>'yieldUnit','units'));
 INSERT INTO public.product_recipes(id,org_id,location_id,product_id,servings,yield_quantity,yield_unit,instructions,metadata) VALUES(id0,_org_id,_location_id,product,(_payload->>'servings')::numeric,coalesce((_payload->>'yieldQuantity')::numeric,1),coalesce(_payload->>'yieldUnit','units'),coalesce(_payload->>'prepInstructions',''),meta)
 ON CONFLICT(id) DO UPDATE SET product_id=EXCLUDED.product_id,servings=EXCLUDED.servings,yield_quantity=EXCLUDED.yield_quantity,yield_unit=EXCLUDED.yield_unit,instructions=EXCLUDED.instructions,metadata=EXCLUDED.metadata,updated_at=now();
 IF recipe.id IS NOT NULL AND recipe.product_id<>product THEN PERFORM public.write_audit(_org_id,'recipe.product_changed',id0::text,jsonb_build_object('location_id',_location_id,'from_product_id',recipe.product_id,'to_product_id',product)); END IF;
 DELETE FROM public.recipe_ingredients WHERE recipe_id=id0;
 FOR item IN SELECT * FROM jsonb_array_elements(_payload->'ingredients') LOOP
  -- Each ingredient must be an object with a numeric quantity (> 0 is enforced by operational_unit_quantity) and a waste percentage within 0..100.
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR coalesce((item->>'wastePercentage')::numeric,0) NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid_recipe'; END IF;
  ref:=(item->>'inventoryItemId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE id=ref AND org_id=_org_id AND location_id=_location_id AND active) THEN RAISE EXCEPTION 'ingredient_not_in_store'; END IF;
  PERFORM public.operational_unit_quantity((item->>'quantity')::numeric,item->>'unit',(SELECT unit FROM public.inventory_items WHERE id=ref));
  INSERT INTO public.recipe_ingredients(org_id,location_id,recipe_id,inventory_item_id,quantity,unit,waste_percentage) VALUES(_org_id,_location_id,id0,ref,(item->>'quantity')::numeric,item->>'unit',coalesce((item->>'wastePercentage')::numeric,0)); END LOOP;
ELSIF _kind='supplier' THEN
 IF id0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=id0 AND org_id=_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF coalesce(length(trim(_payload->>'name')),0)=0 THEN RAISE EXCEPTION 'invalid_supplier'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.suppliers(id,org_id,name,details,active) VALUES(id0,_org_id,_payload->>'name',_payload,coalesce((_payload->>'active')::boolean,true)) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,details=EXCLUDED.details,active=EXCLUDED.active,updated_at=now();
ELSIF _kind='purchase' THEN
 IF id0 IS NOT NULL THEN SELECT * INTO po FROM public.purchase_orders WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF po.id IS NULL OR po.status NOT IN('draft','sent') OR EXISTS(SELECT 1 FROM public.purchase_receipts WHERE purchase_order_id=id0) THEN RAISE EXCEPTION 'purchase_locked'; END IF; END IF;
 ref:=(_payload->>'supplierId')::uuid; IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=ref AND org_id=_org_id AND active) THEN RAISE EXCEPTION 'supplier_required'; END IF;
 IF coalesce(_payload->>'status','draft') NOT IN('draft','sent') THEN RAISE EXCEPTION 'invalid_purchase_status'; END IF;
 IF NOT (_payload ? 'items') OR jsonb_typeof(_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(_payload->'items')=0 THEN RAISE EXCEPTION 'items_required'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.purchase_orders(id,org_id,location_id,supplier_id,status,discount_cents,tax_cents,shipping_cents,notes,metadata) VALUES(id0,_org_id,_location_id,ref,coalesce(_payload->>'status','draft'),coalesce((_payload->>'discountCents')::int,0),coalesce((_payload->>'taxCents')::int,0),coalesce((_payload->>'shippingCents')::int,0),coalesce(_payload->>'notes',''),_payload) ON CONFLICT(id) DO UPDATE SET supplier_id=EXCLUDED.supplier_id,status=EXCLUDED.status,discount_cents=EXCLUDED.discount_cents,tax_cents=EXCLUDED.tax_cents,shipping_cents=EXCLUDED.shipping_cents,notes=EXCLUDED.notes,metadata=EXCLUDED.metadata,updated_at=now();
 DELETE FROM public.purchase_order_items WHERE purchase_order_id=id0;
 FOR item IN SELECT * FROM jsonb_array_elements(_payload->'items') LOOP INSERT INTO public.purchase_order_items(org_id,location_id,purchase_order_id,inventory_item_id,quantity_ordered,unit_price_cents) VALUES(_org_id,_location_id,id0,(item->>'inventoryItemId')::uuid,(item->>'quantityOrdered')::numeric,(item->>'unitPriceCents')::int); END LOOP;
 IF (SELECT sum(round(quantity_ordered*unit_price_cents)) FROM public.purchase_order_items WHERE purchase_order_id=id0)<coalesce((_payload->>'discountCents')::int,0) THEN RAISE EXCEPTION 'invalid_discount'; END IF;
ELSIF _kind='expense' THEN
 IF id0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_expenses WHERE id=id0 AND org_id=_org_id AND location_id=_location_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF (_payload->>'amountCents')::int<0 OR coalesce(_payload->>'status','') NOT IN('pending','paid','overdue') OR coalesce(_payload->>'recurrence','') NOT IN('fixed','variable','recurring') OR coalesce(_payload->>'description','')='' THEN RAISE EXCEPTION 'invalid_expense'; END IF;
 IF coalesce((_payload->>'isSimulation')::boolean,false) AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=_org_id AND is_demo) THEN RAISE EXCEPTION 'simulation_forbidden'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.finance_expenses(id,org_id,location_id,payload,active) VALUES(id0,_org_id,_location_id,_payload,coalesce((_payload->>'active')::boolean,true)) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,active=EXCLUDED.active,updated_at=now();
ELSIF _kind='whatsapp' THEN
 IF id0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.whatsapp_records WHERE id=id0 AND org_id=_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _payload->>'kind'='contact' AND coalesce((_payload->>'consentGranted')::boolean,false)=false THEN RAISE EXCEPTION 'consent_required'; END IF;
 IF coalesce(_payload->>'status','') IN('sent','delivered') THEN RAISE EXCEPTION 'provider_unavailable'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.whatsapp_records(id,org_id,kind,payload,is_simulation) VALUES(id0,_org_id,_payload->>'kind',_payload,true) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now();
ELSE RAISE EXCEPTION 'invalid_kind'; END IF;
PERFORM public.write_audit(_org_id,_kind||'.saved',id0::text,'{}'); RETURN id0;
END $function$;

-- ---------------------------------------------------------------- existing rows
-- The ingredient list was copied into metadata by the previous versions of the function; the rows
-- of recipe_ingredients are the only copy that is read (mapper, sale RPC). Nothing reads
-- metadata.ingredients, so the key is dropped together with any cost snapshot it carried.
UPDATE public.product_recipes SET metadata = metadata - 'ingredients' WHERE metadata ? 'ingredients';
-- The product name shown on the card follows the product the sale RPC actually uses.
UPDATE public.product_recipes r SET metadata = r.metadata || jsonb_build_object('productName', p.name)
  FROM public.menu_products p
 WHERE p.id = r.product_id AND coalesce(r.metadata->>'productName', '') <> p.name;

-- ---------------------------------------------------------------- guard
ALTER TABLE public.product_recipes
  ADD CONSTRAINT product_recipes_metadata_no_ingredients CHECK (NOT (metadata ? 'ingredients')) NOT VALID;
ALTER TABLE public.product_recipes VALIDATE CONSTRAINT product_recipes_metadata_no_ingredients;
