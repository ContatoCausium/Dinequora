-- 0025: one sales-tax rate per store, applied by the server.
--
-- Before: the POS sent the rate it wanted (_tax_rate_basis_points, hard-coded 8.88% in the client)
-- and create_pos_sale only range-checked it, so every tenant collected 8.88% and any caller with
-- pos.sell could record a sale at 0% (or 100%). Integer basis points also cannot express common US
-- rates with three decimals (6.625% NJ, 8.875% NYC, 9.025% Minneapolis).
--
-- Now:
--   - locations.tax_rate_ppm (parts per million: 1,000,000 = 100%; 88,750 = 8.875%). NULL means
--     "not configured": the store cannot record sales until an owner, or a manager holding
--     settings.locations for that store, sets it (set_location_tax_rate, audited). 0 is a valid,
--     explicit rate.
--   - orders.tax_rate_ppm records the exact rate charged. tax_rate_basis_points stays filled
--     (round(ppm / 100)) for the readers that still use it; existing orders get ppm = bp x 100.
--   - create_pos_sale_v2 / finalize_pos_sale_atomic_v2 / persist_finalized_pos_sale_atomic_v2 take
--     _tax_rate_ppm: the rate the client DISPLAYED, used only as a confirmation. The tax charged
--     is always round((subtotal - discount) x store_ppm / 1,000,000) from the store's own rate; a
--     store without a rate raises tax_rate_not_configured and a client whose rate differs from
--     the store's raises tax_rate_changed (never silently charged a different amount).
--   - the previous signatures keep working (policy: a signature change is a new function) and
--     now delegate to v2 with bp x 100, so they enforce the same rule: an old client can confirm
--     a two-decimal rate, never bypass the store's rate.
--
-- This is a single flat rate per store. It is not a US sales-tax engine: no jurisdiction tables,
-- product tax categories, exemptions, inclusive pricing or filing. The tax_engine feature of 0022
-- stays reserved for that; the basic rate here is not gated by any feature.

-- ---------------------------------------------------------------- stores
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS tax_rate_ppm integer;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_tax_rate_ppm_chk;
ALTER TABLE public.locations ADD CONSTRAINT locations_tax_rate_ppm_chk
  CHECK (tax_rate_ppm IS NULL OR tax_rate_ppm BETWEEN 0 AND 1000000) NOT VALID;
ALTER TABLE public.locations VALIDATE CONSTRAINT locations_tax_rate_ppm_chk;
COMMENT ON COLUMN public.locations.tax_rate_ppm IS
  'Sales-tax rate charged by the POS at this store, in parts per million (88750 = 8.875%). NULL = not configured: no sale can be recorded.';

-- ---------------------------------------------------------------- orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_rate_ppm integer;
UPDATE public.orders SET tax_rate_ppm = tax_rate_basis_points * 100 WHERE tax_rate_ppm IS NULL;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tax_rate_ppm_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_tax_rate_ppm_chk
  CHECK (tax_rate_ppm IS NULL OR tax_rate_ppm BETWEEN 0 AND 1000000) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_tax_rate_ppm_chk;
COMMENT ON COLUMN public.orders.tax_rate_ppm IS
  'Exact sales-tax rate charged (parts per million). tax_rate_basis_points = round(tax_rate_ppm / 100) is kept for older readers.';

