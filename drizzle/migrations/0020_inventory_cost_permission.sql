-- 0020_inventory_cost_permission — inventory costs become their own permission, enforced by the database.
--
-- Before: anyone who could read stock (inventory.view / recipes.view / purchases.view) also read
-- inventory_items.cost_cents and inventory_movements.unit_cost_cents. Now:
--   * new permission inventory.costs (catalog, tier ceilings, system profiles);
--   * the cost COLUMNS are not readable by client roles at all (column-level privileges). A direct
--     query that selects, filters or orders by them fails with "permission denied" for everyone,
--     owners included — clients read costs only through the two functions below;
--   * inventory_item_costs() / inventory_movement_costs() are SECURITY DEFINER, require
--     inventory.costs (owners always hold it) and still apply store access per row;
--   * editing an item without inventory.costs keeps its stored cost (the edit form cannot see it,
--     so it must not overwrite it). Creating an item may still set the initial cost.
-- Purchase-order prices stay readable under purchases.view (they are part of purchasing work) and
-- COGS stays under the financial permissions; both are unchanged.
-- NOTE: column grants do not cover columns added later — a new inventory_items/inventory_movements
-- column must be granted explicitly below (fail-closed).

-- ---------------------------------------------------------------- catalog
create or replace function public.permission_catalog()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'dashboard.view','dashboard.financials',
    'pos.view','pos.sell','pos.discount',
    'orders.view','orders.update','orders.refund',
    'kds.view','kds.operate',
    'menu.view','menu.create','menu.edit','menu.delete',
    'inventory.view','inventory.create','inventory.edit','inventory.adjust','inventory.transfer','inventory.costs',
    'recipes.view','recipes.edit',
    'purchases.view','purchases.create','purchases.approve','purchases.receive','purchases.cancel',
    'suppliers.view','suppliers.edit',
    'finance.view',
    'expenses.view','expenses.create','expenses.edit','expenses.delete','expenses.pay',
    'reports.view','reports.export',
    'team.view','team.invite','team.manage','team.activity',
    'settings.locations','settings.branding','settings.billing'
  ]::text[]
$$;
-- role_ceiling / role_default_permissions derive from the catalog: managers get inventory.costs by
-- default (they already saw costs); staff without a profile do NOT (least privilege) — an owner can
-- grant it per member or through a profile.

-- System templates: admin, store manager, stock keeper and finance work with costs; cashier and
-- kitchen do not. (profile_refresh_members recomputes members that use them.)
update public.permission_profiles
   set permissions = array(select distinct p from unnest(permissions || array['inventory.costs']) p order by p)
 where is_system and key in ('org_admin','manager','stock','finance')
   and not ('inventory.costs' = any(permissions));

-- Every member's materialized set (also covers members without a profile).
update public.organization_members
   set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions);

-- ---------------------------------------------------------------- column privileges
revoke select on public.inventory_items from anon, authenticated;
grant select (id, org_id, location_id, client_id, name, category, sku, unit, quantity, min_quantity,
              supplier, expiration_date, active, updated_at)
  on public.inventory_items to authenticated;

revoke select on public.inventory_movements from anon, authenticated;
grant select (id, org_id, location_id, inventory_item_id, order_id, delta, kind, client_event_id,
              reverses_id, reason, actor_id, created_at, request_hash)
  on public.inventory_movements to authenticated;

