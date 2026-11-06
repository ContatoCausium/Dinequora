-- Durable operations, audited writes only. Reconstructed, not original definitions.
ALTER TABLE public.product_recipes ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.purchase_orders ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE TABLE public.finance_expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id),location_id uuid NOT NULL REFERENCES public.locations(id),payload jsonb NOT NULL,active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.finance_expenses TO authenticated; GRANT ALL ON public.finance_expenses TO service_role;
ALTER TABLE public.finance_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_read ON public.finance_expenses FOR SELECT TO authenticated USING(public.is_org_member(org_id) AND public.can_access_location(location_id) AND public.can_manage_org(org_id));
CREATE TRIGGER expense_location BEFORE INSERT OR UPDATE ON public.finance_expenses FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();
CREATE INDEX expense_org_store ON public.finance_expenses(org_id,location_id);
CREATE FUNCTION public.save_operational_record(_org_id uuid,_location_id uuid,_kind text,_payload jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id0 uuid; item jsonb; ref uuid; product uuid; category text; existing public.inventory_items; recipe public.product_recipes; po public.purchase_orders; BEGIN
IF _kind IN('supplier','whatsapp') THEN IF auth.uid() IS NULL OR NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_org_operational(_org_id); ELSE PERFORM public.assert_operational_scope(_org_id,_location_id,true); END IF;
IF jsonb_typeof(_payload)<>'object' THEN RAISE EXCEPTION 'invalid_payload'; END IF;
IF coalesce(_payload->>'id','')<>'' THEN id0:=(_payload->>'id')::uuid; END IF;
IF _kind='inventory' THEN
 IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR (_payload->>'costCents')::int<0 OR (_payload->>'quantity')::numeric<0 THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO existing FROM public.inventory_items WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF existing.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 UPDATE public.inventory_items SET name=_payload->>'name',category=coalesce(_payload->>'category','dry_goods'),sku=coalesce(_payload->>'sku',''),min_quantity=coalesce((_payload->>'minQuantity')::numeric,0),cost_cents=(_payload->>'costCents')::int,supplier=coalesce(_payload->>'supplier',''),active=coalesce((_payload->>'active')::boolean,true),updated_at=now() WHERE id=id0;
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
END $$;
REVOKE ALL ON FUNCTION public.save_operational_record(uuid,uuid,text,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.save_operational_record(uuid,uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.record_operational_movement(_org_id uuid,_location_id uuid,_item_id uuid,_type text,_quantity numeric,_reason text,_client_event_id text,_target_location_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item public.inventory_items; target public.inventory_items; prior public.inventory_movements; d numeric; mid uuid; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id,true);
IF _client_event_id IS NULL OR length(_client_event_id) NOT BETWEEN 1 AND 160 OR _quantity IS NULL OR _quantity<0 OR coalesce(length(trim(_reason)),0)=0 THEN RAISE EXCEPTION 'invalid_movement'; END IF;
IF _type='transfer' THEN PERFORM public.assert_operational_scope(_org_id,_target_location_id,true); IF _target_location_id=_location_id THEN RAISE EXCEPTION 'invalid_transfer'; END IF; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text||':'||_client_event_id,0));
SELECT * INTO item FROM public.inventory_items WHERE id=_item_id AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF item.id IS NULL OR NOT item.active THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT * INTO prior FROM public.inventory_movements WHERE org_id=_org_id AND client_event_id=_client_event_id AND inventory_item_id=_item_id;
IF prior.id IS NOT NULL THEN IF prior.reason<>_reason THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN prior.id; END IF;
d:=CASE _type WHEN 'in' THEN _quantity WHEN 'out' THEN -_quantity WHEN 'loss' THEN -_quantity WHEN 'transfer' THEN -_quantity WHEN 'adjustment' THEN _quantity-item.quantity ELSE NULL END;
IF d IS NULL OR d=0 OR item.quantity+d<0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
UPDATE public.inventory_items SET quantity=quantity+d,updated_at=now() WHERE id=_item_id;
INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,_item_id,d,item.cost_cents,CASE WHEN _type='transfer' THEN 'transfer_out' ELSE 'adjustment' END,_client_event_id,_reason,auth.uid()) RETURNING id INTO mid;
IF _type='transfer' THEN
 SELECT * INTO target FROM public.inventory_items WHERE org_id=_org_id AND location_id=_target_location_id AND client_id=item.client_id FOR UPDATE;
 IF target.id IS NULL THEN INSERT INTO public.inventory_items(org_id,location_id,client_id,name,category,sku,unit,quantity,min_quantity,cost_cents,supplier) VALUES(_org_id,_target_location_id,item.client_id,item.name,item.category,item.sku,item.unit,0,item.min_quantity,item.cost_cents,item.supplier) RETURNING * INTO target; END IF;
 IF target.unit<>item.unit THEN RAISE EXCEPTION 'incompatible_units'; END IF;
 UPDATE public.inventory_items SET quantity=quantity+_quantity,updated_at=now() WHERE id=target.id;
 INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_target_location_id,target.id,_quantity,item.cost_cents,'transfer_in',_client_event_id,_reason,auth.uid()); END IF;