-- ---------------------------------------------------------------- store setting
-- Same authorization as update_location (0018): a member who is not staff, with access to the
-- store; owners always, managers through settings.locations at that store. Audited with the
-- previous and the new rate.
CREATE OR REPLACE FUNCTION public.set_location_tax_rate(_location_id uuid, _tax_rate_ppm integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _loc public.locations; _me public.organization_members;
begin
  select * into _loc from public.locations where id = _location_id for update;
  if _loc.id is null then raise exception 'forbidden'; end if;
  _me := public.my_member(_loc.org_id);
  if _me.id is null or _me.role = 'staff' or not public.can_access_location(_location_id) then raise exception 'forbidden'; end if;
  if _me.role <> 'owner' then perform public.assert_permission(_loc.org_id, 'settings.locations', _location_id); end if;
  perform public.assert_org_operational(_loc.org_id);
  if _tax_rate_ppm is null or _tax_rate_ppm not between 0 and 1000000 then raise exception 'invalid_tax_rate'; end if;
  update public.locations set tax_rate_ppm = _tax_rate_ppm, updated_at = now() where id = _location_id;
  perform public.write_audit(_loc.org_id, 'location.tax_rate_updated', _loc.name,
    jsonb_build_object('location_id', _location_id, 'from_ppm', _loc.tax_rate_ppm, 'to_ppm', _tax_rate_ppm));
end $function$;
REVOKE ALL ON FUNCTION public.set_location_tax_rate(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_location_tax_rate(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------- sale RPCs (v2: rate in ppm)
-- create_pos_sale_v2 is create_pos_sale (0018) with the tax taken from the store; everything else
-- (scope, permissions, prices, modifiers, discount, idempotency, audit) is unchanged.
CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_ppm integer DEFAULT NULL::integer, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE existing public.orders; oid uuid; iid uuid; p public.menu_products; it jsonb; m jsonb; g jsonb; opt jsonb; q int; base int; mods int; subtotal int:=0; tax int; store_ppm int; fingerprint text; n int; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id); IF coalesce(_discount_cents,0)>0 THEN PERFORM public.assert_permission(_org_id,'pos.discount',_location_id); END IF;
IF _is_simulation AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=_org_id AND is_demo) THEN RAISE EXCEPTION 'simulation_forbidden'; END IF;
IF coalesce(length(trim(_client_order_id)),0) NOT BETWEEN 1 AND 160 OR _discount_cents IS NULL OR _discount_cents<0 OR _tax_rate_ppm IS NULL OR _tax_rate_ppm NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'invalid_sale'; END IF;
IF jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'order_empty'; END IF;
fingerprint:=encode(extensions.digest(jsonb_build_object('location',_location_id,'type',_type,'items',_items,'discount',_discount_cents,'tax',_tax_rate_ppm,'simulation',_is_simulation,'customer',_customer_name,'phone',_customer_phone,'email',_customer_email,'address',_delivery_address,'table',_table_number,'notes',_notes)::text,'sha256'),'hex');
PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text||':'||trim(_client_order_id),0));
SELECT * INTO existing FROM public.orders WHERE org_id=_org_id AND client_order_id=trim(_client_order_id);
IF existing.id IS NOT NULL THEN IF existing.request_hash<>fingerprint OR existing.location_id<>_location_id THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN existing.id; END IF;
-- The rate charged is the store's configured rate (0025). The client sends the rate it displayed only as a confirmation: a store without a rate cannot sell, and a stale client is refused instead of silently charged a different amount.
SELECT l.tax_rate_ppm INTO store_ppm FROM public.locations l WHERE l.id=_location_id AND l.org_id=_org_id;
IF store_ppm IS NULL THEN RAISE EXCEPTION 'tax_rate_not_configured'; END IF; IF store_ppm<>_tax_rate_ppm THEN RAISE EXCEPTION 'tax_rate_changed'; END IF;
oid:=gen_random_uuid();
INSERT INTO public.orders(id,org_id,location_id,order_number,type,customer_name,customer_phone,customer_email,delivery_address,table_number,notes,discount_cents,tax_rate_basis_points,tax_rate_ppm,is_simulation,created_by,client_order_id,request_hash) VALUES(oid,_org_id,_location_id,'#'||upper(left(oid::text,8)),_type,coalesce(nullif(trim(_customer_name),''),'Walk-in'),_customer_phone,_customer_email,_delivery_address,_table_number,_notes,0,round(store_ppm/100.0)::int,store_ppm,_is_simulation,auth.uid(),trim(_client_order_id),fingerprint);
FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
SELECT * INTO p FROM public.menu_products WHERE org_id=_org_id AND (id::text=it->>'product_id' OR client_id=it->>'product_id') AND active FOR SHARE;
IF p.id IS NULL OR (cardinality(p.location_ids)>0 AND NOT _location_id=ANY(p.location_ids)) THEN RAISE EXCEPTION 'product_not_in_store'; END IF;
q:=(it->>'quantity')::int; IF q IS NULL OR q NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_quantity'; END IF; base:=p.price_cents; mods:=0;
IF jsonb_typeof(coalesce(it->'modifiers','[]'))<>'array' THEN RAISE EXCEPTION 'invalid_modifiers'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) x GROUP BY x->>'group_id',x->>'option_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_modifier'; END IF;
FOR g IN SELECT * FROM jsonb_array_elements(p.modifier_groups) LOOP SELECT count(*) INTO n FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) x WHERE x->>'group_id'=g->>'id'; IF n<greatest(coalesce((g->>'minSelections')::int,0),CASE WHEN coalesce((g->>'required')::boolean,false) THEN 1 ELSE 0 END) OR n>coalesce((g->>'maxSelections')::int,1) THEN RAISE EXCEPTION 'modifier_selection_invalid'; END IF; END LOOP;
FOR m IN SELECT * FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) LOOP SELECT x INTO g FROM jsonb_array_elements(p.modifier_groups) x WHERE x->>'id'=m->>'group_id'; SELECT x INTO opt FROM jsonb_array_elements(coalesce(g->'options','[]')) x WHERE x->>'id'=m->>'option_id'; IF opt IS NULL THEN RAISE EXCEPTION 'modifier_not_in_product'; END IF; mods:=mods+(opt->>'priceCents')::int; END LOOP;
subtotal:=subtotal+(base+mods)*q;
INSERT INTO public.order_items(org_id,location_id,order_id,product_id,product_name,unit_price_cents,quantity,subtotal_cents,notes) VALUES(_org_id,_location_id,oid,p.id,p.name,base,q,(base+mods)*q,it->>'notes') RETURNING id INTO iid;
FOR m IN SELECT * FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) LOOP SELECT x INTO g FROM jsonb_array_elements(p.modifier_groups) x WHERE x->>'id'=m->>'group_id'; SELECT x INTO opt FROM jsonb_array_elements(g->'options') x WHERE x->>'id'=m->>'option_id'; INSERT INTO public.order_item_modifiers(order_item_id,option_id,group_id,group_name,option_name,price_cents) VALUES(iid,opt->>'id',g->>'id',g->>'name',opt->>'name',(opt->>'priceCents')::int); END LOOP; END LOOP;
IF _discount_cents>subtotal THEN RAISE EXCEPTION 'invalid_discount'; END IF; tax:=round((subtotal-_discount_cents)::numeric*store_ppm/1000000);
UPDATE public.orders SET subtotal_cents=subtotal,discount_cents=_discount_cents,tax_cents=tax,total_cents=subtotal-_discount_cents+tax WHERE id=oid;
INSERT INTO public.order_status_history(org_id,location_id,order_id,to_status,actor_id,reason) VALUES(_org_id,_location_id,oid,'new',auth.uid(),'Order created');
PERFORM public.write_audit(_org_id,'orders.created',oid::text,jsonb_build_object('client_order_id',_client_order_id)); RETURN oid; END $function$;