-- ---------------------------------------------------------------- cost readers
create or replace function public.inventory_item_costs(_org_id uuid)
returns table (item_id uuid, cost_cents integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(_org_id) then raise exception 'forbidden'; end if;
  if not public.has_permission(_org_id, 'inventory.costs') then raise exception 'permission_denied'; end if;
  return query
    select i.id, i.cost_cents from public.inventory_items i
     where i.org_id = _org_id and public.can_access_location(i.location_id);
end $$;

create or replace function public.inventory_movement_costs(_org_id uuid, _movement_ids uuid[])
returns table (movement_id uuid, unit_cost_cents integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(_org_id) then raise exception 'forbidden'; end if;
  if not public.has_permission(_org_id, 'inventory.costs') then raise exception 'permission_denied'; end if;
  if coalesce(array_length(_movement_ids, 1), 0) > 1000 then raise exception 'too_many_ids'; end if;
  return query
    select m.id, m.unit_cost_cents from public.inventory_movements m
     where m.org_id = _org_id and m.id = any(_movement_ids) and public.can_access_location(m.location_id);
end $$;

revoke all on function public.inventory_item_costs(uuid), public.inventory_movement_costs(uuid, uuid[])
  from public, anon;
grant execute on function public.inventory_item_costs(uuid), public.inventory_movement_costs(uuid, uuid[])
  to authenticated;

-- ---------------------------------------------------------------- writes
-- Same function as before; only change: the inventory UPDATE keeps cost_cents unless the caller
-- holds inventory.costs at that store.
CREATE OR REPLACE FUNCTION public.save_operational_record(_org_id uuid, _location_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE id0 uuid; item jsonb; ref uuid; product uuid; category text; existing public.inventory_items; recipe public.product_recipes; po public.purchase_orders; BEGIN
IF _kind='whatsapp' THEN IF auth.uid() IS NULL OR NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_org_operational(_org_id);ELSIF _kind='supplier' THEN IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id,'suppliers.edit'); PERFORM public.assert_org_operational(_org_id);ELSE PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id, CASE _kind WHEN 'inventory' THEN CASE WHEN coalesce(_payload->>'id','')='' THEN 'inventory.create' ELSE 'inventory.edit' END WHEN 'recipe' THEN 'recipes.edit' WHEN 'purchase' THEN 'purchases.create' WHEN 'expense' THEN CASE WHEN coalesce(_payload->>'id','')='' THEN 'expenses.create' ELSE 'expenses.edit' END ELSE 'invalid_kind' END, _location_id); IF _kind='purchase' AND coalesce(_payload->>'status','draft')='sent' THEN PERFORM public.assert_permission(_org_id,'purchases.approve',_location_id); END IF; IF _kind='expense' AND coalesce(_payload->>'status','')='paid' AND NOT EXISTS(SELECT 1 FROM public.finance_expenses WHERE id::text=coalesce(_payload->>'id','') AND payload->>'status'='paid') THEN PERFORM public.assert_permission(_org_id,'expenses.pay',_location_id); END IF; IF _kind='expense' AND coalesce((_payload->>'active')::boolean,true)=false THEN PERFORM public.assert_permission(_org_id,'expenses.delete',_location_id); END IF; END IF;
IF jsonb_typeof(_payload)<>'object' THEN RAISE EXCEPTION 'invalid_payload'; END IF;
IF coalesce(_payload->>'id','')<>'' THEN id0:=(_payload->>'id')::uuid; END IF;
IF _kind='inventory' THEN IF NOT (_payload ? 'quantity' AND _payload ? 'costCents' AND _payload ? 'unit') OR _payload->>'quantity' IS NULL OR _payload->>'costCents' IS NULL OR _payload->>'unit' NOT IN('oz','lb','gal','kg','units','pack') THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR (_payload->>'costCents')::int<0 OR (_payload->>'quantity')::numeric<0 THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO existing FROM public.inventory_items WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF existing.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 UPDATE public.inventory_items SET name=_payload->>'name',category=coalesce(_payload->>'category','dry_goods'),sku=coalesce(_payload->>'sku',''),min_quantity=coalesce((_payload->>'minQuantity')::numeric,0),cost_cents=CASE WHEN public.has_permission(_org_id,'inventory.costs',_location_id) THEN (_payload->>'costCents')::int ELSE cost_cents END,supplier=coalesce(_payload->>'supplier',''),active=coalesce((_payload->>'active')::boolean,true),updated_at=now() WHERE id=id0;
 ELSE id0:=gen_random_uuid(); INSERT INTO public.inventory_items(id,org_id,location_id,client_id,name,category,sku,unit,quantity,min_quantity,cost_cents,supplier) VALUES(id0,_org_id,_location_id,id0::text,_payload->>'name',coalesce(_payload->>'category','dry_goods'),coalesce(_payload->>'sku',''),_payload->>'unit',(_payload->>'quantity')::numeric,coalesce((_payload->>'minQuantity')::numeric,0),(_payload->>'costCents')::int,coalesce(_payload->>'supplier',''));
 IF (_payload->>'quantity')::numeric>0 THEN INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,id0,(_payload->>'quantity')::numeric,(_payload->>'costCents')::int,'opening','opening:'||id0::text,'Opening stock',auth.uid()); END IF; END IF;
ELSIF _kind='recipe' THEN
 SELECT id INTO product FROM public.menu_products WHERE org_id=_org_id AND (id::text=_payload->>'productId' OR client_id=_payload->>'productId') AND active AND (cardinality(location_ids)=0 OR _location_id=ANY(location_ids)); IF product IS NULL THEN RAISE EXCEPTION 'product_required'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO recipe FROM public.product_recipes WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF recipe.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; END IF;
 IF jsonb_typeof(_payload->'ingredients')<>'array' OR jsonb_array_length(_payload->'ingredients')=0 THEN RAISE EXCEPTION 'ingredients_required'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.product_recipes(id,org_id,location_id,product_id,servings,yield_quantity,yield_unit,instructions,metadata) VALUES(id0,_org_id,_location_id,product,(_payload->>'servings')::numeric,coalesce((_payload->>'yieldQuantity')::numeric,1),coalesce(_payload->>'yieldUnit','units'),coalesce(_payload->>'prepInstructions',''),_payload)
 ON CONFLICT(id) DO UPDATE SET servings=EXCLUDED.servings,yield_quantity=EXCLUDED.yield_quantity,yield_unit=EXCLUDED.yield_unit,instructions=EXCLUDED.instructions,metadata=EXCLUDED.metadata,updated_at=now();
 DELETE FROM public.recipe_ingredients WHERE recipe_id=id0;
 FOR item IN SELECT * FROM jsonb_array_elements(_payload->'ingredients') LOOP
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
 IF jsonb_typeof(_payload->'items')<>'array' OR jsonb_array_length(_payload->'items')=0 THEN RAISE EXCEPTION 'items_required'; END IF;
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