PERFORM public.write_audit(_org_id,'inventory.moved',mid::text,jsonb_build_object('type',_type,'quantity',_quantity)); RETURN mid; END $$;
REVOKE ALL ON FUNCTION public.record_operational_movement(uuid,uuid,uuid,text,numeric,text,text,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.record_operational_movement(uuid,uuid,uuid,text,numeric,text,text,uuid) TO authenticated;
CREATE FUNCTION public.receive_operational_purchase(_purchase_id uuid,_items jsonb,_client_event_id text,_notes text DEFAULT '') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE po public.purchase_orders; it public.purchase_order_items; x jsonb; prior public.purchase_receipts; rid uuid; qty numeric; price int; amount int:=0; fingerprint text; BEGIN
SELECT * INTO po FROM public.purchase_orders WHERE id=_purchase_id FOR UPDATE; IF po.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(po.org_id,po.location_id,true);
IF coalesce(length(trim(_client_event_id)),0) NOT BETWEEN 1 AND 160 OR jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
fingerprint:=encode(extensions.digest(jsonb_build_object('po',_purchase_id,'items',_items,'notes',_notes)::text,'sha256'),'hex');
PERFORM pg_advisory_xact_lock(hashtextextended(po.org_id::text||':'||_client_event_id,0));
SELECT * INTO prior FROM public.purchase_receipts WHERE org_id=po.org_id AND client_event_id=_client_event_id; IF prior.id IS NOT NULL THEN IF prior.payload_hash<>fingerprint THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN prior.id; END IF;
IF po.status NOT IN('sent','partially_received') THEN RAISE EXCEPTION 'purchase_locked'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(_items) x GROUP BY x->>'itemId' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_item'; END IF;
rid:=gen_random_uuid();
FOR x IN SELECT * FROM jsonb_array_elements(_items) ORDER BY value->>'itemId' LOOP
 qty:=(x->>'receivedNow')::numeric; IF qty IS NULL OR qty<0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF; IF qty=0 THEN CONTINUE; END IF;
 SELECT * INTO it FROM public.purchase_order_items WHERE id=(x->>'itemId')::uuid AND purchase_order_id=_purchase_id FOR UPDATE;
 IF it.id IS NULL OR it.quantity_received+qty>it.quantity_ordered THEN RAISE EXCEPTION 'invalid_receipt_quantity'; END IF;
 price:=coalesce((x->>'priceVerifiedCents')::int,it.unit_price_cents); IF price<0 THEN RAISE EXCEPTION 'invalid_price'; END IF;
 UPDATE public.purchase_order_items SET quantity_received=quantity_received+qty,unit_price_cents=price WHERE id=it.id;
 UPDATE public.inventory_items SET quantity=quantity+qty,cost_cents=price,updated_at=now() WHERE id=it.inventory_item_id;
 INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(po.org_id,po.location_id,it.inventory_item_id,qty,price,'receiving','receipt:'||rid::text,_notes,auth.uid()); amount:=amount+round(qty*price);
END LOOP;
IF amount=0 AND NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE client_event_id='receipt:'||rid::text) THEN RAISE EXCEPTION 'empty_receipt'; END IF;
INSERT INTO public.purchase_receipts(id,org_id,location_id,purchase_order_id,client_event_id,payload_hash,items,actor_id) VALUES(rid,po.org_id,po.location_id,_purchase_id,_client_event_id,fingerprint,_items,auth.uid());
UPDATE public.purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id=_purchase_id AND quantity_received<quantity_ordered) THEN 'partially_received' ELSE 'received' END,updated_at=now() WHERE id=_purchase_id;
INSERT INTO public.finance_entries(org_id,location_id,kind,amount_cents,client_event_id,description,actor_id) VALUES(po.org_id,po.location_id,'purchase',amount,'receipt:'||rid::text,'Inventory acquisition (not cash payment)',auth.uid());
PERFORM public.write_audit(po.org_id,'purchase.received',rid::text,jsonb_build_object('purchase_id',_purchase_id)); RETURN rid; END $$;
REVOKE ALL ON FUNCTION public.receive_operational_purchase(uuid,jsonb,text,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.receive_operational_purchase(uuid,jsonb,text,text) TO authenticated;
CREATE FUNCTION public.cancel_operational_purchase(_id uuid,_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE po public.purchase_orders; BEGIN SELECT * INTO po FROM public.purchase_orders WHERE id=_id FOR UPDATE; IF po.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(po.org_id,po.location_id,true); IF po.status='cancelled' THEN RETURN; END IF; IF EXISTS(SELECT 1 FROM public.purchase_receipts WHERE purchase_order_id=_id) THEN RAISE EXCEPTION 'received_purchase_requires_return'; END IF; UPDATE public.purchase_orders SET status='cancelled',updated_at=now() WHERE id=_id; PERFORM public.write_audit(po.org_id,'purchase.cancelled',_id::text,jsonb_build_object('reason',_reason)); END $$;
REVOKE ALL ON FUNCTION public.cancel_operational_purchase(uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.cancel_operational_purchase(uuid,text) TO authenticated;