CREATE OR REPLACE FUNCTION public.finalize_pos_sale_atomic_v2(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_ppm integer DEFAULT NULL::integer, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text, _payment_method text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE oid uuid; ord public.orders; pay public.payments; stock public.inventory_items; req record; cost int:=0; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id); IF _payment_method NOT IN('cash','card','digital') OR _payment_method IS NULL THEN RAISE EXCEPTION 'invalid_payment'; END IF;
oid:=public.create_pos_sale_v2(_org_id,_location_id,_type,_customer_name,_customer_phone,_customer_email,_delivery_address,_table_number,_notes,_discount_cents,_tax_rate_ppm,_items,_is_simulation,_client_order_id);
SELECT * INTO ord FROM public.orders WHERE id=oid FOR UPDATE; SELECT * INTO pay FROM public.payments WHERE order_id=oid;
IF pay.id IS NOT NULL THEN IF pay.method<>_payment_method THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN oid; END IF; IF ord.status='cancelled' THEN RAISE EXCEPTION 'order_cancelled'; END IF;
IF NOT ord.is_simulation THEN
FOR req IN SELECT ri.inventory_item_id,sum(public.operational_unit_quantity(ri.quantity,ri.unit,s.unit)*(1+ri.waste_percentage/100)*oi.quantity/r.servings) AS qty FROM public.order_items oi JOIN public.product_recipes r ON r.product_id=oi.product_id AND r.org_id=_org_id AND r.location_id=_location_id JOIN public.recipe_ingredients ri ON ri.recipe_id=r.id JOIN public.inventory_items s ON s.id=ri.inventory_item_id WHERE oi.order_id=oid GROUP BY ri.inventory_item_id ORDER BY ri.inventory_item_id LOOP
SELECT * INTO stock FROM public.inventory_items WHERE id=req.inventory_item_id AND org_id=_org_id AND location_id=_location_id FOR UPDATE;
IF NOT stock.active OR stock.quantity<req.qty THEN RAISE EXCEPTION 'insufficient_stock'; END IF; UPDATE public.inventory_items SET quantity=quantity-req.qty,updated_at=now() WHERE id=stock.id;
INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,order_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,stock.id,oid,-req.qty,stock.cost_cents,'sale','sale:'||oid::text,'Recipe consumption',auth.uid()); cost:=cost+round(req.qty*stock.cost_cents); END LOOP;
INSERT INTO public.finance_entries(org_id,location_id,order_id,kind,amount_cents,client_event_id,description,actor_id) VALUES(_org_id,_location_id,oid,'revenue',ord.total_cents-ord.tax_cents,'sale:'||oid::text,'POS net of tax',auth.uid()),(_org_id,_location_id,oid,'cogs',cost,'sale:'||oid::text,'Recipe cost (configured ingredients only)',auth.uid()); END IF;
INSERT INTO public.payments(org_id,location_id,order_id,method,amount_cents) VALUES(_org_id,_location_id,oid,_payment_method,ord.total_cents);
UPDATE public.orders SET status='confirmed',updated_at=now() WHERE id=oid; INSERT INTO public.order_status_history(org_id,location_id,order_id,from_status,to_status,actor_id,reason) VALUES(_org_id,_location_id,oid,ord.status,'confirmed',auth.uid(),'Payment recorded (not provider capture)');
PERFORM public.write_audit(_org_id,'pos.finalized',oid::text,jsonb_build_object('payment_method',_payment_method)); RETURN oid; END $function$;

CREATE OR REPLACE FUNCTION public.persist_finalized_pos_sale_atomic_v2(_org_id uuid, _location_id uuid, _type public.order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_ppm integer DEFAULT NULL::integer, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text, _payment_method text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT public.finalize_pos_sale_atomic_v2(_org_id,_location_id,_type,_customer_name,_customer_phone,_customer_email,_delivery_address,_table_number,_notes,_discount_cents,_tax_rate_ppm,_items,_is_simulation,_client_order_id,_payment_method) $function$;

REVOKE ALL ON FUNCTION public.create_pos_sale_v2(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_pos_sale_atomic_v2(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.persist_finalized_pos_sale_atomic_v2(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_v2(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_pos_sale_atomic_v2(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_finalized_pos_sale_atomic_v2(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) TO authenticated;

-- ---------------------------------------------------------------- previous signatures: delegate
-- Same signatures, grants and permission checks as 0018; the basis points become ppm (x 100) and
-- the store rule of v2 applies. A caller sending the hard-coded 888 to a store configured at
-- 8.88% is confirmed; at any other rate it is refused with tax_rate_changed.
CREATE OR REPLACE FUNCTION public.create_pos_sale(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_basis_points integer DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id);
IF _tax_rate_basis_points IS NULL OR _tax_rate_basis_points NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_sale'; END IF;
RETURN public.create_pos_sale_v2(_org_id,_location_id,_type,_customer_name,_customer_phone,_customer_email,_delivery_address,_table_number,_notes,_discount_cents,_tax_rate_basis_points*100,_items,_is_simulation,_client_order_id);
END $function$;

CREATE OR REPLACE FUNCTION public.finalize_pos_sale_atomic(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_basis_points integer DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text, _payment_method text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id);
IF _tax_rate_basis_points IS NULL OR _tax_rate_basis_points NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_sale'; END IF;
RETURN public.finalize_pos_sale_atomic_v2(_org_id,_location_id,_type,_customer_name,_customer_phone,_customer_email,_delivery_address,_table_number,_notes,_discount_cents,_tax_rate_basis_points*100,_items,_is_simulation,_client_order_id,_payment_method);
END $function$;
-- persist_finalized_pos_sale_atomic (0013, SQL wrapper) is unchanged: it calls finalize_pos_sale_atomic above.
